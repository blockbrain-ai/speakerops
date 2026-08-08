# SpeakerOps — contract map

**Purpose:** Single index of binding programme contracts so builders do not invent a second source of truth.  
**Sections:** 0.1 programme contract · 0.2 Lumen design system lock · 0.3 Browser E2E inventory law · 0.4 Domain and command map · **0.5 Docs and onboarding outline** (governance).  
**Programme contract summary:** [`docs/governance/0.1-programme-contract.md`](./governance/0.1-programme-contract.md)  
**Lumen lock (E6):** [`docs/governance/0.2-lumen-lock.md`](./governance/0.2-lumen-lock.md)  
**E2E inventory law (S-E2E-INV / S-E2E-RUN):** [`docs/governance/0.3-e2e-inventory-law.md`](./governance/0.3-e2e-inventory-law.md)  
**Domain and command map (S-CLI / SCHEMA+COMMANDS+SCOPES):** [`docs/governance/0.4-domain-map.md`](./governance/0.4-domain-map.md)  
**Docs and onboarding outline (S-ONB-HUMAN / S-ONB-AGENT / S-DOCS):** [`docs/governance/0.5-docs-onboarding-outline.md`](./governance/0.5-docs-onboarding-outline.md)

---

## Binding documents

| Contract | Path | Role |
|----------|------|------|
| Constitution | [`KMS-competition/initiative/00_CONSTITUTION.md`](../KMS-competition/initiative/00_CONSTITUTION.md) | North star, souls, stack lock, non-goals, dogfood_ready |
| Programme contract | [`docs/governance/0.1-programme-contract.md`](./governance/0.1-programme-contract.md) | Workspace ratification of Articles I–II, VI–VIII |
| **Lumen lock (E6 frontend freeze)** | [`docs/governance/0.2-lumen-lock.md`](./governance/0.2-lumen-lock.md) | Token CSS vars, contrast gate, SVG reject, retheme blast radius, component checklist |
| **Browser E2E inventory law (0.3)** | [`docs/governance/0.3-e2e-inventory-law.md`](./governance/0.3-e2e-inventory-law.md) | REQUIRED PASS for dogfood, @inv tags, Phase 8 full run, no shrinkage, discovery crawl, phase letter map |
| **Domain and command map (0.4)** | [`docs/governance/0.4-domain-map.md`](./governance/0.4-domain-map.md) | Person≠Speaker; command summary; scope default-deny; FE/CLI/API alignment |
| **Docs and onboarding outline (0.5)** | [`docs/governance/0.5-docs-onboarding-outline.md`](./governance/0.5-docs-onboarding-outline.md) | Phase 9 `docs/` tree + `reports/` HTML portal; human vs agent paths; 9.6 evidence |
| Schema | [`KMS-competition/initiative/contracts/SCHEMA.md`](../KMS-competition/initiative/contracts/SCHEMA.md) | D1 tables; section ownership; no invented columns |
| D1 baseline (1.3) | [`docs/sections/1.3-d1-baseline.md`](./sections/1.3-d1-baseline.md) | Drizzle `packages/db/schema.ts` + `migrations/0001_baseline.sql`; `pnpm db:migrate` |
| Web shell + Lumen (1.4) | [`docs/sections/1.4-lumen-shell.md`](./sections/1.4-lumen-shell.md) | Vite SPA, `lumen.css` tokens, AdminShell IA, router stubs |
| Playwright inventory harness (1.5) | [`docs/sections/1.5-playwright-inventory-harness.md`](./sections/1.5-playwright-inventory-harness.md) · [`docs/E2E.md`](./E2E.md) | `playwright.config.ts`, `scripts/inventory-lint.ts`, `@inv` tags |
| Commands | [`KMS-competition/initiative/contracts/COMMANDS.md`](../KMS-competition/initiative/contracts/COMMANDS.md) | Named domain commands; HTTP/CLI 1:1 |
| Scopes | [`KMS-competition/initiative/contracts/SCOPES.md`](../KMS-competition/initiative/contracts/SCOPES.md) | API key scopes; default-deny high-risk |
| CLI inventory | [`KMS-competition/initiative/contracts/CLI_INVENTORY.md`](../KMS-competition/initiative/contracts/CLI_INVENTORY.md) | CLI surface parity |
| Inventory ownership | [`KMS-competition/initiative/contracts/INVENTORY_OWNERSHIP.md`](../KMS-competition/initiative/contracts/INVENTORY_OWNERSHIP.md) | Which section owns which @inv rows |
| Traceability | [`KMS-competition/initiative/contracts/TRACEABILITY.md`](../KMS-competition/initiative/contracts/TRACEABILITY.md) | Requirement → section map |
| Browser E2E inventory (canonical) | [`KMS-competition/initiative/BROWSER_E2E_INVENTORY.md`](../KMS-competition/initiative/BROWSER_E2E_INVENTORY.md) | Exhaustive REQUIRED journeys (source of truth) |
| Lumen (initiative synthesis) | [`KMS-competition/initiative/01_DESIGN_SYSTEM_LUMEN.md`](../KMS-competition/initiative/01_DESIGN_SYSTEM_LUMEN.md) | Full design synthesis; 0.2 freezes essentials |
| Synthesis | [`KMS-competition/research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md`](../KMS-competition/research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md) | Keep/cut decisions |

