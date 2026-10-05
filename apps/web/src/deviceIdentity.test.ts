import { describe, expect, it } from 'vitest';
import { describeDevice } from './deviceIdentity';

describe('describeDevice', () => {
  it('recognizes common desktop and mobile platforms without exposing full user agents', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/44.0.0')).toEqual({
      name: 'KRYPT Desktop',
      platform: 'Windows'
    });
    expect(describeDevice('Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36')).toEqual({
      name: 'KRYPT on Android',
      platform: 'Android'
    });
  });

  it('falls back to a generic web label', () => {
    expect(describeDevice('UnknownBrowser/1.0')).toEqual({
      name: 'KRYPT Web',
      platform: 'Web'
    });
  });
});
