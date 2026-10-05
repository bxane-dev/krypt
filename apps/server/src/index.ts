import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from './db.js';
import { requireAuth, signToken, verifyActiveSession, type AuthedRequest } from './auth.js';
import { createOriginPolicy, parseAllowedOrigins } from './origins.js';
import { createAttemptLimiter, normalizeDeviceLabel } from './security.js';

const app = express();
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
const server = http.createServer(app);
const allowedOrigins = parseAllowedOrigins(
  process.env.WEB_ORIGINS,
  process.env.WEB_ORIGIN || 'http://localhost:5173'
);
const allowDesktopOrigins = process.env.ALLOW_DESKTOP_ORIGINS === 'true';
const originPolicy = createOriginPolicy(allowedOrigins, allowDesktopOrigins);
const corsOptions = {
  origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
    if (originPolicy(origin)) return callback(null, true);
    callback(new Error('Origin not allowed by KRYPT CORS policy'));
  },
  credentials: false
};
const io = new Server(server, { cors: corsOptions });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '8mb' }));

const now = () => new Date().toISOString();
const userFields = `id, username, display_name as displayName, public_key as publicKey, avatar_url as avatarUrl, created_at as createdAt`;
const authIpLimiter = createAttemptLimiter({ maxAttempts: 30, windowMs: 10 * 60_000 });
const authIdentityLimiter = createAttemptLimiter({ maxAttempts: 10, windowMs: 10 * 60_000 });
const deviceSchema = z.object({
  id: z.string().min(6).max(100).nullable().optional(),
  name: z.string().max(120).optional(),
  platform: z.string().max(48).optional(),
  publicKey: z.string().max(500).optional()
}).optional();

function authIdentityKey(req: express.Request) {
  const username = String(req.body?.username || '').trim().toLowerCase() || 'anonymous';
  return `${req.ip || 'unknown'}|${username}`;
}

function authRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ipResult = authIpLimiter.consume(req.ip || 'unknown');
  const identityResult = authIdentityLimiter.consume(authIdentityKey(req));
  const blocked = !ipResult.allowed ? ipResult : !identityResult.allowed ? identityResult : null;
  if (!blocked) return next();
  res.setHeader('Retry-After', String(Math.ceil(blocked.retryAfterMs / 1000)));
  return res.status(429).json({ error: 'Too many authentication attempts. Try again later.' });
}

function createDeviceSession(user: { id: string; username: string }, input?: z.infer<typeof deviceSchema>) {
  const device = input || {};
  const at = now();
  let deviceId = device.id || '';
  const existing = deviceId
    ? db.prepare('SELECT id,user_id,revoked_at FROM devices WHERE id=?').get(deviceId) as any
    : null;

  if (!existing || existing.user_id !== user.id || existing.revoked_at) {
    deviceId = nanoid();
    db.prepare(`
      INSERT INTO devices (id,user_id,name,platform,public_key,key_version,created_at,last_seen_at)
      VALUES (?,?,?,?,?,1,?,?)
    `).run(
      deviceId,
      user.id,
      normalizeDeviceLabel(device.name),
      (device.platform || 'Legacy').slice(0, 48),
      (device.publicKey || '').slice(0, 500),
      at,
      at
    );
  } else {
    const priorSessions = db.prepare(
      'SELECT id FROM sessions WHERE device_id=? AND user_id=? AND revoked_at IS NULL'
    ).all(deviceId, user.id) as any[];
    const incomingKey = (device.publicKey || '').slice(0, 500);
    db.prepare(`
      UPDATE devices
      SET name=?,
          platform=?,
          key_version=CASE WHEN ?<>'' AND public_key<>? THEN key_version+1 ELSE key_version END,
          public_key=CASE WHEN ?<>'' THEN ? ELSE public_key END,
          last_seen_at=?
      WHERE id=? AND user_id=?
    `).run(
      normalizeDeviceLabel(device.name),
      (device.platform || 'Legacy').slice(0, 48),
      incomingKey,
      incomingKey,
      incomingKey,
      incomingKey,
      at,
      deviceId,
      user.id
    );
    db.prepare('UPDATE sessions SET revoked_at=? WHERE device_id=? AND revoked_at IS NULL').run(at, deviceId);
    revokeSessions(priorSessions.map(row => row.id));
  }

  const sessionId = nanoid();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  db.prepare(`
    INSERT INTO sessions (id,user_id,device_id,created_at,last_seen_at,expires_at)
    VALUES (?,?,?,?,?,?)
  `).run(sessionId, user.id, deviceId, at, at, expiresAt);

  return {
    deviceId,
    sessionId,
    token: signToken({ id: user.id, username: user.username, sessionId, deviceId })
  };
}