Engineering standards **E1–E12** live in the Section Runner RUNS_DIR as `speakerops-engineering-standards.md` (not duplicated here).

### E6 → Lumen lock

Engineering standard **E6** (Frontend — Lumen + E9) requires React + Vite + Lumen CSS variables, Design Kit tokens only, focus rings, and status-not-color-only. The workspace freeze for those rules is:

**[`docs/governance/0.2-lumen-lock.md`](./governance/0.2-lumen-lock.md)**

Implement `apps/web/src/styles/lumen.css` (section 1.4) from that lock. Do not invent freeform CSS or retheme admin chrome.

### S-E2E-INV / S-E2E-RUN → inventory law

Constitution souls **S-E2E-INV** and **S-E2E-RUN** require inventory completeness and full headless proof. The workspace ratification is:

**[`docs/governance/0.3-e2e-inventory-law.md`](./governance/0.3-e2e-inventory-law.md)**

Canonical journeys: [`BROWSER_E2E_INVENTORY.md`](../KMS-competition/initiative/BROWSER_E2E_INVENTORY.md).  
Harness (1.5): [`docs/E2E.md`](./E2E.md) · `playwright.config.ts` · `scripts/inventory-lint.ts`.  
Commands: `pnpm test:e2e` · `pnpm test:e2e:inventory`. Do not shrink REQUIRED rows; discovery crawl REQUIRED at Phase 8.

### S-CLI → domain and command map

Constitution soul **S-CLI** requires a scoped CLI over the **same** domain commands as HTTP. Workspace ratification of schema ownership, command registry summary, and scope default-deny:

**[`docs/governance/0.4-domain-map.md`](./governance/0.4-domain-map.md)**

Canonical sources: [`SCHEMA.md`](../KMS-competition/initiative/contracts/SCHEMA.md) · [`COMMANDS.md`](../KMS-competition/initiative/contracts/COMMANDS.md) · [`SCOPES.md`](../KMS-competition/initiative/contracts/SCOPES.md).  
**Person ≠ Speaker.** Default-deny on new keys: `comms:send`, `decisions:write`, `keys:admin`.

### S-ONB-HUMAN / S-ONB-AGENT / S-DOCS → docs and onboarding outline

Constitution souls **S-ONB-HUMAN**, **S-ONB-AGENT**, and **S-DOCS** require human onboarding, agent setup, and a coherent docs + HTML report portal. Workspace pre-declaration (Phase 9 shape locked so execution is not invention):

**[`docs/governance/0.5-docs-onboarding-outline.md`](./governance/0.5-docs-onboarding-outline.md)**

Required leaves include `docs/ONBOARDING.md`, `docs/AGENT_SETUP.md`, and **`reports/index.html`**. Final prose and `pnpm docs:reports` land in Phase 9.1–9.6; 9.6 proves BC13–BC15.

---

## Stack lock (quick reference)

| Layer | Locked choice |
|-------|---------------|
| UI | React + Vite + TS + Lumen |
| API | Hono on Cloudflare Workers |
| SoR | **D1** (Drizzle) — not Postgres dual-stack |
| Files | R2 |
| Jobs | Outbox + Queues |
| Live | DO invalidation only |
| Airtable | One-way projection only |
| Agents | CLI + scoped API keys |

See programme contract §3 for full table and non-goals. Lumen tokens / retheme / Design Kit security: [0.2-lumen-lock.md](./governance/0.2-lumen-lock.md).

---

## Rules for later sections

1. Do not add endpoints or table columns outside COMMANDS/SCHEMA without updating those contracts in the same PR (see [0.4 domain map](./governance/0.4-domain-map.md)).
2. Do not introduce a second SoR (Airtable writes, DO-as-DB, client-only authz).
3. Shared DTOs live in `packages/shared/src/` once scaffolded — import; do not duplicate types across web/api.
4. Every new UI control adds a browser inventory row in the same section; Playwright tests tag `@inv:A01` etc. (see [0.3 inventory law](./governance/0.3-e2e-inventory-law.md)).
5. Soul tests change only via constitution Amendment + owner approval.
6. UI chrome uses Lumen tokens from the 0.2 lock only — no freeform CSS/HTML; retheme public CFP + speaker portal only.
7. Do not shrink REQUIRED inventory; no wildcard-only acceptance; Phase 8 runs full suite + discovery crawl.
8. HTTP and CLI map 1:1 to named domain commands; never invent a parallel god-mode CLI. New API keys **default-deny** `comms:send`, `decisions:write`, and `keys:admin`.
9. Phase 9 docs must follow the [0.5 onboarding outline](./governance/0.5-docs-onboarding-outline.md) tree — do not invent alternate top-level leaves or skip `reports/index.html`.
