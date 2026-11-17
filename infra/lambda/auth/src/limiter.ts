// Best-effort rate limiting without a datastore (plan v3 dropped DynamoDB). The window is
// per warm container, so the effective limit is higher than the nominal one across
// containers; it only blunts accidental loops, it is not a security boundary. The real
// ceilings remain the reserved concurrency and the `admin` group check.
export type Limiter = (key: string, limit: number, windowMs: number) => boolean;

export function createInMemoryLimiter(now: () => number, maxKeys = 1000): Limiter {
  const hits = new Map<string, number[]>();
  return (key, limit, windowMs) => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > maxKeys) {
      for (const [k, v] of hits) if (v.every((ts) => t - ts >= windowMs)) hits.delete(k);
    }
    return true;
  };
}
