#!/usr/bin/env bash
# Section 8.6 + 11.9 — Cloudflare dogfood deploy (S-CF / S-DOGFOOD / BC10 / BC-16)
#
# Deploys Worker + SPA assets to the dogfood Worker bound to www.speakerops.org
# (speakerops-demo), smokes GET /health on the binding URL, and writes redacted
# evidence for BUILD_CHECKLIST BC10 + phase 11.9 deploy.md.
#
# Env **names** only in docs (E10). Load secrets out-of-band:
#   scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
#
# Required env (values never committed):
#   CLOUDFLARE_API_TOKEN
#   CLOUDFLARE_ACCOUNT_ID
#
# Optional env **names**:
#   SPEAKEROPS_D1_DATABASE_ID   — real D1 id (overrides wrangler.toml dogfood id)
#   WRANGLER_BIN               — path/command for wrangler (default: resolve)
#   DOGFOOD_WORKER_NAME        — worker name (default: speakerops-demo)
#   DOGFOOD_WRANGLER_ENV       — wrangler --env (default: dogfood)
#   DOGFOOD_EVIDENCE_PATH      — BC10 evidence out path
#   DOGFOOD_PHASE11_EVIDENCE   — phase 11.9 deploy.md path
#   DOGFOOD_SKIP_DEPLOY=1      — skip wrangler deploy (health-only against SMOKE_BASE_URL)
#   DOGFOOD_SKIP_WEB_BUILD=1   — skip pnpm web build (assets already present)
#   SMOKE_BASE_URL             — base URL for health smoke (default: https://www.speakerops.org)
#   DEPLOY_DRY_RUN=1           — validate creds + write dry-run evidence; no network deploy
#
# Exit codes:
#   0 — success (creds present and smoke path completed)
#   1 — missing credentials or deploy/smoke failure
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WORKER_NAME="${DOGFOOD_WORKER_NAME:-speakerops-demo}"
WRANGLER_ENV="${DOGFOOD_WRANGLER_ENV:-dogfood}"
EVIDENCE_PATH="${DOGFOOD_EVIDENCE_PATH:-$ROOT/KMS-competition/initiative/evidence/cf-dogfood.txt}"
PHASE11_EVIDENCE="${DOGFOOD_PHASE11_EVIDENCE:-$ROOT/initiative/PHASE10_11_GAP_CLOSE/evidence/deploy.md}"
# S-DOGFOOD binding URL — constitution: www.speakerops.org only (no alternate for claim)
BINDING_SMOKE_URL="https://www.speakerops.org"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-$ROOT/wrangler.toml}"
TIMESTAMP_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_SHA_FULL="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
APP_VERSION="${DOGFOOD_APP_VERSION:-0.1.0-demo+${GIT_SHA}}"

die() {
  echo "deploy-dogfood: ERROR: $*" >&2
  exit 1
}

info() {
  echo "deploy-dogfood: $*" >&2
}

# --- credential gate (named test: exits nonzero without creds with message) ---
missing=()
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  missing+=("CLOUDFLARE_API_TOKEN")
fi
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  missing+=("CLOUDFLARE_ACCOUNT_ID")
fi

