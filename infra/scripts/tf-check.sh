#!/usr/bin/env bash
# Offline Terraform/OpenTofu checks (no AWS credentials needed):
#   fmt -check, init -backend=false, validate, test (mock providers) on every root and module.
# Usage: scripts/tf-check.sh [terraform|tofu]   (default: terraform; or TF=/path/to/binary)
set -euo pipefail
TF="${TF:-${1:-terraform}}"
cd "$(dirname "$0")/.."
DIRS=(bootstrap modules/edge modules/site modules/identity modules/lambdas modules/ci live/app)

echo "== $("$TF" version | head -1)"
# Terraform and OpenTofu write the same .terraform.lock.hcl (with different registry
# addresses): back up the committed lock files and restore them on exit.
BACKUP="$(mktemp -d)"
for d in "${DIRS[@]}"; do
  if [ -f "$d/.terraform.lock.hcl" ]; then mkdir -p "$BACKUP/$d"; cp "$d/.terraform.lock.hcl" "$BACKUP/$d/"; fi
done
restore() {
  for d in "${DIRS[@]}"; do
    if [ -f "$BACKUP/$d/.terraform.lock.hcl" ]; then cp "$BACKUP/$d/.terraform.lock.hcl" "$d/"; fi
  done
  rm -rf "$BACKUP"
}
trap restore EXIT
"$TF" fmt -recursive -check -diff .
for d in "${DIRS[@]}"; do
  echo "== $d"
  (cd "$d" && "$TF" init -backend=false -input=false >/dev/null)
  (cd "$d" && "$TF" validate -no-color)
  if [ -d "$d/tests" ]; then
    (cd "$d" && "$TF" test -no-color)
    # OpenTofu (1.11) cannot tear down mocked resources that have prevent_destroy and leaves
    # errored_test.tfstate behind (exit code 0, assertions unaffected): drop it.
    rm -f "$d/errored_test.tfstate"
  fi
done
echo "OK: all roots and modules validated and tested with $TF"