function revokeSessions(sessionIds: string[]) {
  for (const sessionId of sessionIds) {
    io.to(`session:${sessionId}`).emit('session:revoked');
    io.in(`session:${sessionId}`).disconnectSockets(true);
  }
}

function isMember(conversationId: string, userId: string) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId);
}

function membersFor(conversationId: string) {
  return db.prepare(`SELECT u.${userFields.replaceAll(', ', ', u.')}, cm.role FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=? ORDER BY u.display_name`).all(conversationId) as any[];
}

function reactionMap(messageIds: string[]) {
  if (!messageIds.length) return new Map<string, any[]>();
  const marks = messageIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT r.message_id as messageId, r.user_id as userId, r.emoji, u.username FROM reactions r JOIN users u ON u.id=r.user_id WHERE r.message_id IN (${marks})`).all(...messageIds) as any[];
  const map = new Map<string, any[]>();
  for (const row of rows) map.set(row.messageId, [...(map.get(row.messageId) || []), row]);
  return map;
}

function viewMessage(row: any, userId: string, reactions: any[] = []) {
  const envelopes = JSON.parse(row.envelopes_json || '{}');
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    envelope: envelopes[userId] || null,
    type: row.type,
    replyToId: row.reply_to_id,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    reactions
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'krypt-api' }));

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  const parsed = z.object({
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
    displayName: z.string().trim().min(1).max(48),
    password: z.string().min(8).max(200),
    publicKey: z.string().min(20).max(500),
    keyBackup: z.string().min(20),
    keySalt: z.string().min(8).max(200),
    device: deviceSchema
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid registration data', details: parsed.error.flatten() });
  const { username, displayName, password, publicKey, keyBackup, keySalt, device } = parsed.data;
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Username already exists' });
  const id = nanoid();
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare(`INSERT INTO users (id,username,display_name,password_hash,public_key,key_backup,key_salt,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, username, displayName, passwordHash, publicKey, keyBackup, keySalt, now());
  const session = createDeviceSession({ id, username }, device);
  authIdentityLimiter.reset(authIdentityKey(req));
  res.status(201).json({ ...session, user: { id, username, displayName, publicKey, avatarUrl: null }, keyBackup, keySalt });
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const parsed = z.object({
    username: z.string().trim().toLowerCase(),
    password: z.string(),
    device: deviceSchema
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid login data' });
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(parsed.data.username) as any;
  if (!row || !(await bcrypt.compare(parsed.data.password, row.password_hash))) return res.status(401).json({ error: 'Invalid username or password' });
  const session = createDeviceSession({ id: row.id, username: row.username }, parsed.data.device);
  authIdentityLimiter.reset(authIdentityKey(req));
  res.json({ ...session, user: { id: row.id, username: row.username, displayName: row.display_name, publicKey: row.public_key, avatarUrl: row.avatar_url }, keyBackup: row.key_backup, keySalt: row.key_salt });
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  const at = now();
  db.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND user_id=?').run(at, req.user!.sessionId, req.user!.id);
  revokeSessions([req.user!.sessionId]);
  res.status(204).end();
});

app.get('/api/devices', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT id, name, platform, public_key as publicKey, key_version as keyVersion,
      created_at as createdAt, last_seen_at as lastSeenAt, revoked_at as revokedAt
    FROM devices
    WHERE user_id=?
    ORDER BY revoked_at IS NOT NULL, last_seen_at DESC
  `).all(req.user!.id) as any[];
  res.json(rows.map(row => ({ ...row, current: row.id === req.user!.deviceId })));
});

app.delete('/api/devices/:id', requireAuth, (req: AuthedRequest, res) => {
  const deviceId = String(req.params.id);
  const device = db.prepare('SELECT id FROM devices WHERE id=? AND user_id=?').get(deviceId, req.user!.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const sessions = db.prepare('SELECT id FROM sessions WHERE device_id=? AND user_id=? AND revoked_at IS NULL').all(deviceId, req.user!.id) as any[];
  const at = now();
  db.transaction(() => {
    db.prepare('UPDATE devices SET revoked_at=? WHERE id=? AND user_id=?').run(at, deviceId, req.user!.id);
    db.prepare('UPDATE sessions SET revoked_at=? WHERE device_id=? AND user_id=? AND revoked_at IS NULL').run(at, deviceId, req.user!.id);
  })();
  revokeSessions(sessions.map(row => row.id));
  res.status(204).end();
});

app.post('/api/devices/:id/key', requireAuth, (req: AuthedRequest, res) => {
  const deviceId = String(req.params.id);
  if (deviceId !== req.user!.deviceId) return res.status(403).json({ error: 'Only the current device can rotate its verification key' });
  const parsed = z.object({ publicKey: z.string().min(20).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid verification key' });
  const at = now();
  db.prepare(`
    UPDATE devices
    SET public_key=?, key_version=key_version+1, last_seen_at=?
    WHERE id=? AND user_id=? AND revoked_at IS NULL
  `).run(parsed.data.publicKey, at, deviceId, req.user!.id);
  const row = db.prepare('SELECT key_version as keyVersion FROM devices WHERE id=?').get(deviceId) as any;
  res.json({ deviceId, keyVersion: row?.keyVersion || 1 });
});

app.get('/api/me', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare(`SELECT ${userFields} FROM users WHERE id=?`).get(req.user!.id);
  res.json(row);
});

app.patch('/api/me', requireAuth, (req: AuthedRequest, res) => {
  const parsed = z.object({ displayName: z.string().trim().min(1).max(48).optional(), avatarUrl: z.string().max(350000).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid profile' });
  if (parsed.data.displayName !== undefined) db.prepare('UPDATE users SET display_name=? WHERE id=?').run(parsed.data.displayName, req.user!.id);
  if (parsed.data.avatarUrl !== undefined) db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(parsed.data.avatarUrl, req.user!.id);
  const row = db.prepare(`SELECT ${userFields} FROM users WHERE id=?`).get(req.user!.id);
  res.json(row);
});

app.get('/api/users', requireAuth, (req: AuthedRequest, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const users = db.prepare(`SELECT ${userFields} FROM users WHERE id<>? AND (username LIKE ? OR display_name LIKE ?) ORDER BY username LIMIT 20`).all(req.user!.id, like, like);
  res.json(users);
});

app.get('/api/conversations', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT c.*, (
      SELECT m.created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1
    ) AS last_message_at
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
    WHERE cm.user_id=? ORDER BY COALESCE(last_message_at,c.created_at) DESC
  `).all(req.user!.id) as any[];
  res.json(rows.map(c => ({ id: c.id, type: c.type, name: c.name, createdAt: c.created_at, lastMessageAt: c.last_message_at, members: membersFor(c.id) })));
});

