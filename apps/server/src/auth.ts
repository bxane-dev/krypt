import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';

export type AuthUser = {
  id: string;
  username: string;
  sessionId: string;
  deviceId: string;
};

export type AuthedRequest = Request & { user?: AuthUser };

const secret = process.env.JWT_SECRET || 'dev-only-change-me';

export function signToken(user: AuthUser) {
  return jwt.sign(user, secret, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, secret) as Partial<AuthUser>;
  if (!payload.id || !payload.username || !payload.sessionId || !payload.deviceId) {
    throw new Error('Invalid session token');
  }
  return payload as AuthUser;
}

export function verifyActiveSession(token: string): AuthUser {
  const user = verifyToken(token);
  const at = new Date().toISOString();
  const row = db.prepare(`
    SELECT s.id
    FROM sessions s
    JOIN devices d ON d.id=s.device_id
    WHERE s.id=? AND s.user_id=? AND s.device_id=?
      AND s.revoked_at IS NULL AND s.expires_at>?
      AND d.revoked_at IS NULL
  `).get(user.sessionId, user.id, user.deviceId, at);

  if (!row) throw new Error('Session revoked or expired');

  db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(at, user.sessionId);
  db.prepare('UPDATE devices SET last_seen_at=? WHERE id=?').run(at, user.deviceId);
  return user;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = verifyActiveSession(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or revoked session' });
  }
}
