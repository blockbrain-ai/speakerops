#!/usr/bin/env bash
set -euo pipefail
cd /data/speakerops-build
if [ -f package.json ]; then
  pnpm test:ci
else
  echo "[gate] pre-scaffold test skip"
fi
