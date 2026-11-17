import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { SESSION_COOKIE } from '../../../edge/session-core.js';
import { setup, ev, token, ADMIN_EMAIL, CONFIG, NOW_SEC } from './fakes.js';
import { INVITE_LINKS } from '../../auth/test/fakeInvites.js';
import type { InviteItem } from '../../auth/src/inviteStore.js';

const admin = () => ({ cookies: [`${SESSION_COOKIE}=${token('sub-admin', ADMIN_EMAIL, { adm: true, ds: ['*'] })}`] });
const body = (o: unknown) => JSON.stringify(o);
const create = (t: ReturnType<typeof setup>, o: unknown = {}) =>
  t.handler(ev('POST', '/api/admin/invite-links', { ...admin(), body: body(o) }));
const list = async (t: ReturnType<typeof setup>) =>
  JSON.parse((await t.handler(ev('GET', '/api/admin/invite-links', admin()))).body!);
const tokenOf = (url: string) => new URL(url).searchParams.get('t')!;
const HOUR = 3_600_000;

describe('POST /api/admin/invite-links', () => {
  it('creates a link with the configured defaults; only sha256(token) is stored', async () => {
    const t = setup();
    const r = await create(t);
    expect(r.statusCode).toBe(201);
    const out = JSON.parse(r.body!);
    const tk = tokenOf(out.url);
    expect(out.url).toBe(`https://${CONFIG.appHosts[0]}/auth/join?t=${tk}`);
    expect(tk).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const id = createHash('sha256').update(tk).digest('hex');
    expect(out).toMatchObject({ id, maxUses: INVITE_LINKS.defaultMaxUses });
    expect(out.expiresAt).toBe(NOW_SEC * 1000 + INVITE_LINKS.defaultTtlHours * HOUR);
    const item = t.invites.items.get(id)!;
    expect(item).toMatchObject({ id, createdBy: ADMIN_EMAIL, uses: 0, maxUses: 1, expiresAt: out.expiresAt });
    expect(item.ttl).toBe(Math.floor(out.expiresAt / 1000) + INVITE_LINKS.retentionDays * 86_400);
    expect(JSON.stringify([...t.invites.items.entries()])).not.toContain(tk);
    expect(JSON.stringify(t.logs)).not.toContain(tk);
    expect(t.audit).toHaveLength(1);
    expect(t.audit[0]).toMatchObject({ evt: 'admin_action', actor: ADMIN_EMAIL, action: 'link_create', target: id });
    expect(JSON.stringify(t.audit[0])).not.toContain(tk);
  });

  it('accepts custom ttl, uses and note (trimmed); two links never share a token', async () => {
    const t = setup();
    const a = JSON.parse((await create(t, { ttlHours: 2, maxUses: 5, note: '  classe 3B  ' })).body!);
    const b = JSON.parse((await create(t, {})).body!);
    expect(a.maxUses).toBe(5);
    expect(t.invites.items.get(a.id)).toMatchObject({ note: 'classe 3B', maxUses: 5 });
    expect(a.id).not.toBe(b.id);
    expect(tokenOf(a.url)).not.toBe(tokenOf(b.url));
    expect(b.expiresAt - a.expiresAt).toBe((INVITE_LINKS.defaultTtlHours - 2) * HOUR);
  });

  it('an empty note is dropped', async () => {
    const t = setup();
    const a = JSON.parse((await create(t, { note: '   ' })).body!);
    expect(t.invites.items.get(a.id)!.note).toBeUndefined();
  });

  it('rejects out-of-range values and bad types with 400 bad_request + reason', async () => {
    const t = setup();
    const cases: [unknown, string][] = [
      [{ ttlHours: 0 }, 'ttlHours'],
      [{ ttlHours: INVITE_LINKS.maxTtlHours + 1 }, 'ttlHours'],
      [{ ttlHours: 1.5 }, 'ttlHours'],
      [{ ttlHours: '5' }, 'ttlHours'],
      [{ ttlHours: null }, 'ttlHours'],
      [{ maxUses: 0 }, 'maxUses'],
      [{ maxUses: INVITE_LINKS.maxMaxUses + 1 }, 'maxUses'],
      [{ maxUses: true }, 'maxUses'],
      [{ note: 5 }, 'note'],
      [{ note: 'x'.repeat(81) }, 'note'],
      [{ note: 'a\nb' }, 'note'],
    ];
    for (const [input, reason] of cases) {
      const r = await create(t, input);
      expect(r.statusCode, JSON.stringify(input)).toBe(400);
      expect(JSON.parse(r.body!)).toEqual({ error: 'bad_request', reason });
    }
    const bad = await t.handler(ev('POST', '/api/admin/invite-links', { ...admin(), body: 'not json' }));
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body!)).toMatchObject({ error: 'bad_request' });
    expect(t.invites.items.size).toBe(0);
    expect(t.audit).toHaveLength(0);
  });

  it('limits the boundaries inclusively', async () => {
    const t = setup();
    expect((await create(t, { ttlHours: INVITE_LINKS.maxTtlHours, maxUses: INVITE_LINKS.maxMaxUses })).statusCode).toBe(201);
    expect((await create(t, { ttlHours: 1, maxUses: 1 })).statusCode).toBe(201);
  });

  it('is rate limited (429 rate_limited), nothing is stored', async () => {
    const t = setup({ limiter: () => false });
    const r = await create(t);
    expect(r.statusCode).toBe(429);
    expect(JSON.parse(r.body!)).toEqual({ error: 'rate_limited' });
    expect(t.invites.items.size).toBe(0);
  });
});

