#!/usr/bin/env bash
set -euo pipefail
if [ -f /root/.config/speakerops/secrets.env ]; then set -a; source /root/.config/speakerops/secrets.env; set +a; fi
if [ -f /data/speakerops-build/.env ]; then set -a; source /data/speakerops-build/.env; set +a; fi
cd /data/speakerops-build
if ! command -v pnpm >/dev/null 2>&1; then npm i -g pnpm@9; fi
if [ -f package.json ]; then pnpm install; fi
echo "[setup] ok AIRTABLE_BASE_ID=${AIRTABLE_BASE_ID:-unset} CF_ACCOUNT=${CLOUDFLARE_ACCOUNT_ID:-unset}"
