// Test doubles: a fake Cognito (authorize/token/revoke with PKCE S256 enforcement),
// an SSM parameter reader and a CloudFront KVS.
import { createHash, randomBytes } from 'node:crypto';
import type { Fetch } from '../src/cognito.js';
import type { Config } from '../src/config.js';
import { createConfigLoader } from '../src/config.js';
import { createKeyStore } from '../src/keys.js';
import { createHandler, type UrlEvent } from '../src/handler.js';

export const CONFIG: Config = {
  userPoolId: 'eu-central-1_TESTPOOL',
  clientId: 'testclientid123',
  cognitoDomain: 'quizzer-test.auth.eu-central-1.amazoncognito.com',
  region: 'eu-central-1',
  appHosts: ['d111111abcdef8.cloudfront.net'],
  datasets: ['aws-dva-c02', 'mule-mcd-01'],
  sessionTtlSeconds: 1800,
  refreshCookieDays: 30,
};
export const APP = 'https://d111111abcdef8.cloudfront.net';
export const KEY1 = 'k1-secret-0123456789abcdefghijklmnopqrstuv';

export interface User {
  sub: string;
  email: string;
  name?: string;
  groups: string[];
  enabled: boolean;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export class FakeCognito {
  users = new Map<string, User>();
  codes = new Map<string, { sub: string; challenge: string; redirectUri: string; used: boolean }>();
  refresh = new Map<string, { sub: string; revoked: boolean }>();
  calls: { url: string; form: Record<string, string> }[] = [];
  nowSec = 1_800_000_000;
  down = false;

  addUser(u: Partial<User> & { sub: string; email: string }) {
    const user: User = { groups: [], enabled: true, ...u };
    this.users.set(user.sub, user);
    return user;
  }
  // Simulates the managed login page: the user signs in, Cognito redirects with a code.
  authorize(authUrl: string, sub: string): { code: string; state: string; redirectUri: string } {
    const u = new URL(authUrl);
    if (u.host !== CONFIG.cognitoDomain || u.pathname !== '/oauth2/authorize') throw new Error('bad authorize url');
    const p = u.searchParams;
    if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256') throw new Error('bad params');
    if (p.get('client_id') !== CONFIG.clientId) throw new Error('bad client');
    const code = randomBytes(8).toString('hex');
    this.codes.set(code, { sub, challenge: p.get('code_challenge')!, redirectUri: p.get('redirect_uri')!, used: false });
    return { code, state: p.get('state')!, redirectUri: p.get('redirect_uri')! };
  }
  idToken(u: User, over: Record<string, unknown> = {}) {
    const claims: Record<string, unknown> = {
      sub: u.sub,
      email: u.email,
      ...(u.name ? { name: u.name } : {}),
      ...(u.groups.length ? { 'cognito:groups': u.groups } : {}),
      iss: `https://cognito-idp.${CONFIG.region}.amazonaws.com/${CONFIG.userPoolId}`,
      aud: CONFIG.clientId,
      token_use: 'id',
      exp: this.nowSec + 3600,
      ...over,
    };
    return `${b64({ alg: 'RS256', kid: 'x' })}.${b64(claims)}.sig`;
  }
  idOverride: Record<string, unknown> = {};

  fetch: Fetch = async (url, init) => {
    const form = Object.fromEntries(new URLSearchParams(init.body));
    this.calls.push({ url, form });
    const res = (status: number, body: unknown) => ({ status, json: async () => body });
    if (this.down) return res(500, { error: 'internal' });
    const u = new URL(url);
    if (u.host !== CONFIG.cognitoDomain) return res(404, {});
    if (init.headers['content-type'] !== 'application/x-www-form-urlencoded') return res(400, { error: 'invalid_request' });
    if (form.client_id !== CONFIG.clientId) return res(400, { error: 'invalid_client' });
    if (u.pathname === '/oauth2/token' && form.grant_type === 'authorization_code') {
      const c = this.codes.get(form.code ?? '');
      if (!c || c.used) return res(400, { error: 'invalid_grant' });
      c.used = true;
      if (c.redirectUri !== form.redirect_uri) return res(400, { error: 'invalid_grant' });
      const ch = createHash('sha256').update(form.code_verifier ?? '').digest('base64url');
      if (ch !== c.challenge) return res(400, { error: 'invalid_grant' });
      const user = this.users.get(c.sub)!;
      if (!user.enabled) return res(400, { error: 'invalid_grant' });
      const rt = 'rt-' + randomBytes(8).toString('hex');
      this.refresh.set(rt, { sub: user.sub, revoked: false });
      return res(200, { id_token: this.idToken(user, this.idOverride), access_token: 'at', refresh_token: rt, expires_in: 3600, token_type: 'Bearer' });
    }
    if (u.pathname === '/oauth2/token' && form.grant_type === 'refresh_token') {
      const r = this.refresh.get(form.refresh_token ?? '');
      if (!r || r.revoked) return res(400, { error: 'invalid_grant' });
      const user = this.users.get(r.sub);
      if (!user || !user.enabled) return res(400, { error: 'invalid_grant' });
      return res(200, { id_token: this.idToken(user), access_token: 'at2', expires_in: 3600, token_type: 'Bearer' });
    }
    if (u.pathname === '/oauth2/revoke') {
      const r = this.refresh.get(form.token ?? '');
      if (r) r.revoked = true;
      return res(200, {});
    }
    return res(400, { error: 'unsupported' });
  };
}

export function setup(opts: { kvs?: Record<string, string>; config?: Partial<Config> } = {}) {
  const cognito = new FakeCognito();
  const kvs: Record<string, string> = opts.kvs ?? { 'qz-current-kid': 'k1', 'qz-key-k1': KEY1 };
  const counters = { ssm: 0, kvs: 0 };
  let nowMs = cognito.nowSec * 1000;
  const logs: Record<string, unknown>[] = [];
  const getConfig = createConfigLoader(
    async (name) => {
      counters.ssm++;
      if (name !== '/quizzer/prod/config') throw new Error('ParameterNotFound');
      return JSON.stringify({ ...CONFIG, ...opts.config });
    },
    '/quizzer/prod/config',
    () => nowMs,
  );
  const keys = createKeyStore(async (k) => {
    counters.kvs++;
    return Object.prototype.hasOwnProperty.call(kvs, k) ? kvs[k]! : null;
  }, () => nowMs);
  const handler = createHandler({
    getConfig,
    keys,
    fetch: cognito.fetch,
    nowMs: () => nowMs,
    random: (n) => randomBytes(n),
    log: (e) => logs.push(e),
  });
  return {
    cognito,
    kvs,
    counters,
    logs,
    handler,
    advance(sec: number) {
      nowMs += sec * 1000;
      cognito.nowSec += sec;
    },
    get nowSec() {
      return Math.floor(nowMs / 1000);
    },
  };
}

export function ev(method: string, pathAndQuery: string, o: { cookies?: string[]; headers?: Record<string, string> } = {}): UrlEvent {
  const u = new URL(pathAndQuery, APP);
  const qs: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (qs[k] = v));
  return {
    rawPath: u.pathname,
    rawQueryString: u.search.slice(1),
    ...(u.search ? { queryStringParameters: qs } : {}),
    ...(o.cookies ? { cookies: o.cookies } : {}),
    headers: { host: 'abcdefghij.lambda-url.eu-central-1.on.aws', ...(o.headers ?? {}) },
    requestContext: { http: { method, sourceIp: '130.176.0.1' } },
  };
}

// Converts Set-Cookie strings into the "name=value" array a browser would send back on /auth.
export function jar(setCookies: string[] | undefined, prev: string[] = []): string[] {
  const m = new Map(prev.map((c) => [c.slice(0, c.indexOf('=')), c]));
  for (const sc of setCookies ?? []) {
    const nv = sc.split(';')[0]!;
    const name = nv.slice(0, nv.indexOf('='));
    if (/Max-Age=0/.test(sc)) m.delete(name);
    else m.set(name, nv);
  }
  return [...m.values()];
}
