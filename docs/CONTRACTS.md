# SpeakerOps — contract map

**Purpose:** Single index of binding programme contracts so builders do not invent a second source of truth.  
**Section:** 0.1 programme contract (governance).  
**Programme contract summary:** [`docs/governance/0.1-programme-contract.md`](./governance/0.1-programme-contract.md)

---

## Binding documents

| Contract | Path | Role |
|----------|------|------|
| Constitution | [`KMS-competition/initiative/00_CONSTITUTION.md`](../KMS-competition/initiative/00_CONSTITUTION.md) | North star, souls, stack lock, non-goals, dogfood_ready |
| Programme contract (this phase) | [`docs/governance/0.1-programme-contract.md`](./governance/0.1-programme-contract.md) | Workspace ratification of Articles I–II, VI–VIII |
| Schema | [`KMS-competition/initiative/contracts/SCHEMA.md`](../KMS-competition/initiative/contracts/SCHEMA.md) | D1 tables; section ownership; no invented columns |
| Commands | [`KMS-competition/initiative/contracts/COMMANDS.md`](../KMS-competition/initiative/contracts/COMMANDS.md) | Named domain commands; HTTP/CLI 1:1 |
| Scopes | [`KMS-competition/initiative/contracts/SCOPES.md`](../KMS-competition/initiative/contracts/SCOPES.md) | API key scopes; default-deny high-risk |
| CLI inventory | [`KMS-competition/initiative/contracts/CLI_INVENTORY.md`](../KMS-competition/initiative/contracts/CLI_INVENTORY.md) | CLI surface parity |
| Inventory ownership | [`KMS-competition/initiative/contracts/INVENTORY_OWNERSHIP.md`](../KMS-competition/initiative/contracts/INVENTORY_OWNERSHIP.md) | Which section owns which @inv rows |
| Traceability | [`KMS-competition/initiative/contracts/TRACEABILITY.md`](../KMS-competition/initiative/contracts/TRACEABILITY.md) | Requirement → section map |
| Browser E2E law | [`KMS-competition/initiative/BROWSER_E2E_INVENTORY.md`](../KMS-competition/initiative/BROWSER_E2E_INVENTORY.md) | Exhaustive REQUIRED journeys |
| Lumen | [`KMS-competition/initiative/01_DESIGN_SYSTEM_LUMEN.md`](../KMS-competition/initiative/01_DESIGN_SYSTEM_LUMEN.md) | Design tokens / components / security |
| Synthesis | [`KMS-competition/research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md`](../KMS-competition/research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md) | Keep/cut decisions |

Engineering standards **E1–E12** live in the Section Runner RUNS_DIR as `speakerops-engineering-standards.md` (not duplicated here).

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

See programme contract §3 for full table and non-goals.

---

## Rules for later sections

1. Do not add endpoints or table columns outside COMMANDS/SCHEMA without updating those contracts in the same PR.
2. Do not introduce a second SoR (Airtable writes, DO-as-DB, client-only authz).
3. Shared DTOs live in `packages/shared/src/` once scaffolded — import; do not duplicate types across web/api.
4. Every new UI control adds a browser inventory row in the same section.
5. Soul tests change only via constitution Amendment + owner approval.
