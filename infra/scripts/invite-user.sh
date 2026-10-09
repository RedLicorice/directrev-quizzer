#!/usr/bin/env bash
# Invites a user (Cognito AdminCreateUser: e-mail with a temporary password) and adds them
# to groups. Groups: ds-<datasetId>, ds-all (every dataset), admin.
#
#   invite-user.sh mario.rossi@example.com ds-aws-dva-c02
#   invite-user.sh me@example.com admin ds-all
#   invite-user.sh --resend mario.rossi@example.com      # new invitation e-mail
#
# A user without ds-*/ds-all/admin groups can sign in to Cognito but gets no session
# ("accesso non abilitato"). ds-mule-mcd-01 contains third-party exam material:
# it requires --confirm-mcd (plan v2 §6).
# Env: USER_POOL_ID (default: terraform output user_pool_id).
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$(dirname "$0")/lib.sh"
need aws

RESEND=0
CONFIRM_MCD=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --resend) RESEND=1 ;;
    --confirm-mcd) CONFIRM_MCD=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) ARGS+=("$a") ;;
  esac
done
[ "${#ARGS[@]}" -ge 1 ] || { echo "usage: $0 [--resend] <email> [group...]" >&2; exit 2; }
EMAIL="${ARGS[0]}"
GROUPS_TO_ADD=("${ARGS[@]:1}")
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "invalid e-mail: $EMAIL" >&2; exit 2; }
for g in "${GROUPS_TO_ADD[@]}"; do
  [[ "$g" =~ ^(admin|ds-all|ds-[a-z0-9][a-z0-9-]{0,62})$ ]] || { echo "invalid group: $g" >&2; exit 2; }
  if [ "$g" = "ds-mule-mcd-01" ] && [ "$CONFIRM_MCD" -ne 1 ]; then
    echo "ds-mule-mcd-01 contains third-party exam-dump material: re-run with --confirm-mcd if you really mean it." >&2
    exit 1
  fi
done

POOL="$(user_pool_id)"

if [ "$RESEND" -eq 1 ]; then
  aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
    --message-action RESEND --desired-delivery-mediums EMAIL >/dev/null
  echo "invitation re-sent to $EMAIL"
else
  aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --desired-delivery-mediums EMAIL >/dev/null
  echo "invited $EMAIL (temporary password sent by e-mail, valid 7 days)"
fi

for g in "${GROUPS_TO_ADD[@]}"; do
  aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" --group-name "$g"
  echo "  + $g"
done
if [ "${#GROUPS_TO_ADD[@]}" -eq 0 ] && [ "$RESEND" -eq 0 ]; then
  echo "warning: no groups: the user will see 'accesso non abilitato' until you add ds-<id>." >&2
fi
