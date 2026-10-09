import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifySession, authorize } from '../../../edge/session-core.js';
import { setup, ev, jar, APP, KEY1, CONFIG } from './fakes.js';
import { safeReturnPath, resolveAppHost } from '../src/returnPath.js';
import { computeAccess } from '../src/access.js';
import { parseConfig } from '../src/config.js';

const hm = (k: string, d: string) => createHmac('sha256', k).update(d).digest('base64url');
const cookieOf = (setCookies: string[] | undefined, name: string) => (setCookies ?? []).find((c) => c.startsWith(name + '='));

async function login(t: ReturnType<typeof setup>, sub: string, ret = '/') {
  const r1 = await t.handler(ev('GET', `/auth/login?return=${encodeURIComponent(ret)}`));
  expect(r1.statusCode).toBe(302);
  const auth = t.cognito.authorize(r1.headers.location!, sub);
  const c1 = jar(r1.cookies);
  const r2 = await t.handler(ev('GET', `/auth/callback?code=${auth.code}&state=${encodeURIComponent(auth.state)}`, { cookies: c1 }));
  return { r1, r2, auth, cookies: jar(r2.cookies, c1) };
}

describe('PKCE login flow', () => {
  it('login -> authorize (S256) -> callback -> session + refresh cookies -> 302 return', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', name: 'Uno', groups: ['ds-aws-dva-c02'] });
    const { r1, r2, auth } = await login(t, 'u1', '/?ds=aws-dva-c02#x');
    const loc = new URL(r1.headers.location!);
    expect(loc.origin).toBe(`https://${CONFIG.cognitoDomain}`);
    expect(loc.searchParams.get('redirect_uri')).toBe(`${APP}/auth/callback`);
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    expect(loc.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth.state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // verifier never leaves the server side: not in the URL
    expect(r1.headers.location).not.toContain('code_verifier');
    expect(r2.statusCode).toBe(302);
    expect(r2.headers.location).toBe(`${APP}/?ds=aws-dva-c02#x`);
    // token request carried the verifier matching the challenge
    const tokenCall = t.cognito.calls.find((c) => c.form.grant_type === 'authorization_code')!;
    expect(createHash('sha256').update(tokenCall.form.code_verifier!).digest('base64url')).toBe(loc.searchParams.get('code_challenge'));
    expect(tokenCall.form.redirect_uri).toBe(`${APP}/auth/callback`);
    const sess = cookieOf(r2.cookies, '__Host-qz_session')!;
    const jwt = sess.split(';')[0]!.split('=')[1]!;
    const claims = verifySession(jwt, (k) => (k === 'k1' ? KEY1 : null), hm, t.nowSec);
    expect(claims).toMatchObject({ sub: 'u1', email: 'u1@example.com', name: 'Uno', ds: ['aws-dva-c02'], adm: false, iss: 'quizzer', aud: 'quizzer-edge' });
    expect(claims!.exp - claims!.iat).toBe(1800);
    expect(authorize('/data/aws-dva-c02/questions.json', claims)).toBe('allow');
    expect(authorize('/data/mule-mcd-01/questions.json', claims)).toBe('forbidden');
    expect(t.logs.some((l) => l.evt === 'login' && l.sub === 'u1')).toBe(true);
    expect(JSON.stringify(t.logs)).not.toContain(jwt);
  });

  it('cookie attributes match the contract', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { r1, r2 } = await login(t, 'u1');
    expect(cookieOf(r1.cookies, '__Secure-qz_pkce')).toMatch(/^__Secure-qz_pkce=[^;]+; Path=\/auth; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
    expect(cookieOf(r2.cookies, '__Host-qz_session')).toMatch(/^__Host-qz_session=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800$/);
    expect(cookieOf(r2.cookies, '__Secure-qz_refresh')).toMatch(/^__Secure-qz_refresh=rt-[^;]+; Path=\/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
    expect(cookieOf(r2.cookies, '__Secure-qz_pkce')).toBe('__Secure-qz_pkce=; Path=/auth; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
    for (const c of [...(r1.cookies ?? []), ...(r2.cookies ?? [])]) expect(c).not.toMatch(/Domain=/i);
    expect(r2.headers['cache-control']).toBe('no-store');
  });

  it('state mismatch -> 400, no session, code not exchanged', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const r1 = await t.handler(ev('GET', '/auth/login'));
    const a = t.cognito.authorize(r1.headers.location!, 'u1');
    const r2 = await t.handler(ev('GET', `/auth/callback?code=${a.code}&state=forged-state`, { cookies: jar(r1.cookies) }));
    expect(r2.statusCode).toBe(400);
    expect(r2.headers['content-type']).toContain('text/html');
    expect(cookieOf(r2.cookies, '__Host-qz_session')).toBeUndefined();
    expect(t.cognito.calls.length).toBe(0);
  });

  it('missing PKCE cookie (login CSRF / other browser) -> 400', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const r1 = await t.handler(ev('GET', '/auth/login'));
    const a = t.cognito.authorize(r1.headers.location!, 'u1');
    const r2 = await t.handler(ev('GET', `/auth/callback?code=${a.code}&state=${a.state}`));
    expect(r2.statusCode).toBe(400);
    expect(t.cognito.calls.length).toBe(0);
  });

  it('tampered PKCE cookie (signature) -> 400', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const r1 = await t.handler(ev('GET', '/auth/login'));
    const a = t.cognito.authorize(r1.headers.location!, 'u1');
    const [nv] = jar(r1.cookies);
    const blob = nv!.split('=')[1]!.split('.')[0]!;
    const st = JSON.parse(Buffer.from(blob, 'base64url').toString());
    st.r = 'https://evil.example/';
    const forged = Buffer.from(JSON.stringify(st)).toString('base64url') + '.' + nv!.split('.').pop();
    const r2 = await t.handler(ev('GET', `/auth/callback?code=${a.code}&state=${a.state}`, { cookies: [`__Secure-qz_pkce=${forged}`] }));
    expect(r2.statusCode).toBe(400);
  });

  it('expired PKCE cookie (> 10 min) -> 400', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const r1 = await t.handler(ev('GET', '/auth/login'));
    const a = t.cognito.authorize(r1.headers.location!, 'u1');
    t.advance(601);
    const r2 = await t.handler(ev('GET', `/auth/callback?code=${a.code}&state=${a.state}`, { cookies: jar(r1.cookies) }));
    expect(r2.statusCode).toBe(400);
  });

  it('code replay is rejected by the IdP -> 400', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const r1 = await t.handler(ev('GET', '/auth/login'));
    const a = t.cognito.authorize(r1.headers.location!, 'u1');
    const c = jar(r1.cookies);
    expect((await t.handler(ev('GET', `/auth/callback?code=${a.code}&state=${a.state}`, { cookies: c }))).statusCode).toBe(302);
    expect((await t.handler(ev('GET', `/auth/callback?code=${a.code}&state=${a.state}`, { cookies: c }))).statusCode).toBe(400);
  });

  it('error from Cognito -> 400 page', async () => {
    const t = setup();
    const r = await t.handler(ev('GET', '/auth/callback?error=access_denied&state=x'));
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain('Accesso non riuscito');
  });

  it('ID token with wrong audience or issuer -> 500, no session', async () => {
    for (const over of [{ aud: 'other' }, { iss: 'https://evil' }, { token_use: 'access' }, { exp: 1 }]) {
      const t = setup();
      t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
      t.cognito.idOverride = over;
      const { r2 } = await login(t, 'u1');
      expect(r2.statusCode).toBe(500);
      expect(cookieOf(r2.cookies, '__Host-qz_session')).toBeUndefined();
    }
  });
});

