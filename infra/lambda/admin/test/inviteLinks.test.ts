import { describe, it, expect } from 'vitest';
import { SESSION_COOKIE } from '../../../edge/session-core.js';
import { setup, ev, token, ADMIN_EMAIL, CONFIG, NOW_SEC } from './fakes.js';
import { INVITE_LINKS } from '../../auth/test/fakeInvites.js';
import { CAMPAIGN_ID_RE } from '../../auth/src/inviteStore.js';

type T = ReturnType<typeof setup>;
const admin = () => ({ cookies: [`${SESSION_COOKIE}=${token('sub-admin', ADMIN_EMAIL, { adm: true, ds: ['*'] })}`] });
const body = (o: unknown) => JSON.stringify(o);
const create = (t: T, o: unknown = { name: 'Classe 3B' }) => t.handler(ev('POST', '/api/admin/invite-links', { ...admin(), body: body(o) }));
const patch = (t: T, id: string, o: unknown) => t.handler(ev('PATCH', `/api/admin/invite-links/${id}`, { ...admin(), body: body(o) }));
const del = (t: T, id: string) => t.handler(ev('DELETE', `/api/admin/invite-links/${id}`, admin()));
const list = async (t: T) => JSON.parse((await t.handler(ev('GET', '/api/admin/invite-links', admin()))).body!);
const made = async (t: T, o?: unknown) => JSON.parse((await create(t, o)).body!);
const HOUR = 3_600_000;
const NOW = NOW_SEC * 1000;
const UNKNOWN_ID = 'Zz_-Zz_-Zz_-Zz_-';

describe('POST /api/admin/invite-links', () => {
  it('creates a campaign with the configured defaults and a stable plain id', async () => {
    const t = setup();
    const r = await create(t, { name: '  Classe 3B  ', publicNote: 'Benvenuti', internalNote: 'per la 3B' });
    expect(r.statusCode).toBe(201);
    const out = JSON.parse(r.body!);
    expect(out.id).toMatch(CAMPAIGN_ID_RE);
    expect(out).toEqual({
      id: out.id,
      url: `https://${CONFIG.appHosts[0]}/auth/join?c=${out.id}`,
      name: 'Classe 3B',
      publicNote: 'Benvenuti',
      internalNote: 'per la 3B',
      createdBy: ADMIN_EMAIL,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW + INVITE_LINKS.defaultTtlHours * HOUR,
      maxUses: INVITE_LINKS.defaultMaxUses,
      uses: 0,
      enabled: true,
      status: 'active',
    });
    const item = t.invites.items.get(out.id)!;
    expect(item).toMatchObject({ name: 'Classe 3B', uses: 0, enabled: true });
    expect('ttl' in item).toBe(false); // a campaign must survive its expiry
    expect(t.audit).toHaveLength(1);
    expect(t.audit[0]).toMatchObject({ evt: 'admin_action', actor: ADMIN_EMAIL, action: 'link_create', target: out.id, detail: 'Classe 3B' });
  });

  it('accepts custom ttl and uses; empty notes are dropped; two campaigns never share an id', async () => {
    const t = setup();
    const a = await made(t, { name: 'a', ttlHours: 2, maxUses: 5, publicNote: '  ', internalNote: '' });
    const b = await made(t, { name: 'b' });
    expect(a).toMatchObject({ maxUses: 5, expiresAt: NOW + 2 * HOUR });
    expect(a.publicNote).toBeUndefined();
    expect(a.internalNote).toBeUndefined();
    expect(a.id).not.toBe(b.id);
  });

  it('rejects bad values with 400 bad_request + reason; limits come from the config, inclusive', async () => {
    const t = setup();
    const L = INVITE_LINKS;
    const cases: [unknown, string][] = [
      [{}, 'name'],
      [{ name: '' }, 'name'],
      [{ name: 5 }, 'name'],
      [{ name: 'x'.repeat(L.nameMaxLength + 1) }, 'name'],
      [{ name: 'a\nb' }, 'name'],
      [{ name: 'n', ttlHours: 0 }, 'ttlHours'],
      [{ name: 'n', ttlHours: L.maxTtlHours + 1 }, 'ttlHours'],
      [{ name: 'n', ttlHours: '5' }, 'ttlHours'],
      [{ name: 'n', maxUses: 0 }, 'maxUses'],
      [{ name: 'n', maxUses: L.maxMaxUses + 1 }, 'maxUses'],
      [{ name: 'n', publicNote: 5 }, 'publicNote'],
      [{ name: 'n', publicNote: 'x'.repeat(L.publicNoteMaxLength + 1) }, 'publicNote'],
      [{ name: 'n', internalNote: 'x'.repeat(L.internalNoteMaxLength + 1) }, 'internalNote'],
      [{ name: 'n', internalNote: 'bell\x07' }, 'internalNote'],
    ];
    for (const [input, reason] of cases) {
      const r = await create(t, input);
      expect(r.statusCode, JSON.stringify(input)).toBe(400);
      expect(JSON.parse(r.body!)).toEqual({ error: 'bad_request', reason });
    }
    expect((await t.handler(ev('POST', '/api/admin/invite-links', { ...admin(), body: 'not json' }))).statusCode).toBe(400);
    expect(t.invites.items.size).toBe(0);
    expect(t.audit).toHaveLength(0);
    const edge = { name: 'x'.repeat(L.nameMaxLength), ttlHours: L.maxTtlHours, maxUses: L.maxMaxUses, publicNote: 'line1\nline2'.padEnd(L.publicNoteMaxLength, 'x') };
    expect((await create(t, edge)).statusCode).toBe(201);
  });

  it('is rate limited (429 rate_limited), nothing is stored', async () => {
    const t = setup({ limiter: () => false });
    expect(JSON.parse((await create(t)).body!)).toEqual({ error: 'rate_limited' });
    expect(t.invites.items.size).toBe(0);
  });
});