app.post('/api/conversations/direct', requireAuth, (req: AuthedRequest, res) => {
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success || parsed.data.userId === req.user!.id) return res.status(400).json({ error: 'Invalid user' });
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(parsed.data.userId)) return res.status(404).json({ error: 'User not found' });
  const directKey = [req.user!.id, parsed.data.userId].sort().join(':');
  let c = db.prepare('SELECT * FROM conversations WHERE direct_key=?').get(directKey) as any;
  if (!c) {
    const id = nanoid();
    db.transaction(() => {
      db.prepare('INSERT INTO conversations (id,type,direct_key,created_by,created_at) VALUES (?,\'direct\',?,?,?)').run(id, directKey, req.user!.id, now());
      const add = db.prepare('INSERT INTO conversation_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)');
      add.run(id, req.user!.id, 'member', now());
      add.run(id, parsed.data.userId, 'member', now());
    })();
    c = db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as any;
  }
  res.status(201).json({ id: c.id, type: c.type, name: c.name, createdAt: c.created_at, members: membersFor(c.id) });
});

app.post('/api/conversations/group', requireAuth, (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(64), memberIds: z.array(z.string()).max(50) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid group' });
  const memberIds = [...new Set([req.user!.id, ...parsed.data.memberIds.filter(x => x !== req.user!.id)])];
  const found = db.prepare(`SELECT id FROM users WHERE id IN (${memberIds.map(() => '?').join(',')})`).all(...memberIds) as any[];
  if (found.length !== memberIds.length) return res.status(400).json({ error: 'Unknown group member' });
  const id = nanoid();
  db.transaction(() => {
    db.prepare('INSERT INTO conversations (id,type,name,created_by,created_at) VALUES (?,\'group\',?,?,?)').run(id, parsed.data.name, req.user!.id, now());
    const add = db.prepare('INSERT INTO conversation_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)');
    for (const uid of memberIds) add.run(id, uid, uid === req.user!.id ? 'owner' : 'member', now());
  })();
  res.status(201).json({ id, type: 'group', name: parsed.data.name, createdAt: now(), members: membersFor(id) });
});

