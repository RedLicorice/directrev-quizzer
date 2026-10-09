# shellcheck shell=bash
# Shared helpers for the infra scripts (sourced).
# Values default to the outputs of infra/live/app (terraform output), overridable by env.

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF="${TF:-terraform}"

tf_output() {
  # $1 = output name
  (cd "$INFRA_DIR/live/app" && "$TF" output -raw "$1")
}

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 2; }
}

user_pool_id() {
  if [ -n "${USER_POOL_ID:-}" ]; then echo "$USER_POOL_ID"; else tf_output user_pool_id; fi
}

kvs_arn() {
  if [ -n "${KVS_ARN:-}" ]; then echo "$KVS_ARN"; else tf_output kvs_arn; fi
}
