# Secrets on made-pilot (SpeakerOps)

## Canonical location (source of truth)
`/root/.config/speakerops/secrets.env` (mode 600, **not** in git)

## Workspace mirror
`/data/speakerops-build/.env` (mode 600, **gitignored**, regenerated from secrets.env)

## How Section Runner / builders use them

**Do not inject deployment secrets into general gates or install.**

1. `scripts/gate-test.sh`, `scripts/gate-typecheck.sh`, and `scripts/workspace-setup.sh` run **without** sourcing secrets. Phase 0 unit/governance tests and `pnpm install` lifecycle scripts must never see Cloudflare/Airtable tokens.
2. For **explicit** integration, deploy, or live Airtable/Cloudflare commands only:  
   `scripts/with-secrets.sh <cmd>` (sources secrets.env then optional `.env`, then execs the command).
3. App code reads process env by **name**: `AIRTABLE_*`, `CLOUDFLARE_*` — only when the parent command loaded secrets via `with-secrets.sh` (or an equivalent scoped inject).
4. Install deps (`pnpm install`) **before** any credential loading on any path that needs both.

## Variables present (names only)
- CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
- AIRTABLE_API_KEY, AIRTABLE_PAT, AIRTABLE_BASE_ID
- AIRTABLE_TABLE_SUBMISSIONS, SPEAKERS, SESSIONS, TASKS, SCHEDULE

## Non-secret local DB path (section 1.3)
- `SPEAKEROPS_DB_PATH` — optional path for `pnpm db:migrate` local SQLite (default `.data/speakerops.local.sqlite`). Not a secret; gitignored via `.data/`.

## R2 / files (section 4.2) — binding names only
- Worker R2 binding name: `FILES` (wrangler.toml) — object bytes for logo/headshot/slides when the binding is configured.
- D1 holds `file_assets` metadata (`r2_key`, mime, size, checksum, `virus_scan_status`). When R2 is not bound (hosted demo dogfood env), file bytes are stored as durable base64 rows in D1 `file_blobs` (migration 0020).
- No R2 API tokens in repo; Cloudflare credentials for deploy stay in secrets.env (CLOUDFLARE_*).

## Auth (section 2.1) — names only
- `AUTH_DEV_OUTBOX` — when `"1"`, local e2e API may expose `GET /api/auth/dev/outbox` for Playwright (never enable as a production dogfood default).
- `BOOTSTRAP_ADMIN_EMAIL` — required for controlled first-admin bootstrap on an empty D1 (production Worker). Not a secret token; email of the intended first admin. When unset, first-admin self-provision is default-deny (no public caller can claim admin). When set, only that email may create the first admin membership once; subsequent self-provision is denied.
- Session cookie name is code constant `speakerops_session` (HttpOnly Secure SameSite=Lax) — not an env secret.
- Never commit magic-link tokens, session values, or log them.

## Demo seed / role switcher (section 8.4) — names only
- `SPEAKEROPS_DB_PATH` — local SQLite path for `pnpm db:migrate` / `pnpm seed` (default `.data/speakerops.local.sqlite`). Not a secret.
- `ROLE_SWITCHER_ENABLED` — when `"1"`, Worker registers `POST /api/auth/dev/role-switch` for private dogfood judges (and, together with `JUDGE_ACCESS_CODE`, `POST /api/auth/judge-access`). **Default off.** Never enable on public production. When enabled on a controlled Worker, role-switch requires an **existing valid session** with **event admin membership** or a preserved judge-origin cookie (speakers/evaluators cannot escalate to admin) — workers.dev alone is not an authorization boundary.
- `JUDGE_ACCESS_CODE` — **legacy, unused.** `/judge` is open whenever `ROLE_SWITCHER_ENABLED=1`. The secret may still exist on the Worker; the app ignores it. Safe to delete after deploy.
- `VITE_ROLE_SWITCHER` — when `"1"`, SPA shows the RoleSwitcher chrome (also shown automatically in Vite `import.meta.env.DEV`). Build-time only; not a secret.
- Demo emails are public constants (`admin@demo.speakerops.local`, etc.) — not credentials; switcher still issues real HttpOnly session cookies server-side.

