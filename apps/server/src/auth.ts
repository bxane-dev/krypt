import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export type AuthUser = { id: string; username: string };
export type AuthedRequest = Request & { user?: AuthUser };

const secret = process.env.JWT_SECRET || 'dev-only-change-me';

export function signToken(user: AuthUser) {
  return jwt.sign(user, secret, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, secret) as AuthUser;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Invalid session' });
  }
}
