// Session client for the AWS build (cookie-based, same origin).
// Contract: server/mock/CONTRACT.md. Nothing here runs in the GitHub Pages build:
// every caller sits behind `import.meta.env.VITE_DEPLOY === 'aws'`.

import type { Session } from '../../types';
import { clearPrivateCaches } from '../../utils/datasets';

export const AUTH_ME = '/auth/me';
export const AUTH_REFRESH = '/auth/refresh';
export const AUTH_LOGIN = '/auth/login';
export const AUTH_LOGOUT = '/auth/logout';

/** sha256("") — CloudFront OAC requires `x-amz-content-sha256` on POST/PUT to a Lambda Function URL. */
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Refresh this long before the session cookie expires. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class AuthRequiredError extends Error {
  constructor() { super('Sessione scaduta: accesso richiesto'); this.name = 'AuthRequiredError'; }
}
export class OfflineError extends Error {
  constructor(readonly reason?: unknown) { super('Rete non disponibile'); this.name = 'OfflineError'; }
}

// ── current session (module state + subscribers for useSession) ───────────

let current: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();

export function currentSession(): Session | null { return current; }

export function setCurrentSession(s: Session | null) {
  current = s;
  listeners.forEach((l) => l(s));
}

export function subscribeSession(l: (s: Session | null) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Dataset ids the user may open: `ds`, or every published dataset for `ds = ['*']`. */
export function allowedDatasetIds(s: Session | null): string[] {
  if (!s) return [];
  const ids = s.ds.includes('*') ? (s.allDatasets ?? []) : s.ds;
  return [...new Set(ids.filter((id) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)))];
}

function isSession(v: unknown): v is Session {
  const s = v as Session;
  return !!s && typeof s.sub === 'string' && typeof s.email === 'string' && Array.isArray(s.ds) && typeof s.exp === 'number';
}

// ── HTTP ───────────────────────────────────────────────────────────────────

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store' });
  } catch (e) {
    throw new OfflineError(e);
  }
}

/** `GET /auth/me` → the session, or null on 401. Throws OfflineError when the network is down. */
export async function getSession(): Promise<Session | null> {
  const res = await send(AUTH_ME, { headers: { accept: 'application/json' } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`${AUTH_ME}: ${res.status}`);
  const body = await res.json();
  if (!isSession(body)) throw new Error(`${AUTH_ME}: unexpected response`);
  setCurrentSession(body);
  return body;
}

let refreshing: Promise<Session | null> | null = null;

/**
 * `POST /auth/refresh` (empty body, refresh cookie scoped to /auth). Single-flight: concurrent
 * callers share one request. Resolves to the new session, or null when the refresh cookie is
 * missing/expired/revoked (caller should then `login()`).
 */
export function refreshSession(): Promise<Session | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await send(AUTH_REFRESH, {
        method: 'POST',
        headers: { accept: 'application/json', 'x-amz-content-sha256': EMPTY_BODY_SHA256 },
      });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error(`${AUTH_REFRESH}: ${res.status}`);
      // The contract answers 200 + the /auth/me body; tolerate 204 by asking /auth/me.
      const body = res.status === 204 ? null : await res.json().catch(() => null);
      if (isSession(body)) { setCurrentSession(body); return body; }
      return getSession();
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** Path to come back to after login (same-origin, relative). */
export function currentPath(): string {
  return `${location.pathname}${location.search}${location.hash}` || '/';
}

let redirecting = false;

/** Full-page navigation to the login flow; `/auth/login` validates `return` server-side. */
export function login(returnTo: string = currentPath()) {
  if (redirecting) return;
  redirecting = true;
  location.assign(`${AUTH_LOGIN}?return=${encodeURIComponent(returnTo)}`);
}

/** Clears private client caches, then lets the server clear the cookies and revoke the refresh token. */
export async function logout() {
  setCurrentSession(null);
  await clearPrivateCaches();
  location.assign(AUTH_LOGOUT);
}

/** Test hook. */
export function _resetForTests() { current = null; refreshing = null; redirecting = false; listeners.clear(); }

// ── keep-alive: refresh at exp - 5 min and when the tab becomes visible ─────

/**
 * Schedules refreshes for the current session. `onExpired` runs when a refresh is refused
 * (the AuthGate then redirects to the login). Returns a cleanup function.
 */
export function startSessionKeeper(onExpired: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const remainingMs = () => (current ? current.exp * 1000 - Date.now() : 0);

  const run = async () => {
    try {
      const s = await refreshSession();
      if (stopped) return;
      if (!s) { onExpired(); return; }
      schedule();
    } catch {
      // Offline or server error: try again in a minute, the cookie may still be valid.
      if (!stopped) timer = setTimeout(run, 60_000);
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    // Normally exp - 5 min. With very short sessions (tests) refresh at half-life, never in a tight loop.
    const r = remainingMs();
    timer = setTimeout(run, r > 2 * REFRESH_MARGIN_MS ? r - REFRESH_MARGIN_MS : Math.max(10_000, r / 2));
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible' && remainingMs() < REFRESH_MARGIN_MS) { clearTimeout(timer); void run(); }
  };

  schedule();
  document.addEventListener('visibilitychange', onVisible);
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
}
