import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SESSION_COOKIE } from '../../../edge/session-core.js';
import { setup, ev, token, ADMIN_EMAIL } from './fakes.js';
import { decodeUid } from '../src/handler.js';
import { createInMemoryLimiter } from '../src/limiter.js';
import { GithubError } from '../src/github.js';

const cookie = (t: string) => [`${SESSION_COOKIE}=${t}`];
const admin = () => token('sub-admin', ADMIN_EMAIL, { adm: true, ds: ['*'] });
const member = (email = 'member@example.com') => token('sub-m', email, { adm: false, ds: ['aws-dva-c02'] });
const ctx = (t: string) => ({ cookies: cookie(t) });

describe('authorization layers', () => {
  it('no cookie -> 401', async () => {
    const t = setup();
    expect((await t.handler(ev('GET', '/api/admin/users'))).statusCode).toBe(401);
  });
  it('valid session without the admin group -> 403', async () => {
    const t = setup();
    t.cognito.addUser({ username: 'member@example.com', email: 'member@example.com', status: 'CONFIRMED', enabled: true, groups: ['ds-aws-dva-c02'] });
    expect((await t.handler(ev('GET', '/api/admin/users', ctx(member())))).statusCode).toBe(403);
  });
  it('forged adm=true claim but no live admin group -> 403 (defence in depth)', async () => {
    const t = setup();
    // No `admin` group in Cognito for this user, even though the cookie says adm=true.
    const forged = token('sub-m', 'member@example.com', { adm: true, ds: ['*'] });
    expect((await t.handler(ev('GET', '/api/admin/users', ctx(forged)))).statusCode).toBe(403);
  });
  it('admin -> 200 on GET users', async () => {
    const t = setup();
    const r = await t.handler(ev('GET', '/api/admin/users', ctx(admin())));
    expect(r.statusCode).toBe(200);
    const key = Buffer.from(ADMIN_EMAIL).toString('base64url');
    expect(JSON.parse(r.body!)).toEqual({
      users: [{ key, email: ADMIN_EMAIL, status: 'CONFIRMED', enabled: true, groups: ['admin', 'ds-all'] }],
    });
  });
});

describe('CSRF / origin on mutations', () => {
  it('rejects a cross-site origin', async () => {
    const t = setup();
    const r = await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), headers: { origin: 'https://evil.example' }, body: '{}' }));
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body!)).toEqual({ error: 'bad_origin' });
  });
  it('requires the x-qz-csrf header', async () => {
    const t = setup();
    const r = await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), headers: { 'x-qz-csrf': '' }, body: '{}' }));
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body!)).toEqual({ error: 'csrf' });
  });
  it('rejects a cross-site sec-fetch-site', async () => {
    const t = setup();
    const r = await t.handler(ev('GET', '/api/admin/users', { ...ctx(admin()), headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(r.statusCode).toBe(200); // GET is not a mutation
    const m = await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), headers: { 'sec-fetch-site': 'cross-site' }, body: '{"email":"a@b.co"}' }));
    expect(m.statusCode).toBe(403);
  });
});