## Public CFP / Turnstile (section 3.3 + 10.3 DEMO) — names only
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile secret for `Submission.Create` server verify. **Required** for production Worker construction without DEMO_MODE (`createAppFromBindings` throws if missing/empty **or** set to a known development/Cloudflare test value: literal `test`, always-pass `1x0000…AA`, always-fail `2x0000…AA`) so deployments cannot fall open to the public development pass token or always-pass modes. Local/e2e (`createAppWithAuth`) may omit it: with `demoMode` true, only the explicit pass token (`XXXX.DUMMY.TOKEN`) is accepted; all other tokens fail closed. With `DEMO_MODE=1`, missing/test secret is allowed (dogfood DEMO path).
- `TURNSTILE_SITE_KEY` — public site key for the SPA Turnstile widget (not a secret). **Required** for production without DEMO_MODE; omitting it or using the Cloudflare always-pass test site key is rejected at construction. Local/e2e may omit it. With `DEMO_MODE=1`, public CFP **forces** the always-pass test site key so the SPA uses the interactive test control.
- `DEMO_MODE` — when `"1"`, enable DEMO Turnstile path (section 10.3 / S-CFP-SUBMIT): force test site key on `Form.GetPublic`; accept `XXXX.DUMMY.TOKEN` only when allowlist rules pass. **Default off.** Dogfood `[env.dogfood]` sets this; never enable on public multi-tenant production without an allowlist. See [`DEMO_HOST.md`](./DEMO_HOST.md).
- `DEMO_ALLOWLIST_ENABLED` — when `"1"` with `DEMO_MODE=1`, DEV_PASS accepted only for hosts in `DEMO_ALLOWLIST_HOSTS` (and optional event slugs). Fail-closed for non-allowlisted hosts (AC-10.3-D).
- `DEMO_ALLOWLIST_HOSTS` — comma-separated hostnames (e.g. `www.speakerops.org,localhost`). Not a secret.
- `DEMO_ALLOWLIST_EVENT_SLUGS` — optional comma-separated event slugs; empty = any event on an allowlisted host.
- Never commit Turnstile secrets or log full captcha tokens.

## Comms / email provider (section 5.2) — names only
- `EMAIL_PROVIDER` — provider mode for outbox drain (`sandbox` default | `resend` | `cloudflare`). Sandbox never makes network calls. The hosted demo sets `cloudflare` (Cloudflare Email Sending — no attachments; `.ics` is a portal download).
- `RESEND_API_KEY` — Resend API key for send via Resend. **Ignored** unless `EMAIL_PROVIDER=resend`. Never commit values; never log the key.
- `EMAIL_FROM` — optional default From: address for provider sends (not a secret token).
- `AUTH_EMAIL_FROM` — optional From: for magic-link emails (falls back to `EMAIL_FROM`).
- `AUTH_EMAIL_PROVIDER` — `cloudflare` (dogfood) or `resend` for magic-link delivery.
- `APP_PUBLIC_BASE_URL` — public origin for magic-link URLs (e.g. `https://www.speakerops.org`). Required for durable auth email.
- `AUTH_LINK_ENCRYPTION_KEY` — encrypts magic-link plaintext in outbox (AES-GCM). Env **name** only; never commit values.
- `CLOUDFLARE_EMAIL_API_TOKEN` — Cloudflare API token with Email Sending permission when not using Workers `EMAIL` binding.
- `CLOUDFLARE_ACCOUNT_ID` — account id for Email Sending REST (public id; may be a wrangler var).
- `MAGIC_LINK_ALLOWLIST` — optional comma-separated extra emails permitted to request magic links (not a secret). **Unset on dogfood**: the controlled policy is that existing users and provisioned members (e.g. accepted speakers) may log in; unknown emails cannot self-register.
- Comms.Send request path never uses these bindings; only `emailConsumer` / queue drain does (E7).
- Queue binding name: `JOBS_QUEUE` (wrangler.toml) — producer (kick after Comms.Send) + consumer; Worker `queue` / `scheduled` handlers drain `outbox_events` topic `comms.send` via `processCommsOutbox`.

## Airtable one-way projection (section 7.3 / S-AIRTABLE) — names only
- `AIRTABLE_API_KEY` — Airtable API key / PAT for projection **drain only**. When unset, drain **pauses** (outbox lags; product mutations still 200). Never on request path (E7). Never commit values.
- `AIRTABLE_BASE_ID` — base id for one-way mirror. Required with `AIRTABLE_API_KEY` for live drain; unset → paused.
- `AIRTABLE_TABLE_SUBMISSIONS`, `AIRTABLE_TABLE_SPEAKERS`, `AIRTABLE_TABLE_SESSIONS`, `AIRTABLE_TABLE_TASKS`, `AIRTABLE_TABLE_SCHEDULE`, `AIRTABLE_TABLE_EVENTS` — optional table name overrides (defaults: `SpeakerOps_*`).
- Domain commands only insert `outbox_events` topic `airtable.project`; `airtableConsumer` / queue / cron drain upserts by `internal_id` into Airtable + `projection_records`.
- Status API `GET /api/events/:eventId/airtable/status` is D1-only lag (no Airtable HTTP).

