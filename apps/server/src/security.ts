export function normalizeDeviceLabel(value?: string | null) {
  const trimmed = (value || '').trim();
  return (trimmed || 'KRYPT device').slice(0, 64);
}

export function createAttemptLimiter({
  maxAttempts,
  windowMs,
  now = () => Date.now()
}: {
  maxAttempts: number;
  windowMs: number;
  now?: () => number;
}) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function consume(key: string) {
    const time = now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= time) {
      buckets.set(key, { count: 1, resetAt: time + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (current.count >= maxAttempts) {
      return { allowed: false, retryAfterMs: Math.max(1, current.resetAt - time) };
    }
    current.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  function reset(key: string) {
    buckets.delete(key);
  }

  return { consume, reset };
}