app.get('/api/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
  if (!isMember(String(req.params.id), req.user!.id)) return res.status(403).json({ error: 'Forbidden' });
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT 300').all(req.params.id) as any[];
  const rx = reactionMap(rows.map(r => r.id));
  res.json(rows.map(row => viewMessage(row, req.user!.id, rx.get(row.id) || [])));
});

app.post('/api/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
  const conversationId = String(req.params.id);
  if (!isMember(conversationId, req.user!.id)) return res.status(403).json({ error: 'Forbidden' });
  const parsed = z.object({ envelopes: z.record(z.object({ ephemeralPublicKey: z.string(), nonce: z.string(), ciphertext: z.string() })), type: z.enum(['text','image']).default('text'), replyToId: z.string().nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid encrypted message' });
  const memberIds = (db.prepare('SELECT user_id as id FROM conversation_members WHERE conversation_id=?').all(conversationId) as any[]).map(x => x.id);
  if (memberIds.some(id => !parsed.data.envelopes[id])) return res.status(400).json({ error: 'Encrypted envelope required for every member' });
  const id = nanoid();
  const row = { id, conversation_id: conversationId, sender_id: req.user!.id, envelopes_json: JSON.stringify(parsed.data.envelopes), type: parsed.data.type, reply_to_id: parsed.data.replyToId || null, created_at: now(), edited_at: null, deleted_at: null };
  db.prepare('INSERT INTO messages (id,conversation_id,sender_id,envelopes_json,type,reply_to_id,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, conversationId, req.user!.id, row.envelopes_json, row.type, row.reply_to_id, row.created_at);
  for (const uid of memberIds) io.to(`user:${uid}`).emit('message:new', viewMessage(row, uid, []));
  res.status(201).json(viewMessage(row, req.user!.id, []));
});

app.patch('/api/messages/:id', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id) as any;
  if (!row || row.sender_id !== req.user!.id) return res.status(404).json({ error: 'Message not found' });
  const parsed = z.object({ envelopes: z.record(z.object({ ephemeralPublicKey: z.string(), nonce: z.string(), ciphertext: z.string() })), type: z.enum(['text','image']).default('text') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid encrypted message' });
  const memberIds = (db.prepare('SELECT user_id as id FROM conversation_members WHERE conversation_id=?').all(row.conversation_id) as any[]).map(x => x.id);
  if (memberIds.some(id => !parsed.data.envelopes[id])) return res.status(400).json({ error: 'Envelope required for every member' });
  const editedAt = now();
  db.prepare('UPDATE messages SET envelopes_json=?, type=?, edited_at=? WHERE id=?').run(JSON.stringify(parsed.data.envelopes), parsed.data.type, editedAt, row.id);
  const updated = { ...row, envelopes_json: JSON.stringify(parsed.data.envelopes), type: parsed.data.type, edited_at: editedAt };
  for (const uid of memberIds) io.to(`user:${uid}`).emit('message:updated', viewMessage(updated, uid));
  res.json(viewMessage(updated, req.user!.id));
});

app.delete('/api/messages/:id', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id) as any;
  if (!row || row.sender_id !== req.user!.id) return res.status(404).json({ error: 'Message not found' });
  const deletedAt = now();
  db.prepare(`UPDATE messages SET envelopes_json='{}', deleted_at=? WHERE id=?`).run(deletedAt, row.id);
  const memberIds = (db.prepare('SELECT user_id as id FROM conversation_members WHERE conversation_id=?').all(row.conversation_id) as any[]).map(x => x.id);
  for (const uid of memberIds) io.to(`user:${uid}`).emit('message:deleted', { id: row.id, conversationId: row.conversation_id, deletedAt });
  res.status(204).end();
});

