// Integration test of the local gateway mock against SYNTHETIC datasets created in a temp dir
// (never the real dataset repos). Node's fetch ignores the Secure attribute, so cookies are
// carried by hand.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createMockServer, EMPTY_SHA256 } from '../server/mock/server.mjs';
import { SESSION_COOKIE, REFRESH_COOKIE, verifySession } from '../server/mock/session-core.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'quizzer-mock-'));
let base;
let srv;
let clock = 1_800_000_000;

beforeAll(async () => {
  const dist = join(TMP, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(dist, 'manifest.webmanifest'), '{}');
  for (const id of ['ds-one', 'ds-two']) {
    mkdirSync(join(TMP, 'data', id, 'images'), { recursive: true });
    writeFileSync(join(TMP, 'data', id, 'index.json'), JSON.stringify({ schemaVersion: 1, datasets: [{ id, title: id, file: 'questions.json' }] }));
    writeFileSync(join(TMP, 'data', id, 'questions.json'), '[]');
    writeFileSync(join(TMP, 'data', id, 'images', 'a.jpeg'), 'img');
  }
  srv = createMockServer({ dist, data: join(TMP, 'data'), secret: 'test-secret', kid: 'k1', ttl: 600, now: () => clock });
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.server.address().port}`;
});
afterAll(() => { srv.server.close(); rmSync(TMP, { recursive: true, force: true }); });

class Jar {
  m = new Map();
  absorb(res) {
    for (const c of res.headers.getSetCookie()) {
      const [nv, ...attrs] = c.split(';');
      const i = nv.indexOf('=');
      const name = nv.slice(0, i);
      const maxAge = attrs.map((a) => a.trim()).find((a) => a.startsWith('Max-Age='));
      if (maxAge === 'Max-Age=0') this.m.delete(name); else this.m.set(name, { value: nv.slice(i + 1), attrs: attrs.map((a) => a.trim()) });
    }
  }
  header(path) {
    return [...this.m.entries()].filter(([, v]) => path.startsWith(v.attrs.find((a) => a.startsWith('Path='))?.slice(5) ?? '/')).map(([k, v]) => `${k}=${v.value}`).join('; ');
  }
}

async function req(jar, path, init = {}) {
  const res = await fetch(base + path, { redirect: 'manual', ...init, headers: { ...(init.headers ?? {}), cookie: jar.header(path) } });
  jar.absorb(res);
  return res;
}

/** Raw request: fetch() would normalise `..`/`%2e%2e` and force `sec-fetch-mode: cors`. */
function raw(path, headers = {}) {
  return new Promise((ok, ko) => {
    const r = request(base + '/', { path, headers }, (res) => { res.resume(); ok({ status: res.statusCode, headers: res.headers }); });
    r.on('error', ko);
    r.end();
  });
}

async function loginAs(email, groups, ret = '/', expectedLocation = ret) {
  const jar = new Jar();
  let r = await req(jar, `/auth/login?return=${encodeURIComponent(ret)}`);
  expect(r.status).toBe(302);
  const state = new URL(r.headers.get('location'), base).searchParams.get('state');
  const form = new URLSearchParams({ state, email });
  groups.forEach((g) => form.append('group', g));
  r = await req(jar, '/auth/mock-idp', { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  r = await req(jar, r.headers.get('location'));
  expect(r.status).toBe(302);
  expect(r.headers.get('location')).toBe(expectedLocation);
  return jar;
}

describe('mock gateway', () => {
  it('unauthenticated: navigation → 302 login, fetch → 401, public allowlist → 200', async () => {
    const jar = new Jar();
    const nav = await raw('/somewhere?x=1', { 'sec-fetch-mode': 'navigate' });
    expect(nav.status).toBe(302);
    expect(nav.headers.location).toBe('/auth/login?return=%2Fsomewhere');
    expect((await raw('/', { accept: 'text/html' })).status).toBe(302);
    let r;
    r = await req(jar, '/data/ds-one/index.json', { headers: { 'sec-fetch-mode': 'cors' } });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'unauthenticated' });
    expect((await req(jar, '/manifest.webmanifest')).status).toBe(200);
    expect((await req(jar, '/signed-out.html')).status).toBe(200);
    expect((await req(jar, '/auth/me')).status).toBe(401);
  });

  it('cookies: names and attributes', async () => {
    const jar = await loginAs('a@example.com', ['ds-ds-one']);
    const s = jar.m.get(SESSION_COOKIE);
    expect(s.attrs).toEqual(expect.arrayContaining(['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']));
    expect(s.attrs.some((a) => a.startsWith('Domain'))).toBe(false);
    const rf = jar.m.get(REFRESH_COOKIE);
    expect(rf.attrs).toEqual(expect.arrayContaining(['Path=/auth', 'Secure', 'HttpOnly', 'SameSite=Strict']));
    const v = verifySession(s.value, { keys: { k1: srv.key }, now: clock });
    expect(v.ok && v.claims).toEqual({ iss: 'quizzer', aud: 'quizzer-edge', sub: expect.any(String), email: 'a@example.com', ds: ['ds-one'], adm: false, iat: clock, exp: clock + 600 });
    expect(srv.key.length).toBeGreaterThanOrEqual(32); // short --secret is stretched
    expect(JSON.parse(Buffer.from(s.value.split('.')[0], 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT', kid: 'k1' });
  });

  it('authorization by dataset: own dataset 200 (private, no-cache), other dataset 403', async () => {
    const jar = await loginAs('a@example.com', ['ds-ds-one']);
    const me = await (await req(jar, '/auth/me')).json();
    expect(me).toMatchObject({ email: 'a@example.com', ds: ['ds-one'], adm: false });
    expect(me.allDatasets).toBeUndefined();
    let r = await req(jar, '/data/ds-one/images/a.jpeg');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-cache');
    r = await req(jar, '/data/ds-two/questions.json');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'forbidden' });
    const cookie = jar.header('/data/');
    expect((await raw('/data/ds-one/../ds-two/questions.json', { cookie })).status).toBe(400);
    expect((await raw('/data/ds-one/%2e%2e/ds-two/questions.json', { cookie })).status).toBe(400);
    expect((await raw('/data/ds-one/%2E%2E%2Fds-two/questions.json', { cookie })).status).toBe(400);
    expect((await raw('/data/ds-one/images/a.jpeg', { cookie })).status).toBe(200);
  });

  it('no dataset group and not admin → 403 "Accesso non abilitato", no cookies', async () => {
    const jar = new Jar();
    let r = await req(jar, '/auth/login?return=%2F');
    const state = new URL(r.headers.get('location'), base).searchParams.get('state');
    r = await req(jar, '/auth/mock-idp', { method: 'POST', body: new URLSearchParams({ state, email: 'nobody@example.com' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    r = await req(jar, r.headers.get('location'));
    expect(r.status).toBe(403);
    expect(await r.text()).toContain('Accesso non abilitato');
    expect(jar.m.has(SESSION_COOKIE)).toBe(false);
  });

  it('admin alone → ds [*]', async () => {
    const jar = await loginAs('adm@example.com', ['admin']);
    expect(await (await req(jar, '/auth/me')).json()).toMatchObject({ ds: ['*'], adm: true });
  });

  it('ds-all → ds [*] + allDatasets', async () => {
    const jar = await loginAs('owner@example.com', ['ds-all', 'admin']);
    const me = await (await req(jar, '/auth/me')).json();
    expect(me).toMatchObject({ ds: ['*'], adm: true, allDatasets: ['ds-one', 'ds-two'] });
    expect((await req(jar, '/data/ds-two/questions.json')).status).toBe(200);
  });

  it('refresh: needs x-amz-content-sha256, re-issues the session; expired session → 401 until refreshed', async () => {
    const jar = await loginAs('b@example.com', ['ds-ds-one']);
    clock += 601; // session expired
    expect((await req(jar, '/data/ds-one/index.json')).status).toBe(401);
    expect((await req(jar, '/auth/refresh', { method: 'POST' })).status).toBe(403); // OAC: payload hash required
    expect((await req(jar, '/auth/refresh', { method: 'POST', headers: { 'x-amz-content-sha256': EMPTY_SHA256, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await req(new Jar(), '/auth/refresh', { method: 'POST', headers: { 'x-amz-content-sha256': EMPTY_SHA256 } })).status).toBe(401);
    expect((await req(jar, '/auth/refresh')).status).toBe(405);
    const r = await req(jar, '/auth/refresh', { method: 'POST', headers: { 'x-amz-content-sha256': EMPTY_SHA256 } });
    expect(r.status).toBe(200);
    expect((await r.json()).exp).toBe(clock + 600);
    expect((await req(jar, '/data/ds-one/index.json')).status).toBe(200);
  });

  it('logout clears cookies, revokes the refresh token, sends Clear-Site-Data: "cache"', async () => {
    const jar = await loginAs('c@example.com', ['ds-ds-one']);
    const stolen = jar.m.get(REFRESH_COOKIE).value;
    const r = await req(jar, '/auth/logout');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/signed-out.html');
    expect(r.headers.get('clear-site-data')).toBe('"cache"');
    expect(jar.m.size).toBe(0);
    expect((await req(jar, '/auth/me')).status).toBe(401);
    const replay = new Jar();
    replay.m.set(REFRESH_COOKIE, { value: stolen, attrs: ['Path=/auth'] });
    expect((await req(replay, '/auth/refresh', { method: 'POST', headers: { 'x-amz-content-sha256': EMPTY_SHA256 } })).status).toBe(401);
  });

  it('login rejects open redirects and a forged state', async () => {
    await loginAs('d@example.com', ['ds-ds-one'], '//evil.example/x', '/');
    await loginAs('d@example.com', ['ds-ds-one'], 'https://evil.example/', '/');
    await loginAs('d@example.com', ['ds-ds-one'], '/?a=1#b', '/?a=1#b');
    const j2 = new Jar();
    const r = await req(j2, '/auth/callback?code=nope&state=nope');
    expect(r.status).toBe(400);
  });
});
