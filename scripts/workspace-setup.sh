#!/usr/bin/env bash
set -euo pipefail
cd /data/speakerops-build
if ! command -v pnpm >/dev/null 2>&1; then
  npm i -g pnpm@9
fi
if [ -f package.json ]; then
  pnpm install
fi
echo "[setup] ok"
