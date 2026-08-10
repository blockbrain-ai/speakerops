#!/usr/bin/env bash
set -euo pipefail
# made-pilot canonical
if [ -f /root/.config/speakerops/secrets.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /root/.config/speakerops/secrets.env
  set +a
fi
# made-pilot workspace mirror
if [ -f /data/speakerops-build/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /data/speakerops-build/.env
  set +a
fi
# Operator laptop (~/.config/speakerops/secrets.env, mode 600, never in git)
if [ -f "${HOME}/.config/speakerops/secrets.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${HOME}/.config/speakerops/secrets.env"
  set +a
fi
exec "$@"
