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
import { EMAIL_RE, isSameOrigin, rawBody } from '../../auth/src/request.js';
import type { Limiter } from '../../auth/src/limiter.js';
import type { InviteLinksConfig } from '../../auth/src/config.js';
import {
  CAMPAIGN_ID_RE,
  campaignStatus,
  newCampaignId,
  type CampaignChanges,
  type CampaignItem,
  type CampaignStore,
} from '../../auth/src/inviteStore.js';
import type { Origin, OriginStore } from '../../auth/src/originStore.js';
import { GithubError, type CommitFile, type GithubClient } from './github.js';
import { IMAGE_PATH_RE, decodeUploads, imageName } from './images.js';
import { detectJsonStyle, parseJsonText } from './jsonStyle.js';

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

export type { Limiter };

export interface Deps {
  getConfig(): Promise<Config>;
  keys: KeyStore;
  cognito: CognitoAdmin;
  github: GithubClient;
  readAudit(sinceMs: number, limit: number): Promise<AuditEntry[]>;
  nowMs(): number;
  log(entry: Record<string, unknown>): void;
  limiter: Limiter;
  invites: CampaignStore;
  origins: OriginStore;
}

export const hmac = (key: string, data: string) => createHmac('sha256', key).update(data).digest('base64url');

const BASE = '/api/admin';
const GROUP_RE = /^(admin|ds-all|ds-[a-z0-9][a-z0-9-]{0,62})$/;
const UID_RE = /^[A-Za-z0-9_-]{2,342}$/;
const ADMIN_GROUP_TTL_MS = 60_000;
const MAX_BODY = 8192;
// One edited question (long markdown explanation, many options) is far bigger than a user action.
const MAX_EDIT_QUESTION = 65_536;
// Up to MAX_UPLOAD_TOTAL_BYTES of images as base64 (x4/3) plus the question: under the 6 MB Function URL cap.
const MAX_EDIT_BODY = 5_200_000;

const MUTATIONS_PER_HOUR = 30;
const INVITES_PER_DAY = 20;
const HOUR_MS = 3_600_000;

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

