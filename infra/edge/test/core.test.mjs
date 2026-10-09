import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as core from '../session-core.js';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest('base64url');
const getKey = (kid) => (kid === V.kid ? V.key : null);
const tok = (name) => V.tokens.find((t) => t.name === name);
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const forge = (header, claims, key = V.key) => {
  const si = b64(header) + '.' + b64(claims);
  return si + '.' + hmac(key, si);
};
const base = tok('user-aws').claims;
const H = { alg: 'HS256', typ: 'JWT', kid: 'k1' };

describe('test vectors (CONTRACT.md §3.2)', () => {
  for (const t of V.tokens) {
    it(`signSession reproduces ${t.name}`, () => {
      expect(core.signSession(t.claims, V.kid, V.key, hmac)).toBe(t.token);
    });
    it(`verifySession accepts ${t.name}`, () => {
      expect(core.verifySession(t.token, getKey, hmac, V.now)).toEqual(t.claims);
    });
  }
  it('expired vector is rejected at exp', () => {
    const t = tok('user-aws-expired');
    expect(core.verifySession(t.token, getKey, hmac, 1700001799)).not.toBeNull();
    expect(core.verifySession(t.token, getKey, hmac, 1700001800)).toBeNull();
  });
});

describe('malicious tokens', () => {
  const now = V.now;
  const cases = {
    'alg none, empty sig': b64({ alg: 'none', typ: 'JWT', kid: 'k1' }) + '.' + b64(base) + '.',
    'alg none with HS sig': forge({ alg: 'none', typ: 'JWT', kid: 'k1' }, base),
    'alg HS512 header': forge({ alg: 'HS512', typ: 'JWT', kid: 'k1' }, base),
    'alg RS256 header': forge({ alg: 'RS256', typ: 'JWT', kid: 'k1' }, base),
    'alg lower-case': forge({ alg: 'hs256', typ: 'JWT', kid: 'k1' }, base),
    'typ other': forge({ alg: 'HS256', typ: 'JOSE', kid: 'k1' }, base),
    'kid missing': forge({ alg: 'HS256', typ: 'JWT' }, base),
    'kid unknown': forge({ alg: 'HS256', typ: 'JWT', kid: 'k2' }, base),
    'kid traversal': forge({ alg: 'HS256', typ: 'JWT', kid: '../k1' }, base),
    'kid too long': forge({ alg: 'HS256', typ: 'JWT', kid: 'k'.repeat(33) }, base),
    'wrong key': forge(H, base, 'another-key-another-key-another-key!!'),
    'flipped sig char': (() => {
      const t = tok('user-aws').token;
      const last = t.at(-2) === 'A' ? 'B' : 'A';
      return t.slice(0, -2) + last + t.at(-1);
    })(),
    'truncated sig': tok('user-aws').token.slice(0, -1),
    'extended sig': tok('user-aws').token + 'A',
    'payload swapped (privilege escalation)': (() => {
      const [h, , s] = tok('user-aws').token.split('.');
      return h + '.' + b64({ ...base, ds: ['*'], adm: true }) + '.' + s;
    })(),
    'four segments': tok('user-aws').token + '.x',
    'two segments': tok('user-aws').token.split('.').slice(0, 2).join('.'),
    'padding chars': tok('user-aws').token + '=',
    'too long': forge(H, { ...base, pad: 'x'.repeat(3000) }),
    'wrong iss': forge(H, { ...base, iss: 'evil' }),
    'wrong aud': forge(H, { ...base, aud: 'other' }),
    'expired': forge(H, { ...base, exp: now }),
    'exp as string': forge(H, { ...base, exp: '4102444800' }),
    'exp missing': forge(H, (({ exp, ...r }) => r)(base)),
    'ds empty': forge(H, { ...base, ds: [] }),
    'ds not array': forge(H, { ...base, ds: 'aws-dva-c02' }),
    'ds traversal': forge(H, { ...base, ds: ['../mule-mcd-01'] }),
    'ds star mixed': forge(H, { ...base, ds: ['*', 'aws-dva-c02'] }),
    'ds upper case': forge(H, { ...base, ds: ['AWS-DVA-C02'] }),
    'adm missing': forge(H, (({ adm, ...r }) => r)(base)),
    'adm string': forge(H, { ...base, adm: 'true' }),
    'sub missing': forge(H, (({ sub, ...r }) => r)(base)),
    'email missing': forge(H, (({ email, ...r }) => r)(base)),
    'payload array': forge(H, [1, 2]),
    'header array': forge([1], base),
    'payload not json': b64(H) + '.' + b64('not json') + '.' + hmac(V.key, b64(H) + '.' + b64('not json')),
    'empty string': '',
  };
  for (const [name, t] of Object.entries(cases)) {
    it(`rejects: ${name}`, () => {
      expect(core.verifySession(t, getKey, hmac, now)).toBeNull();
    });
  }
  it('rejects non-string tokens', () => {
    for (const t of [null, undefined, 42, {}, []]) expect(core.verifySession(t, getKey, hmac, now)).toBeNull();
  });
  it('rejects short keys', () => {
    const p = core.parseToken(tok('user-aws').token);
    expect(core.checkToken(p, 'short', hmac, now)).toBeNull();
    expect(core.checkToken(p, null, hmac, now)).toBeNull();
  });
  it('never calls hmac with an algorithm from the header', () => {
    const seen = [];
    const spy = (k, d) => {
      seen.push(k);
      return hmac(k, d);
    };
    core.verifySession(forge({ alg: 'HS256', typ: 'JWT', kid: 'k1' }, base), getKey, spy, now);
    expect(seen).toEqual([V.key]);
  });
});

