#!/usr/bin/env node
// Local mock of the AWS gateway (CloudFront + session-check Function + Lambda `auth` + S3).
// Reference implementation of server/mock/CONTRACT.md, for tests and manual runs. Not for production.
//
//   npm run build -- --mode aws
//   node server/mock/server.mjs --dist dist --data /path/to/datasets --port 4200 --secret dev
//
// <datasets>/<id>/index.json|questions.json|images/** is served under /data/<id>/… (read in place,
// never copied). Open http://localhost:4200 — cookies use the __Host-/__Secure- prefixes, which
// browsers accept on plain http only for localhost (Chromium, Firefox); use localhost, not 127.0.0.1.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SESSION_COOKIE, REFRESH_COOKIE, PKCE_COOKIE, MIN_KEY_LENGTH, authorize, sessionClaims, parseCookies, safeReturnPath,
  signSession, verifySession, isNavigation,
} from './session-core.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

/** CSP the CloudFront response-headers policy is expected to send for the app (see CONTRACT.md). */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://raw.githubusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com https://raw.githubusercontent.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { o[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; }
  }
  return o;
}

/** Deterministic UUID-shaped `sub` per email, so the same mock user keeps its progress keys. */
function subFor(email) {
  const h = createHash('sha256').update(email.toLowerCase()).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cookie(name, value, { path = '/', maxAge, sameSite = 'Lax' } = {}) {
  return `${name}=${value}; Path=${path}; Secure; HttpOnly; SameSite=${sameSite}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ''}`;
}

/**
 * @param {{ dist: string, data: string, secret: string, kid?: string, ttl?: number, refreshTtl?: number, now?: () => number, log?: boolean }} opts
 */
export function createMockServer(opts) {
  const dist = resolve(opts.dist);
  const dataDir = resolve(opts.data);
  const kid = opts.kid ?? 'mock-1';
  // The contract wants >= 32 characters of key material; a short dev secret (`--secret dev`)
  // is stretched deterministically so the same --secret always gives the same key.
  const key = opts.secret.length >= MIN_KEY_LENGTH ? opts.secret : createHash('sha256').update(`quizzer-mock:${opts.secret}`).digest('base64url');
  const keys = { [kid]: key };
  const ttl = opts.ttl ?? 1800;
  const refreshTtl = opts.refreshTtl ?? 30 * 24 * 3600;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  /** refresh token → { sub, email, name, groups, exp } (revoked on logout) */
  const refreshTokens = new Map();
  /** authorization code → user (single use) */
  const codes = new Map();

  async function listDatasets() {
    try {
      const entries = await readdir(dataDir, { withFileTypes: true });
      const ids = [];
      for (const e of entries) {
        if (!e.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(e.name)) continue;
        try { await stat(join(dataDir, e.name, 'index.json')); ids.push(e.name); } catch { /* not a dataset */ }
      }
      return ids.sort();
    } catch { return []; }
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, headers);
    res.end(body);
  }
  function json(res, status, obj, headers = {}) {
    send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  }
  function html(res, status, body, headers = {}) {
    send(res, status, `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quizzer — login (mock)</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;padding:2rem}main{background:#1e293b;border-radius:1rem;padding:1.5rem;max-width:26rem;width:100%}input[type=email],input[type=text]{width:100%;padding:.5rem;margin:.25rem 0 .75rem;border-radius:.5rem;border:1px solid #475569;background:#0f172a;color:#e2e8f0;box-sizing:border-box}label{display:block;margin:.35rem 0}button,a.btn{background:#f59e0b;color:#0f172a;border:0;border-radius:.6rem;padding:.6rem 1rem;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}small{color:#94a3b8}</style></head><body><main>${body}</main></body></html>`,
      { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", ...headers });
  }

  /** Session for a user, or null when the groups give no access (no ds-*, ds-all or admin). */
  function issue(user) {
    const claims = sessionClaims({ sub: user.sub, email: user.email, name: user.name, groups: user.groups, now: now(), ttl });
    return claims && { claims, token: signSession(claims, { kid, key }) };
  }

  async function meBody(claims) {
    const body = { sub: claims.sub, email: claims.email, ...(claims.name ? { name: claims.name } : {}), ds: claims.ds, adm: claims.adm, exp: claims.exp };
    if (claims.ds.length === 1 && claims.ds[0] === '*') body.allDatasets = await listDatasets();
    return body;
  }

  function readBody(req) {
    return new Promise((ok, ko) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size > 64 * 1024) { ko(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => ok(Buffer.concat(chunks)));
      req.on('error', ko);
    });
  }

  function validRefresh(req) {
    const t = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
    const r = t && refreshTokens.get(t);
    if (!r || r.exp <= now()) { if (t) refreshTokens.delete(t); return null; }
    return { token: t, user: r };
  }

  const clearCookies = [
    cookie(SESSION_COOKIE, '', { maxAge: 0 }),
    cookie(REFRESH_COOKIE, '', { path: '/auth', maxAge: 0, sameSite: 'Strict' }),
    cookie(PKCE_COOKIE, '', { path: '/auth', maxAge: 0 }),
  ];
  const notEnabledPage = '<h1>Accesso non abilitato</h1><p>Il tuo account non ha ancora accesso a nessun dataset. Chiedi all\'amministratore.</p>';

  // ── /auth/* (Lambda `auth` stand-in) ──────────────────────────────────────
  async function handleAuth(req, res, url) {
    const p = url.pathname;
    const method = req.method ?? 'GET';

    if (p === '/auth/me' && method === 'GET') {
      const t = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const v = t ? verifySession(t, { keys, now: now() }) : { ok: false };
      if (!v.ok) return json(res, 401, { error: 'unauthenticated' });
      return json(res, 200, await meBody(v.claims));
    }

    if (p === '/auth/refresh' && method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

    if (p === '/auth/refresh' && method === 'POST') {
      const body = await readBody(req);
      const sha = createHash('sha256').update(body).digest('hex');
      if (req.headers['x-amz-content-sha256'] !== sha) {
        // CloudFront OAC → Lambda URL: an unsigned/mismatching payload hash fails SigV4.
        return json(res, 403, { error: 'x-amz-content-sha256 missing or wrong' });
      }
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) || (site && site !== 'same-origin')) {
        return json(res, 403, { error: 'bad_origin' });
      }
      if (!parseCookies(req.headers.cookie)[REFRESH_COOKIE]) return json(res, 401, { error: 'no_refresh' });
      const r = validRefresh(req);
      if (!r) return json(res, 401, { error: 'refresh_failed' }, { 'set-cookie': clearCookies });
      const issued = issue(r.user);
      if (!issued) { refreshTokens.delete(r.token); return json(res, 403, { error: 'not_enabled' }, { 'set-cookie': clearCookies }); }
      return json(res, 200, await meBody(issued.claims), { 'set-cookie': [cookie(SESSION_COOKIE, issued.token, { maxAge: ttl })] });
    }

    if (p === '/auth/login' && method === 'GET') {
      const ret = safeReturnPath(url.searchParams.get('return') ?? '/');
      // Still holding a valid refresh token: silently mint a new session (the real Lambda does the same via Cognito).
      const r = validRefresh(req);
      const again = r && issue(r.user);
      if (again) {
        return send(res, 302, '', { location: ret, 'cache-control': 'no-store', 'set-cookie': [cookie(SESSION_COOKIE, again.token, { maxAge: ttl })] });
      }
      const state = randomBytes(16).toString('hex');
      const pkce = `${state}.${Buffer.from(ret).toString('base64url')}`;
      // Real flow: 302 to Cognito managed login with state + PKCE challenge. Mock: our own fake IdP page.
      return send(res, 302, '', {
        location: `/auth/mock-idp?state=${state}`,
        'cache-control': 'no-store',
        'set-cookie': [cookie(PKCE_COOKIE, pkce, { path: '/auth', maxAge: 600 })],
      });
    }

    if (p === '/auth/mock-idp' && method === 'GET') {
      const state = url.searchParams.get('state') ?? '';
      const ids = await listDatasets();
      return html(res, 200, `<h1>Quizzer — login finto</h1><p><small>Mock locale di Cognito. Nessuna password: scegli email e gruppi.</small></p>
<form method="post" action="/auth/mock-idp">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<label>Email<input type="email" name="email" required value="collega@example.com"></label>
<label>Nome (facoltativo)<input type="text" name="name"></label>
<fieldset><legend>Gruppi</legend>
${ids.map((id) => `<label><input type="checkbox" name="group" value="ds-${escapeHtml(id)}"> ds-${escapeHtml(id)}</label>`).join('\n')}
<label><input type="checkbox" name="group" value="ds-all"> ds-all</label>
<label><input type="checkbox" name="group" value="admin"> admin</label>
</fieldset><p><button type="submit">Accedi</button></p></form>`);
    }

    if (p === '/auth/mock-idp' && method === 'POST') {
      const form = new URLSearchParams((await readBody(req)).toString('utf8'));
      const email = (form.get('email') ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return html(res, 400, '<p>Email non valida.</p>');
      const code = randomBytes(16).toString('hex');
      codes.set(code, { sub: subFor(email), email, name: (form.get('name') ?? '').trim() || undefined, groups: form.getAll('group') });
      return send(res, 302, '', { location: `/auth/callback?code=${code}&state=${encodeURIComponent(form.get('state') ?? '')}`, 'cache-control': 'no-store' });
    }

    if (p === '/auth/callback' && method === 'GET') {
      const pkce = parseCookies(req.headers.cookie)[PKCE_COOKIE] ?? '';
      const [state, retB64] = pkce.split('.');
      const code = url.searchParams.get('code') ?? '';
      const user = codes.get(code);
      codes.delete(code);
      if (!state || state !== url.searchParams.get('state') || !user) {
        return html(res, 400, '<p>Login non valido o scaduto. <a class="btn" href="/auth/login?return=%2F">Riprova</a></p>');
      }
      const ret = safeReturnPath(Buffer.from(retB64 ?? '', 'base64url').toString('utf8'));
      const issued = issue(user);
      if (!issued) return html(res, 403, notEnabledPage, { 'set-cookie': clearCookies });
      const refresh = randomBytes(32).toString('base64url');
      refreshTokens.set(refresh, { ...user, exp: now() + refreshTtl });
      const token = issued.token;
      return send(res, 302, '', {
        location: ret,
        'cache-control': 'no-store',
        'set-cookie': [
          cookie(SESSION_COOKIE, token, { maxAge: ttl }),
          cookie(REFRESH_COOKIE, refresh, { path: '/auth', maxAge: refreshTtl, sameSite: 'Strict' }),
          cookie(PKCE_COOKIE, '', { path: '/auth', maxAge: 0 }),
        ],
      });
    }

    if (p === '/auth/logout' && (method === 'GET' || method === 'POST')) {
      const t = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
      if (t) refreshTokens.delete(t); // real Lambda: Cognito RevokeToken, then 302 to Cognito /logout → /signed-out.html
      return send(res, 302, '', {
        location: '/signed-out.html',
        'cache-control': 'no-store',
        'clear-site-data': '"cache"',
        'set-cookie': clearCookies,
      });
    }

    return json(res, 404, { error: 'not_found' });
  }

  async function serveFile(res, root, rel, headers) {
    const file = resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + sep)) return false;
    try {
      const st = await stat(file);
      if (!st.isFile()) return false;
      const body = await readFile(file);
      send(res, 200, body, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': body.length, ...headers });
      return true;
    } catch { return false; }
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rawPath = (req.url ?? '/').split('?')[0];
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')]));

    // 1. viewer-request: the CloudFront Function's decision.
    const d = authorize({ uri: rawPath, headers }, { keys, now: now() });
    if (opts.log) console.log(`${req.method} ${rawPath} → ${d.action}${d.status ? ' ' + d.status : ''}`);
    if (d.action === 'redirect') return send(res, 302, '', { location: d.location, 'cache-control': 'no-store' });
    if (d.action === 'deny') return json(res, d.status, { error: d.error });
    if (rawPath === '/signed-out.html' && !existsSync(join(dist, 'signed-out.html'))) {
      return html(res, 200, '<h1>Sei uscito</h1><p><a class="btn" href="/auth/login?return=%2F">Accedi di nuovo</a></p>');
    }

    // 2. behaviors
    if (rawPath.startsWith('/auth/')) return handleAuth(req, res, url);
    if (rawPath.startsWith('/api/')) return json(res, 404, { error: 'not-implemented' }); // no `api` Lambda (plan v3)
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method-not-allowed' });

    if (rawPath.startsWith('/data/')) {
      const ok = await serveFile(res, dataDir, decodeURIComponent(rawPath.slice('/data'.length)), { 'cache-control': 'private, no-cache' });
      if (!ok) json(res, 404, { error: 'not-found' }); // real S3 with OAC (no ListBucket) answers 403
      return;
    }

    const rel = decodeURIComponent(rawPath === '/' ? '/index.html' : rawPath);
    const isHtml = rel.endsWith('.html');
    const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    const sec = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', ...(isHtml ? { 'content-security-policy': APP_CSP } : {}) };
    if (await serveFile(res, dist, rel, { 'cache-control': cache, ...sec })) return;
    // SPA fallback (CloudFront custom error response → /index.html) for navigations only.
    if (isNavigation(headers) && (await serveFile(res, dist, '/index.html', { 'cache-control': 'no-cache', ...sec, 'content-security-policy': APP_CSP }))) return;
    json(res, 404, { error: 'not-found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) json(res, 500, { error: 'internal' }); else res.end(); });
  });
  return { server, keys, kid, key, refreshTokens };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.data) {
    console.error('usage: node server/mock/server.mjs --dist dist --data <datasets-dir> [--port 4200] [--secret dev] [--kid mock-1] [--ttl 1800] [--host localhost]');
    process.exit(2);
  }
  const { server } = createMockServer({
    dist: a.dist ?? 'dist', data: a.data, secret: a.secret ?? 'dev', kid: a.kid, ttl: a.ttl ? Number(a.ttl) : undefined, log: a.log === 'true',
  });
  const port = Number(a.port ?? 4200);
  server.listen(port, a.host ?? 'localhost', () => {
    console.log(`quizzer mock gateway on http://localhost:${port}  (dist=${resolve(a.dist ?? 'dist')}, data=${resolve(a.data)})`);
  });
}

export { EMPTY_SHA256 };
