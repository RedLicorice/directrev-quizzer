// session-core: the pure functions behind the gateway contract (server/mock/CONTRACT.md, which
// mirrors the authoritative infra/CONTRACT.md of branch feat/aws-infra). Used by the local mock
// (server/mock/server.mjs) and by the unit tests; the CloudFront Function (infra/edge/session-core.js)
// implements the same rules and is checked against the same vectors (tests/fixtures/edge-vectors.json).
// Node >= 20, no dependencies besides node:crypto.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-qz_session';
export const REFRESH_COOKIE = '__Secure-qz_refresh';
export const PKCE_COOKIE = '__Secure-qz_pkce';
export const ISSUER = 'quizzer';
export const AUDIENCE = 'quizzer-edge';
export const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const DATASET_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const MAX_TOKEN_LENGTH = 3000;
export const MIN_KEY_LENGTH = 32;
const SIG_LENGTH = 43; // base64url(32 bytes), no padding
const B64URL = /^[A-Za-z0-9_-]+$/;

// ── base64url / HMAC ───────────────────────────────────────────────────────

export function b64urlEncode(input) {
  return (typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)).toString('base64url');
}

function b64urlDecode(s) {
  return typeof s === 'string' && B64URL.test(s) ? Buffer.from(s, 'base64url') : null;
}

/** HMAC-SHA256 with the UTF-8 bytes of `key`, as base64url. */
export function hmacB64url(key, data) {
  return createHmac('sha256', Buffer.from(key, 'utf8')).update(data, 'utf8').digest('base64url');
}

// ── JWT HS256 ──────────────────────────────────────────────────────────────

/** Header is serialized exactly as {"alg":"HS256","typ":"JWT","kid":"<kid>"}. */
export function signSession(claims, { kid, key }) {
  const h = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid }));
  const p = b64urlEncode(JSON.stringify(claims));
  return `${h}.${p}.${hmacB64url(key, `${h}.${p}`)}`;
}

