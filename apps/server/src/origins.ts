export function parseAllowedOrigins(webOrigins?: string, legacyOrigin?: string) {
  const source = webOrigins?.trim() || legacyOrigin?.trim() || '';
  return source ? source.split(',').map(value => value.trim()).filter(Boolean) : [];
}

export function createOriginPolicy(_allowed: string[], _allowDesktop: boolean) {
  return (_origin?: string) => false;
}
