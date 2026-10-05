import { resolveApiUrl, SERVER_STORAGE_KEY } from './serverUrl';

function readStoredServerUrl() {
  try {
    return localStorage.getItem(SERVER_STORAGE_KEY);
  } catch {
    return null;
  }
}

const desktopApi = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('desktopApi')
  : null;

const API_URL = resolveApiUrl({
  storedUrl: readStoredServerUrl(),
  desktopApi,
  configuredApi: import.meta.env.VITE_API_URL?.trim() || null
});

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('krypt_token');
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export { API_URL, SERVER_STORAGE_KEY };
