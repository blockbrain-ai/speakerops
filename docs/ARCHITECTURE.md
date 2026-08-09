# Architecture

> **Soul:** **S-DOCS** · **Owner prose:** section **9.4** · **IA:** [9.1](./sections/9.1-docs-ia.md)  
> **Contracts:** [SCHEMA](../KMS-competition/initiative/contracts/SCHEMA.md) · [COMMANDS](../KMS-competition/initiative/contracts/COMMANDS.md) · [SCOPES](../KMS-competition/initiative/contracts/SCOPES.md)  
> **Programme:** [0.1](./governance/0.1-programme-contract.md) · domain map [0.4](./governance/0.4-domain-map.md)

## Purpose

Coherent description of SpeakerOps as a **Program OS** on Cloudflare: **D1** is the sole system of record; **one-way Airtable** is a projection only; Hono Worker API; React+Vite Lumen SPA; R2 files; queues + transactional outbox; Durable Object invalidation; CLI + scoped API keys over the same domain commands as HTTP.

This document is operator- and judge-facing architecture. It does **not** invent endpoints, tables, or stack alternatives. Binding detail lives in contracts; implementation lives under composition roots below.

---

## 1. North star in one stack diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│  Humans (admin / evaluator / speaker / public CFP)              │
│  React + Vite SPA · Lumen tokens only (E6)                      │
└────────────────────────────┬────────────────────────────────────┘
                             │ cookie session (HttpOnly Secure)
┌────────────────────────────▼────────────────────────────────────┐
│  Agents / CLI (`speakerops`)                                    │
│  Bearer scoped API keys · same COMMANDS as HTTP (S-CLI)         │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Hono Worker  apps/api/src/index.ts                             │
│  Zod + E4 envelopes · requireRole / requireScope · audit        │
└───┬──────────┬──────────┬──────────┬──────────┬─────────────────┘
    │          │          │          │          │
    ▼          ▼          ▼          ▼          ▼
   D1        R2        Queues     Outbox     DO invalidate
 (SoR)    (files)   (jobs)    (side fx)   (live only)
    │
    │  one-way projection (never dual-write)
    ▼
 Airtable (optional read model; pause when unset)
