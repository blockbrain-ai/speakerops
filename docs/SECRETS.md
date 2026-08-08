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

## Auth (section 2.1) — names only
- `AUTH_DEV_OUTBOX` — when `"1"`, local e2e API may expose `GET /api/auth/dev/outbox` for Playwright (never enable as a production dogfood default).
- `BOOTSTRAP_ADMIN_EMAIL` — required for controlled first-admin bootstrap on an empty D1 (production Worker). Not a secret token; email of the intended first admin. When unset, first-admin self-provision is default-deny (no public caller can claim admin). When set, only that email may create the first admin membership once; subsequent self-provision is denied.
- Session cookie name is code constant `speakerops_session` (HttpOnly Secure SameSite=Lax) — not an env secret.
- Never commit magic-link tokens, session values, or log them.

## Public CFP / Turnstile (section 3.3) — names only
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile secret for `Submission.Create` server verify. **Required** for production Worker construction (`createAppFromBindings` throws if missing/empty) so deployments cannot fall open to the public development pass token. Local/e2e (`createApp` / `createAppWithAuth`) may omit it: then only the explicit pass token (`XXXX.DUMMY.TOKEN`) is accepted; all other tokens fail closed.
- `TURNSTILE_SITE_KEY` — public site key for the SPA Turnstile widget (not a secret). **Required** for production Worker construction together with the secret: omitting it (or pairing a real secret with the Cloudflare always-pass test site key) makes the SPA fall back to the test UI and submit `XXXX.DUMMY.TOKEN`, which a real secret rejects — blocking all CFP submissions. Local/e2e may omit it: the always-pass test site key is used for the interactive test control.
- Never commit Turnstile secrets or log full captcha tokens.

## Base
Dogfood base id is in AIRTABLE_BASE_ID. Tables:
SpeakerOps_Submissions, SpeakerOps_Speakers, SpeakerOps_Sessions, SpeakerOps_Tasks, SpeakerOps_Schedule.

## Do not
- Commit `.env` or tokens
- Log full secrets or emit environment values (base IDs, account IDs, tokens) from setup/gate scripts
- Source secrets before `pnpm install` or into the general test/typecheck gate
