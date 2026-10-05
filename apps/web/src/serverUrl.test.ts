import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, resolveApiUrl } from './serverUrl';

describe('normalizeServerUrl', () => {
  it('accepts HTTPS remote servers and removes a trailing slash', () => {
    expect(normalizeServerUrl(' https://chat.example.com/ ')).toBe('https://chat.example.com');
  });

  it('allows HTTP only for loopback development servers', () => {
    expect(normalizeServerUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normalizeServerUrl('http://localhost:8787/')).toBe('http://localhost:8787');
    expect(() => normalizeServerUrl('http://chat.example.com')).toThrow(/HTTPS/);
  });

  it('rejects paths, credentials, query strings, and deceptive loopback hosts', () => {
    expect(() => normalizeServerUrl('https://chat.example.com/api')).toThrow(/origin/);
    expect(() => normalizeServerUrl('https://user:pass@chat.example.com')).toThrow(/credentials/);
    expect(() => normalizeServerUrl('https://chat.example.com/?x=1')).toThrow(/origin/);
    expect(() => normalizeServerUrl('http://127.0.0.1.evil.example')).toThrow(/HTTPS/);
  });
});

describe('resolveApiUrl', () => {
  it('prefers a saved shared server over the bundled desktop API', () => {
    expect(resolveApiUrl({
      storedUrl: 'https://krypt.example.com/',
      desktopApi: 'http://127.0.0.1:49152',
      configuredApi: 'https://web-default.example.com'
    })).toBe('https://krypt.example.com');
  });

  it('falls back past invalid saved values', () => {
    expect(resolveApiUrl({
      storedUrl: 'http://insecure.example.com',
      desktopApi: 'http://127.0.0.1:49152',
      configuredApi: 'https://web-default.example.com'
    })).toBe('http://127.0.0.1:49152');
  });
});
