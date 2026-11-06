import { describe, it, expect, afterEach, vi } from 'vitest';
import { createGithubClient, GithubError } from '../src/github.js';
import { parseConfig } from '../../auth/src/config.js';
import { detectJsonStyle } from '../src/jsonStyle.js';

const TOKEN = 'github_pat_SECRET_0123456789';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function mockFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  });
  return calls;
}
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('github client', () => {
  const client = createGithubClient(async () => TOKEN);

  it('getFile decodes base64 as UTF-8 and sends the token only as a bearer header', async () => {
    const calls = mockFetch(() => jsonRes(200, { sha: 'abc', content: b64('[{"text":"perché ✓"}]\n') }));
    const f = await client.getFile('o/r', 'dir/questions.json');
    expect(f).toEqual({ sha: 'abc', content: '[{"text":"perché ✓"}]\n' });
    expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/contents/dir/questions.json?ref=main');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.url).not.toContain(TOKEN);
  });

  it('getFile url-encodes each path segment', async () => {
    const calls = mockFetch(() => jsonRes(200, { sha: 's', content: b64('[]') }));
    await client.getFile('o/r', 'a b/c#d.json');
    expect(calls[0]!.url).toContain('/contents/a%20b/c%23d.json?ref=main');
  });

  it('getFile returns null on 404 and throws GithubError otherwise', async () => {
    mockFetch(() => new Response('', { status: 404 }));
    expect(await client.getFile('o/r', 'x.json')).toBeNull();
    mockFetch(() => new Response('', { status: 401 }));
    await expect(client.getFile('o/r', 'x.json')).rejects.toMatchObject({ status: 401 });
  });

  it('getFile fails loudly on a file above the 1 MB contents limit (empty content)', async () => {
    mockFetch(() => jsonRes(200, { sha: 's', content: '', size: 2_000_000, encoding: 'none' }));
    const err = await client.getFile('o/r', 'big.json').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect((err as GithubError).status).toBe(413);
  });

  it('getFile accepts a genuinely empty file', async () => {
    mockFetch(() => jsonRes(200, { sha: 's', content: '', size: 0 }));
    expect(await client.getFile('o/r', 'empty.json')).toEqual({ sha: 's', content: '' });
  });

  describe('commitFiles', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    // A tiny GitHub: head commit H, its tree T with three files; records every write.
    function fakeGithub(opts: { currentSha?: string; patchStatus?: number } = {}) {
      const posts: Array<{ url: string; method: string; body: any }> = [];
      const calls = mockFetch((url, init) => {
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(init.body as string) : undefined;
        posts.push({ url, method, body });
        if (url.endsWith('/git/ref/heads/main')) return jsonRes(200, { object: { sha: 'H' } });
        if (url.includes('/contents/questions.json?ref=H')) return jsonRes(200, { sha: opts.currentSha ?? 'qsha', content: b64('[]') });
        if (url.endsWith('/git/commits/H')) return jsonRes(200, { tree: { sha: 'T' } });
        if (url.endsWith('/git/trees/T?recursive=1')) {
          return jsonRes(200, { tree: [
            { path: 'questions.json', type: 'blob' },
            { path: 'images/old.png', type: 'blob' },
            { path: 'images', type: 'tree' },
          ] });
        }
        if (url.endsWith('/git/blobs')) return jsonRes(201, { sha: `blob-${body.content.length}` });
        if (url.endsWith('/git/trees')) return jsonRes(201, { sha: 'T2', tree: [{ path: 'questions.json', sha: 'newq' }] });
        if (url.endsWith('/git/commits')) return jsonRes(201, { sha: 'C2' });
        if (url.endsWith('/git/refs/heads/main')) return opts.patchStatus ? new Response('{}', { status: opts.patchStatus }) : jsonRes(200, {});
        return new Response('', { status: 500 });
      });
      return { calls, posts };
    }

    it('makes ONE commit on top of the head: blobs, tree with deletions, commit, fast-forward only', async () => {
      const { posts } = fakeGithub();
      const out = await client.commitFiles('o/r', {
        message: 'msg',
        expect: { path: 'questions.json', sha: 'qsha' },
        files: [
          { path: 'questions.json', text: 'perché ✓' },
          { path: 'images/new.png', bytes: PNG },
          { path: 'images/old.png', delete: true },
          { path: 'images/missing.png', delete: true },
        ],
      });
      expect(out).toEqual({ commit: 'C2', sha: 'newq' });
      const blobs = posts.filter((p) => p.url.endsWith('/git/blobs'));
      expect(blobs).toHaveLength(2);
      expect(Buffer.from(blobs[0]!.body.content, 'base64').toString('utf8')).toBe('perché ✓');
      expect(Buffer.from(blobs[1]!.body.content, 'base64')).toEqual(PNG);
      const tree = posts.find((p) => p.url.endsWith('/git/trees') && p.method === 'POST')!;
      expect(tree.body.base_tree).toBe('T');
      expect(tree.body.tree).toEqual([
        { path: 'questions.json', mode: '100644', type: 'blob', sha: expect.any(String) },
        { path: 'images/new.png', mode: '100644', type: 'blob', sha: expect.any(String) },
        { path: 'images/old.png', mode: '100644', type: 'blob', sha: null },
      ]);
      const commit = posts.find((p) => p.url.endsWith('/git/commits') && p.method === 'POST')!;
      expect(commit.body).toEqual({ message: 'msg', tree: 'T2', parents: ['H'] });
      const patch = posts.find((p) => p.method === 'PATCH')!;
      expect(patch.body).toEqual({ sha: 'C2', force: false });
    });

    it('skips an image whose (content-addressed) path already exists', async () => {
      const { posts } = fakeGithub();
      await client.commitFiles('o/r', {
        message: 'm',
        expect: { path: 'questions.json', sha: 'qsha' },
        files: [{ path: 'questions.json', text: '[]' }, { path: 'images/old.png', bytes: PNG }],
      });
      expect(posts.filter((p) => p.url.endsWith('/git/blobs'))).toHaveLength(1);
    });

    it('409 when the edited file changed since the editor read it, before writing anything', async () => {
      const { posts } = fakeGithub({ currentSha: 'someone-else' });
      const err = (await client.commitFiles('o/r', { message: 'm', expect: { path: 'questions.json', sha: 'qsha' }, files: [] }).catch((e: unknown) => e)) as GithubError;
      expect(err.status).toBe(409);
      expect(posts.some((p) => p.method === 'POST' || p.method === 'PATCH')).toBe(false);
    });

    it('409 when the branch moved meanwhile (non fast-forward)', async () => {
      fakeGithub({ patchStatus: 422 });
      const err = (await client.commitFiles('o/r', { message: 'm', expect: { path: 'questions.json', sha: 'qsha' }, files: [{ path: 'questions.json', text: '[]' }] }).catch((e: unknown) => e)) as GithubError;
      expect(err.status).toBe(409);
    });

    it('a failed call carries the status and never the token', async () => {
      mockFetch(() => new Response(`bad credentials for ${'x'.repeat(500)}`, { status: 403 }));
      const err = (await client.commitFiles('o/r', { message: 'm', expect: { path: 'q.json', sha: 's' }, files: [] }).catch((e: unknown) => e)) as GithubError;
      expect(err.status).toBe(403);
      expect(err.message).not.toContain(TOKEN);
      expect(err.message.length).toBeLessThan(200);
    });
  });
});

