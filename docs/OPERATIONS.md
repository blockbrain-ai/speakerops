# Operations — deploy, migrate, backup (S-CF + day-2)

> **Owner sections:** **8.6** (dogfood deploy) · **9.4** (ops deep prose) · **Soul:** **S-CF** · **Checklist:** **BC10**  
> **Standards:** E5 gates · E7 side effects · **E10** secrets names-only  
> **Depends:** Worker health **1.2**, D1 baseline **1.3**, demo seed **8.4**  
> **Docs map:** [README](../README.md) · [9.1 IA](./sections/9.1-docs-ia.md) · [ONBOARDING](./ONBOARDING.md) · [ARCHITECTURE](./ARCHITECTURE.md) · [AIRTABLE](./AIRTABLE.md) · [9.4](./sections/9.4-deep-docs.md)

This runbook covers:

1. Clean workspace → private Cloudflare workers.dev dogfood URL with `GET /health` → **200**  
2. Local migrate / seed / day-2 operations  
3. Rollback including **D1 Time Travel**  

Custom domain production cutover is **out of scope** for dogfood claim unless owner amends.

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node ≥ 20 · pnpm | Workspace `packageManager` pin |
| Cloudflare account | Account id + API token with Workers / D1 / R2 / Queues edit |
| Secrets channel | `/root/.config/speakerops/secrets.env` (mode 600) or equivalent — **not** in git |
| Wrangler CLI | `pnpm add -Dw wrangler` (or `WRANGLER_BIN` pointing at a local binary) |

**Do not** inject secrets into `pnpm typecheck` / `pnpm test:ci` / `pnpm install`
(see [`docs/SECRETS.md`](./SECRETS.md)). Deploy is an explicit operator command.

---

## 2. Env **names** only (E10)

| Name | Required | Purpose |
|------|----------|---------|
| `CLOUDFLARE_API_TOKEN` | yes (deploy) | Wrangler auth token — never commit value |
| `CLOUDFLARE_ACCOUNT_ID` | yes (deploy) | Account scope for wrangler — never commit value |
| `SPEAKEROPS_D1_DATABASE_ID` | for real D1 | Overrides placeholder `database_id` in `wrangler.toml` |
| `SPEAKEROPS_R2_BUCKET_NAME` | optional | Overrides `bucket_name` for FILES binding |
| `SMOKE_BASE_URL` | optional | Base URL for health re-smoke / Playwright optional smoke |
| `DOGFOOD_SKIP_DEPLOY` | optional | `1` = health-only (requires `SMOKE_BASE_URL`) |
| `DEPLOY_DRY_RUN` | optional | `1` = validate creds + write dry-run evidence; no network deploy |
| `DOGFOOD_EVIDENCE_PATH` | optional | Override BC10 evidence output path |
| `DOGFOOD_WORKER_NAME` | optional | Default `speakerops-api` |
| `WRANGLER_BIN` | optional | Path or command for wrangler |
| `TURNSTILE_SECRET_KEY` | production Worker | Required by `createAppFromBindings` — set via `wrangler secret put` |
| `TURNSTILE_SITE_KEY` | production Worker | Public site key — `[vars]` or secret; not a private credential |
| `BOOTSTRAP_ADMIN_EMAIL` | first admin | Controlled bootstrap allowlist (email, not a token) |
| `RESEND_API_KEY` | if live email | Only with `EMAIL_PROVIDER=resend` |
| `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` | optional | Projection drain only (paused when unset) |
| `SPEAKEROPS_DB_PATH` | local | SQLite path for `pnpm db:migrate` / `pnpm seed` |
| `EMAIL_PROVIDER` | optional | `sandbox` (default) \| `resend` |

Full names index: [`docs/SECRETS.md`](./SECRETS.md).

---

## 3. Local day-0 loop (no Cloudflare network)

```bash
pnpm install
pnpm db:migrate          # packages/db/migrations → local SQLite
pnpm seed                # demo graph (section 8.4)
pnpm typecheck
pnpm test:ci
# optional product UI locally:
#   API + web per AGENTS.md / ONBOARDING (ports 8787 / 5173 typical)
pnpm test:e2e            # Playwright inventory suite
pnpm test:e2e:inventory  # inventory law + crawl
```

Gates must be **non-interactive** (E5): no `--watch` on CI scripts.

---

## 4. Wrangler steps (dogfood)

### 4.1 Login / token auth

Prefer **API token** (CI/operator) over interactive login:

```bash
# values from secrets.env — never echo
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID
# optional interactive alternative (human laptop only):
# wrangler login
```

### 4.2 Create Cloudflare resources (once per account)

Binding **names** are fixed in root [`wrangler.toml`](../wrangler.toml):

| Binding | Type | Resource name (default) |
|---------|------|-------------------------|
| `DB` | D1 | `speakerops` |
| `FILES` | R2 | `speakerops-files` |
| `JOBS_QUEUE` | Queue producer/consumer | `speakerops-jobs` |

```bash
# D1
wrangler d1 create speakerops
# → copy the returned database_id into SPEAKEROPS_D1_DATABASE_ID
#   (or replace the placeholder database_id in wrangler.toml locally; do not
#    commit account-specific ids if your policy forbids it)

# R2
wrangler r2 bucket create speakerops-files

# Queue
wrangler queues create speakerops-jobs
```

### 4.3 Apply D1 migrations on Cloudflare

```bash
wrangler d1 migrations apply speakerops --remote
# migrations_dir = packages/db/migrations (same SQL as pnpm db:migrate)
```

Local SQLite path for dev remains `pnpm db:migrate` (`SPEAKEROPS_DB_PATH`).

**Migration policy:** additive / linear only. No destructive “reset production” in dogfood without a Time Travel bookmark first (see Rollback).

### 4.4 Put Worker secrets (names only here)

```bash
wrangler secret put TURNSTILE_SECRET_KEY
# wrangler secret put RESEND_API_KEY          # only if EMAIL_PROVIDER=resend
# wrangler secret put AIRTABLE_API_KEY        # optional projection
# wrangler secret put BOOTSTRAP_ADMIN_EMAIL   # or use [vars] for non-secret email
```

Non-secret public config may live under `[vars]` in `wrangler.toml`
(e.g. `APP_VERSION`). Never put tokens in `[vars]` or commit `.dev.vars`.

### 4.5 Deploy + health smoke (preferred one-shot)

```bash
# From repo root — loads secrets.env then runs deploy script
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
# or: pnpm deploy:dogfood  (when secrets already in env)
```

The script:

1. **Fails nonzero** if `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is missing
   (clear message listing required names).
2. Runs `wrangler deploy` (unless `DOGFOOD_SKIP_DEPLOY=1` or `DEPLOY_DRY_RUN=1`).
3. `GET {base}/health` and requires HTTP **200** + `"ok": true`.
4. Writes redacted evidence to
   `KMS-competition/initiative/evidence/cf-dogfood.txt` (**BC10** path).

Manual equivalent:

```bash
wrangler deploy --config wrangler.toml --name speakerops-api
curl -sS "https://<worker>.<account>.workers.dev/health"
# expect: {"ok":true,"version":"…"}
```

### 4.6 Optional remote Playwright smoke

```bash
SMOKE_BASE_URL=https://<worker>.<account>.workers.dev \
  pnpm exec playwright test playwright/e2e/cf_dogfood_smoke.spec.ts
```

When `SMOKE_BASE_URL` is unset, the spec **skips** (no inventory ownership; does not
block local `pnpm test:e2e`).

---

## 5. Demo seed on dogfood data

After remote migrations:

```bash
# Local graph for judges (SQLite) — section 8.4
pnpm db:migrate
pnpm seed