describe('groups', () => {
  it('no groups -> 403 "accesso non abilitato", no cookies, refresh token revoked', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u2', email: 'u2@example.com', groups: [] });
    const { r2 } = await login(t, 'u2');
    expect(r2.statusCode).toBe(403);
    expect(r2.body).toContain('Accesso non abilitato');
    expect(r2.body).toContain('u2@example.com');
    expect(cookieOf(r2.cookies, '__Host-qz_session')).toMatch(/Max-Age=0/);
    expect(cookieOf(r2.cookies, '__Secure-qz_refresh')).toMatch(/Max-Age=0/);
    expect([...t.cognito.refresh.values()].every((r) => r.revoked)).toBe(true);
  });
  it('unrelated groups only -> not enabled', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u2', email: 'u2@example.com', groups: ['ds-', 'ds-BAD', 'other'] });
    expect((await login(t, 'u2')).r2.statusCode).toBe(403);
  });
  it('computeAccess', () => {
    expect(computeAccess([])).toBeNull();
    expect(computeAccess(['ds-mule-mcd-01', 'ds-aws-dva-c02', 'ds-aws-dva-c02'])).toEqual({ ds: ['aws-dva-c02', 'mule-mcd-01'], adm: false });
    expect(computeAccess(['ds-all', 'ds-aws-dva-c02'])).toEqual({ ds: ['*'], adm: false });
    expect(computeAccess(['admin'])).toEqual({ ds: ['*'], adm: true });
    expect(computeAccess(['admin', 'ds-aws-dva-c02'])).toEqual({ ds: ['aws-dva-c02'], adm: true });
    expect(computeAccess(['ds-../x', 'ds-*'])).toBeNull();
  });
  it('/auth/me for ds-all includes allDatasets', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'own', email: 'own@example.com', groups: ['admin', 'ds-all'] });
    const { cookies } = await login(t, 'own');
    const me = await t.handler(ev('GET', '/auth/me', { cookies }));
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body!)).toEqual({ sub: 'own', email: 'own@example.com', ds: ['*'], adm: true, exp: t.nowSec + 1800, allDatasets: ['aws-dva-c02', 'mule-mcd-01'] });
  });
});

