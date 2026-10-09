// Validation of the `return` parameter of /auth/login (open-redirect defence).
// Only same-origin relative paths are kept; everything else becomes "/".
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  const p = raw;
  if (p.length === 0 || p.length > 512) return '/';
  if (p[0] !== '/') return '/';
  if (p.startsWith('//') || p.startsWith('/\\')) return '/';
  if (p.includes('\\')) return '/';
  if (/[\x00-\x1f\x7f\s]/.test(p)) return '/';
  if (p.includes('..')) return '/';
  if (/%(2f|5c|2e|00|0d|0a|09)/i.test(p)) return '/';
  if (p === '/auth' || p.startsWith('/auth/') || p.startsWith('/auth?')) return '/';
  // must still parse as a path on our own origin
  try {
    const u = new URL(p, 'https://app.invalid');
    if (u.origin !== 'https://app.invalid') return '/';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/';
  }
}

// Picks the app host for redirect_uri / final redirects. Candidates come from the
// request but are only used if they are in the configured allowlist (CONTRACT.md §5).
export function resolveAppHost(headers: Record<string, string | undefined>, appHosts: string[]): string {
  for (const h of [headers['x-forwarded-host'], headers['host']]) {
    if (!h) continue;
    const host = h.split(',')[0]!.trim().toLowerCase();
    if (appHosts.includes(host)) return host;
  }
  return appHosts[0]!;
}
