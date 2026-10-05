import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttemptLimiter, normalizeDeviceLabel } from './security.js';

test('auth limiter blocks only after the configured number of attempts', () => {
  let clock = 1_000;
  const limiter = createAttemptLimiter({ maxAttempts: 3, windowMs: 60_000, now: () => clock });
  assert.equal(limiter.consume('alice').allowed, true);
  assert.equal(limiter.consume('alice').allowed, true);
  assert.equal(limiter.consume('alice').allowed, true);
  const blocked = limiter.consume('alice');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);

  clock += 60_001;
  assert.equal(limiter.consume('alice').allowed, true);
});

test('auth limiter can reset a successful identity', () => {
  const limiter = createAttemptLimiter({ maxAttempts: 1, windowMs: 60_000 });
  assert.equal(limiter.consume('alice').allowed, true);
  assert.equal(limiter.consume('alice').allowed, false);
  limiter.reset('alice');
  assert.equal(limiter.consume('alice').allowed, true);
});

test('device labels are trimmed, bounded, and fall back safely', () => {
  assert.equal(normalizeDeviceLabel('  My laptop  '), 'My laptop');
  assert.equal(normalizeDeviceLabel(''), 'KRYPT device');
  assert.equal(normalizeDeviceLabel('x'.repeat(120)).length, 64);
});
