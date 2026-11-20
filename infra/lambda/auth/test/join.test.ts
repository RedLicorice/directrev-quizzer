import { describe, it, expect } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { setup, ev, APP } from './fakes.js';
import { INVITE_LINKS } from './fakeInvites.js';
import { parseConfig } from '../src/config.js';
import { newCampaignId, type CampaignItem } from '../src/inviteStore.js';
import { JOIN_SCRIPT } from '../src/html.js';

type T = ReturnType<typeof setup>;
const PASSWORD = 'Correct-Horse-1';
const HOUR = 3_600_000;

function seedLink(t: T, o: Partial<CampaignItem> = {}) {
  const nowMs = t.nowSec * 1000;
  const item: CampaignItem = {
    id: newCampaignId(),
    name: 'Classe 3B',
    createdBy: 'admin@example.com',
    createdAt: nowMs,
    updatedAt: nowMs,
    expiresAt: nowMs + HOUR,
    maxUses: 1,
    uses: 0,
    enabled: true,
    ...o,
  };
  t.invites.items.set(item.id, item);
  return { id: item.id, item };
}

const SAME_ORIGIN = { origin: APP, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' };
const post = (t: T, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  t.handler(ev('POST', '/auth/join', { headers: { ...SAME_ORIGIN, ...headers }, body: new URLSearchParams(fields).toString() }));
const roomy = () => setup({ config: { inviteLinks: { ...INVITE_LINKS, joinRateLimit: { attempts: 1000, windowSeconds: 600 } } } });
const form = (id: string, over: Record<string, string> = {}) => ({
  c: id,
  email: 'new@example.com',
  password: PASSWORD,
  password2: PASSWORD,
  ...over,
});

describe('GET /auth/join', () => {
  it('usable campaign -> page with logo, name, description and public note; form without inline script', async () => {
    const t = setup();
    const { id } = seedLink(t, { name: 'Classe <3B>', publicNote: 'Benvenuti!\n<b>Seconda</b> riga' });
    const r = await t.handler(ev('GET', `/auth/join?c=${id}`));
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('<img class="logo" src="/icon-192.svg" alt="Quizzer" width="72" height="72">');
    expect(r.body).toContain('<h1>Classe &lt;3B&gt;</h1>');
    expect(r.body).toContain(`<p>${INVITE_LINKS.joinDescription}</p>`);
    expect(r.body).toContain('<p class="note">Benvenuti!\n&lt;b&gt;Seconda&lt;/b&gt; riga</p>');
    expect(r.body).toContain('white-space:pre-line');
    expect(r.body).toContain(`name="c" value="${id}"`);
    expect(r.body).toContain('action="/auth/join"');
    // CSP script-src 'self': only an external script of this origin
    expect([...r.body!.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(['<script src="/auth/join.js">']);
    expect(r.body).not.toMatch(/\son[a-z]+=/);
    expect(t.invites.items.get(id)!.uses).toBe(0); // viewing does not consume
  });

  it('no public note -> no note paragraph', async () => {
    const t = setup();
    const { id } = seedLink(t);
    expect((await t.handler(ev('GET', `/auth/join?c=${id}`))).body).not.toContain('class="note"');
  });

  it('unknown, malformed, deleted, expired, exhausted, disabled and old ?t= links all get the same generic 410 page', async () => {
    const t = setup();
    const expired = seedLink(t, { expiresAt: t.nowSec * 1000 - 1 });
    const exhausted = seedLink(t, { uses: 1 });
    const disabled = seedLink(t, { enabled: false });
    const deleted = seedLink(t);
    t.invites.items.delete(deleted.id);
    const queries = [`c=${newCampaignId()}`, 'c=short', 'c=', `c=${expired.id}`, `c=${exhausted.id}`, `c=${disabled.id}`, `c=${deleted.id}`, `t=${'a'.repeat(43)}`, ''];
    const results = await Promise.all(queries.map((q) => t.handler(ev('GET', `/auth/join?${q}`))));
    for (const r of results) {
      expect(r.statusCode).toBe(410);
      expect(r.body).toBe(results[0]!.body);
      expect(r.headers).toEqual(results[0]!.headers);
    }
    expect(results[0]!.body).toContain('Link non valido o scaduto');
    expect(results[0]!.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('POST /auth/join', () => {
  it('creates the account, consumes one use, assigns nothing, logs no secret', async () => {
    const t = setup();
    const { id, item } = seedLink(t);
    const r = await post(t, form(id));
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Account creato');
    expect(r.body).toContain('href="/auth/login"');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(t.accounts.created).toEqual([{ email: 'new@example.com', password: PASSWORD, username: 'uuid-1' }]);
    expect(t.invites.items.get(item.id)!.uses).toBe(1);
    // the origin is keyed by the Cognito Username (not the e-mail) and snapshots the campaign name
    expect([...t.origins.items.values()]).toEqual([{ username: 'uuid-1', campaignId: item.id, campaignName: 'Classe 3B', at: t.nowSec * 1000 }]);
    expect(t.logs).toContainEqual({ evt: 'join', ip: '130.176.0.1', id: item.id, result: 'ok', origin: 'written' });
    const logs = JSON.stringify(t.logs);
    for (const secret of [PASSWORD, 'new@example.com']) expect(logs).not.toContain(secret);
  });

  it('a failed origin write is logged and does not fail the registration', async () => {
    const t = setup();
    const { id, item } = seedLink(t);
    t.origins.failPut = true;
    const r = await post(t, form(id));
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Account creato');
    expect(t.accounts.created).toHaveLength(1);
    expect(t.invites.items.get(item.id)!.uses).toBe(1);
    expect(t.logs).toContainEqual({ evt: 'join', ip: '130.176.0.1', id: item.id, result: 'ok', origin: 'write_failed' });
  });

  it('reads a base64-encoded body (Function URL)', async () => {
    const t = setup();
    const { id } = seedLink(t);
    const body = Buffer.from(new URLSearchParams(form(id)).toString()).toString('base64');
    const r = await t.handler(ev('POST', '/auth/join', { headers: SAME_ORIGIN, body, isBase64Encoded: true }));
    expect(r.statusCode).toBe(200);
    expect(t.accounts.created).toHaveLength(1);
  });

  it('is atomic: concurrent redeems of a maxUses=1 campaign create exactly one account', async () => {
    const t = roomy();
    const { id, item } = seedLink(t);
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => post(t, form(id, { email: `u${i}@example.com` }))));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode === 410)).toHaveLength(11);
    expect(t.accounts.created).toHaveLength(1);
    expect(t.invites.items.get(item.id)!.uses).toBe(1);
  });

  it('honours maxUses > 1', async () => {
    const t = roomy();
    const { id, item } = seedLink(t, { maxUses: 3 });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => post(t, form(id, { email: `u${i}@example.com` }))));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(3);
    expect(t.invites.items.get(item.id)!.uses).toBe(3);
  });

  it('expired, exhausted, disabled and unknown campaigns give the same generic 410 and create nothing', async () => {
    const t = setup();
    const expired = seedLink(t, { expiresAt: t.nowSec * 1000 - 1 });
    const exhausted = seedLink(t, { uses: 1 });
    const disabled = seedLink(t, { enabled: false });
    const rs = [];
    for (const cid of [expired.id, exhausted.id, disabled.id, newCampaignId(), 'nope']) rs.push(await post(t, form(cid)));
    for (const r of rs) {
      expect(r.statusCode).toBe(410);
      expect(r.body).toBe(rs[0]!.body);
    }
    expect(rs[0]!.body).toContain('Link non valido o scaduto');
    expect(t.accounts.created).toHaveLength(0);
    expect(t.origins.items.size).toBe(0);
  });

  it('a campaign disabled or edited after the page view is honoured at submit', async () => {
    const t = setup();
    const { id, item } = seedLink(t);
    expect((await t.handler(ev('GET', `/auth/join?c=${id}`))).statusCode).toBe(200);
    item.enabled = false;
    expect((await post(t, form(id))).statusCode).toBe(410);
    item.enabled = true; // reactivated: the same link works again
    expect((await post(t, form(id))).statusCode).toBe(200);
  });

  it('campaign expiring between the page view and the submit is refused', async () => {
    const t = setup();
    const { id } = seedLink(t);
    expect((await t.handler(ev('GET', `/auth/join?c=${id}`))).statusCode).toBe(200);
    t.advance(2 * 3600);
    expect((await post(t, form(id))).statusCode).toBe(410);
  });

  it('validation errors re-show the form and do not consume a use', async () => {
    const t = setup();
    const { id, item } = seedLink(t);
    const bad = await post(t, form(id, { email: 'nope' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('email valido');
    expect(bad.body).toContain('<h1>Classe 3B</h1>'); // the form comes back with the campaign page
    const mismatch = await post(t, form(id, { password2: 'other' }));
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.body).toContain('non coincidono');
    expect(mismatch.body).not.toContain(PASSWORD);
    const empty = await post(t, form(id, { password: '', password2: '' }));
    expect(empty.statusCode).toBe(400);
    expect(t.invites.items.get(item.id)!.uses).toBe(0);
    expect(t.accounts.created).toHaveLength(0);
  });

  it('existing account: use released, form shown again with the email', async () => {
    const t = setup();
    const { id, item } = seedLink(t);
    t.accounts.existing.add('taken@example.com');
    const r = await post(t, form(id, { email: 'taken@example.com' }));
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain('Esiste già un account con questa email');
    expect(r.body).toContain('value="taken@example.com"');
    expect(t.invites.items.get(item.id)!.uses).toBe(0);
    expect(t.invites.releases).toBe(1);
    // the same link still works with another address
    expect((await post(t, form(id))).statusCode).toBe(200);
  });

  it('weak password: use released, email kept, password never echoed, policy message shown', async () => {
    const t = setup();
    const { id, item } = seedLink(t);
    const r = await post(t, form(id, { password: 'short', password2: 'short' }));
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain('Password non valida: Password not long enough');
    expect(r.body).toContain('value="new@example.com"');
    expect(r.body).not.toContain('short</');
    expect(r.body).not.toMatch(/name="password"[^>]*value=/);
    expect(t.invites.items.get(item.id)!.uses).toBe(0);
    expect(JSON.stringify(t.logs)).not.toContain('"short"');
  });

  it('unexpected Cognito error: use released, generic 500, only the error name is logged', async () => {
    const t = setup();
    const { id, item } = seedLink(t);
    t.accounts.failWith = { name: 'InternalErrorException', message: `boom ${PASSWORD}` };
    const r = await post(t, form(id));
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain(PASSWORD);
    expect(t.invites.items.get(item.id)!.uses).toBe(0);
    expect(t.logs).toContainEqual({ evt: 'join', ip: '130.176.0.1', id: item.id, result: 'error', error: 'InternalErrorException' });
    expect(JSON.stringify(t.logs)).not.toContain(PASSWORD);
    expect(t.origins.items.size).toBe(0);
  });

  it('same-origin check: cross-site Origin or Sec-Fetch-Site is refused before anything happens', async () => {
    const t = setup();
    const { id, item } = seedLink(t);
    const a = await post(t, form(id), { origin: 'https://evil.example' });
    expect(a.statusCode).toBe(403);
    expect(JSON.parse(a.body!)).toEqual({ error: 'bad_origin' });
    expect((await post(t, form(id), { 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect(t.accounts.created).toHaveLength(0);
    expect(t.invites.items.get(item.id)!.uses).toBe(0);
  });

  it('rate limits per IP (config-driven), other IPs unaffected', async () => {
    const t = setup();
    const { attempts, windowSeconds } = INVITE_LINKS.joinRateLimit;
    const bad = newCampaignId();
    for (let i = 0; i < attempts; i++) expect((await post(t, form(bad))).statusCode).toBe(410);
    const limited = await post(t, form(bad));
    expect(limited.statusCode).toBe(429);
    expect(t.logs).toContainEqual({ evt: 'join', ip: '130.176.0.1', result: 'rate_limited' });
    const other = await post(t, form(bad), { 'cloudfront-viewer-address': '198.51.100.7:4433' });
    expect(other.statusCode).toBe(410);
    t.advance(windowSeconds + 1);
    expect((await post(t, form(bad))).statusCode).toBe(410);
  });

  it('body above 4 KiB -> 413', async () => {
    const t = setup();
    const { id } = seedLink(t);
    const r = await post(t, form(id, { email: 'a'.repeat(5000) }));
    expect(r.statusCode).toBe(413);
  });

  it('other methods -> 405', async () => {
    const t = setup();
    const r = await t.handler(ev('PUT', '/auth/join'));
    expect(r.statusCode).toBe(405);
    expect(r.headers.allow).toBe('GET, POST');
  });
});

describe('feature disabled (no inviteLinks in the config)', () => {
  it('GET, POST and the script answer 404 invite_links_disabled', async () => {
    const t = setup({ config: { inviteLinks: undefined } });
    for (const r of [
      await t.handler(ev('GET', '/auth/join?c=x')),
      await post(t, form('x')),
      await t.handler(ev('GET', '/auth/join.js')),
    ]) {
      expect(r.statusCode).toBe(404);
      expect(JSON.parse(r.body!)).toEqual({ error: 'invite_links_disabled' });
    }
  });
});

describe('/auth/join.js', () => {
  it('is served as JavaScript from this origin', async () => {
    const t = setup();
    const r = await t.handler(ev('GET', '/auth/join.js'));
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/javascript');
    expect(r.body).toBe(JOIN_SCRIPT);
  });

  it('posts the form with the x-amz-content-sha256 header CloudFront OAC requires', async () => {
    let listener: ((e: unknown) => Promise<void>) | undefined;
    const doc = {
      title: '',
      documentElement: { dataset: {} as Record<string, string> },
      body: { replaced: [] as unknown[], replaceChildren(...n: unknown[]) { this.replaced = n; } },
      addEventListener: (_: string, fn: (e: unknown) => Promise<void>) => (listener = fn),
    };
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
    const sandbox = {
      document: doc,
      crypto: webcrypto,
      TextEncoder,
      URLSearchParams,
      Uint8Array,
      FormData: class { constructor(public f: { fields: [string, string][] }) {} [Symbol.iterator]() { return this.f.fields[Symbol.iterator](); } },
      DOMParser: class { parseFromString() { return { title: 'Account creato', body: { childNodes: ['node'] } }; } },
      fetch: async (url: string, init: never) => {
        calls.push({ url, init });
        return { text: async () => '<html></html>' };
      },
      alert: () => { throw new Error('alert'); },
    };
    runInNewContext(JOIN_SCRIPT, sandbox);
    runInNewContext(JOIN_SCRIPT, sandbox); // loaded twice (re-rendered page): still one listener
    expect(doc.documentElement.dataset.joinBound).toBe('1');
    const button = { disabled: false };
    let prevented = false;
    await listener!({
      target: { tagName: 'FORM', fields: [['c', 'tok'], ['password', 'p w']], querySelector: () => button, getAttribute: () => '/auth/join' },
      preventDefault: () => (prevented = true),
    });
    const body = 'c=tok&password=p+w';
    expect(prevented).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/auth/join');
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-amz-content-sha256': createHash('sha256').update(body).digest('hex') },
    });
    expect(doc.title).toBe('Account creato');
    expect(doc.body.replaced).toEqual(['node']);
  });
});

describe('campaign config', () => {
  const base = {
    userPoolId: 'p',
    clientId: 'c',
    cognitoDomain: 'x.auth.eu-central-1.amazoncognito.com',
    region: 'eu-central-1',
    appHosts: ['d111111abcdef8.cloudfront.net'],
  };
  const parse = (inviteLinks: unknown) => parseConfig(JSON.stringify({ ...base, inviteLinks }));

  it('absent -> feature disabled', () => {
    expect(parseConfig(JSON.stringify(base)).inviteLinks).toBeUndefined();
  });
  it('valid block is kept as is', () => {
    expect(parse(INVITE_LINKS).inviteLinks).toEqual(INVITE_LINKS);
  });
  it('rejects bad values', () => {
    const bad: Record<string, unknown>[] = [
      { ...INVITE_LINKS, tableName: '' },
      { ...INVITE_LINKS, tableName: 'a b' },
      { ...INVITE_LINKS, defaultTtlHours: 0 },
      { ...INVITE_LINKS, defaultTtlHours: -1 },
      { ...INVITE_LINKS, maxTtlHours: 1.5 },
      { ...INVITE_LINKS, maxMaxUses: '50' },
      { ...INVITE_LINKS, originTableName: undefined },
      { ...INVITE_LINKS, nameMaxLength: 0 },
      { ...INVITE_LINKS, publicNoteMaxLength: 1.5 },
      { ...INVITE_LINKS, internalNoteMaxLength: undefined },
      { ...INVITE_LINKS, joinDescription: '  ' },
      { ...INVITE_LINKS, defaultTtlHours: 721 }, // default > max
      { ...INVITE_LINKS, defaultMaxUses: 51 }, // default > max
      { ...INVITE_LINKS, joinRateLimit: undefined },
      { ...INVITE_LINKS, joinRateLimit: { attempts: 0, windowSeconds: 60 } },
      { ...INVITE_LINKS, joinRateLimit: { attempts: 5 } },
    ];
    for (const b of bad) expect(() => parse(b), JSON.stringify(b)).toThrow(/inviteLinks/);
    for (const v of [null, 'x', [], 5]) expect(() => parse(v)).toThrow(/inviteLinks/);
  });
});