describe('invite', () => {
  const body = (o: Record<string, unknown>) => JSON.stringify(o);
  it('creates the user, adds groups and audits', async () => {
    const t = setup();
    const r = await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: body({ email: 'new@example.com', groups: ['ds-aws-dva-c02', 'ds-all'] }) }));
    expect(r.statusCode).toBe(201);
    expect(t.cognito.created).toEqual([{ username: 'new@example.com', email: 'new@example.com' }]);
    expect(await t.cognito.listGroupsForUser('new@example.com')).toEqual(['ds-aws-dva-c02', 'ds-all']);
    expect(t.audit.some((e) => e.action === 'invite' && e.target === 'new@example.com' && e.actor === ADMIN_EMAIL)).toBe(true);
    // the audit record is written before the response (it is in the log)
    expect(t.logs.some((l) => l.evt === 'admin_action')).toBe(true);
  });
  it('duplicate -> 409', async () => {
    const t = setup();
    const r = await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: body({ email: ADMIN_EMAIL }) }));
    expect(r.statusCode).toBe(409);
  });
  it('bad e-mail / bad group -> 400', async () => {
    const t = setup();
    expect((await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: body({ email: 'nope' }) }))).statusCode).toBe(400);
    expect((await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: body({ email: 'x@y.co', groups: ['ds-BAD'] }) }))).statusCode).toBe(400);
    expect((await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: 'not json' }))).statusCode).toBe(400);
  });
  it('mule-mcd-01 requires confirmMcd', async () => {
    const t = setup();
    const without = await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: body({ email: 'm@example.com', groups: ['ds-mule-mcd-01'] }) }));
    expect(without.statusCode).toBe(400);
    expect(JSON.parse(without.body!)).toEqual({ error: 'mcd_confirmation_required' });
    const withConfirm = await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: body({ email: 'm@example.com', groups: ['ds-mule-mcd-01'], confirmMcd: true }) }));
    expect(withConfirm.statusCode).toBe(201);
  });
  it('rate limited -> 429', async () => {
    const t = setup({ limiter: () => false });
    const r = await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: body({ email: 'x@y.co' }) }));
    expect(r.statusCode).toBe(429);
  });
});

describe('groups', () => {
  const key = (email: string) => Buffer.from(email).toString('base64url');
  it('replaces the groups of another user', async () => {
    const t = setup();
    t.cognito.addUser({ username: 'member@example.com', email: 'member@example.com', status: 'CONFIRMED', enabled: true, groups: ['ds-aws-dva-c02'] });
    const r = await t.handler(ev('PUT', `/api/admin/users/${key('member@example.com')}/groups`, { ...ctx(admin()), body: JSON.stringify({ groups: ['ds-all'] }) }));
    expect(r.statusCode).toBe(200);
    expect(await t.cognito.listGroupsForUser('member@example.com')).toEqual(['ds-all']);
    expect(t.audit.some((e) => e.action === 'groups')).toBe(true);
  });
  it('self-lockout: an admin cannot drop their own admin group', async () => {
    const t = setup();
    const r = await t.handler(ev('PUT', `/api/admin/users/${key(ADMIN_EMAIL)}/groups`, { ...ctx(admin()), body: JSON.stringify({ groups: ['ds-all'] }) }));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body!)).toEqual({ error: 'self_lockout' });
  });
  it('adding mule-mcd-01 requires confirmMcd', async () => {
    const t = setup();
    t.cognito.addUser({ username: 'member@example.com', email: 'member@example.com', status: 'CONFIRMED', enabled: true, groups: [] });
    const r = await t.handler(ev('PUT', `/api/admin/users/${key('member@example.com')}/groups`, { ...ctx(admin()), body: JSON.stringify({ groups: ['ds-mule-mcd-01'] }) }));
    expect(r.statusCode).toBe(400);
  });
  it('invalid group -> 400, invalid uid -> 400', async () => {
    const t = setup();
    expect((await t.handler(ev('PUT', `/api/admin/users/${key('member@example.com')}/groups`, { ...ctx(admin()), body: JSON.stringify({ groups: ['nope'] }) }))).statusCode).toBe(400);
    expect((await t.handler(ev('PUT', '/api/admin/users/x/groups', { ...ctx(admin()), body: JSON.stringify({ groups: [] }) }))).statusCode).toBe(400);
  });
});