app.post('/api/messages/:id/reactions', requireAuth, (req: AuthedRequest, res) => {
  const parsed = z.object({ emoji: z.string().min(1).max(16) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid reaction' });
  const message = db.prepare('SELECT conversation_id FROM messages WHERE id=?').get(req.params.id) as any;
  if (!message || !isMember(message.conversation_id, req.user!.id)) return res.status(404).json({ error: 'Message not found' });
  const existing = db.prepare('SELECT emoji FROM reactions WHERE message_id=? AND user_id=?').get(req.params.id, req.user!.id) as any;
  if (existing?.emoji === parsed.data.emoji) db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=?').run(req.params.id, req.user!.id);
  else db.prepare(`INSERT INTO reactions (message_id,user_id,emoji,created_at) VALUES (?,?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=excluded.emoji, created_at=excluded.created_at`).run(req.params.id, req.user!.id, parsed.data.emoji, now());
  const reactions = db.prepare('SELECT r.message_id as messageId, r.user_id as userId, r.emoji, u.username FROM reactions r JOIN users u ON u.id=r.user_id WHERE r.message_id=?').all(req.params.id);
  const memberIds = (db.prepare('SELECT user_id as id FROM conversation_members WHERE conversation_id=?').all(message.conversation_id) as any[]).map(x => x.id);
  for (const uid of memberIds) io.to(`user:${uid}`).emit('reaction:update', { messageId: req.params.id, reactions });
  res.json(reactions);
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) throw new Error('No token');
    socket.data.user = verifyActiveSession(token);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

const online = new Map<string, number>();
io.on('connection', socket => {
  const user = socket.data.user as { id: string; username: string; sessionId: string; deviceId: string };
  socket.join(`user:${user.id}`);
  socket.join(`session:${user.sessionId}`);
  const rows = db.prepare('SELECT conversation_id as id FROM conversation_members WHERE user_id=?').all(user.id) as any[];
  for (const row of rows) socket.join(`conversation:${row.id}`);
  online.set(user.id, (online.get(user.id) || 0) + 1);
  io.emit('presence:update', { userId: user.id, online: true });

  socket.on('typing', ({ conversationId, isTyping }) => {
    if (!conversationId || !isMember(conversationId, user.id)) return;
    socket.to(`conversation:${conversationId}`).emit('typing', { conversationId, userId: user.id, username: user.username, isTyping: !!isTyping });
  });

  socket.on('conversation:join', (conversationId: string) => {
    if (isMember(conversationId, user.id)) socket.join(`conversation:${conversationId}`);
  });

  socket.on('disconnect', () => {
    const count = Math.max(0, (online.get(user.id) || 1) - 1);
    if (count === 0) {
      online.delete(user.id);
      io.emit('presence:update', { userId: user.id, online: false });
    } else online.set(user.id, count);
  });
});

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => console.log(`KRYPT API listening on http://${host}:${port}`));