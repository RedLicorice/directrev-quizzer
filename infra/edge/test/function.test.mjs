import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as core from '../session-core.js';
import { buildFunction } from '../build-function.mjs';
import { loadFunction, cfEvent, FUNCTION_PATH } from './runtime-harness.mjs';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest('base64url');
const src = readFileSync(FUNCTION_PATH, 'utf8');
const KVS = { 'qz-current-kid': 'k1', 'qz-key-k1': V.key };
const NOW_MS = V.now * 1000;
const tok = (name) => V.tokens.find((t) => t.name === name).token;

describe('build artefact', () => {
  it('is up to date with session-core.js + template', () => {
    expect(src).toBe(buildFunction());
  });
  it('is well under the 10 KB CloudFront Functions limit', () => {
    const size = Buffer.byteLength(src, 'utf8');
    expect(size).toBeLessThan(8 * 1024);
  });
  it('does not contain export statements or node-only modules', () => {
    expect(src).not.toMatch(/^export /m);
    expect(src).not.toMatch(/require\(|process\.|node:/);
    const imports = [...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['cloudfront', 'crypto']);
  });
});

describe('runtime 2.0 language subset', () => {
  // Only features listed in
  // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  const banned = {
    SpreadElement: 'spread',
    ObjectPattern: 'destructuring',
    ArrayPattern: 'destructuring',
    ForOfStatement: 'for-of',
    ClassDeclaration: 'class',
    ClassExpression: 'class',
    ChainExpression: 'optional chaining',
    YieldExpression: 'generators',
    TaggedTemplateExpression: 'tagged templates',
    ImportExpression: 'dynamic import',
    AssignmentPattern: 'default parameters',
    MetaProperty: 'new.target / import.meta',
  };
  it('uses no unsupported syntax', () => {
    const found = [];
    walk.full(ast, (node) => {
      if (banned[node.type]) found.push(banned[node.type] + '@' + node.start);
      if (node.type === 'LogicalExpression' && node.operator === '??') found.push('??@' + node.start);
      if (node.type === 'AssignmentExpression' && ['??=', '||=', '&&='].includes(node.operator)) found.push('logical assignment');
      if (node.type === 'FunctionDeclaration' && node.generator) found.push('generator');
      if (node.type === 'Literal' && node.regex && /[suyd]/.test(node.regex.flags.replace('g', '').replace('i', '').replace('m', ''))) found.push('regex flag ' + node.regex.flags);
      if (node.type === 'Literal' && typeof node.bigint === 'string') found.push('bigint');
    });
    expect(found).toEqual([]);
  });
  it('only top-level handler is async and has no async closures', () => {
    const asyncFns = [];
    walk.full(ast, (node) => {
      if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.async) {
        asyncFns.push(node.id ? node.id.name : '<anonymous>');
      }
    });
    expect(asyncFns).toEqual(['handler']);
  });
  it('calls console.log with at most one argument', () => {
    walk.full(ast, (node) => {
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'console') {
        expect(node.arguments.length).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('built function behaves like the core', () => {
  const { handler } = loadFunction({ kvs: KVS, nowMs: NOW_MS });
  const people = { anon: null, 'user-aws': tok('user-aws'), 'owner-all': tok('owner-all') };
  const headerSets = {
    nav: { 'sec-fetch-mode': 'navigate', accept: 'text/html' },
    fetch: { 'sec-fetch-mode': 'cors', accept: 'application/json' },
  };
  for (const p of V.paths) {
    for (const [who, token] of Object.entries(people)) {
      for (const [hname, headers] of Object.entries(headerSets)) {
        it(`${who} ${hname} ${p.uri}`, async () => {
          const ev = cfEvent(p.uri, { cookie: token ? `foo=bar; __Host-qz_session=${token}` : undefined, headers });
          const out = await handler(ev);
          const claims = token ? core.verifySession(token, (k) => KVS['qz-key-' + k] || null, hmac, V.now) : null;
          const decision = core.authorize(p.uri, claims);
          expect(decision).toBe(p[who]);
          if (decision === 'allow') {
            expect(out).toBe(ev.request);
          } else {
            const expected = core.denyResponse(decision, p.uri, ev.request.headers);
            expect(JSON.parse(JSON.stringify(out))).toEqual(expected);
          }
        });
      }
    }
  }

  it('expired session -> 401 / 302', async () => {
    const f = loadFunction({ kvs: KVS, nowMs: 1700001800 * 1000 });
    const ev = cfEvent('/data/aws-dva-c02/questions.json', { cookie: `__Host-qz_session=${tok('user-aws-expired')}` });
    expect((await f.handler(ev)).statusCode).toBe(401);
    const nav = cfEvent('/', { cookie: `__Host-qz_session=${tok('user-aws-expired')}`, headers: { 'sec-fetch-mode': 'navigate' } });
    const r = await f.handler(nav);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location.value).toBe('/auth/login?return=%2F');
  });

  it('rotated-out kid (missing in KVS) -> no session', async () => {
    const f = loadFunction({ kvs: { 'qz-current-kid': 'k2', 'qz-key-k2': 'x'.repeat(43) }, nowMs: NOW_MS });
    const ev = cfEvent('/', { cookie: `__Host-qz_session=${tok('user-aws')}` });
    expect((await f.handler(ev)).statusCode).toBe(401);
  });

  it('accepts several kids during rotation', async () => {
    const k2 = 'y'.repeat(43);
    const f = loadFunction({ kvs: { ...KVS, 'qz-current-kid': 'k2', 'qz-key-k2': k2 }, nowMs: NOW_MS });
    const t2 = core.signSession(V.tokens[0].claims, 'k2', k2, hmac);
    expect(await f.handler(cfEvent('/', { cookie: `__Host-qz_session=${t2}` }))).toMatchObject({ uri: '/' });
    expect(await f.handler(cfEvent('/', { cookie: `__Host-qz_session=${tok('user-aws')}` }))).toMatchObject({ uri: '/' });
  });

  it('reads the cookie from the raw header when the parsed map lacks it', async () => {
    const ev = cfEvent('/');
    ev.request.headers.cookie = { value: `a=b; __Host-qz_session=${tok('user-aws')}` };
    expect(await handler(ev)).toBe(ev.request);
  });

  it('a lookalike cookie name is not accepted', async () => {
    const ev = cfEvent('/', { cookie: `qz_session=${tok('owner-all')}` });
    expect((await handler(ev)).statusCode).toBe(401);
  });
});