describe('user actions', () => {
  const key = (email: string) => Buffer.from(email).toString('base64url');
  it('disable / enable / signout / reset / resend another user', async () => {
    const t = setup();
    t.cognito.addUser({ username: 'member@example.com', email: 'member@example.com', status: 'CONFIRMED', enabled: true, groups: ['ds-aws-dva-c02'] });
    const k = key('member@example.com');
    for (const verb of ['disable', 'enable', 'signout', 'reset', 'resend']) {
      const r = await t.handler(ev('POST', `/api/admin/users/${k}/${verb}`, ctx(admin())));
      expect(r.statusCode, verb).toBe(200);
    }
    expect(t.cognito.actions).toContain('disable:member@example.com');
    expect(t.cognito.actions).toContain('enable:member@example.com');
    expect(t.cognito.actions).toContain('signout:member@example.com');
    expect(t.cognito.actions).toContain('reset:member@example.com');
    expect(t.cognito.resends).toContain('member@example.com');
  });
  it('self-lockout: cannot disable or delete yourself', async () => {
    const t = setup();
    const k = key(ADMIN_EMAIL);
    expect((await t.handler(ev('POST', `/api/admin/users/${k}/disable`, ctx(admin())))).statusCode).toBe(400);
    expect((await t.handler(ev('DELETE', `/api/admin/users/${k}`, ctx(admin())))).statusCode).toBe(400);
  });
  it('delete another user', async () => {
    const t = setup();
    t.cognito.addUser({ username: 'member@example.com', email: 'member@example.com', status: 'CONFIRMED', enabled: true, groups: [] });
    const r = await t.handler(ev('DELETE', `/api/admin/users/${key('member@example.com')}`, ctx(admin())));
    expect(r.statusCode).toBe(200);
    expect(t.cognito.users.has('member@example.com')).toBe(false);
  });
});

describe('overview, audit and routing', () => {
  it('overview counts users by status', async () => {
    const t = setup();
    t.cognito.addUser({ username: 'p@example.com', email: 'p@example.com', status: 'FORCE_CHANGE_PASSWORD', enabled: true, groups: [] });
    t.cognito.addUser({ username: 'd@example.com', email: 'd@example.com', status: 'CONFIRMED', enabled: false, groups: [] });
    const r = await t.handler(ev('GET', '/api/admin/overview', ctx(admin())));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!)).toEqual({ datasets: ['aws-dva-c02', 'mule-mcd-01'], users: { total: 3, confirmed: 1, pending: 1, disabled: 1 } });
  });
  it('audit returns the recorded actions', async () => {
    const t = setup();
    await t.handler(ev('POST', '/api/admin/users', { ...ctx(admin()), body: JSON.stringify({ email: 'new@example.com' }) }));
    const r = await t.handler(ev('GET', '/api/admin/audit?days=30', ctx(admin())));
    expect(r.statusCode).toBe(200);
    const entries = JSON.parse(r.body!).entries as { action: string }[];
    expect(entries.some((e) => e.action === 'invite')).toBe(true);
  });
  it('unknown route -> 404, wrong method -> 405', async () => {
    const t = setup();
    expect((await t.handler(ev('GET', '/api/admin/nope', ctx(admin())))).statusCode).toBe(404);
    const r = await t.handler(ev('GET', `/api/admin/users/${Buffer.from(ADMIN_EMAIL).toString('base64url')}/disable`, ctx(admin())));
    expect(r.statusCode).toBe(405);
  });
  it('admin access is re-checked live and cached for 60s', async () => {
    const t = setup();
    expect((await t.handler(ev('GET', '/api/admin/users', ctx(admin())))).statusCode).toBe(200);
    // removed from the group: still cached
    t.cognito.users.get(ADMIN_EMAIL)!.groups = ['ds-all'];
    expect((await t.handler(ev('GET', '/api/admin/users', ctx(admin())))).statusCode).toBe(200);
    t.advance(61);
    expect((await t.handler(ev('GET', '/api/admin/users', ctx(admin())))).statusCode).toBe(403);
  });
});

