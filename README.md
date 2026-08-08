# SpeakerOps

Production-hard **Program OS** for AI Engineer conference operations — CFP → score → accept → portal → comms/calendar → schedule → readiness — on Cloudflare (D1 SoR, one-way Airtable projection, CLI + scoped keys).

**Exit claim:** `dogfood_ready` (see constitution).

## Programme contract (start here)

| Doc | Why |
|-----|-----|
| [`docs/governance/0.1-programme-contract.md`](./docs/governance/0.1-programme-contract.md) | North star, stack lock, non-goals, soul pointers, clean-room, dogfood_ready |
| [`docs/governance/0.2-lumen-lock.md`](./docs/governance/0.2-lumen-lock.md) | **E6 Lumen lock** — tokens, contrast gate, SVG reject, retheme blast radius, component checklist |
| [`docs/governance/0.3-e2e-inventory-law.md`](./docs/governance/0.3-e2e-inventory-law.md) | **S-E2E-INV / S-E2E-RUN** — REQUIRED PASS for dogfood, `@inv` tags, Phase 8 full run, no shrinkage, discovery crawl |
| [`docs/governance/0.4-domain-map.md`](./docs/governance/0.4-domain-map.md) | **S-CLI** — Person≠Speaker, command registry summary, scope default-deny (send/decisions/keys) |
| [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | Index of binding contracts |
| [`KMS-competition/initiative/00_CONSTITUTION.md`](./KMS-competition/initiative/00_CONSTITUTION.md) | Binding constitution (souls, stack, anti-dilution) |

## Stack lock (do not invent alternatives)

- **UI:** React + Vite + TypeScript + Lumen  
- **API:** Hono on Cloudflare Workers  
- **DB:** D1 + Drizzle (sole SoR)  
- **Files:** R2 · **Jobs:** Queues + outbox · **Live:** DO invalidation  
- **Airtable:** one-way projection only  
- **Agents:** CLI + scoped API keys  

**Non-goals include:** Sessionboard CRM suite, in-product agent fleet, Next/RSC default, Postgres dual-stack, Airtable dual-write, OR-Tools, Temporal, struck brief features.

## Initiative contracts

- Schema: `KMS-competition/initiative/contracts/SCHEMA.md`
- Commands: `KMS-competition/initiative/contracts/COMMANDS.md`
- Scopes: `KMS-competition/initiative/contracts/SCOPES.md`
- Domain map (workspace): `docs/governance/0.4-domain-map.md`
- Browser E2E inventory (canonical): `KMS-competition/initiative/BROWSER_E2E_INVENTORY.md`
- Browser E2E inventory law (workspace): `docs/governance/0.3-e2e-inventory-law.md`
- Lumen (initiative): `KMS-competition/initiative/01_DESIGN_SYSTEM_LUMEN.md`
- Lumen lock (workspace E6 freeze): `docs/governance/0.2-lumen-lock.md`

## Gates

```bash
pnpm typecheck
pnpm test:ci
pnpm test:e2e:inventory   # inventory law lint (from 0.3)
pnpm test:e2e             # Playwright full suite (stub until harness; Phase 8 = all REQUIRED PASS)
```

Inventory lint is live from section **0.3**. Full browser suite runs after Playwright scaffold (Phase 1.5+); **all REQUIRED** journeys + discovery crawl at **Phase 8**.

## Phase map

| Phase | Focus |
|-------|--------|
| 0 | Governance contracts (this phase starts at 0.1) |
| 1 | Monorepo, Worker, D1, Lumen shell, Playwright harness |
| 2–7 | Auth, CFP/eval, portal, comms, schedule, CLI/Airtable |
| 8 | Full browser E2E, security, seed, CF dogfood deploy |
| 9 | Onboarding docs + HTML reports (exit gate for dogfood_ready) |