describe('safeEqual', () => {
  it('compares', () => {
    expect(core.safeEqual('abc', 'abc')).toBe(true);
    expect(core.safeEqual('abc', 'abd')).toBe(false);
    expect(core.safeEqual('abc', 'ab')).toBe(false);
    expect(core.safeEqual(null, 'ab')).toBe(false);
  });
});

describe('path authorization vectors (CONTRACT.md §4)', () => {
  const claims = {
    anon: null,
    'user-aws': tok('user-aws').claims,
    'owner-all': tok('owner-all').claims,
  };
  for (const p of V.paths) {
    for (const who of Object.keys(claims)) {
      it(`${who} ${p.uri} -> ${p[who]}`, () => {
        expect(core.authorize(p.uri, claims[who])).toBe(p[who]);
      });
    }
  }
});

describe('cookies and responses', () => {
  it('readCookie', () => {
    expect(core.readCookie('a=1; __Host-qz_session=abc.def.ghi; b=2', '__Host-qz_session')).toBe('abc.def.ghi');
    expect(core.readCookie('x__Host-qz_session=evil', '__Host-qz_session')).toBeNull();
    expect(core.readCookie('', 'a')).toBeNull();
    expect(core.readCookie(undefined, 'a')).toBeNull();
  });
  it('navigation -> 302 with encoded return', () => {
    const r = core.denyResponse('unauthenticated', '/data/x y', { 'sec-fetch-mode': { value: 'navigate' } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location.value).toBe('/auth/login?return=%2Fdata%2Fx%20y');
  });
  it('Accept text/html -> 302', () => {
    const r = core.denyResponse('unauthenticated', '/', { accept: { value: 'text/html,application/xhtml+xml' } });
    expect(r.statusCode).toBe(302);
  });
  it('fetch -> 401 json', () => {
    const r = core.denyResponse('unauthenticated', '/data/a/b', { accept: { value: 'application/json' } });
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body.data)).toEqual({ error: 'unauthenticated' });
    expect(r.headers['cache-control'].value).toBe('no-store');
  });
  it('forbidden -> 403 json even on navigation', () => {
    const r = core.denyResponse('forbidden', '/data/a/b', { 'sec-fetch-mode': { value: 'navigate' } });
    expect(r.statusCode).toBe(403);
  });
  it('bad -> 400', () => {
    expect(core.denyResponse('bad', '/x', {}).statusCode).toBe(400);
  });
});
