#!/usr/bin/env bash
# Live Accelevents ping. Not part of test:ci.
# Exit 30 = precondition-missing (no key). Never skip/pass without a key.
set -euo pipefail
if [[ -z "${ACCELEVENTS_API_KEY:-}" ]]; then
  echo "ACCELEVENTS_API_KEY unset — live ping not executed" >&2
  exit 30
fi
echo "Key present — this script does not call the live API from CI." >&2
echo "Use a dedicated operator session against developer.accelevents.com." >&2
exit 30
