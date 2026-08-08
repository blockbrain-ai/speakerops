#!/usr/bin/env bash
set -euo pipefail
if [ -f /root/.config/speakerops/secrets.env ]; then set -a; source /root/.config/speakerops/secrets.env; set +a; fi
if [ -f /data/speakerops-build/.env ]; then set -a; source /data/speakerops-build/.env; set +a; fi
cd /data/speakerops-build
if [ -f package.json ]; then pnpm test:ci; else echo "[gate] pre-scaffold test skip"; fi