describe('dataset editor', () => {
  const repo = 'o/quizzer-dataset-aws-dva-c02';
  const file = 'questions.json';
  const q1 = { id: 1, text: 'Q1', options: [{ text: 'A', correct: true }, { text: 'B', correct: false }], selectCount: 1, explanation: 'E1' };
  const q2 = { id: 2, text: 'Q2', options: [{ text: 'A', correct: true }, { text: 'B', correct: false }], selectCount: 1 };
  const seed = (t: ReturnType<typeof setup>) => t.github.seed(repo, file, JSON.stringify([q1, q2], null, 2) + '\n');
  const url = (qid = 1) => `/api/admin/datasets/aws-dva-c02/questions/${qid}`;

  it('lists the editable datasets', async () => {
    const t = setup();
    const r = await t.handler(ev('GET', '/api/admin/datasets', ctx(admin())));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!)).toEqual({
      datasets: [
        { id: 'aws-dva-c02', repo: 'o/quizzer-dataset-aws-dva-c02' },
        { id: 'mule-mcd-01', repo: 'o/quizzer-dataset-mule-mcd-01' },
      ],
    });
  });

  it('GET returns the repo version and sha', async () => {
    const t = setup();
    const sha = seed(t);
    const r = await t.handler(ev('GET', url(), ctx(admin())));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!)).toEqual({ sha, question: q1 });
  });

  it('PUT commits one edited question and preserves the rest', async () => {
    const t = setup();
    const sha = seed(t);
    const edited = {
      ...q1,
      text: 'Q1 fixed',
      options: [{ text: 'A', correct: false }, { text: 'B', correct: true }],
      selectCount: 1,
      sourceNumber: '7',
    };
    const r = await t.handler(ev('PUT', url(), { ...ctx(admin()), body: JSON.stringify({ baseSha: sha, question: edited }) }));
    expect(r.statusCode).toBe(200);
    expect(t.github.commits).toHaveLength(1);
    expect(t.github.commits[0]!.message).toContain('edit question 1');
    const content = JSON.parse(t.github.files.get(`${repo}/${file}`)!.content) as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ id: 1, text: 'Q1 fixed', selectCount: 1, sourceNumber: '7' });
    expect(content[1]).toMatchObject({ id: 2, text: 'Q2' });
    expect(t.audit.some((e) => e.action === 'question_edit' && e.target === 'aws-dva-c02#1')).toBe(true);
  });

  it('rejects a stale baseSha with 409', async () => {
    const t = setup();
    seed(t);
    const r = await t.handler(ev('PUT', url(), { ...ctx(admin()), body: JSON.stringify({ baseSha: 'stale', question: q1 }) }));
    expect(r.statusCode).toBe(409);
    expect(t.github.commits).toHaveLength(0);
  });

  it('rejects an invalid edit (selectCount / id) with 400', async () => {
    const t = setup();
    const sha = seed(t);
    const badCount = { ...q1, selectCount: 2 };
    const r1 = await t.handler(ev('PUT', url(), { ...ctx(admin()), body: JSON.stringify({ baseSha: sha, question: badCount }) }));
    expect(r1.statusCode).toBe(400);
    expect(JSON.parse(r1.body!).reason).toBe('select_count');
    const changedId = { ...q1, id: 2 };
    const r2 = await t.handler(ev('PUT', url(), { ...ctx(admin()), body: JSON.stringify({ baseSha: sha, question: changedId }) }));
    expect(r2.statusCode).toBe(400);
    expect(t.github.commits).toHaveLength(0);
  });

  it('admin-only and unknown dataset', async () => {
    const t = setup();
    t.github.seed(repo, file, '[]');
    expect((await t.handler(ev('GET', url(), ctx(member())))).statusCode).toBe(403);
    expect((await t.handler(ev('GET', '/api/admin/datasets/nope/questions/1', ctx(admin())))).statusCode).toBe(404);
    expect((await t.handler(ev('GET', '/api/admin/datasets/aws-dva-c02/questions/999', ctx(admin())))).statusCode).toBe(404);
  });

  it('maps a GitHub failure to 502', async () => {
    const t = setup();
    const sha = seed(t);
    const original = t.github.putFile.bind(t.github);
    t.github.putFile = async () => { throw new GithubError(500); };
    const r = await t.handler(ev('PUT', url(), { ...ctx(admin()), body: JSON.stringify({ baseSha: sha, question: q1 }) }));
    expect(r.statusCode).toBe(502);
    t.github.putFile = original;
  });

  const put = (t: ReturnType<typeof setup>, sha: string, question: unknown, qid = 1) =>
    t.handler(ev('PUT', url(qid), { ...ctx(admin()), body: JSON.stringify({ baseSha: sha, question }) }));
  const stored = (t: ReturnType<typeof setup>) =>
    JSON.parse(t.github.files.get(`${repo}/${file}`)!.content) as Array<Record<string, unknown>>;

  describe('options and images', () => {
    const withImages = {
      id: 1,
      text: 'Pick',
      image: 'images/q001.jpeg',
      options: [
        { text: '', correct: true, image: 'images/q001_A.jpeg' },
        { text: 'B', correct: false },
        { text: '', correct: false, image: 'images/q001_C.jpeg' },
      ],
      selectCount: 1,
      explanationImage: 'images/q001_expl.jpeg',
    };
    const seedImages = (t: ReturnType<typeof setup>) => t.github.seed(repo, file, JSON.stringify([withImages, q2], null, 2) + '\n');

    it('keeps the stored image paths when options are edited', async () => {
      const t = setup();
      const sha = seedImages(t);
      const edited = { ...withImages, text: 'Pick one', options: [withImages.options[0], { text: 'B2', correct: false }, withImages.options[2]] };
      const r = await put(t, sha, edited);
      expect(r.statusCode).toBe(200);
      const q = stored(t)[0]!;
      expect(q.image).toBe('images/q001.jpeg');
      expect(q.explanationImage).toBe('images/q001_expl.jpeg');
      expect(q.options).toEqual([
        { text: '', correct: true, image: 'images/q001_A.jpeg' },
        { text: 'B2', correct: false },
        { text: '', correct: false, image: 'images/q001_C.jpeg' },
      ]);
    });

    it('still works after an option is removed (images follow their path, not the index)', async () => {
      const t = setup();
      const sha = seedImages(t);
      const edited = { ...withImages, options: [withImages.options[0], withImages.options[2]] };
      expect((await put(t, sha, edited)).statusCode).toBe(200);
      expect(stored(t)[0]!.options).toEqual([
        { text: '', correct: true, image: 'images/q001_A.jpeg' },
        { text: '', correct: false, image: 'images/q001_C.jpeg' },
      ]);
    });

    it('drops an image path the question does not already use, and extra fields', async () => {
      const t = setup();
      const sha = seedImages(t);
      const edited = {
        ...withImages,
        options: [
          { text: 'A', correct: true, image: 'https://evil.example/x.png', extra: 1 },
          { text: 'B', correct: false, image: '../other/secret.png' },
        ],
        selectCount: 1,
        image: 'https://evil.example/q.png',
        explanationImage: 'https://evil.example/e.png',
        injected: 'x',
      };
      expect((await put(t, sha, edited)).statusCode).toBe(200);
      const q = stored(t)[0]!;
      expect(q.options).toEqual([{ text: 'A', correct: true }, { text: 'B', correct: false }]);
      expect(q.image).toBe('images/q001.jpeg');
      expect(q.explanationImage).toBe('images/q001_expl.jpeg');
      expect(q).not.toHaveProperty('injected');
    });

    it('an image-only option is valid only through a stored image', async () => {
      const t = setup();
      const sha = seedImages(t);
      const edited = { ...withImages, options: [{ text: '', correct: true }, { text: 'B', correct: false }] };
      const r = await put(t, sha, edited);
      expect(r.statusCode).toBe(400);
      expect(JSON.parse(r.body!).reason).toBe('option_text');
    });
  });

  describe('validation', () => {
    const cases: Array<[string, (q: typeof q1) => unknown, string]> = [
      ['empty text', (q) => ({ ...q, text: '  ' }), 'text'],
      ['one option', (q) => ({ ...q, options: [q.options[0]] }), 'options'],
      ['options not an array', (q) => ({ ...q, options: 'x' }), 'options'],
      ['option not an object', (q) => ({ ...q, options: [q.options[0], 5] }), 'option_shape'],
      ['option correct not boolean', (q) => ({ ...q, options: [q.options[0], { text: 'B', correct: 'no' }] }), 'option_correct'],
      ['option text empty', (q) => ({ ...q, options: [q.options[0], { text: ' ', correct: false }] }), 'option_text'],
      ['no correct option', (q) => ({ ...q, options: [{ text: 'A', correct: false }, { text: 'B', correct: false }], selectCount: 0 }), 'no_correct'],
      ['sourceNumber too long', (q) => ({ ...q, sourceNumber: 'x'.repeat(41) }), 'source_number'],
      ['sourceNumber not a string', (q) => ({ ...q, sourceNumber: 7 }), 'source_number'],
      ['explanation not a string', (q) => ({ ...q, explanation: 7 }), 'explanation'],
    ];
    it.each(cases)('rejects %s', async (_name, make, reason) => {
      const t = setup();
      const sha = seed(t);
      const r = await put(t, sha, make(q1));
      expect(r.statusCode).toBe(400);
      expect(JSON.parse(r.body!).reason).toBe(reason);
      expect(t.github.commits).toHaveLength(0);
    });

    it('a legacy invalid question elsewhere in the file does not block an edit', async () => {
      const t = setup();
      const legacy = { id: 3, text: 'Legacy', options: [{ text: 'A', correct: true }], selectCount: 5 };
      const sha = t.github.seed(repo, file, JSON.stringify([q1, q2, legacy]));
      const r = await put(t, sha, { ...q1, text: 'Q1 ok' });
      expect(r.statusCode).toBe(200);
      expect(stored(t)[2]).toEqual(legacy);
    });

    it('rejects a non-object question and a missing body', async () => {
      const t = setup();
      const sha = seed(t);
      expect((await put(t, sha, [1])).statusCode).toBe(400);
      expect((await put(t, sha, null)).statusCode).toBe(400);
      const r = await t.handler(ev('PUT', url(), { ...ctx(admin()), body: '{not json' }));
      expect(JSON.parse(r.body!).error).toBe('bad_json');
    });
  });

  describe('request guards', () => {
    it('accepts a long explanation (above the 8 KiB default) up to the editor limit', async () => {
      const t = setup();
      const sha = seed(t);
      const r = await put(t, sha, { ...q1, explanation: 'x'.repeat(20_000) });
      expect(r.statusCode).toBe(200);
      expect((stored(t)[0]!.explanation as string).length).toBe(20_000);
    });

    it('rejects a body above the editor limit', async () => {
      const t = setup();
      const sha = seed(t);
      const r = await put(t, sha, { ...q1, explanation: 'x'.repeat(70_000) });
      expect(r.statusCode).toBe(400);
      expect(JSON.parse(r.body!).error).toBe('bad_json');
    });

    it('PUT needs the CSRF header and a same-origin request', async () => {
      const t = setup();
      const sha = seed(t);
      const body = JSON.stringify({ baseSha: sha, question: q1 });
      const noCsrf = ev('PUT', url(), { ...ctx(admin()), body });
      delete noCsrf.headers!['x-qz-csrf'];
      expect((await t.handler(noCsrf)).statusCode).toBe(403);
      const crossSite = ev('PUT', url(), { ...ctx(admin()), body, headers: { 'sec-fetch-site': 'cross-site' } });
      expect((await t.handler(crossSite)).statusCode).toBe(403);
      expect(t.github.commits).toHaveLength(0);
    });

    it('PUT is rate limited', async () => {
      const t = setup({ limiter: () => false });
      const sha = seed(t);
      const r = await put(t, sha, q1);
      expect(r.statusCode).toBe(429);
      expect(t.github.commits).toHaveLength(0);
    });

    it('an unreadable questions file is a logged 502', async () => {
      const t = setup();
      t.github.seed(repo, file, '{broken');
      const r = await t.handler(ev('GET', url(), ctx(admin())));
      expect(r.statusCode).toBe(502);
      expect(t.logs.some((l) => l.evt === 'github_error')).toBe(true);
    });
  });

  describe('output format', () => {
    it('keeps a compact file compact and adds no trailing newline', async () => {
      const t = setup();
      const raw = JSON.stringify([q1, q2]);
      const sha = t.github.seed(repo, file, raw);
      const r = await put(t, sha, { ...q1, text: 'Q1 fixed' });
      expect(JSON.parse(r.body!).reformatted).toBe(false);
      expect(t.github.files.get(`${repo}/${file}`)!.content).toBe(JSON.stringify([{ ...q1, text: 'Q1 fixed' }, q2]));
    });

    it('keeps 2-space indentation and a trailing newline: a one-question diff', async () => {
      const t = setup();
      const raw = JSON.stringify([q1, q2], null, 2) + '\n';
      const sha = t.github.seed(repo, file, raw);
      await put(t, sha, { ...q1, text: 'Q1 fixed' });
      const out = t.github.files.get(`${repo}/${file}`)!.content;
      expect(out).toBe(JSON.stringify([{ ...q1, text: 'Q1 fixed' }, q2], null, 2) + '\n');
      const changed = out.split('\n').filter((l, i) => l !== raw.split('\n')[i]);
      expect(changed).toEqual(['    "text": "Q1 fixed",']);
    });

    it('keeps tab indentation, CRLF line endings and the BOM', async () => {
      const t = setup();
      const raw = '﻿' + JSON.stringify([q1, q2], null, '\t').replace(/\n/g, '\r\n') + '\r\n';
      const sha = t.github.seed(repo, file, raw);
      const r = await put(t, sha, { ...q1, text: 'Q1 fixed' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body!).reformatted).toBe(false);
      const out = t.github.files.get(`${repo}/${file}`)!.content;
      expect(out.startsWith('﻿[\r\n\t{')).toBe(true);
      expect(out.endsWith('}\r\n]\r\n')).toBe(true);
      expect(out).not.toMatch(/[^\r]\n/);
    });

    it('flags a file whose style cannot be reproduced (escapes) and audits it', async () => {
      const t = setup();
      const raw = '[{"id":1,"text":"caf\\u00e9","options":[{"text":"A","correct":true},{"text":"B","correct":false}],"selectCount":1}]';
      const sha = t.github.seed(repo, file, raw);
      const r = await put(t, sha, { id: 1, text: 'café', options: [{ text: 'A', correct: true }, { text: 'B', correct: false }], selectCount: 1 });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body!).reformatted).toBe(true);
      expect(t.audit.some((e) => e.action === 'question_edit' && e.detail === 'file reformatted')).toBe(true);
    });
  });
});

