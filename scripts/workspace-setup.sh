#!/usr/bin/env bash
# Workspace dependency setup — no credentials.
# Install must run before any secret loading so package lifecycle / transitive
# install scripts never see Cloudflare/Airtable tokens.
# Use scripts/with-secrets.sh only for explicit integration/deploy commands.
set -euo pipefail
cd /data/speakerops-build
if ! command -v pnpm >/dev/null 2>&1; then npm i -g pnpm@9; fi
if [ -f package.json ]; then pnpm install; fi
echo "[setup] ok"