describe('return path (open redirect)', () => {
  const evil = [
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example',
    '\\\\evil.example',
    '/%2F%2Fevil.example',
    '/%5cevil.example',
    'javascript:alert(1)',
    ' /x',
    '/x\r\nSet-Cookie: a=b',
    '/data/../auth/logout',
    '/auth/logout',
    '/auth/login?return=/x',
    '/' + 'a'.repeat(600),
    'evil.example',
    '',
  ];
  for (const e of evil) {
    it(`rejects ${JSON.stringify(e.slice(0, 40))}`, () => expect(safeReturnPath(e)).toBe('/'));
  }
  it('keeps same-origin paths', () => {
    expect(safeReturnPath('/')).toBe('/');
    expect(safeReturnPath('/data/aws-dva-c02/questions.json')).toBe('/data/aws-dva-c02/questions.json');
    expect(safeReturnPath('/?a=1&b=%20#h')).toBe('/?a=1&b=%20#h');
    expect(safeReturnPath(undefined)).toBe('/');
  });
  it('end to end: evil return lands on the app root of the configured host', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { r2 } = await login(t, 'u1', '//evil.example/x');
    expect(r2.headers.location).toBe(`${APP}/`);
  });
  it('a spoofed Host/X-Forwarded-Host is ignored unless allow-listed', async () => {
    expect(resolveAppHost({ host: 'evil.example' }, CONFIG.appHosts)).toBe('d111111abcdef8.cloudfront.net');
    expect(resolveAppHost({ 'x-forwarded-host': 'evil.example', host: 'x.lambda-url.eu-central-1.on.aws' }, CONFIG.appHosts)).toBe('d111111abcdef8.cloudfront.net');
    expect(resolveAppHost({ host: 'quiz.example.org' }, ['d1.cloudfront.net', 'quiz.example.org'])).toBe('quiz.example.org');
    const t = setup();
    const r = await t.handler(ev('GET', '/auth/login', { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } }));
    expect(new URL(r.headers.location!).searchParams.get('redirect_uri')).toBe(`${APP}/auth/callback`);
  });
});

