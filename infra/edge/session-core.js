// Quizzer edge session core.
//
// Pure functions shared by:
//   - the CloudFront Function `session-check` (cloudfront-js-2.0 runtime): the build
//     script `build-function.mjs` inlines this file (dropping the `export` keywords);
//   - the `auth` Lambda (re-implemented in TypeScript, cross-checked by the test vectors
//     in ../CONTRACT.md);
//   - the app's local mock backend (it can import this file directly).
//
// RUNTIME SUBSET: this file must only use features of the CloudFront Functions
// JavaScript runtime 2.0 (ES 5.1 + let/const, arrow functions, template literals,
// async/await). No destructuring, spread, classes, for-of, optional chaining, `??`.
// See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html
// The test `edge/test/subset.test.mjs` enforces this with an AST check.
//
// Cryptography is injected (`hmac(key, data) -> base64url`): in the CloudFront
// runtime it is `crypto.createHmac('sha256', key).update(data).digest('base64url')`,
// in Node it is the same call on `node:crypto`.

export const SESSION_COOKIE = '__Host-qz_session';
export const ISSUER = 'quizzer';
export const AUDIENCE = 'quizzer-edge';
export const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const DATASET_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
// KeyValueStore key names (values are written by scripts/rotate-session-key.sh).
// @edge-skip-start
export const KVS_CURRENT = 'qz-current-kid';
// @edge-skip-end
export const KVS_KEY_PREFIX = 'qz-key-';
const MAX_TOKEN = 3000;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const EXPECTED_SIG_LEN = 43; // base64url(32 bytes) without padding

// Returns the value of cookie `name` from a raw Cookie header string, or null.
export function readCookie(header, name) {
  if (typeof header !== 'string' || header.length === 0) return null;
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    const eq = p.indexOf('=');
    if (eq > 0 && p.substring(0, eq) === name) return p.substring(eq + 1);
  }
  return null;
}

function b64urlToString(s) {
  return Buffer.from(s, 'base64url').toString('utf8');
}

// Step 1: structural parse. Never trusts `alg` to pick an algorithm: the only accepted
// value is HS256, anything else (none, RS256, HS512...) is rejected.
// Returns { kid, signingInput, sig, claims } or null.
export function parseToken(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN) return null;
  const seg = token.split('.');
  if (seg.length !== 3) return null;
  for (let i = 0; i < 3; i++) {
    if (!B64URL_RE.test(seg[i])) return null;
  }
  if (seg[2].length !== EXPECTED_SIG_LEN) return null;
  let header;
  let claims;
  try {
    header = JSON.parse(b64urlToString(seg[0]));
    claims = JSON.parse(b64urlToString(seg[1]));
  } catch (e) {
    return null;
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
  if (header.alg !== 'HS256') return null;
  if (header.typ !== undefined && header.typ !== 'JWT') return null;
  if (typeof header.kid !== 'string' || !KID_RE.test(header.kid)) return null;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  return { kid: header.kid, signingInput: seg[0] + '.' + seg[1], sig: seg[2], claims: claims };
}

// Constant-time string comparison (length is not secret: it is fixed at 43).
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) {
    x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return x === 0;
}

function validDs(ds) {
  if (!Array.isArray(ds) || ds.length === 0 || ds.length > 64) return false;
  if (ds.length === 1 && ds[0] === '*') return true;
  for (let i = 0; i < ds.length; i++) {
    if (typeof ds[i] !== 'string' || !DATASET_RE.test(ds[i])) return false;
  }
  return true;
}

// Step 2: signature + claims. `key` is the secret string read from the KVS (its UTF-8
// bytes are the HMAC key). `now` is in seconds. Returns the claims or null.
export function checkToken(parsed, key, hmac, now) {
  if (!parsed || typeof key !== 'string' || key.length < 32) return null;
  const expected = hmac(key, parsed.signingInput);
  if (!safeEqual(expected, parsed.sig)) return null;
  const c = parsed.claims;
  if (c.iss !== ISSUER || c.aud !== AUDIENCE) return null;
  if (typeof c.sub !== 'string' || c.sub.length === 0 || c.sub.length > 128) return null;
  if (typeof c.email !== 'string') return null;
  if (typeof c.exp !== 'number' || !(c.exp > now)) return null;
  if (typeof c.adm !== 'boolean') return null;
  if (!validDs(c.ds)) return null;
  return c;
}

// @edge-skip-start (not needed inside the CloudFront Function)
// Synchronous convenience wrapper (Node/mock): `getKey(kid)` returns the secret or null.
export function verifySession(token, getKey, hmac, now) {
  const p = parseToken(token);
  if (!p) return null;
  return checkToken(p, getKey(p.kid), hmac, now);
}

