export const SERVER_STORAGE_KEY = 'krypt_server_url';

export function normalizeServerUrl(value: string) {
  const raw = value.trim();
  if (!raw) throw new Error('Server URL is required.');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid server URL.');
  }

  if (url.username || url.password) throw new Error('Server URLs cannot include credentials.');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Use only the server origin, without a path, query, or fragment.');

  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('Remote KRYPT servers must use HTTPS.');
  }

  return url.origin;
}

export function resolveApiUrl({
  storedUrl,
  desktopApi,
  configuredApi,
  fallback = 'http://localhost:8787'
}: {
  storedUrl?: string | null;
  desktopApi?: string | null;
  configuredApi?: string | null;
  fallback?: string;
}) {
  for (const candidate of [storedUrl, desktopApi, configuredApi, fallback]) {
    if (!candidate?.trim()) continue;
    try {
      return normalizeServerUrl(candidate);
    } catch {
      // Ignore invalid persisted/configured candidates and continue to the next safe source.
    }
  }
  return 'http://localhost:8787';
}
