# Gateway contract: what the app expects, and what the local mock implements

The **authoritative** contract is `infra/CONTRACT.md` on branch `feat/aws-infra` (CloudFront Function
`session-check`, Lambda `auth`). This file mirrors the parts the app depends on, documents the mock
(`server/mock/server.mjs`), and lists every known difference. Aligned with `feat/aws-infra` @ `84135fc`;
its test vectors are copied verbatim into `tests/fixtures/edge-vectors.json` and run against
`server/mock/session-core.mjs` by `npm test`.

```
node server/mock/server.mjs --dist dist --data <datasets-dir> --port 4200 --secret dev [--kid mock-1] [--ttl 1800] [--log]
```

`<datasets-dir>/<id>/{index.json,questions.json,images/**}` is served in place under `/data/<id>/…`
(it is never copied into this repo). Open `http://localhost:4200`, not `127.0.0.1`: the `__Host-` and
`__Secure-` cookies need a secure context, and browsers (Chromium, Firefox) treat plain-http
`localhost` as one; on any other http host they are silently dropped.

## 1. Paths and the edge decision

The decision is taken on the **raw** URI (never normalised), in this order:

| Request | Result |
|---|---|
| URI with `..`, `//`, `\`, `/./` or trailing `/.`, `%2e`, `%2f`, `%5c`, `%00` (any case), control chars, not starting with `/`, > 1024 chars | **400** `{"error":"bad_path"}` |
| `/manifest.webmanifest`, `/favicon.svg`, `/icon-<name>.svg`, `/signed-out.html`, `/auth`, `/auth/*` | allowed without session |
| no valid session, navigation (`Sec-Fetch-Mode: navigate`, or `Accept` contains `text/html`) | **302** `Location: /auth/login?return=<encodeURIComponent(uri)>` (query string not kept) |
| no valid session, anything else | **401** `{"error":"unauthenticated"}` |
| `/data/<id>/<more>` with `<id>` matching `^[a-z0-9][a-z0-9-]{0,62}$` | allowed iff `<id>` ∈ `ds` or `ds = ["*"]`, else **403** `{"error":"forbidden"}` |
| any other `/data…` (`/data/`, `/data/index.json`, `/data/<id>` without a trailing part, upper case ids) | allowed only for `ds = ["*"]`, else **403** |
| everything else (app shell, `/assets/*`, `/sw.js`, `/registerSW.js`, …) | any valid session |

Error bodies: `application/json; charset=utf-8`, `Cache-Control: no-store`.
`/data/*` responses carry `Cache-Control: private, no-cache` (browser revalidates every time, with the cookie).

## 2. Cookies

| Cookie | Value | Attributes |
|---|---|---|
| `__Host-qz_session` | session JWT (§3) | `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800`, no `Domain` |
| `__Secure-qz_refresh` | opaque refresh token (Cognito's in AWS, random in the mock) | `Path=/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000` |
| `__Secure-qz_pkce` | login state (format is private to the Lambda / mock) | `Path=/auth; Secure; HttpOnly; SameSite=Lax; Max-Age=600` |

Clearing = same name and `Path`, empty value, `Max-Age=0`. JavaScript never sees any of them.

## 3. Session JWT (HS256)

- Header serialized exactly as `{"alg":"HS256","typ":"JWT","kid":"<kid>"}`; verifiers require `alg == "HS256"`
  (never chosen from the header), `typ` absent or `"JWT"`, `kid` matching `^[A-Za-z0-9_-]{1,32}$` and present in
  the key ring (own property: `__proto__`/`constructor` are unknown kids).
- Signature: base64url, no padding, exactly 43 characters, compared in constant time. HMAC key = the **UTF-8 bytes of
  the key string**, at least 32 characters. The mock stretches a shorter `--secret` deterministically:
  `base64url(sha256("quizzer-mock:" + secret))`.
- Token length ≤ 3000. Claims, serialized in this order:

| Claim | Rule |
|---|---|
| `iss` | `"quizzer"` |
| `aud` | `"quizzer-edge"` |
| `sub` | string, 1-128 chars |
| `email` | string |
| `name` | optional string |
| `ds` | non-empty array of dataset ids, or exactly `["*"]` |
| `adm` | boolean |
| `iat` | seconds |
| `exp` | seconds, `iat + 1800`; valid iff `exp > now` (no leeway) |

- Groups → claims: `ds-all` → `["*"]` (wins over `ds-<id>`); otherwise the sorted `ds-<id>` ids; `admin` alone →
  `ds = ["*"], adm = true`; no `ds-*`/`ds-all`/`admin` → **no session** (callback answers 403 "Accesso non abilitato").

### Fixed test vector (same as infra)

Key `qz-test-key-0123456789abcdefghijklmnopqrstuvwxyz` (UTF-8), kid `k1`, claims
`{"iss":"quizzer","aud":"quizzer-edge","sub":"11111111-2222-3333-4444-555555555555","email":"user@example.com","ds":["aws-dva-c02"],"adm":false,"iat":1700000000,"exp":4102444800}`:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImsxIn0.eyJpc3MiOiJxdWl6emVyIiwiYXVkIjoicXVpenplci1lZGdlIiwic3ViIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1IiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIiwiZHMiOlsiYXdzLWR2YS1jMDIiXSwiYWRtIjpmYWxzZSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.TOy6RlraxgdEnZ6g7ZiogaNjdcutPMmACqiB-ChM2p8
```

Owner (`ds:["*"]`, `adm:true`, `name:"Owner"`), expired vector and the full path table: `tests/fixtures/edge-vectors.json`.
Malicious cases covered by `tests/session-core.test.mjs`: `alg:none` (empty or copied signature), `HS512`/`RS256`/`hs256`
re-signed, flipped/truncated signature, tampered payload, foreign key, malformed segments, > 3000 chars, unknown /
prototype / path-like kids, short keys, wrong `iss`/`aud`, `exp` as string, `exp == now`, bad `ds` shapes, missing `adm`,
path traversal (`..`, `%2e%2e`, `%2E%2E`, `.%2e`, `%2f`, `%5c`, `%00`, `//`, `\`, `/./`).

## 4. `/auth/*` endpoints

All responses `Cache-Control: no-store`. POST to a Lambda Function URL behind OAC needs
`x-amz-content-sha256: <hex sha256(body)>`; empty body = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

| Endpoint | Success | Errors |
|---|---|---|
| `GET /auth/login?return=<path>` | 302 to the IdP (Cognito managed login; mock: `/auth/mock-idp`), sets `__Secure-qz_pkce` | invalid `return` → `/` |
| `GET /auth/callback?code&state` | 302 to `<return>`, sets session + refresh, clears PKCE | 400 HTML (state/code), 403 HTML (no access) |
| `POST /auth/refresh` (empty body) | 200 + `/auth/me` body, new session cookie | 401 `no_refresh` / `refresh_failed` (+ cookies cleared), 403 `not_enabled` (+ cleared), 403 `bad_origin` (`Origin` or `Sec-Fetch-Site` not same-origin), 503 `upstream` (AWS only), 405 for GET |
| `GET /auth/me` | 200 `{sub,email,name?,ds,adm,exp,allDatasets?}` (`allDatasets` only for `ds=["*"]`, sorted) | 401 `unauthenticated` |
| `GET`/`POST /auth/logout` | revoke refresh token, clear session + refresh + PKCE cookies, 302 → (Cognito `/logout` →) `/signed-out.html` | never fails |
| other `/auth/*` | | 404 `not_found` |

`return` rules: starts with exactly one `/`; no `//`, `/\`, `\`, `..`, whitespace/control chars, `%2f %5c %2e %00 %0d
%0a %09`; not `/auth…`; ≤ 512 chars; otherwise `/`.

## 5. What the app does with it (`src/aws/`)

- Boot (`AuthGate`): `GET /auth/me`; on 401 one `POST /auth/refresh`; still nothing → `location.assign('/auth/login?return=<path+query+hash>')`.
  Network failure → "offline" banner with retry (the app shell comes from the service worker).
- Refresh: single-flight, at `exp − 5 min` and on `visibilitychange` when less than 5 min are left.
- Data: `fetch('/data/<id>/…', {credentials:'same-origin'})`; 401 → refresh once → retry once → else login redirect;
  403 → "Dataset non abilitato per il tuo account". Network errors never redirect.
- Images: plain `<img src="/data/<id>/images/…">` (cookie authenticated, no blob); on error one refresh + reload.
- Logout: clear Cache Storage except the app-shell precache, `sessionStorage`, in-memory blobs → `location.assign('/auth/logout')`.
- Service worker (`--mode aws`): `navigateFallbackDenylist: [/^\/auth\//, /^\/data\//, /^\/api\//]`, `NetworkOnly` for the same prefixes.
- The aws build ships `/signed-out.html` (public, no script, inline `<style>`; CSP hash
  `sha256-K8NHBPQeBO4G4qXU8S9dAHowhoCAOLgngwcqJNDqBfs=` if `style-src` has no `'unsafe-inline'`).

## 6. Mock-only behaviour and known differences from `feat/aws-infra`

| # | Topic | Mock | Infra (`84135fc`) | Note |
|---|---|---|---|---|
| 1 | IdP | `/auth/mock-idp` form: email, name, checkboxes `ds-<id>` (from the data dir), `ds-all`, `admin` | Cognito managed login, PKCE | mock-only page |
| 2 | Missing/wrong `x-amz-content-sha256` | mock answers 403 itself | rejected by OAC/Lambda URL before the Lambda (exact status **not verified**) | client always sends it |
| 3 | `/auth/login` with a valid refresh cookie | mints a session and 302s back without the IdP | always goes to Cognito (whose own SSO cookie makes it quick) | harmless |
| 4 | Logout | also sends `Clear-Site-Data: "cache"` | not sent | **suggest adding** to the Lambda (`"cache"` only, never `"storage"`: it would wipe every user's local progress) |
| 5 | Missing `/data` object | 404 | S3 with OAC and no `ListBucket` → 403 | the app shows the status either way |
| 6 | `/api/*` | 404 JSON | no `/api` behavior in phase 1 (falls to the app bucket) | no `api` Lambda (plan v3) |
| 7 | `Origin` check on refresh | accepts `http(s)://<Host>` | `https://<appHost>` from SSM | local http |
| 8 | CSP | `connect-src 'self' https://api.github.com https://raw.githubusercontent.com`, `img-src 'self' data: blob: https://raw.githubusercontent.com` | not in the contract yet | the "Avanzate" GitHub sources need these hosts; arbitrary "Static URL" sources cannot work under a strict CSP — **to decide in the response-headers policy** |

Aligned during development (the first mock draft differed): `aud` `quizzer-app` → `quizzer-edge`; added `iat` and
`name` claims and the claim order; kid syntax; 43-char signature; 3000-char limit; key ≥ 32 chars; `ds` non-empty,
`*` alone, id regex `{0,62}`; `admin` alone → `ds=["*"]`; no group → no session; `return` rules (≤ 512, no `..`,
encoded separators); 302 `return` without the query string; error codes (`bad_path`, `forbidden`, `no_refresh`,
`refresh_failed`, `not_enabled`, `bad_origin`, `not_found`); public `/signed-out.html` and `/icon-*.svg`; owner may
read anything under `/data`; `Accept: text/html` also counts as navigation; refresh cookie 30 days; logout lands on
`/signed-out.html`; no special `/api/admin` rule.
