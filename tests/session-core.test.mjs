import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  signSession, verifySession, authorize, decide, classifyPath, safeReturnPath, parseCookies, sessionClaims, accessFromGroups,
  b64urlEncode, SESSION_COOKIE,
} from '../server/mock/session-core.mjs';

// Authoritative vectors copied verbatim from branch feat/aws-infra (infra/edge/test/vectors.json @ 84135fc).
const V = JSON.parse(readFileSync(new URL('./fixtures/edge-vectors.json', import.meta.url), 'utf8'));
const KEYS = { [V.kid]: V.key };
const NOW = V.now;
const tok = (name) => V.tokens.find((t) => t.name === name);
const USER = tok('user-aws');
const OWNER = tok('owner-all');
const EXPIRED = tok('user-aws-expired');

const v = (t, now = NOW) => verifySession(t, { keys: KEYS, now });
function rawToken(header, payload, key = V.key) {
  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(payload));
  return `${h}.${p}.${createHmac('sha256', Buffer.from(key)).update(`${h}.${p}`).digest('base64url')}`;
}
const HDR = { alg: 'HS256', typ: 'JWT', kid: V.kid };

describe('JWT HS256: authoritative vectors (infra/CONTRACT.md §3.2)', () => {
  it('signs every vector byte for byte', () => {
    for (const t of V.tokens) expect(signSession(t.claims, { kid: V.kid, key: V.key }), t.name).toBe(t.token);
  });
  it('verifies them', () => {
    expect(v(USER.token)).toEqual({ ok: true, claims: USER.claims });
    expect(v(OWNER.token)).toEqual({ ok: true, claims: OWNER.claims });
    expect(v(EXPIRED.token, 1700001799).ok).toBe(true);
    expect(v(EXPIRED.token, 1700001800)).toEqual({ ok: false, reason: 'expired' }); // exp <= now: no leeway
  });
});

describe('JWT malicious cases', () => {
  const [h, p, s] = USER.token.split('.');
  it('alg none (empty or copied signature)', () => {
    const nh = b64urlEncode(JSON.stringify({ alg: 'none', typ: 'JWT', kid: V.kid }));
    expect(v(`${nh}.${p}.`).ok).toBe(false);
    expect(v(`${nh}.${p}.${s}`)).toEqual({ ok: false, reason: 'alg' });
  });
  it('wrong alg (HS512, RS256, hs256), re-signed with the right key', () => {
    for (const alg of ['HS512', 'RS256', 'hs256', 'HS256 ']) expect(v(rawToken({ ...HDR, alg }, USER.claims)).reason, alg).toBe('alg');
    expect(v(rawToken({ ...HDR, typ: 'JWS' }, USER.claims)).reason).toBe('typ');
  });
  it('bad signature: flipped char, tampered payload, other key', () => {
    const flipped = s.slice(0, 10) + (s[10] === 'A' ? 'B' : 'A') + s.slice(11);
    expect(v(`${h}.${p}.${flipped}`)).toEqual({ ok: false, reason: 'signature' });
    const p2 = b64urlEncode(JSON.stringify({ ...USER.claims, ds: ['*'], adm: true }));
    expect(v(`${h}.${p2}.${s}`)).toEqual({ ok: false, reason: 'signature' });
    expect(v(rawToken(HDR, USER.claims, 'another-key-0123456789abcdefghijklmnop')).reason).toBe('signature');
  });
  it('truncated / malformed / oversized', () => {
    for (const t of ['', 'a', `${h}.${p}`, `${h}.${p}.`, `${h}..${s}`, `${h}.${p}.${s}.x`, `${h}.${p}.${s.slice(0, 42)}`, `${h}.${p}.${s}=`,
      `${h}.${p}.${s.slice(0, 41)}+/`, `${b64urlEncode('not json')}.${p}.${s}`, `${h}.${p}.${s}`.padEnd(3001, 'A')]) {
      expect(v(t).ok, t.slice(0, 40)).toBe(false);
    }
  });
  it('unknown kid, bad kid syntax, prototype kids', () => {
    for (const kid of ['k2', undefined, 1, '__proto__', 'constructor', 'toString', '../k1', 'k/1', 'x'.repeat(33)]) {
      expect(v(rawToken({ ...HDR, kid }, USER.claims)).reason, String(kid)).toBe('kid');
    }
  });
  it('short keys are refused even when the kid exists', () => {
    const t = rawToken({ ...HDR, kid: 'short' }, USER.claims, 'dev');
    expect(verifySession(t, { keys: { short: 'dev' }, now: NOW }).reason).toBe('kid');
  });
  it('wrong iss / aud / claim shapes', () => {
    for (const [bad, reason] of [[{ iss: 'x' }, 'iss-aud'], [{ aud: 'quizzer-app' }, 'iss-aud'], [{ exp: '4102444800' }, 'claims'],
      [{ ds: [] }, 'claims'], [{ ds: ['../x'] }, 'claims'], [{ ds: ['*', 'aws-dva-c02'] }, 'claims'], [{ ds: 'aws-dva-c02' }, 'claims'],
      [{ adm: undefined }, 'claims'], [{ adm: 'true' }, 'claims'], [{ sub: '' }, 'claims'], [{ sub: 'x'.repeat(129) }, 'claims']]) {
      expect(v(rawToken(HDR, { ...USER.claims, ...bad })).reason, JSON.stringify(bad)).toBe(reason);
    }
  });
});

