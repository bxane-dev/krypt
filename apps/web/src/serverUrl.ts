export function normalizeServerUrl(value: string) {
  return value.trim().replace(/\/$/, '');
}
