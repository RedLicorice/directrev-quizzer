// CloudFront Function `session-check` (runtime cloudfront-js-2.0, viewer-request).
// GENERATED FILE: edit edge/session-core.js or edge/session-check.template.js and run
// `npm run build:edge` in infra/. The test suite fails if this file is stale.
import crypto from 'crypto';
import cf from 'cloudfront';
const SESSION_COOKIE = '__Host-qz_session';
const ISSUER = 'quizzer';
const AUDIENCE = 'quizzer-edge';
const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const DATASET_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const KVS_KEY_PREFIX = 'qz-key-';
const MAX_TOKEN = 3000;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const EXPECTED_SIG_LEN = 43; // base64url(32 bytes) without padding
function readCookie(header, name) {
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
function parseToken(token) {
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
function safeEqual(a, b) {
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
function checkToken(parsed, key, hmac, now) {
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
function classifyPath(uri) {
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
if (uri === '/auth' || uri.indexOf('/auth/') === 0) return { kind: 'public' };
if (uri === '/api/admin' || uri.indexOf('/api/admin/') === 0) return { kind: 'admin' };
if (uri === '/data' || uri.indexOf('/data/') === 0) {
const rest = uri.substring(6);
const slash = rest.indexOf('/');
const id = slash === -1 ? rest : rest.substring(0, slash);
if (DATASET_RE.test(id) && slash !== -1) return { kind: 'dataset', id: id };
return { kind: 'admin-only' };
}
return { kind: 'session' };
}
function authorize(uri, claims) {
const c = classifyPath(uri);
if (c.kind === 'bad') return 'bad';
if (c.kind === 'public') return 'allow';
if (!claims) return 'unauthenticated';
const all = claims.ds.length === 1 && claims.ds[0] === '*';
if (c.kind === 'session') return 'allow';
if (c.kind === 'admin') return claims.adm ? 'allow' : 'forbidden';
if (all) return 'allow';
if (c.kind === 'dataset' && claims.ds.indexOf(c.id) !== -1) return 'allow';
return 'forbidden';
}
function isNavigation(headers) {
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
function denyResponse(decision, uri, headers) {
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
function sessionTokenFromRequest(request) {
const c = request.cookies && request.cookies[SESSION_COOKIE];
if (c && typeof c.value === 'string') return c.value;
const h = request.headers && request.headers.cookie;
return h ? readCookie(h.value, SESSION_COOKIE) : null;
}
function hmac(key, data) {
return crypto.createHmac('sha256', key).update(data).digest('base64url');
}
async function handler(event) {
const request = event.request;
const uri = request.uri;
const cls = classifyPath(uri);
if (cls.kind === 'bad') return denyResponse('bad', uri, request.headers);
if (cls.kind === 'public') return request;
let claims = null;
const parsed = parseToken(sessionTokenFromRequest(request));
if (parsed) {
let key = null;
try {
key = await cf.kvs().get(KVS_KEY_PREFIX + parsed.kid);
} catch (e) {
key = null; // unknown kid (rotated out) or KVS error: treat as no session
}
claims = checkToken(parsed, key, hmac, Math.floor(Date.now() / 1000));
}
const decision = authorize(uri, claims);
if (decision === 'allow') return request;
return denyResponse(decision, uri, request.headers);
}
