import nacl from 'tweetnacl';
import { toBase64 } from './crypto';

export const DEVICE_ID_KEY = 'krypt_device_id';
const DEVICE_PUBLIC_KEY = 'krypt_device_public_key';
const DEVICE_SECRET_KEY = 'krypt_device_secret_key';

export function describeDevice(userAgent: string) {
  const ua = userAgent || '';
  let platform = 'Web';
  if (/Android/i.test(ua)) platform = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) platform = 'iOS';
  else if (/Windows/i.test(ua)) platform = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) platform = 'macOS';
  else if (/Linux/i.test(ua)) platform = 'Linux';

  const name = /Electron/i.test(ua)
    ? 'KRYPT Desktop'
    : platform === 'Web'
      ? 'KRYPT Web'
      : `KRYPT on ${platform}`;

  return { name, platform };
}

export function getOrCreateDeviceIdentity() {
  const existingPublic = localStorage.getItem(DEVICE_PUBLIC_KEY);
  const existingSecret = localStorage.getItem(DEVICE_SECRET_KEY);
  if (existingPublic && existingSecret) {
    return {
      id: localStorage.getItem(DEVICE_ID_KEY),
      publicKey: existingPublic,
      ...describeDevice(navigator.userAgent)
    };
  }

  const pair = nacl.sign.keyPair();
  const publicKey = toBase64(pair.publicKey);
  localStorage.setItem(DEVICE_PUBLIC_KEY, publicKey);
  localStorage.setItem(DEVICE_SECRET_KEY, toBase64(pair.secretKey));

  return {
    id: localStorage.getItem(DEVICE_ID_KEY),
    publicKey,
    ...describeDevice(navigator.userAgent)
  };
}

export function saveServerDeviceId(id: string) {
  localStorage.setItem(DEVICE_ID_KEY, id);
}

export function clearServerDeviceId() {
  localStorage.removeItem(DEVICE_ID_KEY);
}

export function rotateDeviceIdentity() {
  const pair = nacl.sign.keyPair();
  const publicKey = toBase64(pair.publicKey);
  localStorage.setItem(DEVICE_PUBLIC_KEY, publicKey);
  localStorage.setItem(DEVICE_SECRET_KEY, toBase64(pair.secretKey));
  return publicKey;
}
