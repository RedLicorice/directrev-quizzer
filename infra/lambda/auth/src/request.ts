// Request helpers shared by the auth and admin Lambdas.

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Decoded request body, or null when it is longer than `max` characters. Empty body = ''. */
export function rawBody(ev: { body?: string; isBase64Encoded?: boolean }, max: number): string | null {
  if (!ev.body) return '';
  const raw = ev.isBase64Encoded ? Buffer.from(ev.body, 'base64').toString('utf8') : ev.body;
  return raw.length > max ? null : raw;
}

/** `Origin` (when present) must be one of the app hosts and `Sec-Fetch-Site` (when present) same-origin. */
export function isSameOrigin(headers: Record<string, string | undefined>, appHosts: string[]): boolean {
  const origin = headers['origin'];
  const site = headers['sec-fetch-site'];
  return !((origin && !appHosts.some((h) => origin === `https://${h}`)) || (site && site !== 'same-origin'));
}