describe('GET /api/admin/invite-links', () => {
  it('lists newest first with derived status (disabled > expired > exhausted > active), the defaults, and skips old-scheme items', async () => {
    const t = setup();
    const first = await made(t, { name: 'one', internalNote: 'x' });
    t.advance(60);
    const second = await made(t, { name: 'two', maxUses: 2 });
    t.invites.items.set('a'.repeat(64), { ...t.invites.items.get(first.id)!, id: 'a'.repeat(64) }); // old token-hash item
    const item = t.invites.items.get(first.id)!;
    const status = async () => (await list(t)).links.find((l: { id: string }) => l.id === first.id).status;
    expect((await list(t)).links.map((l: { id: string }) => l.id)).toEqual([second.id, first.id]);
    expect(await status()).toBe('active');
    item.uses = item.maxUses;
    expect(await status()).toBe('exhausted');
    item.expiresAt = 0; // (advancing the clock would also expire the admin session)
    expect(await status()).toBe('expired');
    item.enabled = false;
    expect(await status()).toBe('disabled');
    expect((await list(t)).defaults).toEqual({
      ttlHours: INVITE_LINKS.defaultTtlHours,
      maxTtlHours: INVITE_LINKS.maxTtlHours,
      maxUses: INVITE_LINKS.defaultMaxUses,
      maxMaxUses: INVITE_LINKS.maxMaxUses,
      nameMaxLength: INVITE_LINKS.nameMaxLength,
      publicNoteMaxLength: INVITE_LINKS.publicNoteMaxLength,
      internalNoteMaxLength: INVITE_LINKS.internalNoteMaxLength,
    });
  });
});