function readBody(ev: UrlEvent, max = MAX_BODY): Record<string, unknown> | null {
  const raw = rawBody(ev, max);
  if (raw === null) return null;
  if (raw.length === 0) return {};
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

function publicUser(u: AdminUser, origin: Origin) {
  return {
    key: encodeUid(u.username),
    email: u.email,
    ...(u.sub ? { sub: u.sub } : {}),
    status: u.status,
    enabled: u.enabled,
    groups: [...u.groups].sort(),
    origin,
  };
}

function publicCampaign(item: CampaignItem, nowMs: number, appHost: string) {
  return {
    id: item.id,
    url: `https://${appHost}/auth/join?c=${item.id}`,
    name: item.name,
    ...(item.publicNote ? { publicNote: item.publicNote } : {}),
    ...(item.internalNote ? { internalNote: item.internalNote } : {}),
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    expiresAt: item.expiresAt,
    maxUses: item.maxUses,
    uses: item.uses,
    enabled: item.enabled,
    status: campaignStatus(item, nowMs),
  };
}

/** `undefined` -> default; otherwise an integer in [1, max], else null. */
function boundedInt(v: unknown, fallback: number, max: number): number | null {
  if (v === undefined) return fallback;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null;
}

const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;
// Notes are free text: line breaks and tabs are fine, any other control character is not.
const NOTE_CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/** Trimmed text within `max` characters, or null. A name is a single line; a note may have line breaks. */
function boundedText(v: unknown, max: number, multiline: boolean): string | null {
  if (typeof v !== 'string') return null;
  const text = v.trim();
  if (text.length > max || (multiline ? NOTE_CONTROL_CHARS_RE : CONTROL_CHARS_RE).test(text)) return null;
  return text;
}

const CAMPAIGN_FIELDS = ['name', 'publicNote', 'internalNote', 'maxUses', 'enabled', 'expiresAt'] as const;

/** Validated changes of a PATCH body, or the 400 `reason`. */
function parseCampaignChanges(body: Record<string, unknown>, links: InviteLinksConfig, nowMs: number): CampaignChanges | string {
  const changes: CampaignChanges = {};
  for (const key of Object.keys(body)) if (!(CAMPAIGN_FIELDS as readonly string[]).includes(key)) return key;
  if (body.name !== undefined) {
    const name = boundedText(body.name, links.nameMaxLength, false);
    if (!name) return 'name';
    changes.name = name;
  }
  for (const [field, max] of [['publicNote', links.publicNoteMaxLength], ['internalNote', links.internalNoteMaxLength]] as const) {
    if (body[field] === undefined) continue;
    const note = boundedText(body[field], max, true);
    if (note === null) return field;
    changes[field] = note || null; // empty removes the note
  }
  if (body.maxUses !== undefined) {
    const maxUses = boundedInt(body.maxUses, 0, links.maxMaxUses);
    if (maxUses === null) return 'maxUses';
    changes.maxUses = maxUses;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return 'enabled';
    changes.enabled = body.enabled;
  }
  if (body.expiresAt !== undefined) {
    const at = body.expiresAt;
    if (typeof at !== 'number' || !Number.isInteger(at) || at <= nowMs || at > nowMs + links.maxTtlHours * HOUR_MS) return 'expires_at';
    changes.expiresAt = at;
  }
  return Object.keys(changes).length > 0 ? changes : 'empty';
}

/** Structural validation shared by the editor route and its tests. */
function validateQuestion(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'question_shape';
  const q = value as Record<string, unknown>;
  if (!Number.isInteger(q.id) || (q.id as number) < 1) return 'id';
  if (typeof q.text !== 'string' || (!q.text.trim() && typeof q.image !== 'string')) return 'text';
  if (q.sourceNumber !== undefined && (typeof q.sourceNumber !== 'string' || q.sourceNumber.length > 40)) return 'source_number';
  if (q.explanation !== undefined && typeof q.explanation !== 'string') return 'explanation';
  const options = q.options;
  if (!Array.isArray(options) || options.length < 2) return 'options';
  let correct = 0;
  for (const raw of options) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'option_shape';
    const o = raw as Record<string, unknown>;
    if (typeof o.correct !== 'boolean') return 'option_correct';
    if (o.correct) correct++;
    if (typeof o.text !== 'string' || (!o.text.trim() && typeof o.image !== 'string')) return 'option_text';
  }
  if (correct === 0) return 'no_correct';
  if (q.selectCount !== correct) return 'select_count';
  return null;
}

/** Every image path a stored question references (question, options, explanation). */
function imagesOf(q: unknown): string[] {
  if (!q || typeof q !== 'object') return [];
  const r = q as { image?: unknown; explanationImage?: unknown; options?: unknown };
  const out: string[] = [];
  if (typeof r.image === 'string') out.push(r.image);
  if (typeof r.explanationImage === 'string') out.push(r.explanationImage);
  if (Array.isArray(r.options)) {
    for (const o of r.options) {
      const img = o && typeof o === 'object' ? (o as { image?: unknown }).image : undefined;
      if (typeof img === 'string') out.push(img);
    }
  }
  return out;
}

/** Resolves an image reference sent by the client: a stored path, an `upload:<token>`, or nothing. */
type PickImage = (value: unknown, slot: string) => string | undefined;

/**
 * Options come from the client but only `text`, `correct` and an image are taken from it. The
 * image must be a path the stored question already uses or a file uploaded in this request
 * (the server names it), so the editor can never point an option at an arbitrary URL.
 */
function rebuildOptions(incoming: unknown, pick: PickImage): Array<Record<string, unknown>> | string {
  if (!Array.isArray(incoming) || incoming.length < 2) return 'options';
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < incoming.length; i++) {
    const raw = incoming[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'option_shape';
    const o = raw as Record<string, unknown>;
    const next: Record<string, unknown> = { text: o.text, correct: o.correct };
    const img = pick(o.image, String.fromCharCode(65 + (i % 26)));
    if (img !== undefined) next.image = img;
    out.push(next);
  }
  return out;
}