describe('refresh', () => {
  const post = (cookies: string[], headers: Record<string, string> = { origin: APP, 'sec-fetch-site': 'same-origin' }) =>
    ev('POST', '/auth/refresh', { cookies, headers });

  it('re-issues the session and recomputes groups', async () => {
    const t = setup();
    const u = t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { cookies } = await login(t, 'u1');
    u.groups = ['ds-aws-dva-c02', 'ds-mule-mcd-01'];
    t.advance(1500);
    const r = await t.handler(post(cookies));
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body!);
    expect(body.ds).toEqual(['aws-dva-c02', 'mule-mcd-01']);
    expect(body.exp).toBe(t.nowSec + 1800);
    expect(cookieOf(r.cookies, '__Host-qz_session')).toBeDefined();
    expect(cookieOf(r.cookies, '__Secure-qz_refresh')).toBeUndefined(); // not rotated
  });

  it('revoked refresh token -> 401 + cookies cleared', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { cookies } = await login(t, 'u1');
    for (const r of t.cognito.refresh.values()) r.revoked = true; // AdminUserGlobalSignOut
    const r = await t.handler(post(cookies));
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body!)).toEqual({ error: 'refresh_failed' });
    expect(cookieOf(r.cookies, '__Host-qz_session')).toMatch(/Max-Age=0/);
    expect(cookieOf(r.cookies, '__Secure-qz_refresh')).toMatch(/Max-Age=0/);
  });

  it('disabled user -> 401 + cookies cleared', async () => {
    const t = setup();
    const u = t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { cookies } = await login(t, 'u1');
    u.enabled = false;
    const r = await t.handler(post(cookies));
    expect(r.statusCode).toBe(401);
  });

  it('removed from all groups -> 403 not_enabled + cookies cleared + revoked', async () => {
    const t = setup();
    const u = t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { cookies } = await login(t, 'u1');
    u.groups = [];
    const r = await t.handler(post(cookies));
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body!)).toEqual({ error: 'not_enabled' });
    expect(cookieOf(r.cookies, '__Secure-qz_refresh')).toMatch(/Max-Age=0/);
    expect([...t.cognito.refresh.values()].every((x) => x.revoked)).toBe(true);
  });

  it('Cognito outage -> 503, cookies kept', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { cookies } = await login(t, 'u1');
    t.cognito.down = true;
    const r = await t.handler(post(cookies));
    expect(r.statusCode).toBe(503);
    expect(r.cookies).toBeUndefined();
  });

  it('no refresh cookie -> 401 no_refresh; GET -> 405; cross-site -> 403', async () => {
    const t = setup();
    expect(JSON.parse((await t.handler(post([]))).body!)).toEqual({ error: 'no_refresh' });
    expect((await t.handler(ev('GET', '/auth/refresh'))).statusCode).toBe(405);
    expect((await t.handler(post(['__Secure-qz_refresh=x'], { origin: 'https://evil.example' }))).statusCode).toBe(403);
    expect((await t.handler(post(['__Secure-qz_refresh=x'], { 'sec-fetch-site': 'cross-site' }))).statusCode).toBe(403);
  });
});

describe('/auth/me and logout', () => {
  it('me without/with invalid/expired session -> 401', async () => {
    const t = setup();
    expect((await t.handler(ev('GET', '/auth/me'))).statusCode).toBe(401);
    expect((await t.handler(ev('GET', '/auth/me', { cookies: ['__Host-qz_session=a.b.c'] }))).statusCode).toBe(401);
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { cookies } = await login(t, 'u1');
    expect((await t.handler(ev('GET', '/auth/me', { cookies }))).statusCode).toBe(200);
    t.advance(1800);
    expect((await t.handler(ev('GET', '/auth/me', { cookies }))).statusCode).toBe(401);
  });

  it('logout revokes, clears cookies and redirects to Cognito logout', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { cookies } = await login(t, 'u1');
    const r = await t.handler(ev('GET', '/auth/logout', { cookies }));
    expect(r.statusCode).toBe(302);
    const u = new URL(r.headers.location!);
    expect(u.origin + u.pathname).toBe(`https://${CONFIG.cognitoDomain}/logout`);
    expect(u.searchParams.get('logout_uri')).toBe(`${APP}/signed-out.html`);
    expect(u.searchParams.get('client_id')).toBe(CONFIG.clientId);
    expect([...t.cognito.refresh.values()].every((x) => x.revoked)).toBe(true);
    expect(r.headers['clear-site-data']).toBe('"cache"');
    for (const n of ['__Host-qz_session', '__Secure-qz_refresh', '__Secure-qz_pkce']) expect(cookieOf(r.cookies, n)).toMatch(/Max-Age=0/);
  });

  it('unknown route -> 404', async () => {
    const t = setup();
    expect((await t.handler(ev('GET', '/auth/whatever'))).statusCode).toBe(404);
  });
});