describe('PATCH /api/admin/invite-links/<id>', () => {
  it('edits any subset; empty note removes it; reactivation = enabled + later expiry + more uses', async () => {
    const t = setup();
    const a = await made(t, { name: 'old', publicNote: 'p', internalNote: 'i' });
    t.advance(5);
    const r = await patch(t, a.id, { name: 'new', publicNote: '', maxUses: 9, enabled: false });
    expect(r.statusCode).toBe(200);
    const out = JSON.parse(r.body!);
    expect(out).toMatchObject({ id: a.id, name: 'new', maxUses: 9, enabled: false, status: 'disabled', internalNote: 'i', updatedAt: NOW + 5000, createdAt: NOW });
    expect(out.publicNote).toBeUndefined();
    t.invites.items.get(a.id)!.expiresAt = 1; // expired and exhausted
    t.invites.items.get(a.id)!.uses = 9;
    const again = JSON.parse((await patch(t, a.id, { enabled: true, expiresAt: NOW + HOUR, maxUses: 10 })).body!);
    expect(again).toMatchObject({ enabled: true, expiresAt: NOW + HOUR, maxUses: 10, status: 'active' });
    expect(t.audit.filter((e) => e.action === 'link_update').map((e) => [e.target, e.detail])).toEqual([
      [a.id, 'name,publicNote,maxUses,enabled'],
      [a.id, 'maxUses,enabled,expiresAt'],
    ]);
  });

  it('maxUses below the current uses -> 400 max_uses_below_uses (equal is fine), nothing changes', async () => {
    const t = setup();
    const a = await made(t, { name: 'a', maxUses: 10 });
    t.invites.items.get(a.id)!.uses = 4;
    const r = await patch(t, a.id, { maxUses: 3, name: 'renamed' });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body!)).toEqual({ error: 'bad_request', reason: 'max_uses_below_uses' });
    expect(t.invites.items.get(a.id)).toMatchObject({ name: 'a', maxUses: 10 });
    expect((await patch(t, a.id, { maxUses: 4 })).statusCode).toBe(200);
  });

  it('expiresAt must be in the future and at most maxTtlHours ahead (inclusive)', async () => {
    const t = setup();
    const a = await made(t);
    for (const expiresAt of [NOW, NOW - 1, NOW + INVITE_LINKS.maxTtlHours * HOUR + 1, 1.5, '2030-01-01', null]) {
      const r = await patch(t, a.id, { expiresAt });
      expect(r.statusCode, String(expiresAt)).toBe(400);
      expect(JSON.parse(r.body!)).toEqual({ error: 'bad_request', reason: 'expires_at' });
    }
    expect((await patch(t, a.id, { expiresAt: NOW + INVITE_LINKS.maxTtlHours * HOUR })).statusCode).toBe(200);
    expect((await patch(t, a.id, { expiresAt: NOW + 1 })).statusCode).toBe(200);
  });

  it('rejects bad fields, unknown fields and an empty patch', async () => {
    const t = setup();
    const a = await made(t);
    const cases: [unknown, string][] = [
      [{ name: '' }, 'name'],
      [{ name: 'x'.repeat(INVITE_LINKS.nameMaxLength + 1) }, 'name'],
      [{ publicNote: 'x'.repeat(INVITE_LINKS.publicNoteMaxLength + 1) }, 'publicNote'],
      [{ internalNote: 3 }, 'internalNote'],
      [{ maxUses: 0 }, 'maxUses'],
      [{ maxUses: INVITE_LINKS.maxMaxUses + 1 }, 'maxUses'],
      [{ enabled: 'yes' }, 'enabled'],
      [{ createdBy: 'me' }, 'createdBy'],
      [{}, 'empty'],
    ];
    for (const [input, reason] of cases) {
      const r = await patch(t, a.id, input);
      expect(r.statusCode, JSON.stringify(input)).toBe(400);
      expect(JSON.parse(r.body!)).toEqual({ error: 'bad_request', reason });
    }
    expect(t.audit.filter((e) => e.action === 'link_update')).toHaveLength(0);
  });

  it('unknown id -> 404 not_found; malformed id -> 404 before anything else', async () => {
    const t = setup();
    for (const id of [UNKNOWN_ID, 'a'.repeat(64), 'short', 'x'.repeat(15)]) {
      const r = await patch(t, id, { enabled: false });
      expect(r.statusCode, id).toBe(404);
      expect(JSON.parse(r.body!)).toEqual({ error: 'not_found' });
    }
    expect(t.audit).toHaveLength(0);
  });
});

describe('DELETE /api/admin/invite-links/<id>', () => {
  it('hard deletes, idempotent (unknown id also 200), audited; registered users keep their origin', async () => {
    const t = setup();
    const a = await made(t);
    t.origins.items.set('uuid-1', { username: 'uuid-1', campaignId: a.id, campaignName: 'Classe 3B', at: 1 });
    const r = await del(t, a.id);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!)).toEqual({ id: a.id, deleted: true });
    expect(t.invites.items.has(a.id)).toBe(false);
    expect((await list(t)).links).toEqual([]);
    expect((await del(t, a.id)).statusCode).toBe(200);
    expect((await del(t, UNKNOWN_ID)).statusCode).toBe(200);
    expect(t.audit.filter((e) => e.action === 'link_delete')).toHaveLength(3);
    expect(t.origins.items.get('uuid-1')).toMatchObject({ campaignName: 'Classe 3B' });
  });

  it('malformed id -> 404; wrong methods -> 405; rate limited -> 429', async () => {
    const t = setup();
    expect((await del(t, 'a'.repeat(64))).statusCode).toBe(404);
    expect((await t.handler(ev('GET', `/api/admin/invite-links/${UNKNOWN_ID}`, admin()))).statusCode).toBe(405);
    expect((await t.handler(ev('PUT', '/api/admin/invite-links', admin()))).statusCode).toBe(405);
    expect((await del(setup({ limiter: () => false }), UNKNOWN_ID)).statusCode).toBe(429);
  });
});

