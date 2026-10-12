# Handoff: Quizzer su AWS (dal cloud al tuo PC)

Stato al 2026-10-09. Questa nota (e `docs/plan/`) si può eliminare dopo il passaggio: è un commit separato in cima a `staging`.

## Dove sono le cose
| Cosa | Dove |
|---|---|
| App + infrastruttura, tutto unito | branch `staging` di `RedLicorice/directrev-quizzer` (main è antenato → fast-forward) |
| CI dei dataset (validate + publish) | branch `staging` (= `ci/validate-publish`) in `quizzer-dataset-aws-dva-c02` e `quizzer-dataset-mule-mcd-01` |
| Piano e deltas | `docs/plan/aws-plan-v2.md` (base) + `docs/plan/plan-v3-deltas.md` (le deltas prevalgono) |
| Runbook di deploy | `infra/README.md` (italiano) · contratto cookie/token: `infra/CONTRACT.md` · server finto: `server/mock/` |

PR già aperte e che si chiudono da sole con il fast-forward: #1 (`feat/dataset-sources`) e #2 (`fix/ui-overflow`).

## Fast-forward su main
```bash
cd directrev-quizzer && git fetch origin && git checkout main && git merge --ff-only origin/staging && git push origin main
# per ciascun repo dati:
git fetch origin && git checkout main && git merge --ff-only origin/staging && git push origin main
```
Tutto il materiale dei dataset resta SOLO nei due repo dati privati: non copiarlo nel repo dell'app.

## Decisioni già prese
Solo AWS · Terraform (compatibile OpenTofu) · dominio `*.cloudfront.net` (niente Cloudflare/ACM per ora) · Cognito Essentials solo su invito, MFA TOTP facoltativa, niente passkey · progressi solo nel browser, chiavi separate per utente (niente DynamoDB, statistiche o classifiche) · GitHub Pages resta la versione senza backend (token fine-grained per i repo privati) · AWS è per i colleghi, che non ricevono accesso ai repo · regione `eu-central-1` · accesso a `mule-mcd-01` solo all'owner (dump di terzi) · budget 5 USD.

## Verificato in locale (senza AWS)
App: 89 test, build Pages e build AWS, 34 controlli e2e col server finto sui dati reali. Infra: 413 test, `terraform`/`tofu` validate + 23 test con provider simulato, tflint, checkov, shellcheck. Repo dati: 53 test del validatore, workflow controllati con actionlint.

## NON verificato (serve AWS vero) → checklist §19 di `infra/README.md`
Primo `apply`; header `Cache-Control` custom nella response headers policy; logging della distribuzione e ACL del bucket log; branding managed login v2; `aws cloudfront test-function`; SigV4A verso il KVS; login vero con Cognito e cookie su `dXXXX.cloudfront.net`; Function URL invocata direttamente → 403; POST `/auth/refresh` via OAC con `x-amz-content-sha256`; email di invito; publish OIDC reale; PWA su iOS/Android.

## Da fare sul tuo PC
1. Passa l'account AWS al **Paid plan** (il Free chiude l'account dopo 6 mesi; i crediti restano usabili) e metti un budget alert.
2. Installa Terraform ≥ 1.10 (o OpenTofu), controlla `aws sts get-caller-identity`, e segui `infra/README.md`: bootstrap → `terraform apply` → build di Lambda e funzione edge → prima chiave HMAC → variabili GitHub (`AWS_ROLE_ARN`, `AWS_REGION`, `DATA_BUCKET`/`APP_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, environment `prod`) nei tre repo → invito di te stesso come admin → primo publish dei dataset.
3. Prova il flusso: login, MFA TOTP, dataset AWS visibile, MuleSoft solo col gruppo `ds-mule-mcd-01`, logout, rollback con `workflow_dispatch`.

## Aperto / da decidere
- **CSP**: Terraform usa quella larga (`https:` in connect/img-src, variabile `content_security_policy`); per i colleghi consigliata quella stretta (solo `api.github.com`, `raw.githubusercontent.com`). `signed-out.html` ha uno stile inline: serve l'hash `sha256-K8NHBPQeBO4G4qXU8S9dAHowhoCAOLgngwcqJNDqBfs=` se la CSP vieta `unsafe-inline`.
- **Workflow `deploy-aws.yml`** per pubblicare la build `--mode aws` sul bucket dell'app: **fatto** (OIDC, environment `prod`).
- **Console admin** (inviti e gestione utenti nell'app): **fatta** per la gestione utenti (M7): Lambda `admin` + `/api/admin/*` + schermata "Amministrazione"; gli script `infra/scripts/*.sh` restano per il bootstrap. Statistiche/scoreboard restano fuori scope (v3).
- **Difetti nei dati MuleSoft**: Q175 opzioni A e D identiche; Q187 opzioni C e D identiche e RAML con artefatti ("12.201:"); Q22/Q25 "What Database expression" forse per "DataWeave"; l'ultima analisi sul testo dei dump ha spazi persi in diverse spiegazioni.
- Node 20 nei workflow dei repo dati è a fine supporto (basta `node-version: '22'`); `Cache-Control: public` sui dati protetti: valutare `private`; environment `prod` su GitHub: limitare i deploy a `main` ed eventuale approvazione.
- Differenze minori mock ↔ AWS (404 vs 403 su file mancante, ecc.): `server/mock/CONTRACT.md` §6.
- Dominio personalizzato (Cloudflare DNS-only + ACM us-east-1): fase opzionale M10 del piano.
