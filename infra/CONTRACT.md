# Quizzer on AWS: edge/auth contract (authoritative, branch `feat/aws-infra`)

This file is the contract between:

- the CloudFront Function `session-check` (`infra/edge/session-check.js`, generated from `infra/edge/session-core.js`);
- the `auth` Lambda (`infra/lambda/auth`), behind `/auth/*`;
- the SPA (`--mode aws` build) and its local mock backend (`server/mock`, branch `feat/aws-hosted`).

Machine-readable vectors: `infra/edge/test/vectors.json` (the test suite of this branch runs them against the core,
the built CloudFront Function and the Lambda signer). If anything here disagrees with the plan, the plan v3 deltas win
and this file gets fixed.

## 1. Origin layout

| Path | Served by | Edge check (`session-check`) |
|---|---|---|
| `/auth/*` | `auth` Lambda (Function URL, OAC) | none (the Lambda verifies the cookie itself where needed) |
| `/data/<datasetId>/**` | data bucket (`s3://<data>/data/<id>/...`) | valid session **and** `<id>` in `ds` (or `ds = ["*"]`) |
| `/manifest.webmanifest`, `/favicon.svg`, `/icon-<name>.svg`, `/signed-out.html` | app bucket | **public** |
| everything else (app shell, `/assets/*`, `/sw.js`, ...) | app bucket | valid session |

Each dataset repo publishes `data/<id>/index.json` (its own one-dataset index), `data/<id>/questions.json`,
`data/<id>/images/**`. There is **no** shared `/data/index.json`: anything directly under `/data/` that is not
`/data/<valid-id>/...` is denied (403) unless `ds = ["*"]` (and then S3 returns 403/404 anyway).

Dataset id syntax: `^[a-z0-9][a-z0-9-]{0,62}$` (lower case; `/data/AWS-DVA-C02/...` is a different, unauthorized id).

## 2. Cookies

| Cookie | Value | Attributes | Set by |
|---|---|---|---|
| `__Host-qz_session` | session JWT (§3) | `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800` (no `Domain`) | `/auth/callback`, `/auth/refresh` |
| `__Secure-qz_refresh` | Cognito refresh token (opaque) | `Path=/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000` (30 days) | `/auth/callback` (and `/auth/refresh` only if Cognito rotates it) |
| `__Secure-qz_pkce` | `base64url(JSON{s,v,r,e}) + "." + HMAC` (state, PKCE verifier, return path, expiry) | `Path=/auth; Secure; HttpOnly; SameSite=Lax; Max-Age=600` | `/auth/login`; cleared by `/auth/callback` |

- The PKCE cookie must be `Lax`: the return from `<prefix>.auth.us-east-1.amazoncognito.com` is a cross-site
  top-level navigation (plan v2 §2.1).
- Clearing = same name, same `Path`, empty value, `Max-Age=0` (plus `Secure; HttpOnly; SameSite=...`).
- No JavaScript ever sees a token. The SPA only calls `/auth/me` and `/auth/refresh` and navigates to
  `/auth/login?return=...` and `/auth/logout`.

## 3. Session token (`__Host-qz_session`)

Compact JWS, HS256:

```
base64url(header) "." base64url(payload) "." base64url(HMAC-SHA256(key, base64url(header) "." base64url(payload)))
```

- Header, serialized exactly as `{"alg":"HS256","typ":"JWT","kid":"<kid>"}`. Verifiers **require** `alg == "HS256"`
  (the algorithm is fixed, never chosen from the header; `none`, `HS512`, `RS256` are rejected), `typ` absent or `"JWT"`,
  `kid` matching `^[A-Za-z0-9_-]{1,32}$`.
- Signature: base64url without padding, exactly 43 characters. Compared in constant time.
- Payload claims:

