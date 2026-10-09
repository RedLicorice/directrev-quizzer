# Plan v3 = aws-plan-v2.md + these DELTAS (deltas win over v2 wherever they conflict)

Base plan: /tmp/claude-0/-home-user-directrev-quizzer/d653f28f-48ac-5b58-9379-cc749dd0d3f1/scratchpad/aws-plan-v2.md (Italian). User decisions below were taken AFTER v2 was written.

## Removed from scope
1. NO server-side progress, NO DynamoDB, NO `api` sync Lambda, NO "I miei dati" screen, NO sync/outbox/merge code, NO cross-device sync (v2 M6 is dropped).
   Progress (stats, notes, history, practice draft) stays in the browser (localStorage), but keys are separated PER USER in the AWS build: `u:<sub>:hosted:<datasetId>` (see v2 §5.1 `datasetKey`). Existing backup/export stays. Keep the compact session record idea only if trivially useful; otherwise skip.
2. NO statistics, scoreboards, per-question error rates, server-side scoring, SUM items, GSIs, DynamoDB Streams, and NO transparency notice (v2 M8 and §5.4 are dropped). The admin panel later (M7, NOT in the current batch) does only user management.
3. NO passkeys. MFA = Cognito `mfa_configuration = OPTIONAL` with TOTP (software token) only. Drop: passkey enforcement in the auth Lambda, `/passkeys/add`, `passkey-required` AuthGate state, the `terraform_data` FactorConfiguration workaround, RP-ID discussions, `set-mfa-config.sh`, email-OTP/SES. Cognito prefix domain is kept (no permanence constraint any more).
4. Phase 1 domain = default `dXXXX.cloudfront.net`. NO Cloudflare, NO ACM, NO `live/domain` in this batch (v2 M10 stays optional/later).
5. Audit trail for later admin actions: CloudWatch logs (no DynamoDB).

## Simplification to adopt (justify in your report if you deviate)
Without DynamoDB there is no need for an `api` Lambda just to list datasets. Preferred design: the `auth` Lambda's `/auth/me` returns `{sub,email,name?,ds:[datasetIds],adm,exp}`; each dataset repo publishes `data/<id>/index.json` (+ `questions.json`, `images/`); the hosted source lists `session.ds` and fetches `/data/<id>/index.json` per allowed dataset (the CloudFront Function authorizes by path prefix). For `ds=["*"]` (owner/admin) the list of existing dataset ids comes from the SSM config parameter (exposed by `/auth/me` as `allDatasets`). Only Lambdas needed now: `auth`. (`admin` comes later in M7.)

## Unchanged from v2 (follow it)
Architecture (CloudFront + OAC S3 app/data buckets + CF Function session-check + KVS HMAC key + Lambda `auth` Function URL with OAC), cookie names/attributes (`__Host-qz_session`, `__Secure-qz_refresh` Path=/auth), claims `{sub,email,ds[],adm,exp}` HS256 with `kid`, Cognito Essentials invite-only, groups `ds-<datasetId>` (+ `ds-all`, `admin`), PKCE handled by the Lambda, Terraform layout (v2 §4) with OpenTofu compatibility, state strategy (S3 + native lockfile), tests without credentials (`terraform test` mock providers, tflint, trivy/checkov), CI OIDC roles per repo, data pipeline per repo (v2 §5.5), two builds from one codebase (`vite build` = GitHub Pages unchanged, `vite build --mode aws`), service-worker denylist/NetworkOnly for /data, self-hosted fonts, mock edge/gateway as reference implementation for local tests.

## Fixed defaults
Region eu-central-1 (everything; us-east-1 only for a future ACM cert). Dataset ids: `aws-dva-c02` (repo RedLicorice/quizzer-dataset-aws-dva-c02), `mule-mcd-01` (repo RedLicorice/quizzer-dataset-mule-mcd-01, third-party exam-dump material: group `ds-mule-mcd-01` has only the owner for now). Include an `aws_budgets_budget` of 5 USD in Terraform and a runbook note to switch the AWS account to the Paid plan (Free plan closes the account after 6 months). Single environment `prod` (a second workspace for dev is documented, not required).

## Hard constraints for every agent
- You have NO cloud credentials: deliverable = code, Terraform, tests, runbooks. Nothing is deployed, no AWS/Cloudflare API calls. Terraform/tofu/tflint/checkov binaries can be downloaded in the sandbox (outbound HTTPS via proxy; pin versions in URLs; releases.hashicorp.com, registry.terraform.io, github release assets and pypi were verified reachable). Put downloaded tools and scratch files outside the repos, in your scratchpad directory.
- DATA RULE: dataset content (questions/images of the two datasets) must never be copied into the application repo. Only the dataset repos hold it.
- Commit in small logical commits on your own branch and push the branch (`git push -u origin <branch>`). Never push to `main`, never force-push, never open a PR (the lead will). Commit trailer (every commit): "Co-Authored-By: Claude Opus <noreply@anthropic.com>" and "Claude-Session: https://claude.ai/code/session_01UqovMYmuJK51F6d9kULk2g".
- Run the repo's checks before every push (build/tsc/tests/terraform validate as applicable). Report honestly what is untested (anything that needs real AWS).
- Final report in Italian: what was built (files), how it was verified (commands and results), what remains, deviations from the plan with reasons, branch names pushed.