describe('path decisions: authoritative table (vectors.json → paths)', () => {
  const claimsFor = { anon: null, 'user-aws': USER.claims, 'owner-all': OWNER.claims };
  for (const row of V.paths) {
    it(row.uri, () => {
      for (const who of ['anon', 'user-aws', 'owner-all']) expect(decide(row.uri, claimsFor[who]), who).toBe(row[who]);
    });
  }
  it('extra traversal and encoding cases are "bad"', () => {
    for (const p of ['/data/a/..', '/data/a/.', '/%2e%2e/etc/passwd', 'data/a', '/data/a\nb', '/a%2F', '/x'.repeat(600)]) {
      expect(classifyPath(p).kind, p).toBe('bad');
    }
  });
});

describe('authorize: HTTP mapping of the decision', () => {
  const opts = { keys: KEYS, now: NOW };
  const req = (uri, { token, nav = false } = {}) => ({
    uri, headers: { ...(token ? { cookie: `foo=1; ${SESSION_COOKIE}=${token}` } : {}), 'sec-fetch-mode': nav ? 'navigate' : 'cors' },
  });
  it('anon navigation → 302 /auth/login?return=<uri>; anon fetch → 401', () => {
    expect(authorize(req('/some/page', { nav: true }), opts)).toEqual({ action: 'redirect', status: 302, location: '/auth/login?return=%2Fsome%2Fpage' });
    expect(authorize({ uri: '/', headers: { accept: 'text/html,*/*' } }, opts).action).toBe('redirect');
    expect(authorize(req('/data/aws-dva-c02/index.json'), opts)).toEqual({ action: 'deny', status: 401, error: 'unauthenticated' });
    expect(authorize(req('/data/aws-dva-c02/index.json', { token: EXPIRED.token }), { ...opts, now: 1700001800 }).status).toBe(401);
  });
  it('403 forbidden, 400 bad_path, allow', () => {
    expect(authorize(req('/data/mule-mcd-01/questions.json', { token: USER.token }), opts)).toEqual({ action: 'deny', status: 403, error: 'forbidden' });
    expect(authorize(req('/data/aws-dva-c02/%2e%2e/mule-mcd-01/q.json', { token: USER.token }), opts)).toEqual({ action: 'deny', status: 400, error: 'bad_path' });
    expect(authorize(req('/data/aws-dva-c02/images/q1.png', { token: USER.token }), opts).action).toBe('allow');
    expect(authorize(req('/data/mule-mcd-01/questions.json', { token: OWNER.token }), opts).action).toBe('allow');
  });
  it('a forged cookie is treated as no session', () => {
    const forged = rawToken(HDR, { ...USER.claims, ds: ['*'] }, 'attacker-key-0123456789abcdefghijklmn');
    expect(authorize(req('/data/mule-mcd-01/questions.json', { token: forged }), opts).status).toBe(401);
  });
  it('first cookie occurrence wins', () => {
    expect(parseCookies(`${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b`)[SESSION_COOKIE]).toBe('a');
  });
});

describe('helpers', () => {
  it('safeReturnPath keeps only same-origin relative paths', () => {
    expect(safeReturnPath('/?x=1#h')).toBe('/?x=1#h');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', '/auth/logout', '/auth', '/a\nb', '/a/../b', '/a%2fb', `/${'x'.repeat(512)}`]) {
      expect(safeReturnPath(bad), bad).toBe('/');
    }
  });
  it('groups → access (CONTRACT §3, §7)', () => {
    expect(accessFromGroups(['ds-mule-mcd-01', 'ds-aws-dva-c02', 'other'])).toEqual({ ds: ['aws-dva-c02', 'mule-mcd-01'], adm: false });
    expect(accessFromGroups(['ds-aws-dva-c02', 'ds-all'])).toEqual({ ds: ['*'], adm: false });
    expect(accessFromGroups(['admin'])).toEqual({ ds: ['*'], adm: true });
    expect(accessFromGroups(['ds-../x', 'ds-', 'other'])).toBeNull();
    expect(sessionClaims({ sub: USER.claims.sub, email: USER.claims.email, groups: ['ds-aws-dva-c02'], now: 1700000000, ttl: 4102444800 - 1700000000 })).toEqual(USER.claims);
    expect(JSON.stringify(sessionClaims({ sub: OWNER.claims.sub, email: OWNER.claims.email, name: 'Owner', groups: ['ds-all', 'admin'], now: 1700000000, ttl: 4102444800 - 1700000000 })))
      .toBe(JSON.stringify(OWNER.claims)); // same key order → same token
  });
});
