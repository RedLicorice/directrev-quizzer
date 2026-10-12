// Test doubles for the admin Lambda: fake Cognito user management, an in-memory audit log
// and helpers to build signed sessions and Function URL events.
import { createHmac } from 'node:crypto';
import { signSession } from '../../../edge/session-core.js';
import { createKeyStore } from '../../auth/src/keys.js';
import type { Config } from '../../auth/src/config.js';
import {
  createHandler,
  type AdminUser,
  type AuditEntry,
  type CognitoAdmin,
  type Limiter,
  type UrlEvent,
} from '../src/handler.js';

export const KEY1 = 'k1-secret-0123456789abcdefghijklmnopqrstuv';
export const KID = 'k1';
export const CONFIG: Config = {
  userPoolId: 'us-east-1_TESTPOOL',
  clientId: 'testclientid123',
  cognitoDomain: 'quizzer-test.auth.us-east-1.amazoncognito.com',
  region: 'us-east-1',
  appHosts: ['d111111abcdef8.cloudfront.net'],
  datasets: ['aws-dva-c02', 'mule-mcd-01'],
  sessionTtlSeconds: 1800,
  refreshCookieDays: 30,
};
export const APP = 'https://d111111abcdef8.cloudfront.net';
export const ADMIN_EMAIL = 'admin@example.com';
export const NOW_SEC = 1_800_000_000;

const hmac = (k: string, d: string) => createHmac('sha256', k).update(d).digest('base64url');

export class FakeCognito implements CognitoAdmin {
  users = new Map<string, AdminUser>();
  created: { username: string; email: string }[] = [];
  resends: string[] = [];
  actions: string[] = [];

  constructor() {
    this.addUser({ username: ADMIN_EMAIL, email: ADMIN_EMAIL, status: 'CONFIRMED', enabled: true, groups: ['admin', 'ds-all'] });
  }

  addUser(u: AdminUser) {
    this.users.set(u.username.toLowerCase(), u);
    return u;
  }
  private get(username: string) {
    return this.users.get(username.toLowerCase());
  }

  async listUsers() {
    return [...this.users.values()].map((u) => ({ ...u, groups: [...u.groups] }));
  }
  async listGroupsForUser(username: string) {
    return [...(this.get(username)?.groups ?? [])];
  }
  async createUser(username: string, email: string) {
    if (this.get(username)) {
      const e = new Error('user exists');
      e.name = 'UsernameExistsException';
      throw e;
    }
    this.created.push({ username, email });
    this.addUser({ username, email, status: 'FORCE_CHANGE_PASSWORD', enabled: true, groups: [] });
  }
  async resendInvitation(username: string) {
    this.resends.push(username);
  }
  async addToGroup(username: string, group: string) {
    const u = this.get(username);
    if (!u) throw new Error('user not found');
    if (!u.groups.includes(group)) u.groups.push(group);
    this.actions.push(`+${group}:${username}`);
  }
  async removeFromGroup(username: string, group: string) {
    const u = this.get(username);
    if (u) u.groups = u.groups.filter((g) => g !== group);
    this.actions.push(`-${group}:${username}`);
  }
  async disableUser(username: string) {
    const u = this.get(username);
    if (u) u.enabled = false;
    this.actions.push(`disable:${username}`);
  }
  async enableUser(username: string) {
    const u = this.get(username);
    if (u) u.enabled = true;
    this.actions.push(`enable:${username}`);
  }
  async globalSignOut(username: string) {
    this.actions.push(`signout:${username}`);
  }
  async resetPassword(username: string) {
    this.actions.push(`reset:${username}`);
  }
  async deleteUser(username: string) {
    this.users.delete(username.toLowerCase());
    this.actions.push(`delete:${username}`);
  }
}

export function setup(opts: { limiter?: Limiter } = {}) {
  const cognito = new FakeCognito();
  const logs: Record<string, unknown>[] = [];
  const audit: AuditEntry[] = [];
  let nowMs = NOW_SEC * 1000;
  const keys = createKeyStore(async (k) => (k === `qz-key-${KID}` ? KEY1 : null), () => nowMs);
  const handler = createHandler({
    getConfig: async () => CONFIG,
    keys,
    cognito,
    readAudit: async (sinceMs, limit) =>
      audit.filter((e) => Date.parse(e.at) >= sinceMs).slice(0, limit).reverse(),
    nowMs: () => nowMs,
    log: (e) => {
      logs.push(e);
      if (e.evt === 'admin_action') audit.push(e as unknown as AuditEntry);
    },
    limiter: opts.limiter ?? (() => true),
  });
  return {
    cognito,
    logs,
    audit,
    handler,
    advance(sec: number) {
      nowMs += sec * 1000;
    },
  };
}

export function token(sub: string, email: string, opts: { adm?: boolean; ds?: string[] } = {}): string {
  return signSession(
    {
      iss: 'quizzer',
      aud: 'quizzer-edge',
      sub,
      email,
      ds: opts.ds ?? ['*'],
      adm: opts.adm ?? true,
      iat: NOW_SEC,
      exp: NOW_SEC + 3600,
    },
    KID,
    KEY1,
    hmac,
  );
}

export function ev(
  method: string,
  pathAndQuery: string,
  o: { cookies?: string[]; headers?: Record<string, string>; body?: string } = {},
): UrlEvent {
  const u = new URL(pathAndQuery, APP);
  const qs: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (qs[k] = v));
  return {
    rawPath: u.pathname,
    rawQueryString: u.search.slice(1),
    ...(u.search ? { queryStringParameters: qs } : {}),
    ...(o.cookies ? { cookies: o.cookies } : {}),
    ...(o.body !== undefined ? { body: o.body } : {}),
    headers: {
      host: 'x.lambda-url.us-east-1.on.aws',
      origin: APP,
      'sec-fetch-site': 'same-origin',
      'x-qz-csrf': '1',
      ...(o.headers ?? {}),
    },
    requestContext: { http: { method, sourceIp: '130.176.0.1' } },
  };
}
