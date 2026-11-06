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

  it('putFile sends base64 UTF-8 content, the base sha and the main branch', async () => {
    const calls = mockFetch(() => jsonRes(200, { content: { sha: 'new' }, commit: { sha: 'c1' } }));
    const out = await client.putFile('o/r', 'questions.json', 'perché ✓', 'old', 'msg');
    expect(out).toEqual({ sha: 'new', commit: 'c1' });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(calls[0]!.init.method).toBe('PUT');
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('perché ✓');
    expect(body).toMatchObject({ sha: 'old', message: 'msg', branch: 'main' });
  });

  it('a failed putFile carries the status and never the token', async () => {
    mockFetch(() => new Response(`bad credentials for ${'x'.repeat(500)}`, { status: 403 }));
    const err = (await client.putFile('o/r', 'q.json', '[]', 's', 'm').catch((e: unknown) => e)) as GithubError;
    expect(err.status).toBe(403);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message.length).toBeLessThan(200);
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
