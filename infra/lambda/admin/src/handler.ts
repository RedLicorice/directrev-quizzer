// admin Lambda: /api/admin/* — user management only (plan v3: M7, no statistics).
//
// Three authorization layers (plan v2 §5.3):
//   1. the CloudFront Function `session-check` requires `adm=true` in the signed cookie;
//   2. here the HMAC of the cookie is re-verified against the KVS keys;
//   3. the `admin` group is re-checked live on Cognito (cache 60 s), so removing an
//      admin is effective immediately.
//
// Mutations additionally require a same-origin `Origin`/`Sec-Fetch-Site`, the
// `x-qz-csrf: 1` header and (enforced by CloudFront OAC, not here) `x-amz-content-sha256`.
// Every mutation is written to CloudWatch Logs as a structured `admin_action` record
// before the response is sent; there is no DynamoDB (plan v3 delta 5).
import { createHmac } from 'node:crypto';
import { checkToken, parseToken, SESSION_COOKIE } from '../../../edge/session-core.js';
import type { SessionClaims } from '../../../edge/session-core.js';
import type { Config } from '../../auth/src/config.js';
import type { KeyStore } from '../../auth/src/keys.js';
import { getCookie } from '../../auth/src/cookies.js';

export interface UrlEvent {
  rawPath: string;
  rawQueryString?: string;
  queryStringParameters?: Record<string, string | undefined>;
  cookies?: string[];
  headers?: Record<string, string | undefined>;
  requestContext: { http: { method: string; sourceIp?: string } };
  body?: string;
  isBase64Encoded?: boolean;
}

export interface UrlResult {
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
}

export interface AdminUser {
  username: string; // Cognito username (== e-mail in this pool)
  sub?: string;
  email: string;
  status: string; // CONFIRMED | FORCE_CHANGE_PASSWORD | RESET_REQUIRED | UNCONFIRMED | ...
  enabled: boolean;
  groups: string[];
}

export interface CognitoAdmin {
  listUsers(): Promise<AdminUser[]>;
  listGroupsForUser(username: string): Promise<string[]>;
  createUser(username: string, email: string): Promise<void>;
  resendInvitation(username: string): Promise<void>;
  addToGroup(username: string, group: string): Promise<void>;
  removeFromGroup(username: string, group: string): Promise<void>;
  disableUser(username: string): Promise<void>;
  enableUser(username: string): Promise<void>;
  globalSignOut(username: string): Promise<void>;
  resetPassword(username: string): Promise<void>;
  deleteUser(username: string): Promise<void>;
}

export interface AuditEntry {
  evt: 'admin_action';
  at: string;
  actor: string;
  action: string;
  target?: string;
  groups?: string[];
  detail?: string;
  ip?: string;
}

/** Returns true when the call is within the limit (best-effort, per container). */
export type Limiter = (key: string, limit: number, windowMs: number) => boolean;

export interface Deps {
  getConfig(): Promise<Config>;
  keys: KeyStore;
  cognito: CognitoAdmin;
  readAudit(sinceMs: number, limit: number): Promise<AuditEntry[]>;
  nowMs(): number;
  log(entry: Record<string, unknown>): void;
  limiter: Limiter;
}

export const hmac = (key: string, data: string) => createHmac('sha256', key).update(data).digest('base64url');

const BASE = '/api/admin';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GROUP_RE = /^(admin|ds-all|ds-[a-z0-9][a-z0-9-]{0,62})$/;
const UID_RE = /^[A-Za-z0-9_-]{2,342}$/;
const ADMIN_GROUP_TTL_MS = 60_000;
const MAX_BODY = 8192;

const MUTATIONS_PER_HOUR = 30;
const INVITES_PER_DAY = 20;

function json(statusCode: number, body: unknown, allow?: string): UrlResult {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(allow ? { allow } : {}),
    },
    body: JSON.stringify(body),
  };
}

const isValidGroup = (g: unknown): g is string => typeof g === 'string' && GROUP_RE.test(g);
const dedupe = (list: string[]) => [...new Set(list)];
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** base64url(username) → username, or null when it is not a canonical encoding. */
export function decodeUid(uid: string): string | null {
  if (!UID_RE.test(uid)) return null;
  try {
    const v = Buffer.from(uid, 'base64url').toString('utf8');
    if (Buffer.from(v, 'utf8').toString('base64url') !== uid) return null;
    if (v.length === 0 || v.length > 128) return null;
    if (/[\x00-\x1f\x7f]/.test(v)) return null;
    return v;
  } catch {
    return null;
  }
}

function encodeUid(username: string): string {
  return Buffer.from(username, 'utf8').toString('base64url');
}

