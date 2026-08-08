#!/usr/bin/env bash
# General test gate — no deployment secrets.
# Phase 0 (and unit/governance) tests must not receive Cloudflare/Airtable tokens.
# Use scripts/with-secrets.sh only for explicit integration/deploy commands.
set -euo pipefail
cd /data/speakerops-build
if [ -f package.json ]; then pnpm test:ci; else echo "[gate] pre-scaffold test skip"; fi
