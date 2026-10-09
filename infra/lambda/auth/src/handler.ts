// auth Lambda: /auth/login, /auth/callback, /auth/refresh, /auth/logout, /auth/me.
// Contract: infra/CONTRACT.md §5. Behind a Function URL (AuthType AWS_IAM) fronted by
// CloudFront with OAC; CloudFront forwards cookies, query strings and viewer headers
// (managed origin request policy AllViewerExceptHostHeader).
import { createHmac, randomBytes } from 'node:crypto';
import { AUDIENCE, ISSUER, checkToken, parseToken, safeEqual, signSession } from '../../../edge/session-core.js';
import type { SessionClaims } from '../../../edge/session-core.js';
import type { Config } from './config.js';
import type { KeyStore } from './keys.js';
import * as cookies from './cookies.js';
import { safeReturnPath, resolveAppHost } from './returnPath.js';
import {
  CognitoError,
  authorizeUrl,
  challengeS256,
  exchangeCode,
  logoutUrl,
  newVerifier,
  readIdToken,
  refreshTokens,
  revokeToken,
  type Fetch,
} from './cognito.js';
import { computeAccess } from './access.js';
import { loginErrorPage, notEnabledPage } from './html.js';

export interface UrlEvent {
  rawPath: string;
  rawQueryString?: string;
  queryStringParameters?: Record<string, string | undefined>;
  cookies?: string[];
  headers?: Record<string, string | undefined>;
  requestContext: { http: { method: string; sourceIp?: string } };
  body?: string;
  isBase64Encoded?: boolean;
}

export interface UrlResult {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body?: string;
}

export interface Deps {
  getConfig(): Promise<Config>;
  keys: KeyStore;
  fetch: Fetch;
  nowMs(): number;
  random(n: number): Buffer;
  log(entry: Record<string, unknown>): void;
}

export const hmac = (key: string, data: string) => createHmac('sha256', key).update(data).digest('base64url');

const NO_STORE = { 'cache-control': 'no-store' };
const json = (statusCode: number, body: unknown, extraCookies?: string[]): UrlResult => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
  ...(extraCookies ? { cookies: extraCookies } : {}),
  body: JSON.stringify(body),
});
const html = (statusCode: number, body: string, extraCookies?: string[]): UrlResult => ({
  statusCode,
  headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE },
  ...(extraCookies ? { cookies: extraCookies } : {}),
  body,
});
const redirect = (location: string, extraCookies?: string[]): UrlResult => ({
  statusCode: 302,
  headers: { location, ...NO_STORE },
  ...(extraCookies ? { cookies: extraCookies } : {}),
});

const clearAll = () => [cookies.clearSession(), cookies.clearRefresh(), cookies.clearPkce()];

interface PkceState {
  s: string; // state
  v: string; // code verifier
  r: string; // return path
  e: number; // expiry (seconds)
  k: string; // kid used to sign this blob
}

async function signPkce(deps: Deps, st: Omit<PkceState, 'k'>): Promise<string> {
  const { kid, key } = await deps.keys.current();
  const blob = Buffer.from(JSON.stringify({ ...st, k: kid }), 'utf8').toString('base64url');
  return `${blob}.${hmac(key, 'pkce.' + blob)}`;
}

async function readPkce(deps: Deps, raw: string | null, nowSec: number): Promise<PkceState | null> {
  if (!raw) return null;
  const i = raw.indexOf('.');
  if (i <= 0) return null;
  const blob = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  let st: PkceState;
  try {
    st = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8')) as PkceState;
  } catch {
    return null;
  }
  if (!st || typeof st.k !== 'string' || typeof st.s !== 'string' || typeof st.v !== 'string' || typeof st.e !== 'number') return null;
  const key = await deps.keys.get(st.k);
  if (!key || !safeEqual(hmac(key, 'pkce.' + blob), sig)) return null;
  if (st.e <= nowSec) return null;
  return st;
}

