// Cognito OAuth2 endpoints used by the auth Lambda (public client + PKCE, no secret).
// https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html
// https://docs.aws.amazon.com/cognito/latest/developerguide/revocation-endpoint.html
// https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html
import { createHash, randomBytes } from 'node:crypto';
import type { Config } from './config.js';

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export interface TokenSet {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export class CognitoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`cognito ${status} ${code}`);
  }
  // 400/401 from the token endpoint = the grant is not usable (revoked, expired, user disabled).
  get isGrantError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export const b64url = (b: Buffer) => b.toString('base64url');
export const newVerifier = (rand: (n: number) => Buffer = randomBytes) => b64url(rand(32)); // 43 chars, RFC 7636 §4.1
export const challengeS256 = (verifier: string) => b64url(createHash('sha256').update(verifier, 'ascii').digest());

export function authorizeUrl(cfg: Config, redirectUri: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://${cfg.cognitoDomain}/oauth2/authorize?${q.toString()}`;
}

export function logoutUrl(cfg: Config, appHost: string): string {
  const q = new URLSearchParams({ client_id: cfg.clientId, logout_uri: `https://${appHost}/signed-out.html` });
  return `https://${cfg.cognitoDomain}/logout?${q.toString()}`;
}

async function post(fetchFn: Fetch, cfg: Config, path: string, form: Record<string, string>) {
  const res = await fetchFn(`https://${cfg.cognitoDomain}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status !== 200) {
    const code = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : 'http_error';
    throw new CognitoError(res.status, code);
  }
  return body;
}

function asTokenSet(body: unknown): TokenSet {
  const b = body as Partial<TokenSet> | null;
  if (!b || typeof b.id_token !== 'string' || typeof b.access_token !== 'string') throw new CognitoError(502, 'bad_token_response');
  return b as TokenSet;
}

export async function exchangeCode(fetchFn: Fetch, cfg: Config, code: string, redirectUri: string, verifier: string) {
  return asTokenSet(
    await post(fetchFn, cfg, '/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  );
}

export async function refreshTokens(fetchFn: Fetch, cfg: Config, refreshToken: string) {
  return asTokenSet(
    await post(fetchFn, cfg, '/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      refresh_token: refreshToken,
    }),
  );
}

export async function revokeToken(fetchFn: Fetch, cfg: Config, refreshToken: string) {
  await post(fetchFn, cfg, '/oauth2/revoke', { token: refreshToken, client_id: cfg.clientId });
}

export interface IdentityClaims {
  sub: string;
  email: string;
  name?: string;
  groups: string[];
}

// The ID token comes straight from the Cognito token endpoint over TLS, so its signature
// does not need to be re-verified (OpenID Connect Core 1.0 §3.1.3.7 step 6); we still
// check issuer, audience, token_use and expiry.
export function readIdToken(idToken: string, cfg: Config, nowSec: number): IdentityClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new CognitoError(502, 'bad_id_token');
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new CognitoError(502, 'bad_id_token');
  }
  const iss = `https://cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`;
  if (p.iss !== iss) throw new CognitoError(502, 'id_token_iss');
  if (p.aud !== cfg.clientId) throw new CognitoError(502, 'id_token_aud');
  if (p.token_use !== 'id') throw new CognitoError(502, 'id_token_use');
  if (typeof p.exp !== 'number' || p.exp <= nowSec) throw new CognitoError(502, 'id_token_exp');
  if (typeof p.sub !== 'string' || typeof p.email !== 'string') throw new CognitoError(502, 'id_token_claims');
  const g = p['cognito:groups'];
  const groups = Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : [];
  const name = typeof p.name === 'string' ? p.name : typeof p.given_name === 'string' ? p.given_name : undefined;
  return { sub: p.sub, email: p.email, ...(name ? { name } : {}), groups };
}
