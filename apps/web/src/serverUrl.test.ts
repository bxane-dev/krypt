import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from './serverUrl';

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
