import { vi } from 'vitest';

/** Minimal Web Storage stand-in for node tests. */
export class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  keys() { return [...this.m.keys()]; }
}

export function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function stubBrowser() {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const assign = vi.fn();
  const location = { pathname: '/', search: '?q=1', hash: '', assign };
  const listeners = new Map<string, Set<() => void>>();
  const document = {
    visibilityState: 'visible',
    addEventListener: (t: string, f: () => void) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f); },
    removeEventListener: (t: string, f: () => void) => { listeners.get(t)?.delete(f); },
    dispatch: (t: string) => listeners.get(t)?.forEach((f) => f()),
  };
  const cacheNames = ['workbox-precache-v2-http://localhost/', 'runtime-data', 'images'];
  const caches = {
    keys: vi.fn(async () => [...cacheNames]),
    delete: vi.fn(async (n: string) => { const i = cacheNames.indexOf(n); if (i >= 0) cacheNames.splice(i, 1); return i >= 0; }),
  };
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('location', location);
  vi.stubGlobal('document', document);
  vi.stubGlobal('caches', caches);
  return { local, session, assign, location, document, caches, cacheNames };
}