| Claim | Type | Rule |
|---|---|---|
| `iss` | string | `"quizzer"` |
| `aud` | string | `"quizzer-edge"` |
| `sub` | string | Cognito `sub` (1-128 chars) |
| `email` | string | from the ID token |
| `name` | string, optional | from the ID token (`name`, else `given_name`), omitted if absent |
| `ds` | string[] | non-empty; dataset ids from groups `ds-<id>`, or exactly `["*"]` with group `ds-all` |
| `adm` | boolean | `true` iff group `admin` |
| `iat` | number | seconds |
| `exp` | number | seconds, `iat + 1800`; valid iff `exp > now` (no leeway) |

- Admins (`adm = true`) without `ds-*` groups get `ds = ["*"]` (the owner must see every dataset).
  A user with neither `ds-*`/`ds-all` nor `admin` gets **no session**.
- `ds-all` wins over individual `ds-<id>` groups (`ds = ["*"]`).

### 3.1 Keys and `kid`

- Keys live in the CloudFront KeyValueStore of the distribution:
  - `qz-current-kid` -> the kid used to **sign** (e.g. `k20261009T120000`);
  - `qz-key-<kid>` -> the secret (43-char base64url string of 32 random bytes). **The HMAC key is the UTF-8 bytes of
    that string** (not the decoded bytes). Minimum length 32 characters.
- The edge function verifies any `kid` whose `qz-key-<kid>` exists; an unknown kid = no session.
- The Lambda signs with `qz-current-kid` (cached 5 min) and verifies like the edge.
- Rotation (`infra/scripts/rotate-session-key.sh`): add `qz-key-<new>`, switch `qz-current-kid`, delete the old key
  after >= 35 minutes (5 min Lambda cache + 30 min session). Deleting it immediately logs everybody out (kill switch).
- The mock backend uses a fixed dev key; it may use the test key below.

### 3.2 Fixed test vector

Key (UTF-8): `qz-test-key-0123456789abcdefghijklmnopqrstuvwxyz`, kid `k1`.

Claims (serialized in this key order with `JSON.stringify`):
`{"iss":"quizzer","aud":"quizzer-edge","sub":"11111111-2222-3333-4444-555555555555","email":"user@example.com","ds":["aws-dva-c02"],"adm":false,"iat":1700000000,"exp":4102444800}`

Expected token:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImsxIn0.eyJpc3MiOiJxdWl6emVyIiwiYXVkIjoicXVpenplci1lZGdlIiwic3ViIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1IiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIiwiZHMiOlsiYXdzLWR2YS1jMDIiXSwiYWRtIjpmYWxzZSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.TOy6RlraxgdEnZ6g7ZiogaNjdcutPMmACqiB-ChM2p8
```

Owner vector (`ds:["*"]`, `adm:true`, `name:"Owner"`) and an expired vector are in `vectors.json`.

Negative vectors that must be rejected (all covered by `edge/test/core.test.mjs`): `alg: none` with empty signature;
`alg: HS512`/`RS256` re-signed; signature with one char flipped; truncated signature; unknown `kid`; `kid` with `/` or
`..`; wrong `iss`/`aud`; `exp <= now`; `exp` as string; `ds` empty, `ds` with `"../x"`, `ds` mixing `"*"` and ids;
`adm` missing; more than 3 segments; token longer than 3000 chars.

## 4. Edge decisions (`session-check`, viewer-request)

Path checks run on the raw `request.uri` **before** anything else:

- rejected with **400** `{"error":"bad_path"}` if it contains `..`, `//`, `\`, `/./` (or ends with `/.`), `%2e`/`%2E`,
  `%2f`/`%2F`, `%5c`/`%5C`, `%00`, control characters, doesn't start with `/`, or is longer than 1024 chars;
- public allowlist -> pass through;
- no/invalid session -> **302** `Location: /auth/login?return=<encodeURIComponent(uri)>` when the request is a navigation
  (`Sec-Fetch-Mode: navigate`, or `Accept` contains `text/html`), otherwise **401** `{"error":"unauthenticated"}`;