describe('helpers', () => {
  it('decodeUid round-trips and rejects non-canonical input', () => {
    const uid = Buffer.from('user@example.com').toString('base64url');
    expect(decodeUid(uid)).toBe('user@example.com');
    expect(decodeUid('short')).toBeNull();
    expect(decodeUid('%2e%2e')).toBeNull();
    expect(decodeUid('////')).toBeNull();
  });
  it('in-memory limiter enforces the window', () => {
    let now = 0;
    const limiter = createInMemoryLimiter(() => now);
    expect(limiter('k', 2, 1000)).toBe(true);
    expect(limiter('k', 2, 1000)).toBe(true);
    expect(limiter('k', 2, 1000)).toBe(false);
    now = 1001;
    expect(limiter('k', 2, 1000)).toBe(true);
  });
});

describe('bundle', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  beforeAll(() => {
    execFileSync('node', ['lambda/admin/build.mjs'], { cwd: root, stdio: 'pipe' });
  }, 60_000);
  it('is a single ESM file under 1.5 MiB and exports handler', async () => {
    const f = root + 'lambda/admin/dist/index.mjs';
    expect(statSync(f).size).toBeLessThan(1.5 * 1024 * 1024);
    const src = readFileSync(f, 'utf8');
    expect(src).not.toMatch(/from"@aws-sdk|from "@aws-sdk/);
    process.env.CONFIG_PARAMETER = '/quizzer/prod/config';
    process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/00000000-0000-0000-0000-000000000000';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_LAMBDA_LOG_GROUP_NAME = '/aws/lambda/quizzer-prod-admin';
    const mod = await import(f);
    expect(typeof mod.handler).toBe('function');
  });
});