```

**Locked rule:** there is **no second SoR**. Postgres dual-stack, Airtable-as-database, DO-as-DB, and client-only authz are forbidden.

---

## 2. Locked stack (do not invent)

| Layer | Choice | Contract / note |
|-------|--------|-----------------|
| UI | React + Vite + TypeScript + **Lumen** | [0.2 lock](./governance/0.2-lumen-lock.md) — no Next/RSC default, no freeform CSS |
| API | Hono on Cloudflare Workers | Domain commands only ([COMMANDS.md](../KMS-competition/initiative/contracts/COMMANDS.md)) |
| SoR | **D1** + Drizzle | `packages/db` — **D1 only** |
| Files | R2 | Private objects; metadata in D1 `file_assets` |
| Jobs | Queues + transactional **outbox** | Email, Airtable projection off request path (E7) |
| Live | Durable Object **invalidation only** | Not a second database |
| Airtable | **One-way** projection | [AIRTABLE.md](./AIRTABLE.md) · never dual-write |
| Auth (humans) | HttpOnly Secure SameSite cookies | [SECURITY.md](./SECURITY.md) |
| Auth (agents) | Scoped API keys + CLI | [CLI.md](./CLI.md) · [SCOPES.md](../KMS-competition/initiative/contracts/SCOPES.md) |
| E2E | Playwright inventory-driven | [E2E.md](./E2E.md) · [BROWSER_E2E_INVENTORY.md](../KMS-competition/initiative/BROWSER_E2E_INVENTORY.md) |

---

## 3. Composition roots

| Surface | Path | Role |
|---------|------|------|
| API | `apps/api/src/index.ts` | Worker entry; middleware; route modules |
| Web | `apps/web/src/main.tsx` | SPA entry; Lumen shell; role routes |
| CLI | `packages/cli/src/main.ts` | `speakerops` binary; maps to HTTP commands |
| DB | `packages/db` | Drizzle schema + linear migrations |
| Shared DTOs | `packages/shared/src/` | Zod schemas + E4 envelopes — single source; no duplicate types in web/api |

Workspace: `pnpm-workspace.yaml` (`apps/*`, `packages/*`). Package manager: **pnpm** · Node **≥20**.

---

## 4. Domain model invariants

### Person ≠ Speaker

| Concept | Storage | Meaning |
|---------|---------|---------|
| **Person** | `people` | Durable identity (email, name) |
| **Speaker / participation** | `event_participations` | Person at an event (bio, status, tasks, files) |
| **User** | `users` + `event_memberships` | Login identity + role on event |
| **Submission** | `submissions` + answers/speakers | Application (pre-accept) |
| **Session** | sessions + `session_speakers` | Program slot (post-accept / direct) |

**Submission ≠ Session.** Accept creates or links **participations** and tasks; it does not fork a second person identity. Full map: [0.4 domain map](./governance/0.4-domain-map.md).

### Event scope

Repositories and authz are **event-scoped** (`eventId` at repository layer). Cross-event leakage is treated as **403 or 404** per policy — never silent data bleed.

### Optimistic concurrency

Mutable aggregates carry `version`. Consequential updates accept `expectedVersion` / conflict → **409** with machine-readable code when COMMANDS require it.

### Commands only

All product writes go through **named domain commands** (Zod-validated). HTTP and CLI are **1:1**. No generic CRUD bypass; no god-mode CLI.

Representative domains: Auth, Event/settings, Design Kit, Form/CFP, Submission, Eval/Decision, Portal/Files, Schedule, Comms, Reports, Keys. Canonical list: [COMMANDS.md](../KMS-competition/initiative/contracts/COMMANDS.md).

---

## 5. Request path vs side effects (E7)

| On request path | Off request path (outbox / queue) |
|-----------------|-------------------------------------|
| Zod validate | Email send (`comms.send`) |
| Authz (role / scope) | Airtable projection (`airtable.project`) |
| D1 transactional write + outbox insert | Provider HTTP (Resend, Airtable) |
| Audit event + `correlationId` | ICS delivery retries as designed |
| E4 JSON response | Queue consumer / scheduled drain |

**Never** call Airtable or live email providers on the request path. Product mutations return **200** when projection is paused; outbox lags until credentials exist ([AIRTABLE.md](./AIRTABLE.md)).

---

## 6. Authn / authz model (summary)

| Actor | Mechanism | Enforcement |
|-------|-----------|-------------|
| Admin / evaluator / speaker (human) | Magic link → `speakerops_session` cookie | `requireRole` on Worker |
| Public CFP | No session; Turnstile + rate limit | Public routes only |
| Agent / CLI | `Authorization: Bearer spk_…` | `requireScope` on Worker |
| Bootstrap first admin | `BOOTSTRAP_ADMIN_EMAIL` allowlist | Default-deny without name |

High-risk scopes **default-deny** on new keys: `comms:send`, `decisions:write`, `keys:admin` (E8). UI and CLI never “trust local”; server is law (E2). Deep policy: [SECURITY.md](./SECURITY.md).

---

## 7. Data plane

### D1 (system of record)

- Migrations: `packages/db/migrations/` (linear additive Drizzle SQL)
- Local: `pnpm db:migrate` → `SPEAKEROPS_DB_PATH` (default `.data/speakerops.local.sqlite`)
- Remote dogfood: `wrangler d1 migrations apply speakerops --remote`
- Tables owned by section writers — see [SCHEMA.md](../KMS-competition/initiative/contracts/SCHEMA.md) ownership table
- Cross-cutting: `audit_events`, `outbox_events`, `projection_records`, `idempotency_keys`

### R2 (files)

- Binding name: `FILES`
- Bodies in R2; D1 holds `file_assets` metadata (`r2_key`, mime, size, checksum, scan status)
- Logo/headshot/slides: type/size checks; SVG logos rejected (XSS surface)

### Queues + outbox

- Binding: `JOBS_QUEUE`
- Topics include `comms.send`, `airtable.project`
- Consumers: Worker `queue` / `scheduled` handlers
- Idempotency for sends via `idempotency_keys` where COMMANDS require it

### Durable Objects

- **Invalidation / live hints only** — not authoritative storage

---

## 8. Frontend architecture

| Concern | Rule |
|---------|------|
| Tokens | Lumen CSS variables only — [0.2](./governance/0.2-lumen-lock.md) |
| Shell | Admin shell IA; role-appropriate nav |
| Public CFP | Brand from published design tokens; mobile-clean |
| State | Call real APIs; no “coming soon” chrome for soul surfaces |
| XSS | No `dangerouslySetInnerHTML` for untrusted CFP copy |
| Dev vs prod CSP | Dev allows Vite HMR; production Worker CSP strict — [SECURITY.md](./SECURITY.md) |

Performance targets (document, not gate here): admin list p95 &lt; 200ms local after warm load for seed ≤150 rows; public CFP first contentful interaction without multi-second blank screen (skeleton allowed).

---

## 9. Observability & correlation (E3)

- Propagate **`correlationId`** on every request (never regenerate mid-hop)
- CLI may set `SPEAKEROPS_CORRELATION_ID` or generates `cli_…`
- Consequential writes insert **`audit_events`** with `correlation_id`
- Structured logs only — never `console.log` secrets, raw API keys, or magic links in production paths
- Client 500s: E4 envelope **without** stack traces

---

## 10. Package / monorepo layout

```text
apps/api          Worker API
apps/web          React SPA
packages/db       Schema + migrations
packages/shared   DTOs / Zod / security header constants
packages/cli      speakerops CLI
docs/             Onboarding + deep docs (this tree)
playwright/e2e/   Inventory-tagged journeys
tests/            Governance + section unit tests
KMS-competition/  Constitution, contracts, inventory, evidence
```

---

## 11. What architecture explicitly excludes

From [0.1 non-goals](./governance/0.1-programme-contract.md) and [COMPETITION.md](./COMPETITION.md):

- Sessionboard CRM / Marketing / CMS / media suite  
- In-product multi-agent fleet / MCP product theatre  
- Next.js / RSC default · Postgres dual-stack · Temporal · OR-Tools auto-scheduler  
- Airtable dual-write / bidirectional sync  
- Ticketing, travel, payments, badge printing, attendee app  
- Freeform CSS / user HTML injection theming  

---

## 12. Related docs

| Doc | Role |
|-----|------|
| [SECURITY.md](./SECURITY.md) | CSP, cookies, scopes, E10 |
| [OPERATIONS.md](./OPERATIONS.md) | Deploy, migrate, Time Travel |
| [AIRTABLE.md](./AIRTABLE.md) | One-way projection runbook |
| [FIELD_FLOW.md](./FIELD_FLOW.md) | Forms → portal I16 highlights |
| [E2E.md](./E2E.md) | Inventory suite runbook |
| [CLI.md](./CLI.md) · [AGENT_SETUP.md](./AGENT_SETUP.md) | Agent surface |
| [ONBOARDING.md](./ONBOARDING.md) | Human zero → running |
| [CONTRACTS.md](./CONTRACTS.md) | Binding index |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Failure recovery |
| Section note | [9.4-deep-docs.md](./sections/9.4-deep-docs.md) |

## Gates (do not hang)

```bash
pnpm typecheck
pnpm test:ci
pnpm test:e2e            # Phase 8 full REQUIRED
pnpm test:e2e:inventory  # inventory law
```
