// Minimal Italian pages (no scripts: compatible with the CSP `script-src 'self'`).
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{max-width:28rem;background:#1e293b;border-radius:12px;padding:24px}a{color:#38bdf8}h1{font-size:1.25rem;margin-top:0}</style>
</head><body><main>${body}</main></body></html>`;
}

export const notEnabledPage = (email: string) =>
  page(
    'Accesso non abilitato',
    `<h1>Accesso non abilitato</h1>
<p>L'account <strong>${esc(email)}</strong> esiste ma non è abilitato a nessun dataset.</p>
<p>Chiedi all'amministratore di abilitarti, poi <a href="/auth/logout">esci</a> e accedi di nuovo.</p>`,
  );

export const loginErrorPage = (reason: string) =>
  page(
    'Accesso non riuscito',
    `<h1>Accesso non riuscito</h1>
<p>${esc(reason)}</p>
<p><a href="/auth/login">Riprova ad accedere</a></p>`,
  );
