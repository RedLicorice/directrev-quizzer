#!/usr/bin/env bash
# Offboards a user: disable, global sign-out (revokes refresh tokens), remove from all
# groups. The current session cookie stays valid until it expires (<= 30 min); for an
# immediate cut-off of EVERYONE rotate the HMAC key and retire the old one at once.
#
#   offboard-user.sh mario.rossi@example.com            # disable + sign out + remove groups
#   offboard-user.sh --delete mario.rossi@example.com   # also delete the user (irreversible)
# Env: USER_POOL_ID (default: terraform output user_pool_id).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
need aws

DELETE=0
if [ "${1:-}" = "--delete" ]; then DELETE=1; shift; fi
EMAIL="${1:?usage: $0 [--delete] <email>}"
POOL="$(user_pool_id)"

aws cognito-idp admin-disable-user --user-pool-id "$POOL" --username "$EMAIL"
echo "disabled $EMAIL"
aws cognito-idp admin-user-global-sign-out --user-pool-id "$POOL" --username "$EMAIL"
echo "refresh tokens revoked (session cookie expires within 30 minutes)"
for g in $(aws cognito-idp admin-list-groups-for-user --user-pool-id "$POOL" --username "$EMAIL" --query 'Groups[].GroupName' --output text); do
  aws cognito-idp admin-remove-user-from-group --user-pool-id "$POOL" --username "$EMAIL" --group-name "$g"
  echo "  - $g"
done
if [ "$DELETE" -eq 1 ]; then
  aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$EMAIL"
  echo "deleted $EMAIL"
fi
echo "Remember: remove the person from the GitHub dataset repositories too."