// HS256 signer used by the auth Lambda's tests and by the mock backend.
// Header serialization is fixed: {"alg":"HS256","typ":"JWT","kid":"<kid>"}.
export function signSession(claims, kid, key, hmac) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: kid }), 'utf8').toString('base64url');
  const p = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return h + '.' + p + '.' + hmac(key, h + '.' + p);
}
// @edge-skip-end

// Path classification. Returns one of:
//   { kind: 'bad' }                  -> 400 (traversal / encoded separators / malformed)
//   { kind: 'public' }               -> no session needed
//   { kind: 'session' }              -> any valid session
//   { kind: 'dataset', id: '<id>' }  -> session with id in ds (or ds = ['*'])
//   { kind: 'admin-only' }           -> under /data but not a valid dataset id: only ds=['*']
export function classifyPath(uri) {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 1024 || uri.charAt(0) !== '/') {
    return { kind: 'bad' };
  }
  const lower = uri.toLowerCase();
  if (
    uri.indexOf('..') !== -1 ||
    uri.indexOf('//') !== -1 ||
    uri.indexOf('\\') !== -1 ||
    lower.indexOf('%2e') !== -1 ||
    lower.indexOf('%2f') !== -1 ||
    lower.indexOf('%5c') !== -1 ||
    lower.indexOf('%00') !== -1 ||
    /[\x00-\x1f\x7f]/.test(uri) ||
    /\/\.(\/|$)/.test(uri)
  ) {
    return { kind: 'bad' };
  }
  if (
    uri === '/manifest.webmanifest' ||
    uri === '/favicon.svg' ||
    uri === '/signed-out.html' ||
    /^\/icon-[A-Za-z0-9_-]+\.svg$/.test(uri)
  ) {
    return { kind: 'public' };
  }
  // /auth/* is served by the auth Lambda and is not associated with this function;
  // if it ever is, let it through (the Lambda does its own checks).
  if (uri === '/auth' || uri.indexOf('/auth/') === 0) return { kind: 'public' };
  if (uri === '/data' || uri.indexOf('/data/') === 0) {
    const rest = uri.substring(6);
    const slash = rest.indexOf('/');
    const id = slash === -1 ? rest : rest.substring(0, slash);
    if (DATASET_RE.test(id) && slash !== -1) return { kind: 'dataset', id: id };
    return { kind: 'admin-only' };
  }
  return { kind: 'session' };
}

// Authorization decision for an already verified session (or null).
// Returns 'allow' | 'unauthenticated' | 'forbidden' | 'bad'.
export function authorize(uri, claims) {
  const c = classifyPath(uri);
  if (c.kind === 'bad') return 'bad';
  if (c.kind === 'public') return 'allow';
  if (!claims) return 'unauthenticated';
  const all = claims.ds.length === 1 && claims.ds[0] === '*';
  if (c.kind === 'session') return 'allow';
  if (all) return 'allow';
  if (c.kind === 'dataset' && claims.ds.indexOf(c.id) !== -1) return 'allow';
  return 'forbidden';
}

// True for top-level navigations (redirect to login instead of a 401).
export function isNavigation(headers) {
  const mode = headers['sec-fetch-mode'];
  if (mode && mode.value === 'navigate') return true;
  const accept = headers['accept'];
  return !!(accept && accept.value.indexOf('text/html') !== -1);
}

function jsonResponse(status, desc, error) {
  return {
    statusCode: status,
    statusDescription: desc,
    headers: {
      'content-type': { value: 'application/json; charset=utf-8' },
      'cache-control': { value: 'no-store' },
    },
    body: { encoding: 'text', data: '{"error":"' + error + '"}' },
  };
}

// Builds the viewer response for a non-'allow' decision (CloudFront event shape).
export function denyResponse(decision, uri, headers) {
  if (decision === 'bad') return jsonResponse(400, 'Bad Request', 'bad_path');
  if (decision === 'forbidden') return jsonResponse(403, 'Forbidden', 'forbidden');
  if (isNavigation(headers)) {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: {
        location: { value: '/auth/login?return=' + encodeURIComponent(uri) },
        'cache-control': { value: 'no-store' },
      },
    };
  }
  return jsonResponse(401, 'Unauthorized', 'unauthenticated');
}

// Extracts the session cookie from a CloudFront Functions event request.
export function sessionTokenFromRequest(request) {
  const c = request.cookies && request.cookies[SESSION_COOKIE];
  if (c && typeof c.value === 'string') return c.value;
  const h = request.headers && request.headers.cookie;
  return h ? readCookie(h.value, SESSION_COOKIE) : null;
}
