import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-session-secret-that-is-long-enough';

const { db } = await import('./db.js');
const { signToken, verifyActiveSession } = await import('./auth.js');

test('live sessions verify and revoked sessions are rejected', () => {
  const at = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  db.prepare(`
    INSERT INTO users (id,username,display_name,password_hash,public_key,key_backup,key_salt,created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run('u1', 'alice', 'Alice', 'hash', 'public-key-value', 'backup-value', 'salt-value', at);

  db.prepare(`
    INSERT INTO devices (id,user_id,name,platform,public_key,key_version,created_at,last_seen_at)
    VALUES (?,?,?,?,?,1,?,?)
  `).run('d1', 'u1', 'Alice laptop', 'Linux', 'device-public-key', at, at);

  db.prepare(`
    INSERT INTO sessions (id,user_id,device_id,created_at,last_seen_at,expires_at)
    VALUES (?,?,?,?,?,?)
  `).run('s1', 'u1', 'd1', at, at, expiresAt);

  const token = signToken({ id: 'u1', username: 'alice', sessionId: 's1', deviceId: 'd1' });
  assert.equal(verifyActiveSession(token).sessionId, 's1');

  db.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').run(new Date().toISOString(), 's1');
  assert.throws(() => verifyActiveSession(token), /revoked|expired/i);
});
