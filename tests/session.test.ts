import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { json, stubBrowser } from './helpers';
import {
  getSession, refreshSession, login, logout, startSessionKeeper, currentSession, setCurrentSession, allowedDatasetIds,
  _resetForTests, EMPTY_BODY_SHA256, OfflineError, AuthRequiredError,
} from '../src/aws/auth/session';
import { apiFetch, DatasetNotEnabledError } from '../src/aws/api';
import type { Session } from '../src/types';

const S: Session = { sub: 's1', email: 'a@x', ds: ['aws-dva-c02'], adm: false, exp: 4102444800 };

let b: ReturnType<typeof stubBrowser>;
beforeEach(() => { b = stubBrowser(); _resetForTests(); vi.stubEnv('VITE_DEPLOY', 'aws'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('getSession', () => {
  it('200 → session, same-origin credentials, no-store', async () => {
    const f = vi.fn(async () => json(200, S));
    vi.stubGlobal('fetch', f);
    expect(await getSession()).toEqual(S);
    expect(currentSession()).toEqual(S);
    expect(f).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
  });
  it('401 → null; network failure → OfflineError; 500 → Error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'unauthenticated' })));
    expect(await getSession()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(getSession()).rejects.toBeInstanceOf(OfflineError);
    vi.stubGlobal('fetch', vi.fn(async () => json(500, {})));
    await expect(getSession()).rejects.toThrow('500');
  });
  it('allowedDatasetIds: ds, or allDatasets for [*]; junk ids dropped', () => {
    expect(allowedDatasetIds(S)).toEqual(['aws-dva-c02']);
    expect(allowedDatasetIds({ ...S, ds: ['*'], allDatasets: ['a', 'b', '../x'] })).toEqual(['a', 'b']);
    expect(allowedDatasetIds({ ...S, ds: ['*'] })).toEqual([]);
    expect(allowedDatasetIds(null)).toEqual([]);
  });
});

describe('refreshSession', () => {
  it('POST, empty body, x-amz-content-sha256 = sha256(""), single-flight', async () => {
    let resolve!: (r: Response) => void;
    const f = vi.fn(() => new Promise<Response>((r) => { resolve = r; }));
    vi.stubGlobal('fetch', f);
    const a = refreshSession();
    const c = refreshSession();
    expect(f).toHaveBeenCalledTimes(1);
    resolve(json(200, S));
    expect(await a).toEqual(S);
    expect(await c).toEqual(S);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/auth/refresh');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['x-amz-content-sha256']).toBe(EMPTY_BODY_SHA256);
    expect(EMPTY_BODY_SHA256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    // after settling, a new call starts a new request
    vi.stubGlobal('fetch', vi.fn(async () => json(401, {})));
    expect(await refreshSession()).toBeNull();
  });
  it('204 → falls back to /auth/me', async () => {
    const f = vi.fn(async (url: string) => (url === '/auth/refresh' ? new Response(null, { status: 204 }) : json(200, S)));
    vi.stubGlobal('fetch', f);
    expect(await refreshSession()).toEqual(S);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('apiFetch: 401/403 mapping', () => {
  it('401 → refresh once → retry once → ok', async () => {
    const seq = [json(401, {}), json(200, S), json(200, { ok: 1 })];
    const f = vi.fn(async () => seq.shift()!);
    vi.stubGlobal('fetch', f);
    const res = await apiFetch('/data/aws-dva-c02/index.json');
    expect(res.status).toBe(200);
    expect(f.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(['/data/aws-dva-c02/index.json', '/auth/refresh', '/data/aws-dva-c02/index.json']);
    expect(b.assign).not.toHaveBeenCalled();
  });
  it('concurrent 401s share one refresh', async () => {
    let refreshes = 0;
    let authed = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/auth/refresh') { refreshes++; await new Promise((r) => setTimeout(r, 5)); authed = true; return json(200, S); }
      return authed ? json(200, {}) : json(401, {});
    }));
    const rs = await Promise.all([apiFetch('/data/a/1'), apiFetch('/data/a/2'), apiFetch('/data/a/3')]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshes).toBe(1);
  });
  it('401 and refresh refused → redirect to /auth/login?return=<path>', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, {})));
    b.location.pathname = '/';
    b.location.search = '?q=1';
    await expect(apiFetch('/data/aws-dva-c02/index.json')).rejects.toBeInstanceOf(AuthRequiredError);
    expect(b.assign).toHaveBeenCalledWith('/auth/login?return=%2F%3Fq%3D1');
  });
  it('401 after a successful refresh → redirect (no loop)', async () => {
    const f = vi.fn(async (url: string) => (url === '/auth/refresh' ? json(200, S) : json(401, {})));
    vi.stubGlobal('fetch', f);
    await expect(apiFetch('/data/x/y')).rejects.toBeInstanceOf(AuthRequiredError);
    expect(f).toHaveBeenCalledTimes(3);
    expect(b.assign).toHaveBeenCalledTimes(1);
  });
  it('offline during refresh → no redirect', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url === '/auth/refresh') throw new TypeError('offline'); return json(401, {}); }));
    await expect(apiFetch('/data/x/y')).rejects.toBeInstanceOf(OfflineError);
    expect(b.assign).not.toHaveBeenCalled();
  });
  it('403 → DatasetNotEnabledError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { error: 'dataset-not-enabled' })));
    const e = await apiFetch('/data/mule-mcd-01/questions.json').catch((x) => x);
    expect(e).toBeInstanceOf(DatasetNotEnabledError);
    expect(e.message).toMatch(/non abilitato/);
  });
  it('POST bodies carry their sha256', async () => {
    const f = vi.fn(async () => json(200, {}));
    vi.stubGlobal('fetch', f);
    await apiFetch('/api/x', { method: 'POST', body: 'abc' });
    const h = (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
    expect(h.get('x-amz-content-sha256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('login / logout', () => {
  it('login encodes the return path', () => {
    login('/a b?x=1&y=2');
    expect(b.assign).toHaveBeenCalledWith('/auth/login?return=%2Fa%20b%3Fx%3D1%26y%3D2');
  });
  it('logout clears sessionStorage and runtime caches (keeps the app-shell precache), then /auth/logout', async () => {
    b.session.setItem('x', '1');
    setCurrentSession(S);
    await logout();
    expect(b.session.length).toBe(0);
    expect(b.cacheNames).toEqual(['workbox-precache-v2-http://localhost/']);
    expect(currentSession()).toBeNull();
    expect(b.assign).toHaveBeenCalledWith('/auth/logout');
  });
});

describe('startSessionKeeper', () => {
  it('refreshes at exp - 5 min and on visibilitychange when close to expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const now = Math.floor(Date.now() / 1000);
    setCurrentSession({ ...S, exp: now + 30 * 60 });
    const f = vi.fn(async () => json(200, { ...S, exp: Math.floor(Date.now() / 1000) + 30 * 60 }));
    vi.stubGlobal('fetch', f);
    const expired = vi.fn();
    const stop = startSessionKeeper(expired);
    await vi.advanceTimersByTimeAsync(24 * 60 * 1000);
    expect(f).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(61 * 1000);
    expect(f).toHaveBeenCalledTimes(1);
    // tab hidden for a long time, timer throttled: visibilitychange triggers a refresh
    setCurrentSession({ ...S, exp: Math.floor(Date.now() / 1000) + 60 });
    b.document.dispatch('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledTimes(2);
    // refresh refused → onExpired
    f.mockImplementation(async () => json(401, {}));
    setCurrentSession({ ...S, exp: Math.floor(Date.now() / 1000) + 10 });
    b.document.dispatch('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    expect(expired).toHaveBeenCalledTimes(1);
    stop();
  });
});
