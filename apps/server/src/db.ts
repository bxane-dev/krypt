import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'krypt.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  public_key TEXT NOT NULL,
  key_backup TEXT NOT NULL,
  key_salt TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  public_key TEXT NOT NULL DEFAULT '',
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('direct','group')),
  name TEXT,
  direct_key TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id, user_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  envelopes_json TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  reply_to_id TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(message_id, user_id),
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
`);
