#!/usr/bin/env bash
# General typecheck gate — no deployment secrets.
# Typecheck does not need Cloudflare/Airtable credentials.
# Use scripts/with-secrets.sh only for explicit integration/deploy commands.
set -euo pipefail
cd /data/speakerops-build
if [ -f package.json ]; then pnpm typecheck; else echo "[gate] pre-scaffold typecheck skip"; fi
