# SpeakerOps Workspace

This file is loaded automatically by Claude Code at the start of every session. Keep it accurate — outdated commands here cost real time.

## Stack

- **UI:** React + Vite + TypeScript + Lumen (CSS variables; Design Kit tokens only)
- **API:** Hono on Cloudflare Workers
- **DB / SoR:** Cloudflare D1 + Drizzle (sole system of record — no Postgres dual-stack)
- **Files:** R2 · **Jobs:** Queues + transactional outbox · **Live:** Durable Object invalidation only
- **Airtable:** one-way projection only (never SoR, never dual-write)
- **Auth:** HttpOnly cookies (humans); scoped API keys + CLI (agents)
- **E2E:** Playwright inventory-driven (`BROWSER_E2E_INVENTORY.md`)
- **Validation:** Zod at every HTTP/CLI boundary; E4 error envelopes
- **Package manager:** pnpm · **Node:** ≥20

**Non-goals (do not invent):** Next/RSC default, OR-Tools, Temporal, Airtable dual-write, in-product agent fleet, Sessionboard CRM suite.

## Commands

- **Build / typecheck:** `pnpm typecheck`
- **Test (unit/integration/governance):** `pnpm test:ci`
- **Browser E2E:** `pnpm test:e2e` (Playwright harness from 1.5; full REQUIRED set at Phase 8)
- **Inventory lint:** `pnpm test:e2e:inventory` (`scripts/inventory-lint.ts` — anti-shrinkage + `@inv` coverage)
- **Inventory lint (Phase 8 full gate):** `E2E_INVENTORY_GATE=phase8 pnpm test:e2e:inventory` — non-DEFER REQUIRED must be status `PASS` + Playwright-bound `@inv` tags

> The Section Runner build gate uses these same commands via `GATE_TYPECHECK_CMD` and `GATE_TEST_CMD`. They must match.

## Conventions

- **Composition roots (post-scaffold):** API `apps/api/src/index.ts` · Web `apps/web/src/main.tsx` · CLI `packages/cli/src/main.ts` · DB `packages/db` · shared DTOs `packages/shared/src/`
- **Logger:** structured logs only — never `console.log` in production service paths; never log secrets, raw API keys, or magic links
- **Routes / commands:** domain commands from `KMS-competition/initiative/contracts/COMMANDS.md` only — no generic CRUD bypass
- **Repositories:** event-scoped queries (`eventId` at repository layer); Person ≠ Speaker
- **Tests:** `tests/governance/*.test.mjs` (governance); product tests co-located or under `tests/` / `playwright/e2e/` with `@inv:A01` tags
- **Migrations:** `packages/db/migrations/` (linear additive; Drizzle)
- **Validation:** Zod before business logic on every accepting endpoint/command
- **Naming:** camelCase variables, PascalCase types, kebab-case filenames
- **Imports:** ESM static import only (`"type": "module"`). No CommonJS mixing.

## Engineering Standards

See RUNS_DIR `speakerops-engineering-standards.md` (**E1–E12**). Agent entrypoint: [`AGENTS.md`](./AGENTS.md). Every change must comply unless explicitly deferred in the run plan.

Key cross-cutting rules:
- **E1** Schema: D1 only; Person ≠ Speaker; optimistic `version` on mutable aggregates
- **E2** Authz: event-scoped; roles admin|evaluator|speaker|public; scopes on Worker, not CLI alone
- **E3** Correlation: propagate `correlationId`; never regenerate; `audit_events` on consequential writes
- **E4** API: Zod + canonical error envelope `{ error, code, details? }`
- **E5** Gates: non-interactive `typecheck` / `test:ci` / `test:e2e` / `test:e2e:inventory`
- **E6** Frontend: Lumen tokens only; no freeform CSS; see `docs/governance/0.2-lumen-lock.md`
- **E7** Side effects: outbox; Airtable one-way; ICS UID/SEQUENCE
- **E8** CLI + API keys: same domain commands; high-risk scopes default-deny (`comms:send`, `decisions:write`, `keys:admin`)
- **E9** Testing: inventory law; every UI control adds a row + `@inv` tag in the same PR
- **E10** Security: HttpOnly cookies; CSP; no secrets in repo (env **names** only)
- **E11** Docs/onboarding: Phase 9 `docs/` + `reports/` HTML
- **E12** Section Runner programme rules; commit format below

**Commit format:** `feat(<section>): <description>` / `fix(<section>): <description>` (e.g. `feat(0.3): browser-e2e-inventory-lock`).

## Governance contracts (start here)

| Doc | Role |
|-----|------|
| `docs/governance/0.1-programme-contract.md` | North star, stack lock, dogfood_ready, non-goals |
| `docs/governance/0.2-lumen-lock.md` | E6 Lumen freeze |
| `docs/governance/0.3-e2e-inventory-law.md` | S-E2E-INV / S-E2E-RUN; no shrinkage; Phase 8 full run |
| `docs/governance/0.4-domain-map.md` | S-CLI; Person≠Speaker; scopes |
| `docs/governance/0.5-docs-onboarding-outline.md` | Phase 9 docs tree |
| `docs/CONTRACTS.md` | Contract index |
| `KMS-competition/initiative/00_CONSTITUTION.md` | Binding constitution |

## Pipeline Boundaries

Section Runner runs implementation phases inside this workspace. Stay within these boundaries:

- Do not commit `.pipeline/` (it is runtime state owned by the pipeline)
- Do not modify the parent `section-runner/` repo from inside this workspace
- Do not modify other workspaces
- All file changes must happen under this workspace root
- Commit your work before each section ends — leaving an uncommitted tree blocks the build gate

## Programme notes

- Exit claim: **`dogfood_ready`** (Cloudflare dogfood deploy + full browser E2E green + onboarding docs).
- Do not shrink REQUIRED inventory; only owner **DEFER** removes a row from the required PASS set.
- Intermediate inventory lint requires `@inv` on **Playwright-bound** `test()` for **IMPLEMENTED/PASS/FAIL** rows (empty/missing e2e root is a failure when any status-owned ID exists; all-OPEN pre-harness may defer). Phase 8 gate enforces **status PASS** + Playwright-bound `@inv` + a **run report** with **passed, non-skipped** results for every non-DEFER REQUIRED ID (`playwright test --list` / describe.skip / local no-op `const test = …` do not count).
- Mainline product work is section-runner driven; do not push directly around the pipeline from inside a section without following gate rules.
