function normalizeOrigin(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Invalid origin: ${value}`);
  }
  return url.origin;
}

export function parseAllowedOrigins(webOrigins?: string, legacyOrigin?: string) {
  const source = webOrigins?.trim() || legacyOrigin?.trim() || '';
  return source
    ? source.split(',').map(value => value.trim()).filter(Boolean).map(normalizeOrigin)
    : [];
}

function isDesktopLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}

export function createOriginPolicy(allowed: string[], allowDesktop: boolean) {
  const exact = new Set(allowed.map(normalizeOrigin));
  return (origin?: string) => {
    if (!origin) return true;
    if (exact.has(origin)) return true;
    return allowDesktop && isDesktopLoopbackOrigin(origin);
  };
}