# Remote seed is operator-specific (D1 execute / one-off job) — do not commit
# production dumps. Prefer role switcher only on private dogfood:
# ROLE_SWITCHER_ENABLED=1 + VITE_ROLE_SWITCHER=1 (names only; default off).
```

See [`docs/sections/8.4-demo-seed.md`](./sections/8.4-demo-seed.md).

---

## 6. Queues, outbox, and scheduled drains

| Concern | Operator note |
|---------|----------------|
| Comms send | Request path inserts outbox; consumer drains with `EMAIL_PROVIDER` |
| Airtable | Paused when keys unset — product still 200 ([AIRTABLE.md](./AIRTABLE.md)) |
| Stuck outbox | Inspect D1 `outbox_events` where `processed_at` is null; check `last_error` |
| Rate limits | 429 from providers keep rows pending — do not drop |
| Correlation | Use `correlationId` in logs to join request → outbox → audit |

Never force Airtable or Resend on the request path to “speed up demos.”

---

## 7. Observability

| Signal | Where |
|--------|--------|
| Health | `GET /health` → `{ ok, version }` |
| Correlation | Request header / CLI `SPEAKEROPS_CORRELATION_ID` |
| Audit | D1 `audit_events` on consequential writes |
| Worker logs | `wrangler tail` (redact secrets in shared transcripts) |
| E2E coverage | `pnpm docs:e2e-report` → `reports/e2e-coverage.html` |
| Reports portal | `pnpm docs:reports` → `reports/index.html` (section 9.5) |

**Redact** tokens, cookies, and magic links before pasting logs into issues or evidence.

---

## 8. Evidence & redaction (BC10)

| Artifact | Path |
|----------|------|
| Live evidence | `KMS-competition/initiative/evidence/cf-dogfood.txt` |
| Template | `KMS-competition/initiative/evidence/cf-dogfood.template.txt` |
| BUILD_CHECKLIST | `BC10` → `initiative/evidence/cf-dogfood.txt` |

**URL redaction rules** (also enforced in `scripts/deploy-dogfood.sh`):

1. Never write API tokens, session cookies, or magic-link tokens.
2. Redact full `CLOUDFLARE_ACCOUNT_ID` → `[REDACTED_ACCOUNT_ID]`.
3. workers.dev: keep service label; redact account subdomain as `***`.
4. Strip query/fragment from recorded URLs.
5. Health body: public `ok` + `version` only.

---

## 9. Rollback

| Layer | Action |
|-------|--------|
| Code | `git revert` of the deploy-related commit; redeploy previous SHA with wrangler |
| Worker | Cloudflare dashboard → Workers → prior deployment rollback |
| D1 data | **D1 Time Travel** (Cloudflare): restore database to a point-in-time bookmark before a bad migration/seed. **Note the bookmark before risky applies.** |
| Secrets | Rotate via `wrangler secret put` / dashboard; never commit rotated values |
| Local SQLite | Delete/recreate `.data/speakerops.local.sqlite` + `pnpm db:migrate && pnpm seed` |

D1 Time Travel is the data rollback path for dogfood mistakes; code rollback alone
does not undo destructive SQL. Keep this note for section rollback tables across the programme.

---

## 10. Failure modes (ops)

| Symptom | Check |
|---------|--------|
| Deploy script exits 1 immediately | Missing `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` |
| wrangler deploy fails on D1 | Placeholder `database_id` — set `SPEAKEROPS_D1_DATABASE_ID` or create D1 |
| Health not 200 | Worker threw at boot (missing Turnstile secrets); check wrangler tail |
| 500 on product routes | E4 envelope without stack (expected); inspect logs with correlationId |
| Projection lag | Airtable paused when `AIRTABLE_API_KEY` unset — product still 200 |
| Migrate fails locally | `SPEAKEROPS_DB_PATH` permissions; linear migration gap |
| Seed drift | Re-run `pnpm seed` on clean DB; see 8.4 |
| Inventory lint fail | [E2E.md](./E2E.md) — do not shrink REQUIRED |
| Typecheck / test hang | Remove watch flags; use gate scripts only |

Full recovery matrix: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## 11. Performance expectations (ops notes)

| Surface | Target |
|---------|--------|
| Admin primary lists | p95 &lt; 200ms local after warm load for seed ≤150 rows |
| Public CFP | First contentful interaction without multi-second blank (skeleton OK) |
| Status APIs (readiness, airtable lag) | D1-only; no external HTTP on request path |

Document measurement in test notes when adding new list surfaces; do not invent endpoints to “fix” latency.

---

## 12. Related docs

| Doc | Role |
|-----|------|
| [`docs/SECRETS.md`](./SECRETS.md) | Secret channel + env **names** |
| [`docs/sections/1.2-worker-health.md`](./sections/1.2-worker-health.md) | GET /health foundation |
| [`docs/sections/1.3-d1-baseline.md`](./sections/1.3-d1-baseline.md) | Migrations |
| [`docs/sections/8.4-demo-seed.md`](./sections/8.4-demo-seed.md) | Seed + role switcher |
| [`docs/sections/8.6-cloudflare-dogfood-deploy.md`](./sections/8.6-cloudflare-dogfood-deploy.md) | Section deliverables |
| [`docs/SECURITY.md`](./SECURITY.md) | CSP, cookies, hardening |
| [`docs/E2E.md`](./E2E.md) | Playwright / inventory |
| [`docs/ONBOARDING.md`](./ONBOARDING.md) | Human zero → running |

---

## 13. Gates (do not hang)

```bash
pnpm typecheck
pnpm test:ci          # includes 8.6 / 9.4 named assertions (no CF network)
# operator only:
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
```