function parseObject(buf) {
  try {
    const v = JSON.parse(buf.toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function validDs(ds) {
  if (!Array.isArray(ds) || ds.length === 0 || ds.length > 64) return false;
  if (ds.length === 1 && ds[0] === '*') return true;
  return ds.every((d) => typeof d === 'string' && DATASET_RE.test(d));
}

/**
 * Verifies a session JWT.
 * @param {string} token
 * @param {{ keys: Record<string,string>, now: number }} opts  keys: kid → secret string; now in seconds
 * @returns {{ ok: true, claims: object } | { ok: false, reason: string }}
 */
export function verifySession(token, { keys, now }) {
  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'missing' };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'too-long' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts;
  const hb = b64urlDecode(h), pb = b64urlDecode(p);
  if (!hb || !pb || !B64URL.test(s) || s.length !== SIG_LENGTH) return { ok: false, reason: 'malformed' };

  const header = parseObject(hb);
  const c = parseObject(pb);
  if (!header || !c) return { ok: false, reason: 'malformed' };
  // The algorithm is fixed; the header can only confirm it (none/HS512/RS256/... → reject).
  if (header.alg !== 'HS256') return { ok: false, reason: 'alg' };
  if (header.typ !== undefined && header.typ !== 'JWT') return { ok: false, reason: 'typ' };
  if (typeof header.kid !== 'string' || !KID_RE.test(header.kid) || !Object.prototype.hasOwnProperty.call(keys, header.kid)) {
    return { ok: false, reason: 'kid' };
  }
  const key = keys[header.kid];
  if (typeof key !== 'string' || key.length < MIN_KEY_LENGTH) return { ok: false, reason: 'kid' };

  const expected = Buffer.from(hmacB64url(key, `${h}.${p}`));
  const given = Buffer.from(s);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' };

  if (c.iss !== ISSUER || c.aud !== AUDIENCE) return { ok: false, reason: 'iss-aud' };
  if (typeof c.sub !== 'string' || c.sub.length === 0 || c.sub.length > 128 || typeof c.email !== 'string') return { ok: false, reason: 'claims' };
  if (typeof c.exp !== 'number' || !Number.isFinite(c.exp)) return { ok: false, reason: 'claims' };
  if (!(c.exp > now)) return { ok: false, reason: 'expired' };
  if (typeof c.adm !== 'boolean' || !validDs(c.ds)) return { ok: false, reason: 'claims' };
  return { ok: true, claims: c };
}

// ── request helpers ────────────────────────────────────────────────────────

/** Cookie header → { name: value } (first occurrence wins). */
export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !Object.prototype.hasOwnProperty.call(out, name)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Path classification on the RAW uri (never normalised: ambiguous paths are rejected).
 * @returns {{kind:'bad'}|{kind:'public'}|{kind:'session'}|{kind:'dataset',id:string}|{kind:'admin-only'}}
 */
export function classifyPath(uri) {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 1024 || uri[0] !== '/') return { kind: 'bad' };
  const lower = uri.toLowerCase();
  if (uri.includes('..') || uri.includes('//') || uri.includes('\\') || /%2e|%2f|%5c|%00/.test(lower)
    || /[\x00-\x1f\x7f]/.test(uri) || /\/\.(\/|$)/.test(uri)) return { kind: 'bad' };
  if (uri === '/manifest.webmanifest' || uri === '/favicon.svg' || uri === '/signed-out.html' || /^\/icon-[A-Za-z0-9_-]+\.svg$/.test(uri)) {
    return { kind: 'public' };
  }
  if (uri === '/auth' || uri.startsWith('/auth/')) return { kind: 'public' }; // auth origin, no edge check
  if (uri === '/data' || uri.startsWith('/data/')) {
    const rest = uri.slice(6);
    const slash = rest.indexOf('/');
    const id = slash === -1 ? rest : rest.slice(0, slash);
    return DATASET_RE.test(id) && slash !== -1 ? { kind: 'dataset', id } : { kind: 'admin-only' };
  }
  return { kind: 'session' };
}

/** 'allow' | 'unauthenticated' | 'forbidden' | 'bad' for a verified session (or null). */
export function decide(uri, claims) {
  const c = classifyPath(uri);
  if (c.kind === 'bad') return 'bad';
  if (c.kind === 'public') return 'allow';
  if (!claims) return 'unauthenticated';
  if (c.kind === 'session') return 'allow';
  if (claims.ds.length === 1 && claims.ds[0] === '*') return 'allow';
  if (c.kind === 'dataset' && claims.ds.includes(c.id)) return 'allow';
  return 'forbidden';
}

/** Top-level navigation (→ 302 to the login) vs. fetch/subresource (→ 401 JSON). Headers lower-case. */
export function isNavigation(headers) {
  if (headers['sec-fetch-mode'] === 'navigate') return true;
  return String(headers.accept ?? '').includes('text/html');
}

/**
 * Viewer-request decision, identical to the CloudFront Function's.
 * @param {{ uri: string, headers: Record<string,string> }} req  headers lower-case, values as strings
 * @param {{ keys: Record<string,string>, now: number }} opts
 */
export function authorize(req, opts) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const v = token ? verifySession(token, opts) : null;
  const claims = v && v.ok ? v.claims : null;
  const d = decide(req.uri, claims);
  if (d === 'allow') return { action: 'allow', claims };
  if (d === 'bad') return { action: 'deny', status: 400, error: 'bad_path' };
  if (d === 'forbidden') return { action: 'deny', status: 403, error: 'forbidden' };
  if (isNavigation(req.headers)) return { action: 'redirect', status: 302, location: `/auth/login?return=${encodeURIComponent(req.uri)}` };
  return { action: 'deny', status: 401, error: 'unauthenticated' };
}

/** `return` parameter of /auth/login: same-origin relative paths only, everything else → "/". */
export function safeReturnPath(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return '/';
  if (raw[0] !== '/' || raw.startsWith('//') || raw.startsWith('/\\') || raw.includes('\\')) return '/';
  if (/[\x00-\x1f\x7f\s]/.test(raw) || raw.includes('..') || /%(2f|5c|2e|00|0d|0a|09)/i.test(raw)) return '/';
  if (raw === '/auth' || raw.startsWith('/auth/') || raw.startsWith('/auth?')) return '/';
  try {
    const u = new URL(raw, 'https://app.invalid');
    return u.origin === 'https://app.invalid' ? u.pathname + u.search + u.hash : '/';
  } catch { return '/'; }
}

/** Cognito groups → { ds, adm }, or null (no dataset and not admin: no session). */
export function accessFromGroups(groups) {
  const adm = groups.includes('admin');
  if (groups.includes('ds-all')) return { ds: ['*'], adm };
  const ids = [...new Set(groups.filter((g) => g.startsWith('ds-')).map((g) => g.slice(3)).filter((id) => DATASET_RE.test(id)))].sort();
  if (ids.length > 0) return { ds: ids.slice(0, 64), adm };
  if (adm) return { ds: ['*'], adm };
  return null;
}

/** Session claims in the contract's key order: iss, aud, sub, email, name?, ds, adm, iat, exp. */
export function sessionClaims({ sub, email, name, groups, now, ttl }) {
  const access = accessFromGroups(groups);
  if (!access) return null;
  return { iss: ISSUER, aud: AUDIENCE, sub, email, ...(name ? { name } : {}), ds: access.ds, adm: access.adm, iat: now, exp: now + ttl };
}
