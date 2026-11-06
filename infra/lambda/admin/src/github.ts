// Minimal GitHub Contents API client for the admin editor: read the current questions.json
// and commit one edited file (the dataset repo's publish workflow then updates S3).
// A fine-grained token with Contents: read/write on the dataset repos is stored as an SSM
// SecureString (/quizzer/prod/github-datasets-token); it never reaches the browser.

export interface GithubFile {
  content: string;
  sha: string;
}

export interface GithubClient {
  getFile(repo: string, path: string): Promise<GithubFile | null>;
  putFile(repo: string, path: string, content: string, sha: string, message: string): Promise<{ sha: string; commit: string }>;
}

export class GithubError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message ?? `github ${status}`);
    this.name = 'GithubError';
  }
}

const API = 'https://api.github.com';
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

  return {
    async getFile(repo, path) {
      const res = await fetch(`${API}/repos/${repo}/contents/${encodePath(path)}?ref=main`, { headers: await headers() });
      if (res.status === 404) return null;
      if (!res.ok) throw new GithubError(res.status);
      const body = (await res.json()) as { content?: unknown; sha?: unknown; size?: unknown };
      if (typeof body.sha !== 'string' || typeof body.content !== 'string') throw new GithubError(502, 'github bad response');
      // Above 1 MB the Contents API answers with an empty `content`: fail loudly instead of parsing ''.
      if (body.content === '' && typeof body.size === 'number' && body.size > 0) {
        throw new GithubError(413, `${path} is too large for the GitHub contents API (${body.size} bytes)`);
      }
      return { content: Buffer.from(body.content, 'base64').toString('utf8'), sha: body.sha };
    },

    async putFile(repo, path, content, sha, message) {
      const res = await fetch(`${API}/repos/${repo}/contents/${encodePath(path)}`, {
        method: 'PUT',
        headers: { ...(await headers()), 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          content: Buffer.from(content, 'utf8').toString('base64'),
          sha,
          branch: 'main',
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new GithubError(res.status, `github ${res.status} ${text.slice(0, 160)}`);
      }
      const body = (await res.json()) as { content?: { sha?: unknown }; commit?: { sha?: unknown } };
      return {
        sha: typeof body.content?.sha === 'string' ? body.content.sha : '',
        commit: typeof body.commit?.sha === 'string' ? body.commit.sha : '',
      };
    },
  };
}
