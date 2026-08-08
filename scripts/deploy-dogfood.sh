#!/usr/bin/env bash
# Section 8.6 — Cloudflare dogfood deploy (S-CF / BC10)
#
# Deploys the Hono API Worker to a private workers.dev URL, smokes GET /health,
# and writes redacted evidence for BUILD_CHECKLIST BC10.
#
# Env **names** only in docs (E10). Load secrets out-of-band:
#   scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
#
# Required env (values never committed):
#   CLOUDFLARE_API_TOKEN
#   CLOUDFLARE_ACCOUNT_ID
#
# Optional env **names**:
#   SPEAKEROPS_D1_DATABASE_ID   — real D1 id (overrides wrangler.toml placeholder)
#   SPEAKEROPS_R2_BUCKET_NAME  — R2 bucket name override
#   WRANGLER_BIN               — path/command for wrangler (default: resolve)
#   DOGFOOD_WORKER_NAME        — worker name (default: speakerops-api)
#   DOGFOOD_EVIDENCE_PATH      — evidence out path (default: initiative evidence)
#   DOGFOOD_SKIP_DEPLOY=1      — skip wrangler deploy (health-only against SMOKE_BASE_URL)
#   SMOKE_BASE_URL             — base URL for health smoke (set after deploy or manually)
#   DEPLOY_DRY_RUN=1           — validate creds + write dry-run evidence; no network deploy
#
# Exit codes:
#   0 — success (creds present and smoke path completed)
#   1 — missing credentials or deploy/smoke failure
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WORKER_NAME="${DOGFOOD_WORKER_NAME:-speakerops-api}"
EVIDENCE_PATH="${DOGFOOD_EVIDENCE_PATH:-$ROOT/KMS-competition/initiative/evidence/cf-dogfood.txt}"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-$ROOT/wrangler.toml}"
TIMESTAMP_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"

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
  # Strip query/fragments that might hold tokens
  url="${url%%\?*}"
  url="${url%%#*}"
  # workers.dev: keep service label, redact account subdomain hash
  if [[ "$url" =~ ^(https?://)([a-zA-Z0-9-]+)\.([a-zA-Z0-9-]+)\.workers\.dev(.*)$ ]]; then
    echo "${BASH_REMATCH[1]}${BASH_REMATCH[2]}.***.workers.dev${BASH_REMATCH[4]}"
    return
  fi
  if [[ "$url" =~ ^(https?://)([a-zA-Z0-9-]+)\.workers\.dev(.*)$ ]]; then
    echo "${BASH_REMATCH[1]}${BASH_REMATCH[2]}.workers.dev${BASH_REMATCH[3]}"
    return
  fi
  # Generic host: keep scheme + first label, redact rest of host
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
  # Never echo token or full account id into evidence
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    text="${text//"${CLOUDFLARE_API_TOKEN}"/[REDACTED_TOKEN]}"
  fi
  if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    text="${text//"${CLOUDFLARE_ACCOUNT_ID}"/[REDACTED_ACCOUNT_ID]}"
  fi
  # Common secret-shaped patterns
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
  # Prefer pnpm exec when wrangler is a workspace dep
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
# BC10 / S-CF — Cloudflare dogfood health evidence (section 8.6)

Section: 8.6 Cloudflare dogfood deploy
Workspace: speakerops-build
Date (UTC): ${TIMESTAMP_UTC}
Git SHA: ${GIT_SHA}
Status: ${status}

## Claim

Private Cloudflare (workers.dev / preview) dogfood URL returns GET /health → 200
with body \`{ "ok": true, "version": string }\`. Deploy uses env **names** only;
secret **values** never committed (E10).

Souls: **S-CF** (constitution) · BUILD_CHECKLIST **BC10**

## Evidence path

This file: KMS-competition/initiative/evidence/cf-dogfood.txt
Template: KMS-competition/initiative/evidence/cf-dogfood.template.txt
Deploy script: scripts/deploy-dogfood.sh
Operations: docs/OPERATIONS.md
wrangler: wrangler.toml (binding **names** only)

## URL redaction rules (binding)

1. Never write CLOUDFLARE_API_TOKEN, API keys, session cookies, or magic-link tokens.
2. Never write full CLOUDFLARE_ACCOUNT_ID — replace with \`[REDACTED_ACCOUNT_ID]\`.
3. workers.dev hosts: keep worker service label; redact account subdomain as \`***\`
   (example: \`https://speakerops-api.***.workers.dev\`).
4. Strip query strings and fragments from recorded URLs (may contain tokens).
5. Health body may include public \`version\` only — no env dumps.

## Smoke result

| Field | Value |
|-------|-------|
| Base URL (redacted) | ${redacted_url} |
| GET /health HTTP status | ${health_code:-n/a} |
| Health body (redacted) | ${safe_body:-n/a} |
| Worker name | ${WORKER_NAME} |

## Notes

${notes}

## Reproduce (operator)

\`\`\`bash
# Load secrets out-of-band (never commit values)
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh

# Optional: health-only re-smoke against an existing dogfood URL
SMOKE_BASE_URL=https://<your-workers-dev-host> \\
  DOGFOOD_SKIP_DEPLOY=1 \\
  scripts/with-secrets.sh bash scripts/deploy-dogfood.sh

# Optional Playwright remote smoke (skips when unset)
SMOKE_BASE_URL=https://<your-workers-dev-host> pnpm exec playwright test playwright/e2e/cf_dogfood_smoke.spec.ts
\`\`\`

## Gate local proof (no CF network)

- assert deploy script exits nonzero without creds with message
- assert OPERATIONS.md lists wrangler steps
- assert evidence template path exists
- Local GET /health 200: apps/api/src/health.test.ts (section 1.2)

Env **names** only (E10): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
SPEAKEROPS_D1_DATABASE_ID, SPEAKEROPS_R2_BUCKET_NAME, SMOKE_BASE_URL,
DOGFOOD_SKIP_DEPLOY, DEPLOY_DRY_RUN, DOGFOOD_EVIDENCE_PATH, WRANGLER_BIN.
EOF
  info "wrote evidence → $EVIDENCE_PATH"
}

# --- dry-run path: creds present, no network deploy ---
if [[ "${DEPLOY_DRY_RUN:-}" == "1" ]]; then
  info "DEPLOY_DRY_RUN=1 — validating config only (no wrangler deploy)"
  [[ -f "$WRANGLER_CONFIG" ]] || die "wrangler.toml missing at $WRANGLER_CONFIG"
  write_evidence \
    "DRY_RUN" \
    "" \
    "" \
    "${SMOKE_BASE_URL:-}" \
    "Dry-run only. Credentials were present; wrangler deploy was not invoked.
Live dogfood smoke requires DEPLOY_DRY_RUN unset and network access to Cloudflare.
See docs/OPERATIONS.md for wrangler create D1/R2/queue + secret put steps."
  info "dry-run complete (exit 0)"
  exit 0
fi

# --- resolve smoke URL: skip deploy when operator only wants re-smoke ---
SMOKE_URL="${SMOKE_BASE_URL:-}"

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

  # Optional resource id overrides (names in docs; values from secrets/env)
  EXTRA_ARGS=()
  if [[ -n "${SPEAKEROPS_D1_DATABASE_ID:-}" ]]; then
    info "SPEAKEROPS_D1_DATABASE_ID set — injecting D1 database_id for deploy"
    # wrangler supports --var and config; use temporary config merge via env for d1 is limited.
    # Documented path: edit wrangler.toml database_id or use CF dashboard id in this env
    # and a local non-committed override file.
    OVERRIDE_TOML="$(mktemp "${TMPDIR:-/tmp}/wrangler-dogfood.XXXXXX.toml")"
    # shellcheck disable=SC2064
    trap 'rm -f "$OVERRIDE_TOML"' EXIT
    sed -E "s/database_id = \"[^\"]+\"/database_id = \"${SPEAKEROPS_D1_DATABASE_ID}\"/" \
      "$WRANGLER_CONFIG" >"$OVERRIDE_TOML"
    if [[ -n "${SPEAKEROPS_R2_BUCKET_NAME:-}" ]]; then
      sed -i -E "s/bucket_name = \"[^\"]+\"/bucket_name = \"${SPEAKEROPS_R2_BUCKET_NAME}\"/" \
        "$OVERRIDE_TOML"
    fi
    WRANGLER_CONFIG="$OVERRIDE_TOML"
  fi

  info "deploying worker ${WORKER_NAME} (account id redacted in logs)"
  # CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are read by wrangler from env
  set +e
  DEPLOY_LOG="$(mktemp "${TMPDIR:-/tmp}/dogfood-deploy.XXXXXX.log")"
  # shellcheck disable=SC2086
  $WRANGLER deploy --config "$WRANGLER_CONFIG" --name "$WORKER_NAME" >"$DEPLOY_LOG" 2>&1
  deploy_rc=$?
  set -e

  # Never print raw deploy log to stdout (may include account metadata); redact on failure summary
  if [[ $deploy_rc -ne 0 ]]; then
    redact_text "$(tail -n 40 "$DEPLOY_LOG")" >&2 || true
    rm -f "$DEPLOY_LOG"
    write_evidence \
      "DEPLOY_FAILED" \
      "" \
      "" \
      "" \
      "wrangler deploy exited ${deploy_rc}. Fix D1/R2/queue resource ids per docs/OPERATIONS.md, then re-run."
    die "wrangler deploy failed (exit ${deploy_rc})"
  fi

  # Parse workers.dev URL from deploy output
  if [[ -z "$SMOKE_URL" ]]; then
    SMOKE_URL="$(grep -Eo 'https://[a-zA-Z0-9._-]+\.workers\.dev' "$DEPLOY_LOG" | head -n1 || true)"
  fi
  rm -f "$DEPLOY_LOG"
  [[ -n "$SMOKE_URL" ]] || die "could not parse workers.dev URL from wrangler deploy output; set SMOKE_BASE_URL"
  info "deployed; smoke base (redacted): $(redact_url "$SMOKE_URL")"
fi

# --- health smoke ---
HEALTH_URL="${SMOKE_URL%/}/health"
info "GET ${HEALTH_URL%%/*}//…/health (URL redacted in evidence)"
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

# Minimal body check without requiring jq
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
  "Live dogfood smoke succeeded. S-CF / BC10 health 200 recorded with redacted URL.
Optional: SMOKE_BASE_URL=$(redact_url "$SMOKE_URL") pnpm exec playwright test playwright/e2e/cf_dogfood_smoke.spec.ts"

info "health 200 ok — S-CF smoke complete (exit 0)"
exit 0