async function issueSession(deps: Deps, cfg: Config, id: { sub: string; email: string; name?: string }, access: { ds: string[]; adm: boolean }, nowSec: number) {
  const claims: SessionClaims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: id.sub,
    email: id.email,
    ...(id.name ? { name: id.name } : {}),
    ds: access.ds,
    adm: access.adm,
    iat: nowSec,
    exp: nowSec + cfg.sessionTtlSeconds,
  };
  const { kid, key } = await deps.keys.current();
  return { claims, token: signSession(claims, kid, key, hmac) };
}

function meBody(cfg: Config, c: SessionClaims) {
  const all = c.ds.length === 1 && c.ds[0] === '*';
  return {
    sub: c.sub,
    email: c.email,
    ...(c.name ? { name: c.name } : {}),
    ds: c.ds,
    adm: c.adm,
    exp: c.exp,
    ...(all ? { allDatasets: cfg.datasets } : {}),
  };
}

function viewerIp(h: Record<string, string | undefined>, ev: UrlEvent): string | undefined {
  const a = h['cloudfront-viewer-address'];
  if (a) return a.slice(0, a.lastIndexOf(':')) || a;
  return ev.requestContext.http.sourceIp;
}

export function createHandler(deps: Deps) {
  return async function handler(ev: UrlEvent): Promise<UrlResult> {
    const method = ev.requestContext.http.method.toUpperCase();
    const path = ev.rawPath;
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(ev.headers ?? {})) headers[k.toLowerCase()] = v;
    const q = ev.queryStringParameters ?? {};
    const nowSec = Math.floor(deps.nowMs() / 1000);
    const ip = viewerIp(headers, ev);
    try {
      const cfg = await deps.getConfig();
      const appHost = resolveAppHost(headers, cfg.appHosts);
      const redirectUri = `https://${appHost}/auth/callback`;

      if (path === '/auth/login' && (method === 'GET' || method === 'HEAD')) {
        const state = deps.random(16).toString('base64url');
        const verifier = newVerifier(deps.random);
        const r = safeReturnPath(q.return);
        const blob = await signPkce(deps, { s: state, v: verifier, r, e: nowSec + 600 });
        return redirect(authorizeUrl(cfg, redirectUri, state, challengeS256(verifier)), [cookies.pkceCookie(blob)]);
      }

      if (path === '/auth/callback' && method === 'GET') {
        const st = await readPkce(deps, cookies.getCookie(ev.cookies, cookies.PKCE_COOKIE), nowSec);
        if (q.error) {
          deps.log({ evt: 'login_error', ip, error: String(q.error).slice(0, 64) });
          return html(400, loginErrorPage('Il login è stato annullato o non è riuscito.'), [cookies.clearPkce()]);
        }
        if (!st) {
          deps.log({ evt: 'login_error', ip, error: 'pkce_cookie' });
          return html(400, loginErrorPage('La richiesta di accesso è scaduta. Riprova.'), [cookies.clearPkce()]);
        }
        if (typeof q.state !== 'string' || !safeEqual(q.state, st.s) || typeof q.code !== 'string' || q.code.length === 0) {
          deps.log({ evt: 'login_error', ip, error: 'state_mismatch' });
          return html(400, loginErrorPage('Richiesta di accesso non valida.'), [cookies.clearPkce()]);
        }
        let tokens;
        try {
          tokens = await exchangeCode(deps.fetch, cfg, q.code, redirectUri, st.v);
        } catch (e) {
          deps.log({ evt: 'login_error', ip, error: e instanceof CognitoError ? e.code : 'exchange' });
          return html(400, loginErrorPage('Non è stato possibile completare l’accesso. Riprova.'), [cookies.clearPkce()]);
        }
        const id = readIdToken(tokens.id_token, cfg, nowSec);
        const access = computeAccess(id.groups);
        if (!access) {
          deps.log({ evt: 'login_denied', sub: id.sub, ip, reason: 'no_groups' });
          if (tokens.refresh_token) await revokeToken(deps.fetch, cfg, tokens.refresh_token).catch(() => undefined);
          return html(403, notEnabledPage(id.email), clearAll());
        }
        const { token } = await issueSession(deps, cfg, id, access, nowSec);
        const out = [cookies.sessionCookie(token, cfg.sessionTtlSeconds), cookies.clearPkce()];
        if (tokens.refresh_token) out.push(cookies.refreshCookie(tokens.refresh_token, cfg.refreshCookieDays));
        deps.log({ evt: 'login', sub: id.sub, ip, ds: access.ds, adm: access.adm });
        return redirect(`https://${appHost}${safeReturnPath(st.r)}`, out);
      }

      if (path === '/auth/refresh') {
        if (method !== 'POST') {
          const r = json(405, { error: 'method_not_allowed' });
          r.headers.allow = 'POST';
          return r;
        }
        const origin = headers['origin'];
        const site = headers['sec-fetch-site'];
        if ((origin && !cfg.appHosts.some((h) => origin === `https://${h}`)) || (site && site !== 'same-origin')) {
          deps.log({ evt: 'refresh_denied', ip, reason: 'bad_origin' });
          return json(403, { error: 'bad_origin' });
        }
        const rt = cookies.getCookie(ev.cookies, cookies.REFRESH_COOKIE);
        if (!rt) return json(401, { error: 'no_refresh' });
        let tokens;
        try {
          tokens = await refreshTokens(deps.fetch, cfg, rt);
        } catch (e) {
          if (e instanceof CognitoError && e.isGrantError) {
            deps.log({ evt: 'refresh_failed', ip, error: e.code });
            return json(401, { error: 'refresh_failed' }, clearAll());
          }
          deps.log({ evt: 'refresh_upstream_error', ip, error: e instanceof CognitoError ? e.code : String(e) });
          return json(503, { error: 'upstream' });
        }
        const id = readIdToken(tokens.id_token, cfg, nowSec);
        const access = computeAccess(id.groups);
        if (!access) {
          deps.log({ evt: 'refresh_denied', sub: id.sub, ip, reason: 'no_groups' });
          await revokeToken(deps.fetch, cfg, tokens.refresh_token ?? rt).catch(() => undefined);
          return json(403, { error: 'not_enabled' }, clearAll());
        }
        const { claims, token } = await issueSession(deps, cfg, id, access, nowSec);
        const out = [cookies.sessionCookie(token, cfg.sessionTtlSeconds)];
        if (tokens.refresh_token && tokens.refresh_token !== rt) out.push(cookies.refreshCookie(tokens.refresh_token, cfg.refreshCookieDays));
        deps.log({ evt: 'refresh', sub: id.sub, ip, ds: access.ds, adm: access.adm });
        return json(200, meBody(cfg, claims), out);
      }

      if (path === '/auth/me' && (method === 'GET' || method === 'HEAD')) {
        const parsed = parseToken(cookies.getCookie(ev.cookies, cookies.SESSION_COOKIE));
        const key = parsed ? await deps.keys.get(parsed.kid) : null;
        const claims = checkToken(parsed, key, hmac, nowSec);
        if (!claims) return json(401, { error: 'unauthenticated' });
        return json(200, meBody(cfg, claims));
      }

      if (path === '/auth/logout' && (method === 'GET' || method === 'POST')) {
        const rt = cookies.getCookie(ev.cookies, cookies.REFRESH_COOKIE);
        if (rt) await revokeToken(deps.fetch, cfg, rt).catch(() => undefined);
        deps.log({ evt: 'logout', ip, revoked: !!rt });
        return redirect(logoutUrl(cfg, appHost), clearAll());
      }

      return json(404, { error: 'not_found' });
    } catch (e) {
      deps.log({ evt: 'error', path, ip, error: e instanceof Error ? e.message : String(e) });
      return json(500, { error: 'internal' });
    }
  };
}
