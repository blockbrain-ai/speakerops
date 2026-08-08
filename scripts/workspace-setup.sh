#!/usr/bin/env bash
# Workspace dependency setup — no credentials.
set -euo pipefail
cd /data/speakerops-build
if ! command -v pnpm >/dev/null 2>&1; then npm i -g pnpm@9; fi
if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then
    # Frozen after lockfile exists — refuse silent lockfile drift
    before=$(sha256sum pnpm-lock.yaml | awk '{print $1}')
    pnpm install --frozen-lockfile
    after=$(sha256sum pnpm-lock.yaml | awk '{print $1}')
    if [ "$before" != "$after" ]; then
      echo "[setup] ERROR: pnpm-lock.yaml changed under frozen install" >&2
      exit 1
    fi
  else
    echo "[setup] bootstrap: no lockfile yet — pnpm install (one-time)"
    pnpm install
  fi
fi
echo "[setup] ok"
