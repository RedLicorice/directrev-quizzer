// Cookie names and attributes: CONTRACT.md §2.
export const SESSION_COOKIE = '__Host-qz_session';
export const REFRESH_COOKIE = '__Secure-qz_refresh';
export const PKCE_COOKIE = '__Secure-qz_pkce';

type SameSite = 'Lax' | 'Strict';

function serialize(name: string, value: string, path: string, sameSite: SameSite, maxAge: number): string {
  return `${name}=${value}; Path=${path}; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

export const sessionCookie = (jwt: string, ttl: number) => serialize(SESSION_COOKIE, jwt, '/', 'Lax', ttl);
export const refreshCookie = (token: string, days: number) => serialize(REFRESH_COOKIE, token, '/auth', 'Strict', days * 86400);
export const pkceCookie = (blob: string) => serialize(PKCE_COOKIE, blob, '/auth', 'Lax', 600);

export const clearSession = () => serialize(SESSION_COOKIE, '', '/', 'Lax', 0);
export const clearRefresh = () => serialize(REFRESH_COOKIE, '', '/auth', 'Strict', 0);
export const clearPkce = () => serialize(PKCE_COOKIE, '', '/auth', 'Lax', 0);

// Lambda Function URL events (payload 2.0) carry cookies as an array of "name=value".
export function getCookie(cookies: string[] | undefined, name: string): string | null {
  if (!cookies) return null;
  for (const c of cookies) {
    for (const part of c.split(';')) {
      const p = part.trim();
      const i = p.indexOf('=');
      if (i > 0 && p.slice(0, i) === name) return p.slice(i + 1);
    }
  }
  return null;
}
