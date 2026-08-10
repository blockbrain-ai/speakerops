# Onboarding (human path)

> **Soul:** **S-ONB-HUMAN** · **Owner prose:** section **9.2** · **Proof:** **9.6** / BC13  
> **IA map:** section [9.1](./sections/9.1-docs-ia.md) · Section note: [9.2](./sections/9.2-human-onboarding.md) · Outline: [0.5](./governance/0.5-docs-onboarding-outline.md)

## Purpose

New human operators (AIE staff, judges, clean-room readers) go from **zero → running** without tribal knowledge: prerequisites → env **names** → wrangler / Cloudflare resources → migrate → seed → first admin → demo path (CFP → eval → portal → schedule → readiness) → gates / E2E → optional Airtable → dogfood deploy notes.

**Timebox target:** complete this checklist in **&lt;90 minutes** on a clean machine (install through first demo walk and local gates). Deploy to Cloudflare dogfood may add more time for account setup; the local zero→demo path is the &lt;90m bar.

---

## Timed checklist (numbered steps)

Work these steps in order. Each step lists the command or doc you need — nothing off-document.

### 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node.js **≥ 20 &lt; 25** (`engines`-enforced) | `node -v` |
| **pnpm** (workspace pin) | See root `packageManager` in `package.json` |
| Git clone of this workspace | Clean worktree; do not invent alternate monorepo layout |
| Optional: Cloudflare account | Only for dogfood deploy (steps 12–14); local demo works without it |

```bash
node -v          # expect v20–v24 (engines: >=20 <25)
pnpm -v          # install via corepack enable && corepack prepare if needed
```

### 2. Install dependencies

```bash
pnpm install
```

Do **not** source deployment secrets into install (see [SECRETS.md](./SECRETS.md)). Gates and install stay credential-free.

### 3. Env names template (names only — E10)

Copy names into a local secrets channel or `.env` / `.dev.vars` that is **gitignored**. Document **names only** in this table — never commit values.

| Name | Required for | Purpose |
|------|--------------|---------|
| `SPEAKEROPS_DB_PATH` | local DB | Optional path for SQLite (default `.data/speakerops.local.sqlite`) |
| `BOOTSTRAP_ADMIN_EMAIL` | first admin (Worker) | Email allowlist for controlled first-admin bootstrap (not a token) |
| `AUTH_DEV_OUTBOX` | local e2e only | `"1"` exposes dev magic-link outbox for Playwright — never production default |
| `TURNSTILE_SITE_KEY` | production Worker / public CFP | Public Turnstile site key |
| `TURNSTILE_SECRET_KEY` | production Worker | Turnstile secret — set via `wrangler secret put` |
| `CLOUDFLARE_API_TOKEN` | dogfood deploy | Wrangler / API auth — never commit value |
| `CLOUDFLARE_ACCOUNT_ID` | dogfood deploy | Account scope — never commit value |
| `SPEAKEROPS_D1_DATABASE_ID` | remote D1 | Real D1 `database_id` when leaving wrangler placeholder |
| `SPEAKEROPS_R2_BUCKET_NAME` | optional R2 | Override `FILES` bucket name |
| `ROLE_SWITCHER_ENABLED` | private dogfood only | `"1"` enables role-switch API (default **off**) |
| `JUDGE_ACCESS_CODE` | shared demo only (secret) | With role switcher on, enables `/judge` entry (4h demo sessions); 404 when unset |
| `VITE_ROLE_SWITCHER` | private dogfood SPA | `"1"` shows RoleSwitcher chrome (also auto in Vite DEV) |
| `EMAIL_PROVIDER` | comms drain | `sandbox` (default), `resend`, or `cloudflare` (hosted demo — Cloudflare Email Sending, no attachments) |
| `RESEND_API_KEY` | Resend provider only | Ignored unless `EMAIL_PROVIDER=resend` |
| `EMAIL_FROM` | optional | Default From: address for provider sends |
| `AIRTABLE_API_KEY` | optional projection | Drain only; product works when unset (paused) |
| `AIRTABLE_BASE_ID` | optional projection | Base id for one-way mirror |
| `AIRTABLE_TABLE_SUBMISSIONS` | optional | Table name override (and siblings for SPEAKERS / SESSIONS / TASKS / SCHEDULE / EVENTS) |
| `SPEAKEROPS_API_KEY` | CLI / agent | Bearer `spk_…` — mint via admin; never commit |
| `SPEAKEROPS_API_URL` | CLI optional | API base (default `http://127.0.0.1:8787`) |
| `SMOKE_BASE_URL` | optional remote smoke | workers.dev base for health re-smoke |
| `DOGFOOD_SKIP_DEPLOY` | optional | `"1"` = health-only path with `SMOKE_BASE_URL` |
| `DEPLOY_DRY_RUN` | optional | `"1"` = validate creds + dry-run evidence only |

