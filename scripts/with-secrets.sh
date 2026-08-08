#!/usr/bin/env bash
set -euo pipefail
if [ -f /root/.config/speakerops/secrets.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /root/.config/speakerops/secrets.env
  set +a
fi
if [ -f /data/speakerops-build/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /data/speakerops-build/.env
  set +a
fi
exec "$@"
