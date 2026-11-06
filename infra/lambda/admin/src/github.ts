// Minimal GitHub client for the admin editor: read a file and commit several files at once
// (questions.json, index.json, images) through the Git Data API, so one edit is ONE commit and
// the dataset repo's validate + publish workflow sees a consistent tree.
// A fine-grained token with Contents: read/write on the dataset repos is stored as an SSM
// SecureString (/quizzer/<env>/github-datasets-token); it never reaches the browser.

export interface GithubFile {
  content: string;
  sha: string;
}

export interface CommitFile {
  path: string;
  /** UTF-8 text content. */
  text?: string;
  /** Binary content (a new image). Skipped when that exact path already exists. */
  bytes?: Buffer;
  /** Delete the file (ignored when it does not exist). */
  delete?: boolean;
}

export interface CommitInput {
  files: CommitFile[];
  message: string;
  /** The file the edit was based on: the commit is refused (409) when it changed meanwhile. */
  expect: { path: string; sha: string };
}

export interface GithubClient {
  getFile(repo: string, path: string, ref?: string): Promise<GithubFile | null>;
  commitFiles(repo: string, input: CommitInput): Promise<{ commit: string; sha: string }>;
}

export class GithubError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message ?? `github ${status}`);
    this.name = 'GithubError';
  }
}

const API = 'https://api.github.com';
const BRANCH = 'main';
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function createGithubClient(getToken: () => Promise<string>): GithubClient {
  async function headers(): Promise<Record<string, string>> {
    return {
      authorization: `Bearer ${await getToken()}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'quizzer-admin',
    };
  }

  async function getFile(repo: string, path: string, ref = BRANCH): Promise<GithubFile | null> {
    const res = await fetch(`${API}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, { headers: await headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new GithubError(res.status);
    const body = (await res.json()) as { content?: unknown; sha?: unknown; size?: unknown };
    if (typeof body.sha !== 'string' || typeof body.content !== 'string') throw new GithubError(502, 'github bad response');
    // Above 1 MB the Contents API answers with an empty `content`: fail loudly instead of parsing ''.
    if (body.content === '' && typeof body.size === 'number' && body.size > 0) {
      throw new GithubError(413, `${path} is too large for the GitHub contents API (${body.size} bytes)`);
    }
    return { content: Buffer.from(body.content, 'base64').toString('utf8'), sha: body.sha };
  }

  async function call<T>(repo: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}/repos/${repo}/${path}`, {
      method,
      headers: { ...(await headers()), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GithubError(res.status, `github ${res.status} ${text.slice(0, 160)}`);
    }
    return (await res.json()) as T;
  }

  return {
    getFile,

    async commitFiles(repo, { files, message, expect }) {
      const ref = await call<{ object?: { sha?: unknown } }>(repo, 'GET', `git/ref/heads/${BRANCH}`);
      const head = ref.object?.sha;
      if (typeof head !== 'string') throw new GithubError(502, 'github bad response');

      // Everything below is based on `head`: refuse when the edited file is no longer what the editor saw.
      const current = await getFile(repo, expect.path, head);
      if (!current || current.sha !== expect.sha) throw new GithubError(409);

      const commit = await call<{ tree?: { sha?: unknown } }>(repo, 'GET', `git/commits/${head}`);
      const baseTree = commit.tree?.sha;
      if (typeof baseTree !== 'string') throw new GithubError(502, 'github bad response');
      const listing = await call<{ tree?: Array<{ path?: string; type?: string }> }>(repo, 'GET', `git/trees/${baseTree}?recursive=1`);
      const existing = new Set((listing.tree ?? []).filter((e) => e.type === 'blob').map((e) => e.path));

      const entries: Array<{ path: string; mode: string; type: 'blob'; sha: string | null }> = [];
      for (const f of files) {
        if (f.delete) {
          if (existing.has(f.path)) entries.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
          continue;
        }
        if (f.bytes && existing.has(f.path)) continue; // content-addressed name: same bytes already there
        const content = f.bytes ? f.bytes.toString('base64') : Buffer.from(f.text ?? '', 'utf8').toString('base64');
        const blob = await call<{ sha?: unknown }>(repo, 'POST', 'git/blobs', { content, encoding: 'base64' });
        if (typeof blob.sha !== 'string') throw new GithubError(502, 'github bad response');
        entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }

      const tree = await call<{ sha?: unknown; tree?: Array<{ path?: string; sha?: string }> }>(repo, 'POST', 'git/trees', {
        base_tree: baseTree,
        tree: entries,
      });
      if (typeof tree.sha !== 'string') throw new GithubError(502, 'github bad response');
      const created = await call<{ sha?: unknown }>(repo, 'POST', 'git/commits', { message, tree: tree.sha, parents: [head] });
      if (typeof created.sha !== 'string') throw new GithubError(502, 'github bad response');
      try {
        await call(repo, 'PATCH', `git/refs/heads/${BRANCH}`, { sha: created.sha, force: false });
      } catch (e) {
        // Not a fast-forward: somebody pushed in between.
        if (e instanceof GithubError && (e.status === 422 || e.status === 409)) throw new GithubError(409);
        throw e;
      }
      const mine = tree.tree?.find((t) => t.path === expect.path);
      return { commit: created.sha, sha: typeof mine?.sha === 'string' ? mine.sha : '' };
    },
  };
}
