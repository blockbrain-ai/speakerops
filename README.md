# SpeakerOps

Production-hard **Program OS** for AI Engineer conference operations — CFP → score → accept → portal → comms/calendar → schedule → readiness — on Cloudflare (D1 SoR, optional one-way Airtable projection — paused on the hosted demo, CLI + scoped keys).

**Exit claim:** `dogfood_ready` (see constitution).

## Judges — start here

**Live demo:** <https://www.speakerops.org> · **Entry:** open [`/judge`](https://www.speakerops.org/judge), pick **admin**, **evaluator**, or **speaker**, and enter — **no access code**. The role switcher (top of every shell) moves between roles. Sessions last ~4 hours; the demo is shared and reset periodically; API keys minted in demo sessions expire within at most 4 hours (only demo-created keys can be revoked).

**Developers:** [`/developers`](https://www.speakerops.org/developers) — TypeScript SDK (`@speakerops/sdk` in this monorepo, not on public npm), CLI, and how to project a programme to another platform. Handbook: [`docs/SDK.md`](./docs/SDK.md).

**10-minute happy path:** publish a CFP form (`Admin → CFP/Forms`) → submit it from [`/cfp/dogfood-2026`](https://www.speakerops.org/cfp/dogfood-2026) (or your own form's public link) → assign an evaluator (`Submissions → detail → Assign`) → score it with the proposal panel (`/eval`) → accept (`Submissions → decision`) → speaker portal onboarding (`/portal`) → place the session by drag-and-drop (`Schedule`) → download the `.ics` from the portal → watch `Overview` readiness update. Full feature map: [`docs/COMPETITION.md`](./docs/COMPETITION.md).

**Real-entrant loop:** submit the public CFP with your own email; on accept, membership-aware magic-link login gets you into the portal with that identity (no allowlist needed for provisioned members).

**Requirements to run locally:** Node **20–24** (`engines` enforced), pnpm 9.

## 5-minute orientation

New here? Pick a path, then skim the map. Human timed checklist is live (**9.2** / **S-ONB-HUMAN**); agent CLI path is live (**9.3** / **S-ONB-AGENT**); deep docs land in **9.4**; HTML portal in **9.5**; onboarding proof keystone in **9.6** (BC13–15). The **tree is locked** (section **9.1** / outline **0.5**).

| You are… | Start | Then |
|----------|--------|------|
| **Human operator** | [`docs/ONBOARDING.md`](./docs/ONBOARDING.md) (**S-ONB-HUMAN**) | Env names → migrate → seed → first admin → demo path (CFP→schedule) → gates · **&lt;90m** |
| **Coding agent** | [`docs/AGENT_SETUP.md`](./docs/AGENT_SETUP.md) + [`docs/CLI.md`](./docs/CLI.md) (**S-ONB-AGENT**) | Scoped key → OpenAPI → readiness / design publish |
| **Reviewer / judge** | [`docs/COMPETITION.md`](./docs/COMPETITION.md) · this README | Non-goals + [constitution](./KMS-competition/initiative/00_CONSTITUTION.md) |
| **Maintainer** | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) | Security · E2E · troubleshooting |

```bash
pnpm install
pnpm db:migrate && pnpm seed    # local SoR + demo graph
pnpm typecheck && pnpm test:ci  # non-watch gates (E5)
# Optional: pnpm test:e2e · pnpm deploy:dogfood (secrets out-of-band)
```

**Never commit secret values** — env **names** only: [`docs/SECRETS.md`](./docs/SECRETS.md).

### Docs map (S-DOCS)

| Doc | Role |
|-----|------|
| [`docs/ONBOARDING.md`](./docs/ONBOARDING.md) | Human zero → dogfood (timed **9.2** / S-ONB-HUMAN) |
| [`docs/sections/9.2-human-onboarding.md`](./docs/sections/9.2-human-onboarding.md) | Section note · AC → proof for human path |
| [`docs/AGENT_SETUP.md`](./docs/AGENT_SETUP.md) | Agent zero → CLI ops (timed **9.3** / S-ONB-AGENT) |
| [`docs/sections/9.3-agent-setup.md`](./docs/sections/9.3-agent-setup.md) | Section note · AC → proof for agent path |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | D1 SoR, projection, auth, CLI model |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | CSP, cookies, roles, keys |
| [`docs/CLI.md`](./docs/CLI.md) | `speakerops` command reference |
| [`docs/SDK.md`](./docs/SDK.md) | TypeScript SDK (`@speakerops/sdk`) |
| [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) | Deploy, migrate, backup / D1 Time Travel |
| [`docs/AIRTABLE.md`](./docs/AIRTABLE.md) | One-way projection setup & lag |
| [`docs/E2E.md`](./docs/E2E.md) | Playwright inventory suite |
| [`docs/COMPETITION.md`](./docs/COMPETITION.md) | Brief mapping + non-goals |
| [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) | Common failures / recovery |
| [`docs/FIELD_FLOW.md`](./docs/FIELD_FLOW.md) | Forms → portal field flow (I16) |
| [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | Binding contract index |
| [`docs/SECRETS.md`](./docs/SECRETS.md) | Env **names** only (E10) |
| [`docs/sections/9.1-docs-ia.md`](./docs/sections/9.1-docs-ia.md) | This IA section note |
| [`reports/index.html`](./reports/index.html) | Offline Lumen reports portal (**9.5** · S-DOCS) |
| [`reports/e2e-coverage.html`](./reports/e2e-coverage.html) | Offline E2E coverage (8.5); linked from portal **9.5** |
| [`docs/sections/9.6-onboarding-proof.md`](./docs/sections/9.6-onboarding-proof.md) | Onboarding proof keystone (**9.6** · BC13–15) |
| [`KMS-competition/initiative/evidence/onboarding-proof/`](./KMS-competition/initiative/evidence/onboarding-proof/) | Dry-run evidence bundle (human / agent / docs / CF gate) |

Outline + build order: [`docs/governance/0.5-docs-onboarding-outline.md`](./docs/governance/0.5-docs-onboarding-outline.md).

## Programme contract (start here)

| Doc | Why |
|-----|-----|
| [`docs/governance/0.1-programme-contract.md`](./docs/governance/0.1-programme-contract.md) | North star, stack lock, non-goals, soul pointers, clean-room, dogfood_ready |
| [`docs/governance/0.2-lumen-lock.md`](./docs/governance/0.2-lumen-lock.md) | **E6 Lumen lock** — tokens, contrast gate, SVG reject, retheme blast radius, component checklist |
| [`docs/governance/0.3-e2e-inventory-law.md`](./docs/governance/0.3-e2e-inventory-law.md) | **S-E2E-INV / S-E2E-RUN** — REQUIRED PASS for dogfood, `@inv` tags, Phase 8 full run, no shrinkage, discovery crawl |
| [`docs/governance/0.4-domain-map.md`](./docs/governance/0.4-domain-map.md) | **S-CLI** — Person≠Speaker, command registry summary, scope default-deny (send/decisions/keys) |
| [`docs/governance/0.5-docs-onboarding-outline.md`](./docs/governance/0.5-docs-onboarding-outline.md) | **S-ONB-HUMAN / S-ONB-AGENT / S-DOCS** — Phase 9 docs tree + reports portal outline |
| [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | Index of binding contracts |
| [`KMS-competition/initiative/00_CONSTITUTION.md`](./KMS-competition/initiative/00_CONSTITUTION.md) | Binding constitution (souls, stack, anti-dilution) |

## Stack lock (do not invent alternatives)

- **UI:** React + Vite + TypeScript + Lumen  
- **API:** Hono on Cloudflare Workers  
- **DB:** D1 + Drizzle (sole SoR)  
- **Files:** R2 when configured — the hosted demo stores file bytes as durable D1 rows (`file_blobs`) because R2 is not bound · **Jobs:** Queues + outbox · **Live:** 3-second polling (DO invalidation deferred)
- **Airtable:** optional one-way projection only (paused on the hosted demo — no keys configured)
- **Agents:** CLI + scoped API keys  

**Non-goals include:** Sessionboard CRM suite, in-product agent fleet, Next/RSC default, Postgres dual-stack, Airtable dual-write, OR-Tools, Temporal, AI-assisted multi-round review. Accelevents one-way projection, portal markdown library + allowlisted embeds, and the embeddable public programme are **in-scope** (Amendment A1) and shipped — Accelevents is **untested against a live API key** on this dogfood (no credentials).

## Initiative contracts

- Schema: `KMS-competition/initiative/contracts/SCHEMA.md`
- Commands: `KMS-competition/initiative/contracts/COMMANDS.md`
- Scopes: `KMS-competition/initiative/contracts/SCOPES.md`
- Domain map (workspace): `docs/governance/0.4-domain-map.md`
- Docs and onboarding outline (workspace): `docs/governance/0.5-docs-onboarding-outline.md`
- Browser E2E inventory (canonical): `KMS-competition/initiative/BROWSER_E2E_INVENTORY.md`
- Browser E2E inventory law (workspace): `docs/governance/0.3-e2e-inventory-law.md`
- Lumen (initiative): `KMS-competition/initiative/01_DESIGN_SYSTEM_LUMEN.md`
- Lumen lock (workspace E6 freeze): `docs/governance/0.2-lumen-lock.md`

## Gates

```bash
pnpm typecheck            # tsc -b monorepo project references (non-watch)
pnpm test:ci              # governance node:test + vitest run (watch: false)
pnpm test:e2e:inventory   # inventory law lint (`scripts/inventory-lint.ts` → 0.3 engine)
pnpm test:e2e             # Playwright suite (`playwright.config.ts`; full REQUIRED PASS at Phase 8)
pnpm db:generate          # verify Drizzle schema + migration inventory (1.3+)
pnpm db:migrate           # apply packages/db/migrations to local SQLite (1.3+)
pnpm seed                 # deterministic demo graph (~150 speakers; section 8.4)
pnpm docs:e2e-report      # offline E2E coverage HTML (section 8.5 · S-E2E-RUN)
pnpm docs:reports         # Lumen reports portal (section 9.5 · S-DOCS)
pnpm check:onboarding-proof  # 9.6 evidence bundle · BC13–15 · CF gate · linkcheck 0
```

### Demo seed and role switcher (section 8.4)

```bash
pnpm db:migrate           # ensure local schema
pnpm seed                 # idempotent — second run keeps the same speaker count (150)
```

- **Seed:** writes org/event, 150 accepted speakers (L05), outstanding tasks, missing headshots, and ≥1 intentional schedule room conflict into local SQLite (`SPEAKEROPS_DB_PATH` or `.data/speakerops.local.sqlite`).
- **Demo accounts** (not secrets): `admin@demo.speakerops.local`, `evaluator@demo.speakerops.local`, `speaker@demo.speakerops.local`.
- **Role switcher (dogfood/dev only):** SPA shows when `import.meta.env.DEV` or `VITE_ROLE_SWITCHER=1`. API route registers only when `ROLE_SWITCHER_ENABLED=1` (Worker) or local e2e (`createAppWithAuth`). Controlled/production dogfood requires an **existing admin session** (or a `/judge` demo session — see “Judges — start here”) before minting a demo role (workers.dev is not private; non-admins cannot escalate). Default production path keeps the route **off**. See [`docs/sections/8.4-demo-seed.md`](./docs/sections/8.4-demo-seed.md).

Monorepo layout (section **1.1**): `apps/{web,api}`, `packages/{shared,db,cli}`. Agent standards: [`AGENTS.md`](./AGENTS.md) → `speakerops-engineering-standards.md` (E1–E12).

Worker API health (section **1.2**): `GET /health` → `{ ok: true, version }` on Hono Worker; root `wrangler.toml` binds D1 as `DB` (names only, no secrets). See [`docs/sections/1.2-worker-health.md`](./docs/sections/1.2-worker-health.md).

### Cloudflare dogfood deploy (section 8.6 / S-CF)

```bash
# Fails clearly without CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
pnpm deploy:dogfood

# Operator path (secrets out-of-band — never commit values)
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
```

- **Runbook:** [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) (wrangler create D1/R2/queue, `secret put`, deploy, D1 Time Travel rollback)
- **Evidence (BC10):** `KMS-competition/initiative/evidence/cf-dogfood.txt` (+ `.template.txt` redaction rules)
- **Optional remote smoke:** `SMOKE_BASE_URL=https://…workers.dev pnpm exec playwright test playwright/e2e/cf_dogfood_smoke.spec.ts` (skips when unset)
- Env **names** only: see [`docs/SECRETS.md`](./docs/SECRETS.md). Gates (`test:ci` / `typecheck`) never source deploy secrets.

D1 Drizzle baseline (section **1.3**): `packages/db/schema.ts` + `migrations/0001_baseline.sql` (`organizations`, `events`+`version`, `audit_events`, `outbox_events`, `idempotency_keys`). See [`docs/sections/1.3-d1-baseline.md`](./docs/sections/1.3-d1-baseline.md).

Inventory lint is live from section **0.3** (TS entry **1.5**: `scripts/inventory-lint.ts`). Playwright harness is scaffolded in **1.5** (`playwright.config.ts`, `playwright/e2e/`); see [`docs/E2E.md`](./docs/E2E.md). **All REQUIRED** journeys + discovery crawl at **Phase 8**.

## Phase map

| Phase | Focus |
|-------|--------|
| 0 | Governance contracts (0.1–0.5; docs tree pre-declared in 0.5) |
| 1 | Monorepo, Worker, D1, Lumen shell, Playwright harness |
| 2–7 | Auth, CFP/eval, portal, comms, schedule, CLI/Airtable |
| 8 | Full browser E2E, security, seed, CF dogfood deploy |
| 9 | Onboarding docs + HTML reports (exit gate for dogfood_ready; tree locked in 0.5) |