## Accelevents one-way projector — names only
- `ACCELEVENTS_API_KEY` — Accelevents header `Key` for **drain only**. When unset, drain pauses; Worker still boots. Never on the request path (E7). Never commit values. Never type into the SPA.
- Event URL + numeric event id are D1 connection metadata, not secrets. There is **no** `ACCELEVENTS_EVENT_URL` env fallback.
- Topics: `accelevents.verify`, `accelevents.project`. See [`ACCELEVENTS.md`](./ACCELEVENTS.md).

## CLI / agent (section 7.2) — names only
- `SPEAKEROPS_API_KEY` — Bearer secret for `speakerops` CLI (`spk_…`). Minted via admin UI / `Keys.Create`; never commit values; never log full secret.
- `SPEAKEROPS_API_URL` — optional API base URL for CLI (default `http://127.0.0.1:8787`). Not a secret.
- `SPEAKEROPS_CORRELATION_ID` — optional fixed correlation id for CLI requests (else CLI generates `cli_…`). Not a secret.
- CLI command reference: `docs/CLI.md`. OpenAPI: `GET /openapi.json`.

## Cloudflare dogfood deploy (section 8.6 / S-CF / BC10) — names only
- `CLOUDFLARE_API_TOKEN` — Wrangler / API auth for dogfood deploy. **Required** by `scripts/deploy-dogfood.sh`. Never commit values; never log the token.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account scope for wrangler. **Required** by deploy script. Evidence redacts full id (`[REDACTED_ACCOUNT_ID]`).
- `SPEAKEROPS_D1_DATABASE_ID` — optional real D1 `database_id` override (placeholder in `wrangler.toml` is not deployable until set).
- `SPEAKEROPS_R2_BUCKET_NAME` — optional R2 bucket name override for `FILES` binding.
- `SMOKE_BASE_URL` — optional base for health re-smoke (default for 11.9 claim is `https://www.speakerops.org`) and optional Playwright (`playwright/e2e/cf_dogfood_smoke.spec.ts` skips when unset).
- `DOGFOOD_SKIP_DEPLOY` — when `"1"`, deploy script skips `wrangler deploy` and only smokes `SMOKE_BASE_URL`.
- `DOGFOOD_SKIP_WEB_BUILD` — when `"1"`, skip Vite SPA build (use existing `apps/web/dist`).
- `DOGFOOD_PHASE11_EVIDENCE` — optional override for section 11.9 `deploy.md` (default `initiative/PHASE10_11_GAP_CLOSE/evidence/deploy.md`).
- `DOGFOOD_KEYSTONE` — when `"1"`, enables phase11 18-soul D keystone against www.speakerops.org (`pnpm test:e2e:phase11-keystone`).
- `DEPLOY_DRY_RUN` — when `"1"`, validate creds + write dry-run evidence; no network deploy.
- `DOGFOOD_EVIDENCE_PATH` — optional override for BC10 evidence output (default `KMS-competition/initiative/evidence/cf-dogfood.txt`).
- `DOGFOOD_WORKER_NAME` — optional Worker name (default `speakerops-demo` for S-DOGFOOD binding).
- `DOGFOOD_WRANGLER_ENV` — optional wrangler `--env` (default `dogfood`).
- `WRANGLER_BIN` — optional path/command for wrangler CLI.
- Deploy entry: `pnpm deploy:dogfood` / `scripts/with-secrets.sh bash scripts/deploy-dogfood.sh`.
- Phase 11.9 keystone: `scripts/with-secrets.sh pnpm test:e2e:phase11-keystone`.
- Runbook: `docs/OPERATIONS.md`. Never source these into general `test:ci` / `typecheck` gates.

## Base
Dogfood base id is in AIRTABLE_BASE_ID. Tables:
SpeakerOps_Submissions, SpeakerOps_Speakers, SpeakerOps_Sessions, SpeakerOps_Tasks, SpeakerOps_Schedule.

## Do not
- Commit `.env` or tokens
- Log full secrets or emit environment values (base IDs, account IDs, tokens) from setup/gate scripts
- Source secrets before `pnpm install` or into the general test/typecheck gate