- valid session but dataset not allowed -> **403** `{"error":"forbidden"}`;
- all error responses: `content-type: application/json; charset=utf-8`, `cache-control: no-store`.

Path vectors (`anon` = no cookie, `user-aws` = the first vector above, `owner-all` = `ds:["*"]`):

| URI | anon | user-aws | owner-all |
|---|---|---|---|
| `/`, `/index.html`, `/assets/x.js`, `/sw.js` | 401/302 | allow | allow |
| `/manifest.webmanifest`, `/favicon.svg`, `/icon-192.svg`, `/signed-out.html` | allow | allow | allow |
| `/data/aws-dva-c02/questions.json`, `/data/aws-dva-c02/index.json`, `/data/aws-dva-c02/images/q1.png` | 401/302 | allow | allow |
| `/data/mule-mcd-01/questions.json` | 401/302 | **403** | allow |
| `/data/aws-dva-c02-evil/questions.json`, `/data/index.json`, `/data/aws-dva-c02` (no trailing part) | 401/302 | 403 | allow |
| `/data/aws-dva-c02/../mule-mcd-01/questions.json`, `.../%2e%2e/...`, `/data//mule-mcd-01/...`, `%2f`, `%5c`, `%00` | 400 | 400 | 400 |

Full list: `vectors.json` -> `paths`.

## 5. `/auth/*` endpoints (auth Lambda)

All responses carry `Cache-Control: no-store`. JSON bodies are `application/json; charset=utf-8`.
CloudFront OAC on a Lambda Function URL requires `POST`/`PUT` requests to carry `x-amz-content-sha256: <hex sha256 of
body>`; for the empty body that is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

| Method + path | Input | Success | Errors |
|---|---|---|---|
| `GET /auth/login?return=<path>` | `return` optional | **302** to `https://<cognito-domain>/oauth2/authorize?response_type=code&client_id=..&redirect_uri=https://<app-host>/auth/callback&scope=openid+email+profile&state=..&code_challenge=..&code_challenge_method=S256`; sets `__Secure-qz_pkce` | invalid `return` is replaced by `/` (never an error) |
| `GET /auth/callback?code&state` | PKCE cookie | **302** to `https://<app-host><return>`; sets `__Host-qz_session` + `__Secure-qz_refresh`; clears PKCE | **400** HTML (missing/expired PKCE cookie, state mismatch, `error=` from Cognito, failed code exchange); **403** HTML "Accesso non abilitato" when the user has no `ds-*`/`ds-all`/`admin` group (refresh token revoked, no session cookie) |
| `POST /auth/refresh` | refresh cookie, empty body | **200** body = `/auth/me` body; new `__Host-qz_session` | **401** `{"error":"no_refresh"}` (no cookie); **401** `{"error":"refresh_failed"}` + both cookies cleared (revoked/expired token, disabled/deleted user); **403** `{"error":"not_enabled"}` + cookies cleared (groups removed); **403** `{"error":"bad_origin"}` (`Origin`/`Sec-Fetch-Site` not same-origin); **503** `{"error":"upstream"}` (Cognito 5xx/unreachable: cookies are kept, retry later); **405** for GET |
| `GET /auth/me` | session cookie | **200** `{"sub","email","name"?,"ds","adm","exp","allDatasets"?}` | **401** `{"error":"unauthenticated"}` |
| `GET` or `POST /auth/logout` | cookies | revokes the refresh token at Cognito (best effort), clears session + refresh + PKCE cookies, sends `Clear-Site-Data: "cache"` (never `"storage"`: local progress must survive), **302** to `https://<cognito-domain>/logout?client_id=..&logout_uri=https://<app-host>/signed-out.html` | never fails |
| anything else under `/auth/` | | | **404** `{"error":"not_found"}` |
| any route, unexpected failure (SSM/KVS unreachable, malformed ID token) | | | **500** `{"error":"internal"}` |