describe('origin in the users list', () => {
  it('campaign users carry the snapshot (survives deletion), everyone else is "invited"', async () => {
    const t = setup();
    const a = await made(t, { name: 'Classe 3B' });
    t.cognito.addUser({ username: 'uuid-9', email: 'joined@example.com', status: 'CONFIRMED', enabled: true, groups: [] });
    t.cognito.addUser({ username: 'uuid-8', email: 'invited@example.com', status: 'FORCE_CHANGE_PASSWORD', enabled: true, groups: [] });
    t.origins.items.set('uuid-9', { username: 'uuid-9', campaignId: a.id, campaignName: 'Classe 3B', at: 1 });
    await del(t, a.id);
    const users = JSON.parse((await t.handler(ev('GET', '/api/admin/users', admin()))).body!).users as { email: string; origin: unknown }[];
    const origin = (email: string) => users.find((u) => u.email === email)!.origin;
    expect(origin('joined@example.com')).toEqual({ kind: 'campaign', campaignId: a.id, name: 'Classe 3B' });
    expect(origin('invited@example.com')).toEqual({ kind: 'invited' });
    expect(origin(ADMIN_EMAIL)).toEqual({ kind: 'invited' });
  });

  it('an unreadable origin table does not break the list (logged, everyone invited)', async () => {
    const t = setup();
    t.origins.getMany = async () => {
      throw new Error('dynamo down');
    };
    const r = await t.handler(ev('GET', '/api/admin/users', admin()));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!).users[0].origin).toEqual({ kind: 'invited' });
    expect(t.logs).toContainEqual({ evt: 'origin_read_failed', error: 'Error' });
  });
});

describe('authorization, CSRF and feature switch', () => {
  it('no cookie -> 401; non-admin -> 403', async () => {
    const t = setup();
    expect((await t.handler(ev('GET', '/api/admin/invite-links'))).statusCode).toBe(401);
    const member = token('sub-m', 'member@example.com', { adm: false, ds: ['aws-dva-c02'] });
    t.cognito.addUser({ username: 'member@example.com', email: 'member@example.com', status: 'CONFIRMED', enabled: true, groups: [] });
    const cookies = [`${SESSION_COOKIE}=${member}`];
    expect((await t.handler(ev('GET', '/api/admin/invite-links', { cookies }))).statusCode).toBe(403);
    expect((await t.handler(ev('POST', '/api/admin/invite-links', { cookies, body: '{"name":"x"}' }))).statusCode).toBe(403);
    expect(t.invites.items.size).toBe(0);
  });

  it('mutations need the CSRF header and a same-origin request', async () => {
    const t = setup();
    for (const [method, path] of [['POST', '/api/admin/invite-links'], ['PATCH', `/api/admin/invite-links/${UNKNOWN_ID}`], ['DELETE', `/api/admin/invite-links/${UNKNOWN_ID}`]] as const) {
      const noCsrf = await t.handler(ev(method, path, { ...admin(), headers: { 'x-qz-csrf': '' }, body: '{"name":"x"}' }));
      expect(JSON.parse(noCsrf.body!)).toEqual({ error: 'csrf' });
      const evil = await t.handler(ev(method, path, { ...admin(), headers: { origin: 'https://evil.example' }, body: '{"name":"x"}' }));
      expect(JSON.parse(evil.body!)).toEqual({ error: 'bad_origin' });
      const site = await t.handler(ev(method, path, { ...admin(), headers: { 'sec-fetch-site': 'cross-site' }, body: '{"name":"x"}' }));
      expect(site.statusCode).toBe(403);
    }
    expect(t.invites.items.size).toBe(0);
  });

  it('feature disabled -> 404 invite_links_disabled on every verb; the users list still works (all invited)', async () => {
    const t = setup({ config: { inviteLinks: undefined } });
    for (const [method, path] of [
      ['GET', '/api/admin/invite-links'],
      ['POST', '/api/admin/invite-links'],
      ['PATCH', `/api/admin/invite-links/${UNKNOWN_ID}`],
      ['DELETE', `/api/admin/invite-links/${UNKNOWN_ID}`],
    ] as const) {
      const r = await t.handler(ev(method, path, { ...admin(), body: '{}' }));
      expect(r.statusCode).toBe(404);
      expect(JSON.parse(r.body!)).toEqual({ error: 'invite_links_disabled' });
    }
    const users = JSON.parse((await t.handler(ev('GET', '/api/admin/users', admin()))).body!).users;
    expect(users[0].origin).toEqual({ kind: 'invited' });
  });
});
