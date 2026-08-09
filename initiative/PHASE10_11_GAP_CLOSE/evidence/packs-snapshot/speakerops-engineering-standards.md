# SpeakerOps Engineering Standards

> **Date:** 2026-08-08  
> **Scope:** Cross-cutting standards for all SpeakerOps Section Runner runs  
> **Status:** active  
> **Product:** Kill My SaaS — Sessionboard Program replacement for AIE  
> **Control plane:** `~/Documents/nood-factory/plans/runs/speakerops/`  
> **Initiative:** `~/Documents/KMS-competition/initiative/`

All run plans MUST include:  
`Standards: See <RUNS_DIR>/speakerops-engineering-standards.md (E1-E12)`  
Deviations require justification in the plan + Deferred Items.

---

## E1: Schema and Database

- **SoR:** Cloudflare **D1** only (no dual Postgres+D1; no Airtable as SoR).
- Schema: `packages/db/schema.ts` (Drizzle) + SQL migrations under `packages/db/migrations/`.
- Generate/migrate: `pnpm db:generate` / `pnpm db:migrate` (exact scripts in root `package.json` after scaffold).
- Linear additive migrations; no destructive DROP without data-preservation step.
- Optimistic `version` on mutable aggregates; foreign keys on.
- **Person ≠ Speaker:** `people` + `event_participations` (or equivalent); submissions ≠ sessions.

## E2: Authorization and scoping

- Single org, multi-event. Every event-owned query takes `eventId` at repository layer.
- Roles: `admin` | `evaluator` | `speaker` | `public`.
- Machine actors: API keys with **scopes** (see CLI report); enforce on Worker, not CLI.
- Wrong event / insufficient role → **404** for resource reads (no existence leak) or **403** for clear authz denies on known actions — pick one per surface and test both.
- UI hide is not authz.

## E3: Observability and correlation

- `correlationId` (UUIDv7) at request/CLI entry; propagate to audit + outbox.
- Structured logs only; never log secrets, raw API keys, magic links.
- Consequential writes → `audit_events` row with actor (`user` | `api_key` | `system`).

## E4: API conventions

- Validate all bodies with **Zod** before business logic.
- Error envelope: `{ "error": string, "code": string, "details"?: unknown }`.
- Success: explicit resources or `{ data }` lists with pagination where needed.
- OpenAPI generated from Zod/command registry → `openapi.json`.
- **No generic CRUD** that bypasses domain commands.

## E5: Deterministic gates (CI)

Non-interactive only. After scaffold, gates MUST include:

| Gate | Command (target names) |
|------|------------------------|
| Typecheck | `pnpm typecheck` |
| Unit/integration | `pnpm test:ci` |
| Browser E2E | `pnpm test:e2e` (Playwright; inventory-mapped) |
| Inventory lint | `pnpm test:e2e:inventory` (every REQUIRED inv id has a test tag) |

`GATE_TYPECHECK_CMD` / `GATE_TEST_CMD` / full-CI must never use watch mode.

## E6: Frontend (Lumen + E9)

- **Stack:** React + Vite + TypeScript SPA; Lumen tokens in CSS variables (`01_DESIGN_SYSTEM_LUMEN.md`).
- No Next/RSC by default.
- **E9:** no orphan buttons/endpoints; every UI action has real API + inventory row.
- Design Kit: tokens only — no freeform CSS/HTML/JS.
- Accessibility: keyboard schedule alternative; focus rings; status not color-only.
- `data-testid` on critical controls matching inventory where practical.

## E7: Side effects and integrations

- Transactional **outbox** in D1 for email, reminders, Airtable projection.
- **Airtable:** one-way projection; never request-path; never write-back.
- Email: provider adapter; ICS UID/SEQUENCE/cancel semantics.
- Idempotency keys on sends and imports.

## E8: CLI and API keys

- CLI package `packages/cli` / bin `speakerops`.
- Same domain commands as HTTP; `--json`; dry-run on side effects.
- Keys hashed at rest; scopes least-privilege; audit `key_id`.
- High-risk scopes default deny: `comms:send`, `decisions:write`, `keys:admin`.

## E9: Testing law (unit + browser)

- Unit/integration for domain invariants (conflicts, authz, idempotency).
- **Browser:** Playwright headless; full inventory `initiative/BROWSER_E2E_INVENTORY.md`.
- Every new UI control adds an inventory row in the same section PR.
- Phase 8 keystone runs **entire** REQUIRED inventory; HTML report artifact.
- Negative tests required for authz and validation failures listed in inventory.

## E10: Security

- HttpOnly Secure SameSite cookies for humans; no auth in localStorage.
- CSP strict; Turnstile on public CFP.
- Sanitize/escape user content; no `dangerouslySetInnerHTML` for untrusted HTML.
- R2 private; signed upload constraints (type/size).
- Secrets: env **names** only in packs/docs; never values.

## E11: Documentation and onboarding (Phase 9)

- Coherent tree under `docs/` (see ACTIVE-RUNS Phase 9).
- Agent-operable setup: `docs/AGENT_SETUP.md` + CLI.
- Human path: `docs/ONBOARDING.md`.
- Generate beautiful HTML reports into `reports/` (onboarding, e2e coverage, architecture).
- README is the root map — not a wall of unstructured notes.

## E12: Section Runner programme rules

- Standards-first; every `plan.md` Standards line.
- Multi-component phases end with integration/e2e proof (I12).
- I16 field-flow tables for collected fields in form/portal/settings specs.
- Builder default estate: grok-4.5; phase audit Codex gpt-5.6-sol; section audit off unless owner enables.
- No execute/sync/deploy from authoring skill without owner go.

---

## Deferred Items

| Item | Reason | Tracked |
|------|--------|---------|
| OR-Tools solver | Out of scope | synthesis |
| Next/RSC | Security posture | frontend security report |
| Bidirectional Airtable | Split-brain | data architecture |
| In-product agent fleet | Customer + synthesis | constitution non-goals |

---

*— SpeakerOps E1–E12*
