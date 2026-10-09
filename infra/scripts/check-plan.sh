#!/usr/bin/env bash
# Fails if a Terraform/OpenTofu plan deletes or replaces a resource whose identity must
# stay stable (plan v2 §4.4): the CloudFront distribution (its domain is in Cognito, the
# invitation e-mails and bookmarks), the Cognito user pool and its domain (all users and
# their MFA), the session KeyValueStore (keys = every session), the data bucket and the
# state bucket.
#
# Usage (from infra/live/app):
#   terraform plan -out=plan.tfplan
#   ../../scripts/check-plan.sh plan.tfplan          # uses `terraform show -json`
#   ../../scripts/check-plan.sh --json plan.json     # already rendered JSON
# Env: TF=tofu to use OpenTofu.
set -euo pipefail
TF="${TF:-terraform}"

if [ "${1:-}" = "--json" ]; then
  [ -f "${2:-}" ] || { echo "usage: $0 --json plan.json" >&2; exit 2; }
  JSON="$(cat "$2")"
elif [ -n "${1:-}" ]; then
  JSON="$("$TF" show -json "$1")"
else
  echo "usage: $0 <plan.tfplan> | --json <plan.json>" >&2
  exit 2
fi

PROTECTED_TYPES='["aws_cloudfront_distribution","aws_cognito_user_pool","aws_cognito_user_pool_domain","aws_cloudfront_key_value_store"]'
# Buckets are protected by address suffix (the app and logs buckets may be recreated).
PROTECTED_ADDR_RE='(aws_s3_bucket\.data|aws_s3_bucket\.state)$'

BAD="$(printf '%s' "$JSON" | jq -r --argjson types "$PROTECTED_TYPES" --arg re "$PROTECTED_ADDR_RE" '
  [.resource_changes[]?
   | select(.change.actions | index("delete"))
   | select((.type as $t | $types | index($t)) or (.address | test($re)))
   | "\(.address)  (\(.change.actions | join("+")))"]
  | .[]')"

if [ -n "$BAD" ]; then
  echo "REFUSED: the plan deletes or replaces protected resources:" >&2
  printf '  %s\n' "$BAD" >&2
  echo "Do NOT apply. Check variables/refactors (use moved {} blocks); see infra/README.md." >&2
  exit 1
fi

CHANGES="$(printf '%s' "$JSON" | jq -r '[.resource_changes[]? | select(.change.actions != ["no-op"])] | length')"
echo "OK: no protected resource is deleted or replaced ($CHANGES resource changes)."