Full index: [SECRETS.md](./SECRETS.md). **Never** paste API keys, JWTs, or magic-link tokens into docs or commits.

### 4. Local migrate

Apply linear D1 migrations to local SQLite (same SQL as Cloudflare remote apply):

```bash
pnpm db:migrate
```

Default file: `.data/speakerops.local.sqlite` (override with `SPEAKEROPS_DB_PATH`). Details: [OPERATIONS.md](./OPERATIONS.md) · [1.3 D1 baseline](./sections/1.3-d1-baseline.md).

### 5. Demo seed

Load the deterministic dogfood graph (~150 speakers, outstanding tasks, ≥1 schedule conflict):

```bash
pnpm seed
# second run is idempotent — same speaker count
pnpm seed
```

| Seed constant | Value |
|---------------|--------|
| Org / event | `org_dogfood` / `evt_dogfood` (slug `dogfood-2026`) |
| Demo admin email | `admin@demo.speakerops.local` |
| Demo evaluator | `evaluator@demo.speakerops.local` |
| Demo speaker | `speaker@demo.speakerops.local` |

These demo emails are **not** credentials (magic-link auth). Role switcher details: [8.4 demo seed](./sections/8.4-demo-seed.md).

### 6. Gates (typecheck + unit/governance)

```bash
pnpm typecheck
pnpm test:ci
```

Both must be non-interactive (E5). Do not use watch mode.

### 7. First admin (local path)

SpeakerOps uses **magic-link** auth (no passwords). Local / e2e path:

1. Start the SPA: `pnpm --filter @speakerops/web dev` (Vite).
2. API for browser e2e is started by `pnpm test:e2e` via `scripts/e2e-api-server.mjs` (dev outbox enabled). For interactive local dogfood against a Worker, use wrangler + controlled bootstrap (step 13).
3. Open `/login`, request a magic link for `admin@demo.speakerops.local` (or your `BOOTSTRAP_ADMIN_EMAIL` on a controlled empty D1).
4. In e2e / `AUTH_DEV_OUTBOX=1`, the harness reads the token from the **dev outbox** (never log the full token). Exchange sets HttpOnly cookie `speakerops_session`.
5. On production Worker: set `BOOTSTRAP_ADMIN_EMAIL` (email name only) so only that address may create the first admin membership once. Subsequent self-provision is denied.

Cookie flags (locked): `HttpOnly; Secure; SameSite=Lax`. See [SECURITY.md](./SECURITY.md) · [2.1 session auth](./sections/2.1-session-auth.md).

### 8. Demo path (constitution souls walk)

Walk the programme demo path end-to-end. This is the **S-ONB-HUMAN** success surface after first login — no tribal shortcuts.