if ((${#missing[@]} > 0)); then
  echo "deploy-dogfood: missing required Cloudflare credentials: ${missing[*]}" >&2
  echo "deploy-dogfood: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (names only in docs; values via secrets.env / with-secrets.sh)" >&2
  echo "deploy-dogfood: see docs/OPERATIONS.md and docs/SECRETS.md" >&2
  exit 1
fi

info "credentials present (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID) — continuing"

# --- redaction helpers (never write secrets or full account ids to evidence) ---
redact_url() {
  local url="$1"
  url="${url%%\?*}"
  url="${url%%#*}"
  if [[ "$url" =~ ^(https?://)([a-zA-Z0-9-]+)\.([a-zA-Z0-9-]+)\.workers\.dev(.*)$ ]]; then
    echo "${BASH_REMATCH[1]}${BASH_REMATCH[2]}.***.workers.dev${BASH_REMATCH[4]}"
    return
  fi
  if [[ "$url" =~ ^(https?://)([a-zA-Z0-9-]+)\.workers\.dev(.*)$ ]]; then
    echo "${BASH_REMATCH[1]}${BASH_REMATCH[2]}.workers.dev${BASH_REMATCH[3]}"
    return
  fi
  # Keep www.speakerops.org fully (public dogfood claim URL — not a secret)
  if [[ "$url" == *"speakerops.org"* ]]; then
    echo "$url"
    return
  fi
  if [[ "$url" =~ ^(https?://)([^/]+)(.*)$ ]]; then
    local host="${BASH_REMATCH[2]}"
    local path="${BASH_REMATCH[3]}"
    local first="${host%%.*}"
    echo "${BASH_REMATCH[1]}${first}.***${path}"
    return
  fi
  echo "[REDACTED_URL]"
}

redact_text() {
  local text="$1"
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    text="${text//"${CLOUDFLARE_API_TOKEN}"/[REDACTED_TOKEN]}"
  fi
  if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    text="${text//"${CLOUDFLARE_ACCOUNT_ID}"/[REDACTED_ACCOUNT_ID]}"
  fi
  text="$(printf '%s' "$text" | sed -E \
    -e 's/[Bb]earer [A-Za-z0-9._~+\/-]{20,}/Bearer [REDACTED]/g' \
    -e 's/api[_-]?key[=: ]+["'"'"']?[A-Za-z0-9._-]{16,}/api_key=[REDACTED]/gi')"
  printf '%s' "$text"
}

resolve_wrangler() {
  if [[ -n "${WRANGLER_BIN:-}" ]]; then
    echo "$WRANGLER_BIN"
    return
  fi
  if command -v wrangler >/dev/null 2>&1; then
    command -v wrangler
    return
  fi
  if [[ -x "$ROOT/node_modules/.bin/wrangler" ]]; then
    echo "$ROOT/node_modules/.bin/wrangler"
    return
  fi
  if [[ -f "$ROOT/node_modules/wrangler/package.json" ]]; then
    echo "pnpm exec wrangler"
    return
  fi
  echo ""
}

write_evidence() {
  local status="$1"
  local health_code="${2:-}"
  local health_body="${3:-}"
  local smoke_url_raw="${4:-}"
  local notes="${5:-}"
  local redacted_url=""
  if [[ -n "$smoke_url_raw" ]]; then
    redacted_url="$(redact_url "$smoke_url_raw")"
  else
    redacted_url="(not set — run live deploy or set SMOKE_BASE_URL)"
  fi
  local safe_body
  safe_body="$(redact_text "${health_body:-}")"
  mkdir -p "$(dirname "$EVIDENCE_PATH")"
  cat >"$EVIDENCE_PATH" <<EOF
# BC10 / S-CF — Cloudflare dogfood health evidence (section 8.6 / 11.9)

Section: 8.6 + 11.9 Cloudflare dogfood deploy
Workspace: speakerops-build
Date (UTC): ${TIMESTAMP_UTC}
Git SHA: ${GIT_SHA}
Git SHA (full): ${GIT_SHA_FULL}
App version: ${APP_VERSION}
Status: ${status}

## Claim

Dogfood URL returns GET /health → 200 with body \`{ "ok": true, "version": string }\`.
S-DOGFOOD binds **https://www.speakerops.org** only. Deploy uses env **names** only;
secret **values** never committed (E10).

Souls: **S-CF** · **S-DOGFOOD** · BUILD_CHECKLIST **BC10** · **BC-16**

## Evidence path

This file: KMS-competition/initiative/evidence/cf-dogfood.txt
Phase 11.9: initiative/PHASE10_11_GAP_CLOSE/evidence/deploy.md
Template: KMS-competition/initiative/evidence/cf-dogfood.template.txt
Deploy script: scripts/deploy-dogfood.sh
Operations: docs/OPERATIONS.md
wrangler: wrangler.toml [env.dogfood] (binding **names** only)

## URL redaction rules (binding)

1. Never write CLOUDFLARE_API_TOKEN, API keys, session cookies, or magic-link tokens.
2. Never write full CLOUDFLARE_ACCOUNT_ID — replace with \`[REDACTED_ACCOUNT_ID]\`.
3. workers.dev hosts: keep worker service label; redact account subdomain as \`***\`.
4. www.speakerops.org is the public dogfood claim URL and may appear in full.
5. Strip query strings and fragments from recorded URLs (may contain tokens).
6. Health body may include public \`version\` only — no env dumps.

## Smoke result

| Field | Value |
|-------|-------|
| Base URL | ${redacted_url} |
| GET /health HTTP status | ${health_code:-n/a} |
| Health body (redacted) | ${safe_body:-n/a} |
| Worker name | ${WORKER_NAME} |
| Wrangler env | ${WRANGLER_ENV} |
| Deploy revision (git) | ${GIT_SHA} |
| App version | ${APP_VERSION} |

## Notes

${notes}

## Reproduce (operator)

\`\`\`bash
# Load secrets out-of-band (never commit values)
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh

# Optional: health-only re-smoke against binding URL
SMOKE_BASE_URL=https://www.speakerops.org \\
  DOGFOOD_SKIP_DEPLOY=1 \\
  scripts/with-secrets.sh bash scripts/deploy-dogfood.sh

# Phase 11.9 keystone (all 18 souls D)
scripts/with-secrets.sh pnpm test:e2e:phase11-keystone
\`\`\`

## Gate local proof (no CF network)

- assert deploy script exits nonzero without creds with message
- assert OPERATIONS.md lists wrangler steps
- assert evidence template path exists
- Local GET /health 200: apps/api/src/health.test.ts (section 1.2)

Env **names** only (E10): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
SPEAKEROPS_D1_DATABASE_ID, SMOKE_BASE_URL, DOGFOOD_SKIP_DEPLOY, DEPLOY_DRY_RUN,
DOGFOOD_EVIDENCE_PATH, DOGFOOD_PHASE11_EVIDENCE, WRANGLER_BIN, DOGFOOD_WORKER_NAME,
DOGFOOD_WRANGLER_ENV, DOGFOOD_SKIP_WEB_BUILD, DOGFOOD_APP_VERSION.
EOF
  info "wrote BC10 evidence → $EVIDENCE_PATH"

  # Phase 11.9 deploy.md (S-DOGFOOD revision + health)
  mkdir -p "$(dirname "$PHASE11_EVIDENCE")"
  cat >"$PHASE11_EVIDENCE" <<EOF
# Section 11.9 — Dogfood deploy evidence (S-DOGFOOD)

| Field | Value |
|-------|-------|
| **Status** | ${status} |
| **Timestamp (UTC)** | ${TIMESTAMP_UTC} |
| **Git SHA (short)** | \`${GIT_SHA}\` |
| **Git SHA (full)** | \`${GIT_SHA_FULL}\` |
| **App version** | \`${APP_VERSION}\` |
| **Worker name** | \`${WORKER_NAME}\` |
| **Wrangler env** | \`${WRANGLER_ENV}\` |
| **Binding URL** | https://www.speakerops.org |
| **GET /health** | ${health_code:-n/a} |
| **Health body** | ${safe_body:-n/a} |
| **Smoke base (recorded)** | ${redacted_url} |

## Claim

S-DOGFOOD: deploy healthy at **https://www.speakerops.org** only; revision + timestamp recorded;
keystone e2e non-skipped for all **18** constitution soul IDs (see \`SOUL_EVIDENCE_TABLE.md\`).

## Reproduce

\`\`\`bash
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
# Health-only:
SMOKE_BASE_URL=https://www.speakerops.org DOGFOOD_SKIP_DEPLOY=1 \\
  scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
\`\`\`

## Notes

${notes}

## Related evidence

| Artifact | Path |
|----------|------|
| BC10 / S-CF | \`KMS-competition/initiative/evidence/cf-dogfood.txt\` |
| Soul table | \`initiative/PHASE10_11_GAP_CLOSE/evidence/SOUL_EVIDENCE_TABLE.md\` |
| Keystone | \`playwright/e2e/phase11_handover_keystone.spec.ts\` |
| Handover | \`initiative/PHASE10_11_GAP_CLOSE/evidence/PRODUCTION_HANDOVER_WAVE.md\` |

Secrets: never commit CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID values (E10).
EOF
  info "wrote phase11 deploy evidence → $PHASE11_EVIDENCE"
}

# --- dry-run path: creds present, no network deploy ---
if [[ "${DEPLOY_DRY_RUN:-}" == "1" ]]; then
  info "DEPLOY_DRY_RUN=1 — validating config only (no wrangler deploy)"
  [[ -f "$WRANGLER_CONFIG" ]] || die "wrangler.toml missing at $WRANGLER_CONFIG"
  write_evidence \
    "DRY_RUN" \
    "" \
    "" \
    "${SMOKE_BASE_URL:-$BINDING_SMOKE_URL}" \
    "Dry-run only. Credentials were present; wrangler deploy was not invoked.
Live dogfood smoke requires DEPLOY_DRY_RUN unset and network access to Cloudflare.
See docs/OPERATIONS.md for wrangler create D1/R2/queue + secret put steps."
  info "dry-run complete (exit 0)"
  exit 0
fi

# --- resolve smoke URL: default binding URL for S-DOGFOOD ---
SMOKE_URL="${SMOKE_BASE_URL:-$BINDING_SMOKE_URL}"

if [[ "${DOGFOOD_SKIP_DEPLOY:-}" == "1" ]]; then
  info "DOGFOOD_SKIP_DEPLOY=1 — skipping wrangler deploy"
  [[ -n "$SMOKE_URL" ]] || die "DOGFOOD_SKIP_DEPLOY=1 requires SMOKE_BASE_URL for health smoke"
else
  WRANGLER="$(resolve_wrangler)"
  if [[ -z "$WRANGLER" ]]; then
    die "wrangler not found. Install: pnpm add -Dw wrangler  OR  set WRANGLER_BIN. See docs/OPERATIONS.md"
  fi
  info "using wrangler: $WRANGLER"
  [[ -f "$WRANGLER_CONFIG" ]] || die "wrangler.toml missing at $WRANGLER_CONFIG"

  # Build SPA assets for Workers Assets (env.dogfood.assets.directory)
  if [[ "${DOGFOOD_SKIP_WEB_BUILD:-}" != "1" ]]; then
    info "building @speakerops/web (Vite → apps/web/dist) for dogfood assets"
    pnpm --filter @speakerops/web build || die "web build failed"
    [[ -f "$ROOT/apps/web/dist/index.html" ]] || die "apps/web/dist/index.html missing after build"
  else
    info "DOGFOOD_SKIP_WEB_BUILD=1 — expecting apps/web/dist already present"
    [[ -f "$ROOT/apps/web/dist/index.html" ]] || die "apps/web/dist/index.html missing (build SPA or unset DOGFOOD_SKIP_WEB_BUILD)"
  fi

  # Optional D1 id override (names in docs; values from secrets/env)
  CONFIG_FOR_DEPLOY="$WRANGLER_CONFIG"
  if [[ -n "${SPEAKEROPS_D1_DATABASE_ID:-}" ]]; then
    info "SPEAKEROPS_D1_DATABASE_ID set — injecting D1 database_id for deploy"
    OVERRIDE_TOML="$(mktemp "${TMPDIR:-/tmp}/wrangler-dogfood.XXXXXX.toml")"
    # shellcheck disable=SC2064
    trap 'rm -f "$OVERRIDE_TOML"' EXIT
    sed -E "s/database_id = \"[^\"]+\"/database_id = \"${SPEAKEROPS_D1_DATABASE_ID}\"/" \
      "$WRANGLER_CONFIG" >"$OVERRIDE_TOML"
    CONFIG_FOR_DEPLOY="$OVERRIDE_TOML"
  fi

  info "deploying worker ${WORKER_NAME} --env ${WRANGLER_ENV} (account id redacted in logs)"
  info "APP_VERSION=${APP_VERSION}"
  set +e
  DEPLOY_LOG="$(mktemp "${TMPDIR:-/tmp}/dogfood-deploy.XXXXXX.log")"
  # Note: with --env, Worker name comes from [env.<env>].name in wrangler.toml
  # (legacy mode forbids --name + --env together).
  # shellcheck disable=SC2086
  $WRANGLER deploy \
    --config "$CONFIG_FOR_DEPLOY" \
    --env "$WRANGLER_ENV" \
    --var "APP_VERSION:${APP_VERSION}" \
    --keep-vars \
    >"$DEPLOY_LOG" 2>&1
  deploy_rc=$?
  set -e

  if [[ $deploy_rc -ne 0 ]]; then
    redact_text "$(tail -n 60 "$DEPLOY_LOG")" >&2 || true
    rm -f "$DEPLOY_LOG"
    write_evidence \
      "DEPLOY_FAILED" \
      "" \
      "" \
      "$SMOKE_URL" \
      "wrangler deploy exited ${deploy_rc}. Fix D1/queue/assets per docs/OPERATIONS.md, then re-run."
    die "wrangler deploy failed (exit ${deploy_rc})"
  fi

  # Prefer binding URL for S-DOGFOOD; keep workers.dev parse as fallback note only
  if [[ -z "${SMOKE_BASE_URL:-}" ]]; then
    SMOKE_URL="$BINDING_SMOKE_URL"
  fi
  PARSED_WORKERS="$(grep -Eo 'https://[a-zA-Z0-9._-]+\.workers\.dev' "$DEPLOY_LOG" | head -n1 || true)"
  rm -f "$DEPLOY_LOG"
  info "deployed; smoke base: $(redact_url "$SMOKE_URL")${PARSED_WORKERS:+ (workers.dev also: $(redact_url "$PARSED_WORKERS"))}"
fi

# --- health smoke ---
HEALTH_URL="${SMOKE_URL%/}/health"
info "GET $(redact_url "$HEALTH_URL")"
set +e
HEALTH_RESP="$(curl -sS -m 30 -w '\n%{http_code}' "$HEALTH_URL" 2>&1)"
curl_rc=$?
set -e

if [[ $curl_rc -ne 0 ]]; then
  write_evidence \
    "SMOKE_FAILED" \
    "" \
    "" \
    "$SMOKE_URL" \
    "curl failed (exit ${curl_rc}) against dogfood /health. Network or URL issue."
  die "health smoke curl failed (exit ${curl_rc})"
fi

HEALTH_CODE="$(printf '%s' "$HEALTH_RESP" | tail -n1)"
HEALTH_BODY="$(printf '%s' "$HEALTH_RESP" | sed '$d')"

if [[ "$HEALTH_CODE" != "200" ]]; then
  write_evidence \
    "SMOKE_FAILED" \
    "$HEALTH_CODE" \
    "$HEALTH_BODY" \
    "$SMOKE_URL" \
    "Expected HTTP 200 from GET /health; got ${HEALTH_CODE}."
  die "health smoke expected 200, got ${HEALTH_CODE}"
fi

if ! printf '%s' "$HEALTH_BODY" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  write_evidence \
    "SMOKE_FAILED" \
    "$HEALTH_CODE" \
    "$HEALTH_BODY" \
    "$SMOKE_URL" \
    "HTTP 200 but body missing ok:true — unexpected health payload."
  die "health body missing ok:true"
fi

write_evidence \
  "DONE_WITH_EVIDENCE" \
  "$HEALTH_CODE" \
  "$HEALTH_BODY" \
  "$SMOKE_URL" \
  "Live dogfood smoke succeeded. S-CF / S-DOGFOOD / BC10 / BC-16 health 200 recorded.
Deploy revision: ${GIT_SHA} · APP_VERSION: ${APP_VERSION}
Binding URL: https://www.speakerops.org
Next: scripts/with-secrets.sh pnpm test:e2e:phase11-keystone"

info "health 200 ok — S-DOGFOOD smoke complete (exit 0)"
exit 0