describe('parseConfig datasetRepos', () => {
  const base = {
    userPoolId: 'p',
    clientId: 'c',
    cognitoDomain: 'quizzer-x.auth.us-east-1.amazoncognito.com',
    region: 'us-east-1',
    appHosts: ['d111111abcdef8.cloudfront.net'],
    datasets: ['aws-dva-c02'],
  };
  const parse = (datasetRepos: unknown) => parseConfig(JSON.stringify({ ...base, datasetRepos }));

  it('accepts a valid map and is optional', () => {
    expect(parse({ 'aws-dva-c02': { repo: 'o/r', file: 'questions.json' } }).datasetRepos).toEqual({ 'aws-dva-c02': { repo: 'o/r', file: 'questions.json' } });
    expect(parseConfig(JSON.stringify(base)).datasetRepos).toBeUndefined();
  });

  it.each([
    ['bad repo', { 'aws-dva-c02': { repo: 'not a repo', file: 'q.json' } }],
    ['repo with a path', { 'aws-dva-c02': { repo: 'o/r/extra', file: 'q.json' } }],
    ['.. in the file', { 'aws-dva-c02': { repo: 'o/r', file: '../secrets.json' } }],
    ['absolute-ish file', { 'aws-dva-c02': { repo: 'o/r', file: 'a b.json' } }],
    ['bad dataset id', { 'Bad_ID': { repo: 'o/r', file: 'q.json' } }],
    ['not an object', ['x']],
  ])('rejects %s', (_n, value) => {
    expect(() => parse(value)).toThrow();
  });
});

describe('detectJsonStyle', () => {
  const data = [{ id: 1, text: 'a' }];
  it.each([
    ['compact', JSON.stringify(data)],
    ['compact + newline', JSON.stringify(data) + '\n'],
    ['2 spaces', JSON.stringify(data, null, 2)],
    ['4 spaces + newline', JSON.stringify(data, null, 4) + '\n'],
    ['tabs', JSON.stringify(data, null, '\t')],
  ])('reproduces %s exactly', (_n, raw) => {
    const style = detectJsonStyle(raw);
    expect(style.exact).toBe(true);
    expect(style.stringify(data)).toBe(raw);
  });

  it('is not exact for hand-formatted input, and still returns valid JSON', () => {
    const raw = '[ {"id":1,   "text":"a"} ]';
    const style = detectJsonStyle(raw);
    expect(style.exact).toBe(false);
    expect(JSON.parse(style.stringify(data))).toEqual(data);
  });
});
