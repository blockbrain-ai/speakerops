# Secrets on made-pilot (SpeakerOps)

## Canonical location (source of truth)
`/root/.config/speakerops/secrets.env` (mode 600, **not** in git)

## Workspace mirror
`/data/speakerops-build/.env` (mode 600, **gitignored**, regenerated from secrets.env)

## How Section Runner / builders use them
1. Gate scripts (`scripts/gate-*.sh`, `workspace-setup.sh`) **source secrets.env then .env** before running.
2. App code should read process env: `AIRTABLE_*`, `CLOUDFLARE_*`.
3. Optional wrapper: `scripts/with-secrets.sh <cmd>`.

## Variables present
- CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
- AIRTABLE_API_KEY, AIRTABLE_PAT, AIRTABLE_BASE_ID
- AIRTABLE_TABLE_SUBMISSIONS, SPEAKERS, SESSIONS, TASKS, SCHEDULE

## Base
Dogfood base id is in AIRTABLE_BASE_ID. Tables:
SpeakerOps_Submissions, SpeakerOps_Speakers, SpeakerOps_Sessions, SpeakerOps_Tasks, SpeakerOps_Schedule.

## Do not
- Commit `.env` or tokens
- Log full secrets