- `allDatasets` is present only when `ds = ["*"]`; it is the sorted list of dataset ids from the runtime config
  (SSM parameter, `datasets`).
- `exp` is the session expiry (seconds). The SPA should call `POST /auth/refresh` ~5 minutes before `exp`, on
  `visibilitychange`, and once after a 401 from `/data/*` (single-flight); if refresh returns 401, navigate to
  `/auth/login?return=<current path>`.
- **Return path rules** (`return` of `/auth/login`): must start with a single `/`, must not start with `//` or `/\`,
  must not contain `\`, control characters, `..`, `%2f`/`%5c` (any case) and must not start with `/auth/`; at most 512
  chars. Anything else becomes `/`. The final redirect is always absolute on the app host
  (`https://<app-host><return>`), never on a host taken from the request without validation.
- **App host / redirect URI**: candidates are, in order, `x-forwarded-host` and `host`; the first one that is in the
  configured `appHosts` list wins, otherwise `appHosts[0]`. Behind CloudFront with OAC the Lambda receives the Function
  URL host (AllViewerExceptHostHeader policy), so in practice `appHosts[0]` (the distribution domain) is used.

## 6. Runtime config (SSM parameter `/quizzer/prod/config`, String, JSON)

```json
{
  "userPoolId": "us-east-1_XXXXXXXXX",
  "clientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "cognitoDomain": "quizzer-xxxx.auth.us-east-1.amazoncognito.com",
  "region": "us-east-1",
  "appHosts": ["dXXXXXXXXXXXXX.cloudfront.net"],
  "datasets": ["aws-dva-c02", "mule-mcd-01"],
  "sessionTtlSeconds": 1800,
  "refreshCookieDays": 30
}
```

The Lambda reads it at cold start (cache 5 min). Environment variables of the Lambda: `CONFIG_PARAMETER`
(the parameter name), `KVS_ARN`. This breaks the Terraform dependency cycle (plan v2 §4.4).

## 7. Cognito groups

`ds-<datasetId>` (one per dataset), `ds-all`, `admin`. Created by Terraform; membership managed with
`infra/scripts/invite-user.sh` / `offboard-user.sh` (later by the admin UI, M7). Group changes take effect at the
next refresh (<= 30 min).

## 8. Response headers (CloudFront response headers policies)

Every behavior: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(),
microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin` and the CSP of plan v1 §D:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
```

(`https:` in `connect-src`/`img-src` keeps the "Avanzate" GitHub/URL sources working; it is the Terraform variable
`content_security_policy` of `modules/edge` and can be narrowed to `https://api.github.com https://raw.githubusercontent.com`.)
`/data/*` additionally gets `Cache-Control: private, no-cache` (overriding S3), so the browser revalidates through
CloudFront and the session check every time. Edge cache key for `/data/*`: no cookies, headers or query strings.

## 9. CI variables (outputs of `infra/live/app`, `terraform output github_variables`)

| Repository | Variables (GitHub repository or `prod` environment variables, not secrets) | Role trust (`sub`) | Permissions |
|---|---|---|---|
| `RedLicorice/directrev-quizzer` | `AWS_ROLE_ARN`, `AWS_REGION`, `APP_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID` | `repo:RedLicorice/directrev-quizzer:environment:prod` | app bucket (list/put/get/delete), invalidations of the distribution |
| `RedLicorice/quizzer-dataset-<id>` | `AWS_ROLE_ARN`, `AWS_REGION`, `DATA_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID` | `repo:RedLicorice/quizzer-dataset-<id>:environment:prod` | `s3://<DATA_BUCKET>/data/<id>/*` only (list with `s3:prefix` `data/<id>/`), invalidations |

The deploy jobs must run in a GitHub environment named `prod` (`environment: prod`) and have
`permissions: id-token: write`.
