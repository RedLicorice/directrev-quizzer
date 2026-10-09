# Quizzer su AWS: infrastruttura (`infra/`)

Runbook passo-passo per mettere online Quizzer su AWS **dal tuo PC**, con le credenziali AWS già configurate.
Niente di questa cartella è stato eseguito su un account reale: codice, Terraform e script sono stati verificati solo
offline (vedi [§19](#19-cosa-è-stato-verificato-offline-e-cosa-no)).

Architettura (piano v2 + delta v3): una distribuzione CloudFront sul dominio di default `dXXXX.cloudfront.net`, due
bucket S3 privati (app e dati) dietro OAC, una CloudFront Function `session-check` che verifica il cookie di sessione
con una chiave HMAC presa dal KeyValueStore (KVS), una Lambda `auth` (Function URL con OAC) che fa il login con
Cognito (codice + PKCE), una user pool Cognito solo su invito con MFA TOTP opzionale, i ruoli OIDC per GitHub Actions
e un budget da 5 USD. Niente DynamoDB, niente API, niente passkey, niente dominio custom.

Il contratto tra edge, Lambda e app (cookie, claim, endpoint, vettori di test) è in [`CONTRACT.md`](CONTRACT.md).

```text
infra/
  CONTRACT.md              contratto edge/auth/app (autorevole)
  package.json             test e build di edge + Lambda (vitest, esbuild, tsc)
  edge/                    session-core.js (logica pura), session-check.js (CloudFront Function generata)
  lambda/auth/             Lambda auth in TypeScript (src/, test/, build.mjs -> dist/index.mjs)
  bootstrap/               bucket dello stato Terraform (stato locale, poi migrate-state)
  modules/                 edge, site, identity, lambdas, ci (ognuno con tests/*.tftest.hcl)
  live/app/                root principale (provider aws, eu-central-1)
  scripts/                 rotate-session-key, invite-user, offboard-user, check-plan, tf-check
```

---

## 1. Prerequisiti

| Strumento | Versione | Note |
|---|---|---|
| Terraform | >= 1.10 (testato 1.16.5) | oppure OpenTofu >= 1.10 (testato 1.11.0): il codice è compatibile |
| AWS CLI v2 | recente (>= 2.15) | servono i comandi `cloudfront-keyvaluestore` (firma SigV4A, inclusa nella CLI v2) |
| Node.js | 22 | per build e test di edge function e Lambda |
| `jq`, `openssl`, `bash` | | usati dagli script |
| `gh` (opzionale) | | per impostare le variabili GitHub da riga di comando |

Credenziali: un profilo con permessi di amministratore sull'account (IAM Identity Center/SSO consigliato), regione
`eu-central-1`. Verifica:

```bash
export AWS_PROFILE=quizzer-admin        # il tuo profilo
export AWS_REGION=eu-central-1
aws sts get-caller-identity             # annota l'Account (12 cifre)
```

## 2. Account AWS: Paid plan, MFA, budget

1. **Passa al Paid plan** (Console -> Billing and Cost Management -> piano dell'account). Con il modello attuale il
   *Free plan* limita i servizi e **chiude l'account dopo 6 mesi** o quando finiscono i crediti; il *Paid plan* dà
   accesso completo e usa comunque i crediti (https://aws.amazon.com/free/). Per un servizio che deve durare serve il
   Paid plan. Il budget da 5 USD creato da Terraform ti avvisa se qualcosa costa più del previsto.
2. Attiva la **MFA sull'utente root** e non usarlo per il lavoro quotidiano.
3. Il budget (`aws_budgets_budget`, 5 USD/mese, avvisi all'80% reale e al 100% previsto) arriva all'e-mail
   `admin_email`.

## 3. Build di edge function e Lambda

```bash
cd infra
npm ci
npm test              # edge (vettori, casi malevoli, harness del runtime), Lambda, script: tutto offline
npm run build         # = build:edge (edge/session-check.js) + build:lambda (lambda/auth/dist/index.mjs)
```

- `edge/session-check.js` è **generato** da `edge/session-core.js` + `edge/session-check.template.js` ed è committato.
  Se modifichi il core, `npm run build:edge`; `npm test` fallisce se il file è vecchio o supera gli 8 KB (limite
  CloudFront: 10 KB).
- `lambda/auth/dist/index.mjs` è il bundle esbuild (SDK v3 inclusi, niente Docker). Terraform lo zippa da solo
  (`archive_file` in `live/app/main.tf` -> `live/app/.build/auth.zip`). **Rifai `npm run build:lambda` prima di ogni
  `plan`** se hai toccato la Lambda.

## 4. Bootstrap del bucket di stato (una volta sola)

```bash
cd infra/bootstrap
cat > terraform.tfvars <<EOF
account_id = "123456789012"
region     = "eu-central-1"
EOF
terraform init
terraform apply                     # crea quizzer-tfstate-<account>-eu-central-1 (stato ancora locale)
terraform output -raw backend_hcl > backend.hcl
```

Poi sposta lo stato del bootstrap nel bucket stesso:

1. in `bootstrap/versions.tf` togli il commento al blocco `backend "s3" { ... }`;
2. `terraform init -migrate-state -backend-config=backend.hcl` e rispondi `yes`;
3. cancella `terraform.tfstate*` locali **solo dopo** aver verificato `terraform plan` (nessuna modifica).

Il backend usa `use_lockfile = true` (lock nativo su S3, niente tabella DynamoDB:
https://developer.hashicorp.com/terraform/language/backend/s3).

## 5. Deploy di `live/app`

```bash
cd infra/live/app
cp ../../bootstrap/backend.hcl backend.hcl         # stesso bucket, chiave app/terraform.tfstate
cp terraform.tfvars.example terraform.tfvars        # e compila
```

Variabili principali (`terraform.tfvars`):

| Variabile | Esempio | Note |
|---|---|---|
| `account_id` | `"123456789012"` | niente lookup `aws_caller_identity`: plan e test non dipendono dall'account; `allowed_account_ids` impedisce di applicare sull'account sbagliato |
| `cognito_domain_prefix` | `"quizzer-x7k2"` | dominio di login `<prefix>.auth.eu-central-1.amazoncognito.com`, unico al mondo; non deve contenere `aws`, `amazon`, `cognito` |
| `admin_email` | `"tu@example.com"` | avvisi del budget |
| `budget_amount_usd` | `5` | |
| `dataset_ids` | `["aws-dva-c02", "mule-mcd-01"]` | repo `RedLicorice/quizzer-dataset-<id>`, gruppi `ds-<id>`, ruoli CI |
| `create_github_oidc_provider` | `true` | `false` se l'account ha già il provider `token.actions.githubusercontent.com` |

```bash
terraform init -backend-config=backend.hcl
terraform plan -out=plan.tfplan
../../scripts/check-plan.sh plan.tfplan       # DEVE dire OK (vedi sotto)
terraform apply plan.tfplan
```

- `check-plan.sh` fallisce se il piano cancella o sostituisce distribuzione CloudFront, user pool, dominio Cognito,
  KVS, bucket dati o bucket di stato. Quelle risorse hanno anche `prevent_destroy`. Eseguilo **sempre** prima di
  `apply`: un cambio di distribuzione cambia `dXXXX.cloudfront.net` (callback Cognito, inviti, segnalibri, PWA).
- Il primo `apply` dura 5-15 minuti (la distribuzione CloudFront si propaga).
- Il ciclo distribuzione -> Lambda -> Cognito è rotto così: la Lambda conosce solo il **nome** del parametro SSM
  `/quizzer/prod/config`, che Terraform scrive dopo aver creato client e distribuzione (piano v2 §4.4). Un solo
  `apply` basta.
- Output utili: `terraform output` (URL dell'app, id della distribuzione, bucket, user pool, KVS, ruoli) e
  `terraform output -json github_variables`.

OpenTofu: stessi comandi con `tofu` al posto di `terraform`. Il `.terraform.lock.hcl` committato è quello di
Terraform (hash per linux/darwin/windows); con `tofu init` il file viene riscritto con gli indirizzi
`registry.opentofu.org`: non mescolare i due strumenti sullo stesso stato senza motivo.

## 6. Prima chiave HMAC (subito dopo il primo apply)

Finché il KVS è vuoto la Lambda risponde 500 a `/auth/login` e la CloudFront Function rifiuta ogni cookie (fail closed).

```bash
cd infra
scripts/rotate-session-key.sh --init      # crea qz-key-k<timestamp> e qz-current-kid nel KVS
scripts/rotate-session-key.sh --list      # mostra i kid, mai i segreti
```

La chiave (32 byte casuali, base64url) è generata sul tuo PC con `openssl`, scritta direttamente nel KVS con
`aws cloudfront-keyvaluestore put-key` e **non passa mai** da Terraform né dallo stato. La Lambda la legge con l'API
del KVS (cache 5 minuti), la funzione all'edge con `cf.kvs()`.

## 7. Variabili GitHub nei tre repository

```bash
cd infra/live/app
terraform output -json github_variables | jq .
```

Per ogni repository crea un **environment `prod`** (Settings -> Environments; per i repo dati conviene la
"required reviewers") e imposta le variabili (non sono segreti):

| Repository | Variabili |
|---|---|
| `RedLicorice/directrev-quizzer` | `AWS_ROLE_ARN`, `AWS_REGION`, `APP_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID` |
| `RedLicorice/quizzer-dataset-aws-dva-c02` | `AWS_ROLE_ARN`, `AWS_REGION`, `DATA_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID` |
| `RedLicorice/quizzer-dataset-mule-mcd-01` | `AWS_ROLE_ARN`, `AWS_REGION`, `DATA_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID` |

Con `gh`:

```bash
terraform output -json github_variables | jq -r 'to_entries[] | .key as $r | .value | to_entries[] | [$r, .key, .value] | @tsv' |
while IFS=$'\t' read -r repo name value; do
  gh variable set "$name" --repo "$repo" --env prod --body "$value"
done
```

I ruoli accettano solo `sub = repo:<owner>/<repo>:environment:prod` (uguaglianza esatta): i job di deploy devono avere
`environment: prod` e `permissions: id-token: write`. Il ruolo di un repo dati può scrivere solo in
`s3://<DATA_BUCKET>/data/<id>/` e invalidare la distribuzione; il ruolo dell'app solo nel bucket dell'app.

## 8. Primo deploy dell'app

Normalmente lo fa il workflow AWS del repo app (branch `feat/aws-hosted`). A mano, dal repo dell'app:

```bash
npm ci && npm run build -- --mode aws
aws s3 sync dist/assets "s3://$APP_BUCKET/assets" --cache-control "public,max-age=31536000,immutable"
aws s3 sync dist "s3://$APP_BUCKET" --exclude "assets/*" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
```

Niente `--delete` sugli asset: i client ancora aperti devono trovare i vecchi chunk (le versioni non correnti scadono
dopo 30 giorni). `signed-out.html`, `manifest.webmanifest`, `favicon.svg` e `icon-*.svg` sono pubblici (allowlist della
funzione), tutto il resto richiede la sessione.

## 9. Invitare te stesso (admin) e il primo utente

```bash
cd infra
scripts/invite-user.sh tu@example.com admin ds-all
scripts/invite-user.sh collega@example.com ds-aws-dva-c02
scripts/invite-user.sh --resend collega@example.com              # nuova e-mail di invito
```

- Cognito manda un'e-mail con password temporanea (valida 7 giorni) e il link all'app. Limite della configurazione
  e-mail di default: **50 e-mail al giorno per account** (https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html).
- Gruppi: `ds-<id>` (un dataset), `ds-all` (tutti), `admin`. Senza gruppi `ds-*`/`ds-all`/`admin` l'utente fa login ma
  vede "Accesso non abilitato" e non riceve la sessione.
- `ds-mule-mcd-01` contiene materiale d'esame di terze parti: lo script chiede `--confirm-mcd` (piano v2 §6).
- MFA: opzionale, TOTP (app di autenticazione). Ognuno può attivarla dalla pagina di login gestita da Cognito.

## 10. Primo publish dei dati

Dal repo `quizzer-dataset-<id>` col suo workflow `publish.yml` (environment `prod`), che scrive
`data/<id>/index.json`, `questions.json` e `images/` e poi invalida `/data/<id>/*`. A mano, solo se serve:

```bash
aws s3 sync . "s3://$DATA_BUCKET/data/<id>/" --delete \
  --exclude "*" --include "index.json" --include "questions.json" --include "images/*"
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/data/<id>/*"
```

I contenuti dei dataset stanno solo nei repo dati e nel bucket, mai nel repo dell'app.

## 11. Verifiche dopo il deploy

```bash
URL=$(terraform -chdir=infra/live/app output -raw app_url)
curl -sI "$URL" | head -5                           # 401 JSON (fetch) senza cookie
curl -sI -H 'Sec-Fetch-Mode: navigate' "$URL"       # 302 Location: /auth/login?return=%2F
curl -sI "${URL}manifest.webmanifest"               # 200 senza cookie (pubblico)
curl -sI "${URL}data/aws-dva-c02/questions.json"    # 401
curl -s -o /dev/null -w '%{http_code}\n' "${URL}data/aws-dva-c02/%2e%2e/mule-mcd-01/questions.json"   # 400
curl -sI "$URL" | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer'
aws lambda get-function-url-config --function-name quizzer-prod-auth   # AuthType AWS_IAM
curl -s -o /dev/null -w '%{http_code}\n' "$(aws lambda get-function-url-config --function-name quizzer-prod-auth --query FunctionUrl --output text)auth/me"   # 403: la URL diretta non è invocabile
aws cloudfront test-function --name quizzer-prod-session-check --if-match "$(aws cloudfront describe-function --name quizzer-prod-session-check --query ETag --output text)" --event-object fileb://infra/edge/test/cf-test-event.json --stage LIVE   # atteso: 302 verso /auth/login
```

Nel browser: login, cambio password, (opzionale) TOTP, ritorno all'app; con solo `ds-aws-dva-c02` la richiesta di
`/data/mule-mcd-01/...` deve dare 403; logout -> `/signed-out.html`.

## 12. Rollback

- **App o dati**: rilancia il workflow del repo su un commit precedente (`workflow_dispatch`), oppure ripristina le
  versioni precedenti degli oggetti S3 (versioning attivo) e invalida.
- **Lambda**: `git checkout <commit> -- infra/lambda`, `npm run build:lambda`, `terraform plan/apply` (solo la Lambda
  cambia).
- **Infrastruttura**: `git revert` della modifica, `terraform plan -out=plan.tfplan`, `check-plan.sh`, `apply`. Lo stato
  precedente è anche nelle versioni del bucket di stato (ultimo rimedio, a mano).
- **Edge function**: come la Lambda (`npm run build:edge`, plan, apply). `publish = true` pubblica subito in LIVE.

## 13. Rotazione della chiave di sessione

Ogni 90 giorni, o subito in caso di incidente:

```bash
scripts/rotate-session-key.sh             # aggiunge la nuova chiave, aspetta 60 s la propagazione, la rende corrente
# dopo almeno 35 minuti (5 min cache Lambda + 30 min sessione):
scripts/rotate-session-key.sh --retire k20260101T120000
```

Nessuno viene disconnesso: per 35 minuti valgono entrambe le chiavi. **Kill switch** (tutti fuori subito, per esempio
chiave compromessa): ruota e poi fai `--retire` della vecchia chiave senza aspettare; gli utenti rifanno il refresh
(il refresh token Cognito resta valido) o il login.

## 14. Offboarding di un collega

```bash
scripts/offboard-user.sh collega@example.com            # disabilita, global sign-out, toglie i gruppi
scripts/offboard-user.sh --delete collega@example.com   # più avanti: cancella l'utente
```

Il refresh token viene revocato subito; il cookie di sessione già emesso vale al massimo altri 30 minuti. Per tagliare
subito usa il kill switch del §13 (disconnette tutti). Togli la persona anche dai repo dati su GitHub. I dati già
scaricati non si possono ritirare.

## 15. Distruggere tutto

Le risorse "permanenti" sono protette due volte (`prevent_destroy` e `deletion_protection` della user pool).

```bash
# 1. svuota i bucket (tutte le versioni e i delete marker); in alternativa: console S3 -> "Empty"
empty_bucket() {
  while :; do
    objs=$(aws s3api list-object-versions --bucket "$1" --output json |
      jq '{Objects: ([.Versions[]?, .DeleteMarkers[]?] | map({Key, VersionId}) | .[:1000]), Quiet: true}')
    [ "$(jq '.Objects | length' <<<"$objs")" -gt 0 ] || break
    aws s3api delete-objects --bucket "$1" --delete "$objs" >/dev/null
  done
}
for o in app_bucket data_bucket logs_bucket; do
  empty_bucket "$(terraform -chdir=infra/live/app output -raw $o)"
done
# 2. togli le protezioni
sed -i 's/prevent_destroy = true/prevent_destroy = false/' infra/modules/*/*.tf
sed -i 's/deletion_protection      = "ACTIVE"/deletion_protection      = "INACTIVE"/' infra/modules/identity/main.tf
terraform -chdir=infra/live/app apply          # applica deletion_protection = INACTIVE
# 3. distruggi
terraform -chdir=infra/live/app destroy
# 4. (opzionale) bootstrap: svuota il bucket di stato, prevent_destroy = false in bootstrap/main.tf,
#    riporta lo stato in locale (commenta il backend, terraform init -migrate-state) e terraform destroy
```

La CloudFront Function associata va prima staccata dalla distribuzione: `destroy` lo fa nell'ordine giusto, ma la
cancellazione della distribuzione richiede che sia disabilitata (Terraform la disabilita e aspetta: 10-20 minuti).
Svuotare un bucket con versioning dalla console ("Empty") è il modo più semplice.

## 16. Costi stimati (circa 20 utenti, eu-central-1)

| Voce | Uso | Costo |
|---|---|---|
| CloudFront (traffico, richieste, Functions, KVS) | circa 4 GB, 150k richieste e invocazioni | 0 (free tier: 1 TB, 10M richieste, 2M invocazioni di funzioni) |
| Lambda `auth` | qualche migliaio di invocazioni | 0 (1M richieste gratis) |
| Cognito Essentials | 20 MAU | 0 (10.000 MAU gratis) |
| SSM Parameter Store standard | 1 parametro | 0 |
| S3 (circa 20 MB più versioni e log) | | < 0,05 USD |
| CloudWatch Logs (90 giorni) | pochi MB | < 0,10 USD |
| KVS | 1 store, letture dalla Lambda | trascurabile |
| **Totale** | | **meno di 0,5 USD/mese**, coperto dai crediti; budget di allarme a 5 USD |

Fonti: https://aws.amazon.com/cloudfront/pricing/, https://aws.amazon.com/lambda/pricing/,
https://aws.amazon.com/cognito/pricing/ (piano v2 §7, senza DynamoDB).

## 17. Limiti noti

- **TLS**: con il certificato di default `*.cloudfront.net` CloudFront impone la security policy `TLSv1` e non si
  cambia; i browser moderni negoziano comunque TLS 1.2/1.3, ma uno scanner segnalerà "TLS 1.0 accettato". Si risolve
  solo con un dominio custom e un certificato ACM (M10). HSTS vale solo per `dXXXX.cloudfront.net`.
- **Stabilità dell'URL**: `dXXXX.cloudfront.net` cambia se la distribuzione viene ricreata: callback Cognito
  (si aggiornano da sole), e-mail d'invito già spedite, segnalibri, PWA installate e localStorage (che è per origine).
  Per questo `prevent_destroy` + `check-plan.sh`. Un dominio custom (M10) rende l'URL indipendente dalla distribuzione.
- I cambi di gruppo valgono al refresh successivo (massimo 30 minuti); un utente disabilitato resta dentro al massimo
  30 minuti (kill switch nel §13).
- **Host della Lambda**: dietro OAC la Lambda vede l'host della Function URL (policy `AllViewerExceptHostHeader`),
  quindi `redirect_uri` usa il primo host configurato in SSM (`appHosts[0]`, il dominio della distribuzione); un
  `Host`/`X-Forwarded-Host` viene usato solo se è nella lista.
- Oggetti mancanti in `/data` rispondono 403 (S3 senza `ListBucket` per CloudFront), non 404.
- Nessun WAF (costerebbe più del budget); la protezione è l'autenticazione all'edge.
- iOS in modalità PWA standalone può aprire il login Cognito in una vista con cookie separati: da provare (M5).
- Account AWS nuovi possono avere un limite di concorrenza Lambda di 10: per questo la Lambda non ha concorrenza
  riservata (`reserved_concurrency = -1`).
- Il refresh token Cognito non ruota (dura 30 giorni dal login).

## 18. Test offline (senza credenziali)

```bash
cd infra
npm test                                  # 400+ test: edge, Lambda, script (AWS CLI finta)
scripts/tf-check.sh terraform             # fmt -check, init -backend=false, validate, test (mock_provider) ovunque
scripts/tf-check.sh tofu                  # idem con OpenTofu
tflint --chdir=live/app --config=$PWD/.tflint.hcl       # ruleset aws 0.43.0 (tflint --init per scaricarlo)
checkov -d . --framework terraform --skip-path node_modules   # skip motivati nel codice (#checkov:skip=...)
```

## 19. Cosa è stato verificato offline e cosa no

Verificato qui (senza AWS): logica della funzione e della Lambda con vettori e casi malevoli, comportamento della
funzione generata in un harness che imita il runtime `cloudfront-js-2.0` (moduli `crypto`/`cloudfront`, sintassi
ammessa), dimensione della funzione, flusso PKCE contro un Cognito finto, bundle della Lambda, Terraform
`validate` + `test` con mock provider (Terraform 1.16.5 e OpenTofu 1.11.0), tflint, checkov, shellcheck, script con
AWS CLI finta.

**Non verificabile senza AWS** (checklist per il primo deploy reale, M5):

- [ ] `terraform apply` va a buon fine al primo colpo (in particolare: header `Cache-Control` come custom header della
      response headers policy di `/data`, logging legacy della distribuzione sul bucket dei log con ACL,
      `aws_cognito_managed_login_branding` con i valori di default, permission Lambda per OAC);
- [ ] la funzione gira davvero nel runtime CloudFront: `aws cloudfront test-function` con un evento con e senza cookie,
      e i tempi/limiti di calcolo;
- [ ] la Lambda legge SSM e il KVS (SigV4A con `@aws-sdk/signature-v4a`) e la prima chiave creata con
      `rotate-session-key.sh --init` viene accettata sia dalla Lambda sia dall'edge;
- [ ] login reale con Cognito managed login (cambio password al primo accesso, TOTP opzionale), callback, cookie
      `__Host-`/`__Secure-` su `dXXXX.cloudfront.net`, refresh e logout (revoca + `/logout` di Cognito);
- [ ] la Function URL diretta risponde 403 (solo CloudFront può invocarla) e `POST /auth/refresh` passa da OAC con
      `x-amz-content-sha256` dell'app;
- [ ] `/data/mule-mcd-01/...` dà 403 a chi non ha `ds-mule-mcd-01`; un utente disabilitato è fuori entro 30 minuti;
- [ ] header di sicurezza presenti (anche CSP con le sorgenti "Avanzate"); PWA installabile; test su iOS e Android;
- [ ] publish dei due dataset con i ruoli OIDC (e un tentativo di scrivere fuori da `data/<id>/` che fallisce);
- [ ] e-mail di invito ricevuta (non in spam) con il link giusto; budget visibile in Billing;
- [ ] `check-plan.sh` su un piano reale (`terraform show -json`), e rotazione della chiave senza disconnessioni.
