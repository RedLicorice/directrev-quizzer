#!/usr/bin/env bash
# Creates/rotates the HMAC key that signs the session cookie (CONTRACT.md §3.1).
# The key never goes through Terraform state: it is generated here and written straight
# into the CloudFront KeyValueStore (KVS) with the cloudfront-keyvaluestore API.
#
#   rotate-session-key.sh              add a new key, wait for edge propagation, make it current
#   rotate-session-key.sh --init       first key (no wait: nobody is logged in yet)
#   rotate-session-key.sh --list       show kids and the current one (never prints secrets)
#   rotate-session-key.sh --retire K   delete key K (only >= 35 min after it stopped being current;
#                                      retiring the current or a just-replaced key logs everybody out)
#
# Env: KVS_ARN (default: terraform output kvs_arn), WAIT_SECONDS (default 60), AWS_PROFILE...
# KVS API: https://docs.aws.amazon.com/cli/latest/reference/cloudfront-keyvaluestore/
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
need aws
need jq
need openssl

MODE="rotate"
RETIRE=""
case "${1:-}" in
  "") ;;
  --init) MODE="init" ;;
  --list) MODE="list" ;;
  --retire) MODE="retire"; RETIRE="${2:?kid required}" ;;
  -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

ARN="$(kvs_arn)"
WAIT_SECONDS="${WAIT_SECONDS:-60}"
KVS=(aws cloudfront-keyvaluestore)

etag() { "${KVS[@]}" describe-key-value-store --kvs-arn "$ARN" --query ETag --output text; }
current_kid() { "${KVS[@]}" get-key --kvs-arn "$ARN" --key qz-current-kid --query Value --output text 2>/dev/null || true; }
list_kids() {
  "${KVS[@]}" list-keys --kvs-arn "$ARN" --output json | jq -r '.Items[].Key | select(startswith("qz-key-")) | sub("^qz-key-"; "")'
}
put() { "${KVS[@]}" put-key --kvs-arn "$ARN" --key "$1" --value "$2" --if-match "$(etag)" >/dev/null; }

if [ "$MODE" = "list" ]; then
  echo "KVS: $ARN"
  echo "current: $(current_kid)"
  echo "keys:"
  list_kids | sed 's/^/  /'
  exit 0
fi

if [ "$MODE" = "retire" ]; then
  [[ "$RETIRE" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || { echo "invalid kid" >&2; exit 2; }
  if [ "$RETIRE" = "$(current_kid)" ]; then
    echo "refusing to delete the current key $RETIRE (rotate first)" >&2
    exit 1
  fi
  "${KVS[@]}" delete-key --kvs-arn "$ARN" --key "qz-key-$RETIRE" --if-match "$(etag)" >/dev/null
  echo "deleted qz-key-$RETIRE (sessions signed with it are now invalid)"
  exit 0
fi

OLD="$(current_kid)"
if [ "$MODE" = "init" ] && [ -n "$OLD" ] && [ "$OLD" != "None" ]; then
  echo "a current key already exists ($OLD): use rotation without --init" >&2
  exit 1
fi

KID="k$(date -u +%Y%m%dT%H%M%S)"
# 32 random bytes, base64url without padding = 43 chars. The HMAC key is this string.
SECRET="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
[ "${#SECRET}" -eq 43 ] || { echo "key generation failed" >&2; exit 1; }

put "qz-key-$KID" "$SECRET"
unset SECRET
echo "added qz-key-$KID"

if [ "$MODE" = "rotate" ] && [ "$WAIT_SECONDS" -gt 0 ]; then
  echo "waiting ${WAIT_SECONDS}s for the new key to reach the edge locations..."
  sleep "$WAIT_SECONDS"
fi
put qz-current-kid "$KID"
echo "current kid -> $KID"
if [ -n "$OLD" ] && [ "$OLD" != "None" ]; then
  echo "previous kid: $OLD. Retire it in >= 35 minutes (5 min Lambda cache + 30 min session):"
  echo "  $0 --retire $OLD"
fi
