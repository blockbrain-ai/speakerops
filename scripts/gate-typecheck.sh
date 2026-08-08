#!/usr/bin/env bash
set -euo pipefail
cd /data/speakerops-build
if [ -f package.json ]; then
  pnpm typecheck
else
  echo "[gate] pre-scaffold typecheck skip"
fi
