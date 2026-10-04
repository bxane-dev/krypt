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
import { requireAuth, signToken, verifyToken, type AuthedRequest } from './auth.js';

const app = express();
const server = http.createServer(app);
const origin = process.env.WEB_ORIGIN || 'http://localhost:5173';
const io = new Server(server, { cors: { origin, credentials: false } });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin }));
app.use(express.json({ limit: '8mb' }));

const now = () => new Date().toISOString();
const userFields = `id, username, display_name as displayName, public_key as publicKey, avatar_url as avatarUrl, created_at as createdAt`;

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

app.post('/api/auth/register', async (req, res) => {
  const parsed = z.object({
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
    displayName: z.string().trim().min(1).max(48),
    password: z.string().min(8).max(200),
    publicKey: z.string().min(20).max(500),
    keyBackup: z.string().min(20),
    keySalt: z.string().min(8).max(200)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid registration data', details: parsed.error.flatten() });
  const { username, displayName, password, publicKey, keyBackup, keySalt } = parsed.data;
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Username already exists' });
  const id = nanoid();
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare(`INSERT INTO users (id,username,display_name,password_hash,public_key,key_backup,key_salt,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, username, displayName, passwordHash, publicKey, keyBackup, keySalt, now());
  const token = signToken({ id, username });
  res.status(201).json({ token, user: { id, username, displayName, publicKey, avatarUrl: null }, keyBackup, keySalt });
});

app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ username: z.string().trim().toLowerCase(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid login data' });
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(parsed.data.username) as any;
  if (!row || !(await bcrypt.compare(parsed.data.password, row.password_hash))) return res.status(401).json({ error: 'Invalid username or password' });
  const token = signToken({ id: row.id, username: row.username });
  res.json({ token, user: { id: row.id, username: row.username, displayName: row.display_name, publicKey: row.public_key, avatarUrl: row.avatar_url }, keyBackup: row.key_backup, keySalt: row.key_salt });
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
  if (!isMember(req.params.id, req.user!.id)) return res.status(403).json({ error: 'Forbidden' });
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT 300').all(req.params.id) as any[];
  const rx = reactionMap(rows.map(r => r.id));
  res.json(rows.map(row => viewMessage(row, req.user!.id, rx.get(row.id) || [])));
});

app.post('/api/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
  const conversationId = req.params.id;
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
    socket.data.user = verifyToken(token);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

const online = new Map<string, number>();
io.on('connection', socket => {
  const user = socket.data.user as { id: string; username: string };
  socket.join(`user:${user.id}`);
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
server.listen(port, () => console.log(`KRYPT API listening on http://localhost:${port}`));