function readBody(ev: UrlEvent): Record<string, unknown> | null {
  if (!ev.body) return {};
  const raw = ev.isBase64Encoded ? Buffer.from(ev.body, 'base64').toString('utf8') : ev.body;
  if (raw.length === 0) return {};
  if (raw.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function viewerIp(headers: Record<string, string | undefined>, ev: UrlEvent): string | undefined {
  const a = headers['cloudfront-viewer-address'];
  if (a) return a.slice(0, a.lastIndexOf(':')) || a;
  return ev.requestContext.http.sourceIp;
}

function summarize(users: AdminUser[]) {
  let confirmed = 0;
  let pending = 0;
  let disabled = 0;
  for (const u of users) {
    if (!u.enabled) disabled++;
    else if (u.status === 'CONFIRMED') confirmed++;
    else pending++;
  }
  return { total: users.length, confirmed, pending, disabled };
}

function publicUser(u: AdminUser) {
  return {
    key: encodeUid(u.username),
    email: u.email,
    ...(u.sub ? { sub: u.sub } : {}),
    status: u.status,
    enabled: u.enabled,
    groups: [...u.groups].sort(),
  };
}

export function createHandler(deps: Deps) {
  // Live `admin` group cache: a removed admin loses access within 60 s even if the
  // cookie still carries adm=true.
  const adminCache = new Map<string, { admin: boolean; at: number }>();

  async function isLiveAdmin(username: string): Promise<boolean> {
    const cacheKey = username.toLowerCase();
    const now = deps.nowMs();
    const hit = adminCache.get(cacheKey);
    if (hit && now - hit.at < ADMIN_GROUP_TTL_MS) return hit.admin;
    let groups: string[] = [];
    try {
      groups = await deps.cognito.listGroupsForUser(username);
    } catch {
      groups = [];
    }
    const admin = groups.includes('admin');
    adminCache.set(cacheKey, { admin, at: now });
    return admin;
  }

  return async function handler(ev: UrlEvent): Promise<UrlResult> {
    const method = ev.requestContext.http.method.toUpperCase();
    const path = ev.rawPath;
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(ev.headers ?? {})) headers[k.toLowerCase()] = v;
    const nowMs = deps.nowMs();
    const nowSec = Math.floor(nowMs / 1000);
    const ip = viewerIp(headers, ev);
    try {
      const cfg = await deps.getConfig();

      // (2) re-verify the cookie HMAC.
      const parsed = parseToken(getCookie(ev.cookies, SESSION_COOKIE));
      const key = parsed ? await deps.keys.get(parsed.kid) : null;
      const claims: SessionClaims | null = checkToken(parsed, key, hmac, nowSec);
      if (!claims) return json(401, { error: 'unauthenticated' });

      // (3) live admin group.
      if (!(await isLiveAdmin(claims.email))) {
        deps.log({ evt: 'admin_denied', sub: claims.sub, ip, reason: 'not_admin' });
        return json(403, { error: 'forbidden' });
      }

      const actor = claims.email;
      const mutating = method !== 'GET' && method !== 'HEAD';
      if (mutating) {
        const origin = headers['origin'];
        const site = headers['sec-fetch-site'];
        if ((origin && !cfg.appHosts.some((h) => origin === `https://${h}`)) || (site && site !== 'same-origin')) {
          return json(403, { error: 'bad_origin' });
        }
        if (headers['x-qz-csrf'] !== '1') return json(403, { error: 'csrf' });
      }

      const audit = (action: string, target?: string, groups?: string[], detail?: string) => {
        deps.log({
          evt: 'admin_action',
          at: new Date(nowMs).toISOString(),
          actor,
          action,
          ...(target ? { target } : {}),
          ...(groups ? { groups } : {}),
          ...(detail ? { detail } : {}),
          ...(ip ? { ip } : {}),
        });
      };
      const limited = (key: string, limit: number, windowMs: number) => deps.limiter(key, limit, windowMs);

      if ((path === `${BASE}/overview`) && (method === 'GET' || method === 'HEAD')) {
        return json(200, { datasets: cfg.datasets, users: summarize(await deps.cognito.listUsers()) });
      }

      if ((path === `${BASE}/audit`) && (method === 'GET' || method === 'HEAD')) {
        const days = clampInt(ev.queryStringParameters?.days, 1, 90, 30);
        const entries = await deps.readAudit(nowMs - days * 86_400_000, 200);
        return json(200, { days, entries });
      }

      if (path === `${BASE}/users`) {
        if (method === 'GET' || method === 'HEAD') {
          const filter = (ev.queryStringParameters?.filter ?? '').trim().toLowerCase().slice(0, 128);
          const users = await deps.cognito.listUsers();
          const filtered = filter
            ? users.filter((u) => u.email.toLowerCase().includes(filter) || u.username.toLowerCase().includes(filter))
            : users;
          filtered.sort((a, b) => a.email.localeCompare(b.email));
          return json(200, { users: filtered.map(publicUser) });
        }
        if (method === 'POST') {
          const body = readBody(ev);
          if (!body) return json(400, { error: 'bad_json' });
          const email = typeof body.email === 'string' ? body.email.trim() : '';
          if (!EMAIL_RE.test(email) || email.length > 254) return json(400, { error: 'bad_email' });
          const groups = Array.isArray(body.groups) ? dedupe(body.groups.filter(isValidGroup)) : [];
          if (Array.isArray(body.groups) && groups.length !== dedupe(body.groups).length) return json(400, { error: 'bad_group' });
          if (groups.includes('ds-mule-mcd-01') && body.confirmMcd !== true) {
            return json(400, { error: 'mcd_confirmation_required' });
          }
          if (!limited(`invite:${actor}`, INVITES_PER_DAY, 86_400_000)) return json(429, { error: 'rate_limited' });
          try {
            await deps.cognito.createUser(email, email);
          } catch (e) {
            if (e instanceof Error && /UsernameExists/i.test(e.name)) return json(409, { error: 'exists' });
            throw e;
          }
          for (const g of groups) await deps.cognito.addToGroup(email, g);
          audit('invite', email, groups);
          return json(201, { key: encodeUid(email), email, groups });
        }
        return json(405, { error: 'method_not_allowed' }, 'GET, POST');
      }

      if (path.startsWith(`${BASE}/users/`)) {
        const rest = path.slice(`${BASE}/users/`.length);
        const slash = rest.indexOf('/');
        const uid = slash === -1 ? rest : rest.slice(0, slash);
        const verb = slash === -1 ? '' : rest.slice(slash + 1);
        const username = decodeUid(uid);
        if (!username) return json(400, { error: 'bad_user' });

        if (verb === 'groups' && method === 'PUT') {
          const body = readBody(ev);
          if (!body) return json(400, { error: 'bad_json' });
          const rawGroups = Array.isArray(body.groups) ? body.groups : null;
          if (!rawGroups || !rawGroups.every(isValidGroup)) return json(400, { error: 'bad_group' });
          const groups = dedupe(rawGroups);
          const current = await deps.cognito.listGroupsForUser(username);
          if (groups.includes('ds-mule-mcd-01') && !current.includes('ds-mule-mcd-01') && body.confirmMcd !== true) {
            return json(400, { error: 'mcd_confirmation_required' });
          }
          if (same(actor, username) && current.includes('admin') && !groups.includes('admin')) {
            return json(400, { error: 'self_lockout' });
          }
          if (!limited(`mut:${actor}`, MUTATIONS_PER_HOUR, 3_600_000)) return json(429, { error: 'rate_limited' });
          const toAdd = groups.filter((g) => !current.includes(g));
          const toRemove = current.filter((g) => !groups.includes(g));
          for (const g of toRemove) await deps.cognito.removeFromGroup(username, g);
          for (const g of toAdd) await deps.cognito.addToGroup(username, g);
          audit('groups', username, groups, `-${toRemove.join(',') || '-'} +${toAdd.join(',') || '-'}`);
          return json(200, { key: uid, email: username, groups });
        }

        if (method === 'POST' && (verb === 'resend' || verb === 'disable' || verb === 'enable' || verb === 'signout' || verb === 'reset')) {
          if (same(actor, username) && verb === 'disable') return json(400, { error: 'self_lockout' });
          if (!limited(`mut:${actor}`, MUTATIONS_PER_HOUR, 3_600_000)) return json(429, { error: 'rate_limited' });
          if (verb === 'resend') await deps.cognito.resendInvitation(username);
          else if (verb === 'disable') await deps.cognito.disableUser(username);
          else if (verb === 'enable') await deps.cognito.enableUser(username);
          else if (verb === 'signout') await deps.cognito.globalSignOut(username);
          else await deps.cognito.resetPassword(username);
          audit(verb, username);
          return json(200, { key: uid, email: username, action: verb });
        }

        if (method === 'DELETE' && verb === '') {
          if (same(actor, username)) return json(400, { error: 'self_lockout' });
          if (!limited(`mut:${actor}`, MUTATIONS_PER_HOUR, 3_600_000)) return json(429, { error: 'rate_limited' });
          await deps.cognito.deleteUser(username);
          audit('delete', username);
          return json(200, { key: uid, email: username, action: 'delete' });
        }

        return json(405, { error: 'method_not_allowed' }, 'PUT, POST, DELETE');
      }

      return json(404, { error: 'not_found' });
    } catch (e) {
      deps.log({ evt: 'error', path, ip, error: e instanceof Error ? e.message : String(e) });
      return json(500, { error: 'internal' });
    }
  };
}