| Order | Surface | Where | What you prove |
|-------|---------|--------|----------------|
| A | **Public CFP** | `/cfp/dogfood-2026` (or event slug) | Form loads with Lumen brand; conditional multi-speaker submit works |
| B | **Admin form builder** | `/admin/cfp` | CFP schema / categories (admin) |
| C | **Submissions & decisions** | `/admin/submissions` | Score → accept / reject |
| D | **Evaluation** | `/eval` · `/admin/evaluations` | Evaluator scoring + admin rollup |
| E | **Speaker portal** | `/portal` | Tasks, bio/headshot, onboarding |
| F | **Comms** | `/admin/comms` | Templates; send path uses outbox (E7) |
| G | **Schedule** | `/admin/schedule` | Drag/place sessions; conflict detection on room blocks |
| H | **Readiness dashboard** | `/admin` (readiness) | Outstanding speaker onboarding tasks; large list (L05 seed) |

**Constitution demo path (short form):** **CFP → eval → decide → portal → schedule → readiness**. If any step needs a secret value that is not in your env channel by **name**, stop and fix the channel — do not invent tribal workarounds.

Optional private dogfood: with an existing **admin** session and `ROLE_SWITCHER_ENABLED=1` + `VITE_ROLE_SWITCHER=1`, switch among demo roles without re-issuing magic links. Default production keeps the switcher **off**.

### 9. Browser E2E command

Verify inventory-backed journeys:

```bash
pnpm test:e2e                 # full Playwright suite (Phase 8 REQUIRED set)
pnpm test:e2e:inventory       # anti-shrinkage + @inv coverage lint
pnpm docs:e2e-report          # offline reports/e2e-coverage.html
```

Runbook: [E2E.md](./E2E.md) · law: [0.3 inventory law](./governance/0.3-e2e-inventory-law.md). Do not shrink REQUIRED inventory rows.

### 10. Cloudflare account steps (names only)

For dogfood host **S-CF** you need a Cloudflare account and API token. Operator checklist:

1. Create / use a Cloudflare account (dashboard).
2. Create an **API token** with Workers, D1, R2, Queues edit — store value only in secrets channel under name `CLOUDFLARE_API_TOKEN`.
3. Note account id under name `CLOUDFLARE_ACCOUNT_ID` (never commit the value).
4. Prefer token auth over interactive login for CI; interactive alternative for a human laptop: `wrangler login`.

Details: [OPERATIONS.md](./OPERATIONS.md) · [8.6 dogfood deploy](./sections/8.6-cloudflare-dogfood-deploy.md).

### 11. Wrangler install and resource create

```bash
# Wrangler is a workspace devDependency — or set WRANGLER_BIN
pnpm exec wrangler --version

# Once per account (binding names fixed in wrangler.toml):
pnpm exec wrangler d1 create speakerops
# → put returned database_id into SPEAKEROPS_D1_DATABASE_ID (name only in docs)

pnpm exec wrangler r2 bucket create speakerops-files
pnpm exec wrangler queues create speakerops-jobs
```

| Binding | Type | Default resource name |
|---------|------|------------------------|
| `DB` | D1 | `speakerops` |
| `FILES` | R2 | `speakerops-files` |
| `JOBS_QUEUE` | Queue | `speakerops-jobs` |

### 12. Remote migrate + Worker secrets (names)

```bash
pnpm exec wrangler d1 migrations apply speakerops --remote

pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
# optional:
# pnpm exec wrangler secret put RESEND_API_KEY
# pnpm exec wrangler secret put AIRTABLE_API_KEY
# BOOTSTRAP_ADMIN_EMAIL may be secret put or non-secret [vars]
```

### 13. Dogfood deploy + health

```bash
# Preferred one-shot (loads secrets channel, never commits values)
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
# or:
pnpm deploy:dogfood
```

Expect `GET /health` → **200** with `{ "ok": true, "version": "…" }`. Evidence path (BC10): `KMS-competition/initiative/evidence/cf-dogfood.txt` (redacted).

### 14. Airtable projection (optional)

Airtable is **one-way** D1 → Airtable only. Product writes never dual-write and never wait on Airtable (E7 / S-AIRTABLE).

