// Minimal Italian pages (no scripts: compatible with the CSP `script-src 'self'`).
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{max-width:28rem;background:#1e293b;border-radius:12px;padding:24px}a{color:#38bdf8}h1{font-size:1.25rem;margin-top:0}
label{display:block;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:inherit;font:inherit}
button{margin-top:16px;padding:8px 16px;border:0;border-radius:6px;background:#38bdf8;color:#0f172a;font:inherit;font-weight:600;cursor:pointer}.err{color:#fca5a5}</style>
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

// Invite links (/auth/join). The link state is never told apart: every invalid link gets the same page.
export const joinInvalidPage = () =>
  page('Link non valido', `<h1>Link non valido o scaduto</h1>\n<p>Chiedi all'amministratore un nuovo link di invito.</p>`);

export const joinBusyPage = () =>
  page('Troppi tentativi', `<h1>Troppi tentativi</h1>\n<p>Riprova tra qualche minuto.</p>`);

export const joinErrorPage = () =>
  page('Errore', `<h1>Qualcosa è andato storto</h1>\n<p>La registrazione non è stata completata. Riprova tra poco usando lo stesso link.</p>`);

export const joinDonePage = () =>
  page(
    'Account creato',
    `<h1>Account creato</h1>
<p>Ora puoi <a href="/auth/login">accedere</a> con la tua email e la password scelta.</p>
<p>L'accesso ai contenuti verrà abilitato dall'amministratore: fino ad allora vedrai "Accesso non abilitato".</p>`,
  );

// The script is served by this Lambda (`script-src 'self'`): a plain form POST cannot carry the
// `x-amz-content-sha256` header CloudFront OAC needs on POST to a Lambda Function URL.
export const joinFormPage = (token: string, email = '', error = '') =>
  page(
    'Crea il tuo account',
    `<h1>Crea il tuo account</h1>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}<form method="post" action="/auth/join">
<input type="hidden" name="t" value="${esc(token)}">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email" maxlength="254" required value="${esc(email)}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="new-password" maxlength="256" required>
<label for="password2">Ripeti la password</label>
<input id="password2" name="password2" type="password" autocomplete="new-password" maxlength="256" required>
<button type="submit">Crea account</button>
</form>
<script src="/auth/join.js"></script>`,
  );

export const JOIN_SCRIPT = `(function () {
  if (document.documentElement.dataset.joinBound) return;
  document.documentElement.dataset.joinBound = '1';
  document.addEventListener('submit', async function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    e.preventDefault();
    var button = form.querySelector('button');
    if (button) button.disabled = true;
    try {
      var body = new URLSearchParams(new FormData(form)).toString();
      var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
      var hash = Array.from(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      var res = await fetch(form.getAttribute('action'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-amz-content-sha256': hash },
        body: body
      });
      var doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      document.title = doc.title;
      document.body.replaceChildren.apply(document.body, Array.from(doc.body.childNodes));
    } catch (err) {
      if (button) button.disabled = false;
      alert('Connessione non riuscita. Riprova.');
    }
  });
})();
`;