describe('GET /api/admin/invite-links', () => {
  it('lists newest first with derived status and the defaults, never a token', async () => {
    const t = setup();
    const first = JSON.parse((await create(t, { note: 'one' })).body!);
    t.advance(60);
    const second = JSON.parse((await create(t, { maxUses: 2 })).body!);
    t.invites.items.get(first.id)!.uses = 1; // exhausted
    const out = await list(t);
    expect(out.links.map((l: { id: string }) => l.id)).toEqual([second.id, first.id]);
    expect(out.links[0]).toEqual({
      id: second.id,
      createdBy: ADMIN_EMAIL,
      createdAt: expect.any(Number),
      expiresAt: second.expiresAt,
      maxUses: 2,
      uses: 0,
      status: 'active',
    });
    expect(out.links[1]).toMatchObject({ note: 'one', status: 'exhausted' });
    expect(out.defaults).toEqual({
      ttlHours: INVITE_LINKS.defaultTtlHours,
      maxTtlHours: INVITE_LINKS.maxTtlHours,
      maxUses: INVITE_LINKS.defaultMaxUses,
      maxMaxUses: INVITE_LINKS.maxMaxUses,
    });
    const raw = JSON.stringify(out);
    expect(raw).not.toContain(tokenOf(first.url));
    expect(raw).not.toContain(tokenOf(second.url));
    expect(raw).not.toMatch(/"ttl"|revokedAt/);
  });

  it('status follows time and revocation (revoked > expired > exhausted > active)', async () => {
    const t = setup();
    const a = JSON.parse((await create(t)).body!);
    const item: InviteItem = t.invites.items.get(a.id)!;
    const status = async () => (await list(t)).links[0].status;
    expect(await status()).toBe('active');
    item.expiresAt = 0; // (advancing the clock would also expire the admin session)
    expect(await status()).toBe('expired');
    item.uses = item.maxUses;
    expect(await status()).toBe('expired');
    item.revokedAt = 1;
    expect(await status()).toBe('revoked');
  });

  it('empty table -> empty list', async () => {
    expect((await list(setup())).links).toEqual([]);
  });
});

