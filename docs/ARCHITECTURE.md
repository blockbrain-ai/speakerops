# Architecture

> **Soul:** **S-DOCS** · **Owner prose:** section **9.4** · **IA:** [9.1](./sections/9.1-docs-ia.md)  
> **Contracts:** [SCHEMA](../KMS-competition/initiative/contracts/SCHEMA.md) · [COMMANDS](../KMS-competition/initiative/contracts/COMMANDS.md) · [SCOPES](../KMS-competition/initiative/contracts/SCOPES.md)

## Purpose

Coherent description of SpeakerOps as a **Program OS** on Cloudflare: D1 system of record, one-way Airtable projection, Hono Worker API, React+Vite Lumen SPA, R2 files, queues + outbox, Durable Object invalidation, CLI + scoped keys.

## Status (section 9.1)

**Stub.** Deep architecture prose lands in **9.4**. This leaf locks the path and cross-links so the docs map has no dead ends.

## Locked stack (do not invent)

| Layer | Choice |
|-------|--------|
| UI | React + Vite + TypeScript + **Lumen** ([0.2 lock](./governance/0.2-lumen-lock.md)) |
| API | Hono on Cloudflare Workers (`apps/api/src/index.ts`) |
| SoR | **D1** + Drizzle (`packages/db`) — not Postgres dual-stack |
| Files | R2 |
| Jobs | Queues + transactional outbox |
| Live | Durable Object invalidation only (not DO-as-DB) |
| Airtable | One-way projection only ([AIRTABLE.md](./AIRTABLE.md)) |
| Agents | CLI + scoped API keys ([CLI.md](./CLI.md) · [AGENT_SETUP.md](./AGENT_SETUP.md)) |

## Composition roots

| Surface | Path |
|---------|------|
| API | `apps/api/src/index.ts` |
| Web | `apps/web/src/main.tsx` |
| CLI | `packages/cli/src/main.ts` |
| DB | `packages/db` |
| Shared DTOs | `packages/shared/src/` |

## Domain invariants (pointers)

- **Person ≠ Speaker** — [0.4 domain map](./governance/0.4-domain-map.md)  
- Domain commands only — no generic CRUD bypass ([COMMANDS.md](../KMS-competition/initiative/contracts/COMMANDS.md))  
- Event-scoped authz; scopes on Worker ([SECURITY.md](./SECURITY.md))  
- Optimistic `version` on mutable aggregates  
- Audit + `correlationId` on consequential writes (E3)

## Related

- Programme north star: [0.1](./governance/0.1-programme-contract.md)  
- Operations / deploy: [OPERATIONS.md](./OPERATIONS.md)  
- Field flow (forms/portal): [FIELD_FLOW.md](./FIELD_FLOW.md)  
- Competition brief mapping: [COMPETITION.md](./COMPETITION.md)  
- Contract index: [CONTRACTS.md](./CONTRACTS.md)
