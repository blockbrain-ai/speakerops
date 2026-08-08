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
- Worker R2 binding name: `FILES` (wrangler.toml) — object bytes for logo/headshot/slides.
- D1 holds `file_assets` metadata only (`r2_key`, mime, size, checksum, `virus_scan_status`); never file bodies.
- No R2 API tokens in repo; Cloudflare credentials for deploy stay in secrets.env (CLOUDFLARE_*).

## Auth (section 2.1) — names only
- `AUTH_DEV_OUTBOX` — when `"1"`, local e2e API may expose `GET /api/auth/dev/outbox` for Playwright (never enable as a production dogfood default).
- `BOOTSTRAP_ADMIN_EMAIL` — required for controlled first-admin bootstrap on an empty D1 (production Worker). Not a secret token; email of the intended first admin. When unset, first-admin self-provision is default-deny (no public caller can claim admin). When set, only that email may create the first admin membership once; subsequent self-provision is denied.
- Session cookie name is code constant `speakerops_session` (HttpOnly Secure SameSite=Lax) — not an env secret.
- Never commit magic-link tokens, session values, or log them.

## Public CFP / Turnstile (section 3.3) — names only
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile secret for `Submission.Create` server verify. **Required** for production Worker construction (`createAppFromBindings` throws if missing/empty **or** set to a known development/Cloudflare test value: literal `test`, always-pass `1x0000…AA`, always-fail `2x0000…AA`) so deployments cannot fall open to the public development pass token or always-pass modes. Local/e2e (`createApp` / `createAppWithAuth`) may omit it: then only the explicit pass token (`XXXX.DUMMY.TOKEN`) is accepted; all other tokens fail closed.
- `TURNSTILE_SITE_KEY` — public site key for the SPA Turnstile widget (not a secret). **Required** for production Worker construction together with the secret: omitting it or using the Cloudflare always-pass test site key makes the SPA fall back to the test UI and submit `XXXX.DUMMY.TOKEN` — blocking real protection or all CFP submissions. Local/e2e may omit it: the always-pass test site key is used for the interactive test control.
- Never commit Turnstile secrets or log full captcha tokens.

## Comms / email provider (section 5.2) — names only
- `EMAIL_PROVIDER` — provider mode for outbox drain (`sandbox` default | `resend`). Sandbox never makes network calls.
- `RESEND_API_KEY` — Resend API key for live send. **Ignored** unless `EMAIL_PROVIDER=resend`. Never commit values; never log the key.
- `EMAIL_FROM` — optional default From: address for provider sends (not a secret token).
- Comms.Send request path never uses these bindings; only `emailConsumer` / queue drain does (E7).
- Queue binding name: `JOBS_QUEUE` (wrangler.toml) — producer (kick after Comms.Send) + consumer; Worker `queue` / `scheduled` handlers drain `outbox_events` topic `comms.send` via `processCommsOutbox`.

## Airtable one-way projection (section 7.3 / S-AIRTABLE) — names only
- `AIRTABLE_API_KEY` — Airtable API key / PAT for projection **drain only**. When unset, drain **pauses** (outbox lags; product mutations still 200). Never on request path (E7). Never commit values.
- `AIRTABLE_BASE_ID` — base id for one-way mirror. Required with `AIRTABLE_API_KEY` for live drain; unset → paused.
- `AIRTABLE_TABLE_SUBMISSIONS`, `AIRTABLE_TABLE_SPEAKERS`, `AIRTABLE_TABLE_SESSIONS`, `AIRTABLE_TABLE_TASKS`, `AIRTABLE_TABLE_SCHEDULE`, `AIRTABLE_TABLE_EVENTS` — optional table name overrides (defaults: `SpeakerOps_*`).
- Domain commands only insert `outbox_events` topic `airtable.project`; `airtableConsumer` / queue / cron drain upserts by `internal_id` into Airtable + `projection_records`.
- Status API `GET /api/events/:eventId/airtable/status` is D1-only lag (no Airtable HTTP).

## CLI / agent (section 7.2) — names only
- `SPEAKEROPS_API_KEY` — Bearer secret for `speakerops` CLI (`spk_…`). Minted via admin UI / `Keys.Create`; never commit values; never log full secret.
- `SPEAKEROPS_API_URL` — optional API base URL for CLI (default `http://127.0.0.1:8787`). Not a secret.
- `SPEAKEROPS_CORRELATION_ID` — optional fixed correlation id for CLI requests (else CLI generates `cli_…`). Not a secret.
- CLI command reference: `docs/CLI.md`. OpenAPI: `GET /openapi.json`.

## Base
Dogfood base id is in AIRTABLE_BASE_ID. Tables:
SpeakerOps_Submissions, SpeakerOps_Speakers, SpeakerOps_Sessions, SpeakerOps_Tasks, SpeakerOps_Schedule.

## Do not
- Commit `.env` or tokens
- Log full secrets or emit environment values (base IDs, account IDs, tokens) from setup/gate scripts
- Source secrets before `pnpm install` or into the general test/typecheck gate
