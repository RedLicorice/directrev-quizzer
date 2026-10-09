// HMAC session keys, read from the CloudFront KeyValueStore through the
// cloudfront-keyvaluestore data-plane API (GetKey), cached for 5 minutes.
// KVS key names are shared with the edge function: see CONTRACT.md §3.1.
import { KID_RE, KVS_CURRENT, KVS_KEY_PREFIX } from '../../../edge/session-core.js';

export type KvsGet = (key: string) => Promise<string | null>;

export interface KeyStore {
  current(): Promise<{ kid: string; key: string }>;
  get(kid: string): Promise<string | null>;
}

export function createKeyStore(kvsGet: KvsGet, now: () => number, ttlMs = 5 * 60_000): KeyStore {
  const cache = new Map<string, { v: string | null; at: number }>();
  async function read(name: string): Promise<string | null> {
    const hit = cache.get(name);
    if (hit && now() - hit.at < ttlMs) return hit.v;
    const v = await kvsGet(name);
    cache.set(name, { v, at: now() });
    return v;
  }
  return {
    async current() {
      const kid = await read(KVS_CURRENT);
      if (!kid || !KID_RE.test(kid)) throw new Error('KVS: current kid missing or invalid');
      const key = await read(KVS_KEY_PREFIX + kid);
      if (!key || key.length < 32) throw new Error('KVS: current key missing or too short');
      return { kid, key };
    },
    async get(kid: string) {
      if (!KID_RE.test(kid)) return null;
      const key = await read(KVS_KEY_PREFIX + kid);
      return key && key.length >= 32 ? key : null;
    },
  };
}
