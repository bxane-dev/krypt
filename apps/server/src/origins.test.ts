import assert from 'node:assert/strict';
import test from 'node:test';
import { createOriginPolicy, parseAllowedOrigins } from './origins.js';

test('parseAllowedOrigins supports comma separated values and legacy WEB_ORIGIN', () => {
  assert.deepEqual(
    parseAllowedOrigins('https://app.example.com, https://admin.example.com ', 'http://localhost:5173'),
    ['https://app.example.com', 'https://admin.example.com']
  );
  assert.deepEqual(parseAllowedOrigins('', 'http://localhost:5173'), ['http://localhost:5173']);
});

test('origin policy allows exact configured origins and non-browser clients', () => {
  const policy = createOriginPolicy(['https://app.example.com'], false);
  assert.equal(policy(undefined), true);
  assert.equal(policy('https://app.example.com'), true);
  assert.equal(policy('https://evil.example.com'), false);
});

test('desktop loopback origins are opt-in and strictly validated', () => {
  const disabled = createOriginPolicy([], false);
  assert.equal(disabled('http://127.0.0.1:49152'), false);

  const enabled = createOriginPolicy([], true);
  assert.equal(enabled('http://127.0.0.1:49152'), true);
  assert.equal(enabled('http://localhost:5173'), true);
  assert.equal(enabled('https://127.0.0.1:49152'), false);
  assert.equal(enabled('http://127.0.0.1.evil.example:49152'), false);
});
