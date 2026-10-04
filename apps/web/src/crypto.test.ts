import { describe, expect, it } from 'vitest';
import { createIdentity, decryptEnvelope, encryptPayload, restoreIdentity } from './crypto';

describe('KRYPT crypto primitives', () => {
  it('encrypts and decrypts a message envelope', async () => {
    const identity = await createIdentity('correct horse battery staple');
    const envelope = encryptPayload({ kind: 'text', text: 'classified' }, identity.publicKey);
    expect(decryptEnvelope(envelope, identity.secretKey)).toEqual({ kind: 'text', text: 'classified' });
  });

  it('restores a private key from the password-encrypted backup', async () => {
    const identity = await createIdentity('another strong password');
    expect(await restoreIdentity('another strong password', identity.keyBackup, identity.keySalt)).toBe(identity.secretKey);
  });
});