/** Directory part of a repo path ('' for the root). */
const dirOfPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const joinRepo = (dir: string, rel: string) => (dir ? `${dir}/${rel}` : rel);

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

  // Origins are informative: if the table cannot be read the list still loads, everyone as "invited".
  async function readOrigins(usernames: string[]) {
    try {
      return await deps.origins.getMany(usernames);
    } catch (e) {
      deps.log({ evt: 'origin_read_failed', error: e instanceof Error ? e.name : String(e) });
      return new Map<string, { campaignId: string; campaignName: string }>();
    }
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
        if (!isSameOrigin(headers, cfg.appHosts)) return json(403, { error: 'bad_origin' });
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
          const origins = await readOrigins(cfg.inviteLinks ? filtered.map((u) => u.username) : []);
          return json(200, {
            users: filtered.map((u) => {
              const o = origins.get(u.username);
              return publicUser(u, o ? { kind: 'campaign', campaignId: o.campaignId, name: o.campaignName } : { kind: 'invited' });
            }),
          });
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

      // ── campaigns: reusable registration links that create accounts without any dataset ─────
      const linkMatch = path.match(/^\/api\/admin\/invite-links(?:\/([^/]*))?$/);
      if (linkMatch) {
        const links = cfg.inviteLinks;
        if (!links) return json(404, { error: 'invite_links_disabled' });
        const linkId = linkMatch[1];
        const appHost = cfg.appHosts[0]!;
        const badRequest = (reason: string) => json(400, { error: 'bad_request', reason });

        if (linkId === undefined) {
          if (method === 'GET' || method === 'HEAD') {
            const items = (await deps.invites.list()).sort((a, b) => b.createdAt - a.createdAt);
            return json(200, {
              links: items.map((i) => publicCampaign(i, nowMs, appHost)),
              defaults: {
                ttlHours: links.defaultTtlHours,
                maxTtlHours: links.maxTtlHours,
                maxUses: links.defaultMaxUses,
                maxMaxUses: links.maxMaxUses,
                nameMaxLength: links.nameMaxLength,
                publicNoteMaxLength: links.publicNoteMaxLength,
                internalNoteMaxLength: links.internalNoteMaxLength,
              },
            });
          }
          if (method === 'POST') {
            const body = readBody(ev);
            if (!body) return badRequest('body');
            const name = boundedText(body.name, links.nameMaxLength, false);
            if (!name) return badRequest('name');
            const ttlHours = boundedInt(body.ttlHours, links.defaultTtlHours, links.maxTtlHours);
            if (ttlHours === null) return badRequest('ttlHours');
            const maxUses = boundedInt(body.maxUses, links.defaultMaxUses, links.maxMaxUses);
            if (maxUses === null) return badRequest('maxUses');
            const notes: { publicNote?: string; internalNote?: string } = {};
            for (const [field, max] of [['publicNote', links.publicNoteMaxLength], ['internalNote', links.internalNoteMaxLength]] as const) {
              if (body[field] === undefined) continue;
              const note = boundedText(body[field], max, true);
              if (note === null) return badRequest(field);
              if (note) notes[field] = note;
            }
            if (!limited(`link:${actor}`, INVITES_PER_DAY, 86_400_000)) return json(429, { error: 'rate_limited' });
            const item: CampaignItem = {
              id: newCampaignId(),
              name,
              ...notes,
              createdBy: actor,
              createdAt: nowMs,
              updatedAt: nowMs,
              expiresAt: nowMs + ttlHours * HOUR_MS,
              maxUses,
              uses: 0,
              enabled: true,
            };
            await deps.invites.create(item);
            audit('link_create', item.id, undefined, name);
            return json(201, publicCampaign(item, nowMs, appHost));
          }
          return json(405, { error: 'method_not_allowed' }, 'GET, POST');
        }

        if (!CAMPAIGN_ID_RE.test(linkId)) return json(404, { error: 'not_found' });

        if (method === 'PATCH') {
          const body = readBody(ev);
          if (!body) return badRequest('body');
          const changes = parseCampaignChanges(body, links, nowMs);
          if (typeof changes === 'string') return badRequest(changes);
          if (!limited(`mut:${actor}`, MUTATIONS_PER_HOUR, 3_600_000)) return json(429, { error: 'rate_limited' });
          const out = await deps.invites.update(linkId, changes, nowMs);
          if (!out.ok) return out.reason === 'not_found' ? json(404, { error: 'not_found' }) : badRequest(out.reason);
          audit('link_update', linkId, undefined, Object.keys(changes).join(','));
          return json(200, publicCampaign(out.item, nowMs, appHost));
        }

        if (method === 'DELETE') {
          if (!limited(`mut:${actor}`, MUTATIONS_PER_HOUR, 3_600_000)) return json(429, { error: 'rate_limited' });
          await deps.invites.delete(linkId);
          audit('link_delete', linkId);
          return json(200, { id: linkId, deleted: true });
        }

        return json(405, { error: 'method_not_allowed' }, 'PATCH, DELETE');
      }

      // ── dataset editor (P1): read/commit one question in its dataset repo ─────
      if (path === `${BASE}/datasets` && (method === 'GET' || method === 'HEAD')) {
        const repos = cfg.datasetRepos ?? {};
        const datasets = Object.entries(repos)
          .map(([id, r]) => ({ id, repo: r.repo }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return json(200, { datasets });
      }

      const editMatch = path.match(/^\/api\/admin\/datasets\/([a-z0-9][a-z0-9-]{0,62})\/questions\/(\d+)$/);
      if (editMatch) {
        const datasetId = editMatch[1]!;
        const qid = Number(editMatch[2]);
        const repoCfg = cfg.datasetRepos?.[datasetId];
        if (!repoCfg) return json(404, { error: 'dataset_not_editable' });
        const editing = method === 'PUT';
        if (editing && !limited(`mut:${actor}`, MUTATIONS_PER_HOUR, 3_600_000)) return json(429, { error: 'rate_limited' });
        if (!editing && method !== 'GET' && method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, 'GET, PUT');

        let file: { content: string; sha: string } | null;
        try {
          file = await deps.github.getFile(repoCfg.repo, repoCfg.file);
        } catch (e) {
          deps.log({ evt: 'github_error', ip, path, error: e instanceof Error ? e.message : String(e) });
          return json(502, { error: 'github_error' });
        }
        if (!file) return json(404, { error: 'dataset_not_editable' });

        let questions: unknown;
        let style: ReturnType<typeof detectJsonStyle>;
        try {
          questions = parseJsonText(file.content);
          style = detectJsonStyle(file.content);
        } catch {
          deps.log({ evt: 'github_error', ip, path, error: 'questions file is not valid JSON' });
          return json(502, { error: 'github_error' });
        }
        if (!Array.isArray(questions)) return json(502, { error: 'github_error' });
        const found = questions.find((q) => !!q && typeof q === 'object' && (q as { id?: unknown }).id === qid);
        if (found === undefined) return json(404, { error: 'not_found' });

        if (!editing) return json(200, { sha: file.sha, question: found });

        const body = readBody(ev, MAX_EDIT_BODY);
        if (!body) return json(400, { error: 'bad_json' });
        if (typeof body.baseSha !== 'string' || body.baseSha !== file.sha) return json(409, { error: 'conflict' });
        const incoming = body.question;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return json(400, { error: 'invalid_question' });
        if (JSON.stringify(incoming).length > MAX_EDIT_QUESTION) return json(413, { error: 'too_large' });
        const q = incoming as Record<string, unknown>;
        if (q.id !== qid) return json(400, { error: 'invalid_question', reason: 'id_changed' });

        const uploads = decodeUploads(body.uploads);
        if (typeof uploads === 'string') return json(400, { error: 'invalid_question', reason: uploads });

        // Replace in place: keep the array order and the internal id; only the editable fields
        // (and images, see PickImage) come from the client.
        const idx = questions.indexOf(found);
        const original = found as Record<string, unknown>;
        const storedImages = new Set(imagesOf(original));
        const dir = dirOfPath(repoCfg.file);
        const newFiles = new Map<string, Buffer>(); // question-relative path -> bytes
        const tokenPath: Record<string, string> = {};
        const pick: PickImage = (value, slot) => {
          if (typeof value !== 'string') return undefined;
          if (storedImages.has(value)) return value;
          if (value.startsWith('upload:')) {
            const token = value.slice('upload:'.length);
            const up = uploads.get(token);
            if (!up) return undefined;
            const path = imageName(qid, slot, up.bytes, up.ext);
            newFiles.set(path, up.bytes);
            tokenPath[token] = path;
            return path;
          }
          return undefined;
        };

        const options = rebuildOptions(q.options, pick);
        if (typeof options === 'string') return json(400, { error: 'invalid_question', reason: options });
        const merged: Record<string, unknown> = { ...original };
        for (const k of ['text', 'selectCount', 'explanation', 'sourceNumber']) {
          if (Object.prototype.hasOwnProperty.call(q, k)) merged[k] = q[k];
          else delete merged[k];
        }
        for (const [k, slot] of [['image', ''], ['explanationImage', 'expl']] as const) {
          const img = pick(q[k], slot);
          if (img !== undefined) merged[k] = img;
          else delete merged[k];
        }
        merged.options = options;
        merged.id = qid;

        // Only the edited question is validated: other (legacy) questions of the file must not
        // block an edit, and the id is pinned so an edit cannot create a duplicate.
        const reason = validateQuestion(merged);
        if (reason) return json(400, { error: 'invalid_question', reason });
        questions[idx] = merged;

        // Files of this commit: questions.json, new images, images this edit stopped using (and
        // nobody else uses), and index.json when its distinct-image count changes (the dataset
        // validator rejects a stale count, which would fail the publish).
        const nowImages = new Set(imagesOf(merged));
        const usedElsewhere = new Set<string>();
        for (const other of questions) if (other !== merged) for (const p of imagesOf(other)) usedElsewhere.add(p);
        const removed = [...storedImages].filter((p) => !nowImages.has(p) && !usedElsewhere.has(p) && IMAGE_PATH_RE.test(p));
        const added = [...newFiles.keys()].filter((p) => !usedElsewhere.has(p));

        const files: CommitFile[] = [{ path: repoCfg.file, text: style.stringify(questions) }];
        for (const [p, bytes] of newFiles) files.push({ path: joinRepo(dir, p), bytes });
        for (const p of removed) files.push({ path: joinRepo(dir, p), delete: true });

        try {
          const indexPath = joinRepo(dir, 'index.json');
          const index = await deps.github.getFile(repoCfg.repo, indexPath);
          if (index) {
            const total = new Set(questions.flatMap(imagesOf)).size;
            const idxJson = ((): { datasets?: Array<Record<string, unknown>> } | null => {
              try { return parseJsonText(index.content) as { datasets?: Array<Record<string, unknown>> }; } catch { return null; } // a broken index.json is left alone
            })();
            const entry = idxJson?.datasets?.[0];
            if (idxJson && entry && entry.images !== total) {
              const re = /("images"\s*:\s*)\d+/;
              const text = re.test(index.content)
                ? index.content.replace(re, `$1${total}`)
                : JSON.stringify({ ...idxJson, datasets: [{ ...entry, images: total }, ...(idxJson.datasets ?? []).slice(1)] }, null, 2) + '\n';
              files.push({ path: indexPath, text });
            }
          }

          const note = [added.length ? `+${added.length} image(s)` : '', removed.length ? `-${removed.length} image(s)` : ''].filter(Boolean).join(', ');
          const out = await deps.github.commitFiles(repoCfg.repo, {
            files,
            expect: { path: repoCfg.file, sha: file.sha },
            message: `fix(dataset): edit question ${qid}${note ? ` (${note})` : ''}\n\nEdited via Quizzer admin by ${actor}.`,
          });
          const detail = [style.exact ? '' : 'file reformatted', note].filter(Boolean).join('; ');
          audit('question_edit', `${datasetId}#${qid}`, undefined, detail || undefined);
          // reformatted: the original style could not be reproduced, so the diff is larger than one question.
          return json(200, { sha: out.sha, commit: out.commit, reformatted: !style.exact, question: merged, uploads: tokenPath });
        } catch (e) {
          if (e instanceof GithubError && e.status === 409) return json(409, { error: 'conflict' });
          deps.log({ evt: 'github_error', ip, path, error: e instanceof Error ? e.message : String(e) });
          return json(502, { error: 'github_error' });
        }
      }

      return json(404, { error: 'not_found' });
    } catch (e) {
      deps.log({ evt: 'error', path, ip, error: e instanceof Error ? e.message : String(e) });
      return json(500, { error: 'internal' });
    }
  };
}
