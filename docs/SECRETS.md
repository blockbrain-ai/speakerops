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

## Base
Dogfood base id is in AIRTABLE_BASE_ID. Tables:
SpeakerOps_Submissions, SpeakerOps_Speakers, SpeakerOps_Sessions, SpeakerOps_Tasks, SpeakerOps_Schedule.

## Do not
- Commit `.env` or tokens
- Log full secrets or emit environment values (base IDs, account IDs, tokens) from setup/gate scripts
- Source secrets before `pnpm install` or into the general test/typecheck gate
