# SpeakerOps — Agent guide

This workspace is built by Section Runner against the SpeakerOps programme.
Human-oriented product docs land in Phase 9 (`docs/ONBOARDING.md`); this file is the **agent** entrypoint for standards and gates.

## Engineering standards (E1–E12)

**Binding standards path (RUNS_DIR):**

- `speakerops-engineering-standards.md` (control plane / RUNS_DIR)
- Typical absolute layout: `ClawdSpeakerOpsRuns/speakerops-engineering-standards.md` next to ACTIVE-RUNS phase indexes

Every change must comply with **E1–E12** unless explicitly deferred in the run plan.

| Id | Topic |
|----|--------|
| E1 | Schema: D1 only; Person ≠ Speaker; optimistic `version` |
| E2 | Authz: event-scoped roles + API key scopes on Worker |
| E3 | Correlation: propagate `correlationId`; `audit_events` on writes |
| E4 | API: Zod + error envelope `{ error, code, details? }` |
| E5 | Gates: non-interactive `typecheck` / `test:ci` / `test:e2e` / `test:e2e:inventory` |
| E6 | Frontend: Lumen tokens only — `docs/governance/0.2-lumen-lock.md` |
| E7 | Side effects: outbox; Airtable one-way; ICS UID/SEQUENCE |
| E8 | CLI + API keys: same domain commands; high-risk scopes default-deny |
| E9 | Testing: inventory law; every UI control + `@inv` in same PR |
| E10 | Security: HttpOnly cookies; CSP; env **names** only in repo |
| E11 | Docs/onboarding: Phase 9 `docs/` + `reports/` HTML |
| E12 | Section Runner programme rules; commit format `feat(<section>): …` |

Also loaded at session start: [`CLAUDE.md`](./CLAUDE.md).

## Gates (must never hang / never watch)

```bash
pnpm typecheck          # tsc -b project references
pnpm test:ci            # governance (node:test) + vitest run (watch false)
pnpm test:e2e           # Playwright (`playwright.config.ts`; full REQUIRED at Phase 8)
pnpm test:e2e:inventory # inventory anti-shrinkage + @inv coverage (`scripts/inventory-lint.ts`)
pnpm db:generate        # verify schema + migration inventory (1.3+)
pnpm db:migrate         # apply packages/db/migrations to local SQLite (1.3+)
pnpm docs:e2e-report    # offline E2E coverage HTML (section 8.5)
pnpm docs:reports       # stub until Phase 9
```

**E5:** no `--watch` (or concurrent watch flags) on gate scripts. Vitest config sets `watch: false`.

## Monorepo layout (section 1.1)

| Path | Role |
|------|------|
| `apps/api` | Hono Worker composition root (`src/index.ts`) |
| `apps/web` | React + Vite SPA composition root (`src/main.tsx`) |
| `packages/shared` | Shared DTOs + Zod + E4 envelopes |
| `packages/db` | D1/Drizzle schema + migrations (`schema.ts`, `migrations/`) |
| `packages/cli` | `speakerops` CLI composition root (`src/main.ts`) |

Workspace definition: `pnpm-workspace.yaml` (`apps/*`, `packages/*`).

## Contracts (do not invent a second SoR)

| Contract | Path |
|----------|------|
| Constitution | `KMS-competition/initiative/00_CONSTITUTION.md` |
| Programme contract | `docs/governance/0.1-programme-contract.md` |
| Lumen lock | `docs/governance/0.2-lumen-lock.md` |
| E2E inventory law | `docs/governance/0.3-e2e-inventory-law.md` |
| Domain map | `docs/governance/0.4-domain-map.md` |
| Docs outline | `docs/governance/0.5-docs-onboarding-outline.md` |
| Schema / Commands / Scopes | `KMS-competition/initiative/contracts/` |
| Contract index | `docs/CONTRACTS.md` |

## Secrets

- Never commit values. Env **names** only — see `docs/SECRETS.md`.
- Ignore: `.env`, `.dev.vars`, `.pipeline/` (pipeline runtime).

## Composition roots

- API: `apps/api/src/index.ts`
- Web: `apps/web/src/main.tsx`
- CLI: `packages/cli/src/main.ts`
- DB: `packages/db`
- Shared DTOs: `packages/shared/src/`