1. Create a base; set `AIRTABLE_BASE_ID` and `AIRTABLE_API_KEY` in secrets channel (names only here).
2. Optional table name overrides: `AIRTABLE_TABLE_SUBMISSIONS`, `AIRTABLE_TABLE_SPEAKERS`, `AIRTABLE_TABLE_SESSIONS`, `AIRTABLE_TABLE_TASKS`, `AIRTABLE_TABLE_SCHEDULE`, `AIRTABLE_TABLE_EVENTS`.
3. When key/base unset, projection **pauses** (outbox lags; product still 200).
4. Status UI: `/admin/settings/airtable` (D1 lag only — no Airtable HTTP on that path).

Stub → full prose in 9.4: [AIRTABLE.md](./AIRTABLE.md) · implementation [7.3](./sections/7.3-airtable-projection.md).

### 15. Confirm timebox and hand-off

| Checkpoint | Pass when |
|------------|-----------|
| Local SoR | `pnpm db:migrate` + `pnpm seed` succeed |
| Gates | `pnpm typecheck` + `pnpm test:ci` green |
| Demo path | CFP → eval → portal → **schedule** → readiness walked once |
| E2E | `pnpm test:e2e` (or documented subset) green for dogfood claim later |
| Secrets | No values in git; names only in docs |
| Time | Local zero→demo **&lt;90 minutes** |

If a step fails, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) (expand 9.4) and [OPERATIONS.md](./OPERATIONS.md) failure modes — still no tribal private steps.

---

## Quick command card

```bash
pnpm install
pnpm db:migrate && pnpm seed
pnpm typecheck && pnpm test:ci
pnpm test:e2e                 # browser inventory suite
pnpm test:e2e:inventory       # inventory law
# Cloudflare (secrets out-of-band):
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
```

---

## Related paths

| Audience | Primary doc |
|----------|-------------|
| **Human** (this file) | `docs/ONBOARDING.md` → HTML `reports/onboarding.html` (**9.5**) |
| **Agent** | [AGENT_SETUP.md](./AGENT_SETUP.md) · [CLI.md](./CLI.md) |
| **Deep reference** | [ARCHITECTURE.md](./ARCHITECTURE.md) · [FIELD_FLOW.md](./FIELD_FLOW.md) · [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| **Ops / deploy** | [OPERATIONS.md](./OPERATIONS.md) · [SECRETS.md](./SECRETS.md) |
| **Security** | [SECURITY.md](./SECURITY.md) |
| **Contracts** | [CONTRACTS.md](./CONTRACTS.md) |
| **Competition / judges** | [COMPETITION.md](./COMPETITION.md) |
| **Section note** | [9.2-human-onboarding.md](./sections/9.2-human-onboarding.md) |

---

## Secret rule (E10)

Document **variable names only** (`CLOUDFLARE_*`, `AIRTABLE_*`, `RESEND_*`, `TURNSTILE_*`, `SPEAKEROPS_*`, …). Never commit or log API keys, session cookies, Bearer tokens, JWTs (`eyJ…`), OpenAI-style keys (`sk-…`), or magic-link tokens in full.

---

## Failure modes this doc prevents

| Failure | How this checklist avoids it |
|---------|------------------------------|
| Tribal step | Numbered steps 1–15; no off-doc “ask the last engineer” |
| Secret value in doc | Env **names** table only; no `sk-` / `eyJ` values |
| Broken command | Commands match workspace `package.json` + CLI/ops scripts |
| Missing demo path | Explicit CFP → eval → portal → schedule → readiness walk |

---

## Performance expectations (operator note)

- Primary admin list interactions target p95 &lt; 200ms local after warm load for seed ≤150 rows (L05 page size 25 on Speakers list).
- Public CFP first contentful interaction without multi-second blank screen (skeleton allowed).

---

## Proof / later sections

| Item | Section |
|------|---------|
| This prose (S-ONB-HUMAN) | **9.2** (you are here) |
| Agent path | **9.3** |
| Deep docs | **9.4** |
| HTML reports (`reports/onboarding.html`) | **9.5** |
| Dry-run evidence BC13 | **9.6** |