describe('DELETE /api/admin/invite-links/<id>', () => {
  const del = (t: ReturnType<typeof setup>, id: string, o = admin()) => t.handler(ev('DELETE', `/api/admin/invite-links/${id}`, o));

  it('revokes, is idempotent and audited', async () => {
    const t = setup();
    const a = JSON.parse((await create(t)).body!);
    const r = await del(t, a.id);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!)).toEqual({ id: a.id, status: 'revoked' });
    const revokedAt = t.invites.items.get(a.id)!.revokedAt;
    expect(revokedAt).toBeDefined();
    t.advance(30);
    expect((await del(t, a.id)).statusCode).toBe(200);
    expect(t.invites.items.get(a.id)!.revokedAt).toBe(revokedAt);
    expect((await list(t)).links[0].status).toBe('revoked');
    expect(t.audit.filter((e) => e.action === 'link_revoke').map((e) => e.target)).toEqual([a.id, a.id]);
  });

  it('unknown or malformed id -> 404 not_found', async () => {
    const t = setup();
    for (const id of ['a'.repeat(64), 'xyz', 'A'.repeat(64), 'a'.repeat(63)]) {
      const r = await del(t, id);
      expect(r.statusCode, id).toBe(404);
      expect(JSON.parse(r.body!)).toEqual({ error: 'not_found' });
    }
    expect(t.audit).toHaveLength(0);
  });

  it('wrong methods -> 405', async () => {
    const t = setup();
    expect((await t.handler(ev('GET', `/api/admin/invite-links/${'a'.repeat(64)}`, admin()))).statusCode).toBe(405);
    expect((await t.handler(ev('PUT', '/api/admin/invite-links', admin()))).statusCode).toBe(405);
  });

  it('is rate limited', async () => {
    const t = setup({ limiter: () => false });
    expect((await del(t, 'a'.repeat(64))).statusCode).toBe(429);
  });
});

describe('authorization, CSRF and feature switch', () => {
  it('no cookie -> 401; non-admin -> 403', async () => {
    const t = setup();
    expect((await t.handler(ev('GET', '/api/admin/invite-links'))).statusCode).toBe(401);
    const member = token('sub-m', 'member@example.com', { adm: false, ds: ['aws-dva-c02'] });
    t.cognito.addUser({ username: 'member@example.com', email: 'member@example.com', status: 'CONFIRMED', enabled: true, groups: [] });
    expect((await t.handler(ev('GET', '/api/admin/invite-links', { cookies: [`${SESSION_COOKIE}=${member}`] }))).statusCode).toBe(403);
    expect((await t.handler(ev('POST', '/api/admin/invite-links', { cookies: [`${SESSION_COOKIE}=${member}`], body: '{}' }))).statusCode).toBe(403);
    expect(t.invites.items.size).toBe(0);
  });

  it('mutations need the CSRF header and a same-origin request', async () => {
    const t = setup();
    const id = 'a'.repeat(64);
    for (const [method, path] of [['POST', '/api/admin/invite-links'], ['DELETE', `/api/admin/invite-links/${id}`]] as const) {
      const noCsrf = await t.handler(ev(method, path, { ...admin(), headers: { 'x-qz-csrf': '' }, body: '{}' }));
      expect(JSON.parse(noCsrf.body!)).toEqual({ error: 'csrf' });
      const evil = await t.handler(ev(method, path, { ...admin(), headers: { origin: 'https://evil.example' }, body: '{}' }));
      expect(JSON.parse(evil.body!)).toEqual({ error: 'bad_origin' });
      const site = await t.handler(ev(method, path, { ...admin(), headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' }));
      expect(site.statusCode).toBe(403);
    }
    expect(t.invites.items.size).toBe(0);
  });

  it('feature disabled -> 404 invite_links_disabled on every verb', async () => {
    const t = setup({ config: { inviteLinks: undefined } });
    for (const [method, path] of [
      ['GET', '/api/admin/invite-links'],
      ['POST', '/api/admin/invite-links'],
      ['DELETE', `/api/admin/invite-links/${'a'.repeat(64)}`],
    ] as const) {
      const r = await t.handler(ev(method, path, { ...admin(), body: '{}' }));
      expect(r.statusCode).toBe(404);
      expect(JSON.parse(r.body!)).toEqual({ error: 'invite_links_disabled' });
    }
  });
});