describe('config (SSM) and keys (KVS)', () => {
  it('caches config and keys for 5 minutes', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) await t.handler(ev('GET', '/auth/login'));
    expect(t.counters.ssm).toBe(1);
    expect(t.counters.kvs).toBe(2);
    t.advance(301);
    await t.handler(ev('GET', '/auth/login'));
    expect(t.counters.ssm).toBe(2);
    expect(t.counters.kvs).toBe(4);
  });

  it('signs with the current kid and still accepts the previous one during rotation', async () => {
    const t = setup();
    t.cognito.addUser({ sub: 'u1', email: 'u1@example.com', groups: ['ds-aws-dva-c02'] });
    const { cookies } = await login(t, 'u1');
    t.kvs['qz-key-k2'] = 'k2-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    t.kvs['qz-current-kid'] = 'k2';
    t.advance(301);
    expect((await t.handler(ev('GET', '/auth/me', { cookies }))).statusCode).toBe(200);
    const r = await t.handler(ev('POST', '/auth/refresh', { cookies, headers: { origin: APP } }));
    const jwt = cookieOf(r.cookies, '__Host-qz_session')!.split(';')[0]!.split('=')[1]!;
    expect(JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString()).kid).toBe('k2');
    delete t.kvs['qz-key-k1'];
    t.advance(301);
    expect((await t.handler(ev('GET', '/auth/me', { cookies }))).statusCode).toBe(401);
  });

  it('missing KVS key -> 500 on login (fails closed)', async () => {
    const t = setup({ kvs: {} });
    expect((await t.handler(ev('GET', '/auth/login'))).statusCode).toBe(500);
  });

  it('parseConfig validates', () => {
    expect(() => parseConfig(JSON.stringify({ ...CONFIG, appHosts: [] }))).toThrow();
    expect(() => parseConfig(JSON.stringify({ ...CONFIG, appHosts: ['https://x.example'] }))).toThrow();
    expect(() => parseConfig(JSON.stringify({ ...CONFIG, datasets: ['../x'] }))).toThrow();
    expect(() => parseConfig(JSON.stringify({ ...CONFIG, sessionTtlSeconds: 99999 }))).toThrow();
    expect(parseConfig(JSON.stringify(CONFIG)).datasets).toEqual(['aws-dva-c02', 'mule-mcd-01']);
  });
});

describe('bundle', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  beforeAll(() => {
    execFileSync('node', ['lambda/auth/build.mjs'], { cwd: root, stdio: 'pipe' });
  }, 60_000);
  it('is a single ESM file under 1.5 MiB and exports handler', async () => {
    const f = root + 'lambda/auth/dist/index.mjs';
    expect(statSync(f).size).toBeLessThan(1.5 * 1024 * 1024);
    const src = readFileSync(f, 'utf8');
    expect(src).not.toMatch(/from"@aws-sdk|from "@aws-sdk/);
    process.env.CONFIG_PARAMETER = '/quizzer/prod/config';
    process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/00000000-0000-0000-0000-000000000000';
    process.env.AWS_REGION = 'eu-central-1';
    const mod = await import(f);
    expect(typeof mod.handler).toBe('function');
  });
});
