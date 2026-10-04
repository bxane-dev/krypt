import nacl from 'tweetnacl';
import type { Envelope, Payload, User } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

export const fromBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
};

async function deriveBackupKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function createIdentity(password: string) {
  const pair = nacl.box.keyPair();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pair.secretKey));
  const backup = new Uint8Array(iv.length + encrypted.length);
  backup.set(iv, 0);
  backup.set(encrypted, iv.length);
  return {
    publicKey: toBase64(pair.publicKey),
    secretKey: toBase64(pair.secretKey),
    keyBackup: toBase64(backup),
    keySalt: toBase64(salt)
  };
}

export async function restoreIdentity(password: string, keyBackup: string, keySalt: string) {
  const backup = fromBase64(keyBackup);
  const iv = backup.slice(0, 12);
  const encrypted = backup.slice(12);
  const key = await deriveBackupKey(password, fromBase64(keySalt));
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return toBase64(new Uint8Array(raw));
}

export function encryptPayload(payload: Payload, recipientPublicKey: string): Envelope {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const message = encoder.encode(JSON.stringify(payload));
  const ciphertext = nacl.box(message, nonce, fromBase64(recipientPublicKey), ephemeral.secretKey);
  return {
    ephemeralPublicKey: toBase64(ephemeral.publicKey),
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext)
  };
}

export function encryptForMembers(payload: Payload, members: User[]) {
  return Object.fromEntries(members.map(member => [member.id, encryptPayload(payload, member.publicKey)]));
}

export function decryptEnvelope(envelope: Envelope, secretKey: string): Payload {
  const plaintext = nacl.box.open(
    fromBase64(envelope.ciphertext),
    fromBase64(envelope.nonce),
    fromBase64(envelope.ephemeralPublicKey),
    fromBase64(secretKey)
  );
  if (!plaintext) throw new Error('Unable to decrypt message');
  return JSON.parse(decoder.decode(plaintext)) as Payload;
}
