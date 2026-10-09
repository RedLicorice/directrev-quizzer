// Same-origin fetch for the AWS build: cookies authenticate, 401 → one refresh + one retry,
// then a redirect to the login; 403 → the dataset is not enabled for this account.

import { AuthRequiredError, login, refreshSession } from './auth/session';

export class DatasetNotEnabledError extends Error {
  readonly status = 403;
  constructor(public readonly url: string) {
    super('Dataset non abilitato per il tuo account (403)');
    this.name = 'DatasetNotEnabledError';
  }
}

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * fetch() with `credentials: 'same-origin'`. Mutating requests get `x-amz-content-sha256`
 * (required by CloudFront OAC in front of Lambda Function URLs; string bodies only).
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if ((method === 'POST' || method === 'PUT') && !headers.has('x-amz-content-sha256')) {
    headers.set('x-amz-content-sha256', await sha256Hex(typeof init.body === 'string' ? init.body : ''));
  }
  const go = () => fetch(url, { ...init, headers, credentials: 'same-origin' });

  let res = await go();
  if (res.status === 401) {
    const session = await refreshSession(); // network errors propagate: no redirect while offline
    if (session) res = await go();
    if (!session || res.status === 401) {
      login();
      throw new AuthRequiredError();
    }
  }
  if (res.status === 403) throw new DatasetNotEnabledError(url);
  return res;
}
