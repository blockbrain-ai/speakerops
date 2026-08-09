# Spec 10.4 — DEMO persona session reliability

> **Source Concept**: Stable session cookies for three roles on dogfood (S-AUTH-ROLES). | **Complexity**: high | **Risk**: high | **Domain**: fullstack

## Source Documents

- `speakerops-engineering-standards.md` (E1–E12)
- `ACTIVE-RUNS-10-PRODUCT-RELIABILITY.md` and/or `ACTIVE-RUNS-11-LUMEN2-PARITY.md`
- `speakerops/initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md`
- `docs/audits/SBEK_RUN_REPORT.md` (product vs harness)
- `design-pack at speakerops/initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/ (checksum: evidence/design-pack-snapshot.SHA256). Do NOT use laptop ChatGPT design-pack paths on the box.` (AGENT_IMPLEMENTATION_SPEC, QA_CHECKLIST, page-atlas) for Phase 11
- `evidence/design-pack-snapshot/SPEAKEROPS_DESIGN_AUDIT.md` for Phase 11

## Goal

Stable session cookies for three roles on dogfood (S-AUTH-ROLES).

## Current Build Contract

- **Status**: Cumulative on dependencies ['10.3', '2.1']
- **Requirement**: Meet every AC without inventing out-of-scope product surface or new runtime deps.

## 1. What Already Exists

| Layer | Current State |
| --- | --- |
| Auth | `apps/api/src/modules/auth/**`, magic link |
| Mint | `scripts/sbek-mint-auth-states.mjs` if present |
| SPA | Login, RequireRole, portal |

## 2. Items In Scope

### Auth edge
- Session cookie max-age / same-site / path correct for www.speakerops.org
- DEMO documented mint path for agents
- Login copy must not promise missing /dev outbox unless implemented
- e2e three roles


## 3. Out of Scope

- Multi-round review boards (optional P3 — not this section)
- Personal attendee schedule, embed widgets
- Changing sbek eval kit
- Public production email outbox UI as default
- sbek harness scoring/rubric/agent changes
- Constitution struck: embeds, gallery CMS, AI auto-schedule, AI evaluator, full CRM
- New npm UI kits / icon / chart / font packages

## 4. Hard Dependencies

| Dependency | Run | What's Needed |
| --- | --- | --- |
| Prior | 10.3 | Prior section complete |
| Prior | 2.1 | Prior section complete |

## 5. Success Metrics

| Metric | Criteria |
| --- | --- |
| Admin | Organizer reaches /admin |
| Speaker | Portal tasks reachable |
| Evaluator | Queue reachable |

### Tests that prove these (E9)

- e2e auth-roles
- unit session cookie options if changed

## 6. Stop / Reassess Gates

- Do not APPROVE if any AC fails.
- Do not add runtime dependencies without owner+security exception documented.
- Do not remove or weaken soul tests from the constitution.
- Do not implement struck non-goals to chase sbek points.

## 7. Migration / Compatibility

- Preserve existing domain commands, roles, CSP, and inventory tags.
- Additive migrations only if schema required; no destructive drops.

## 8. Rollback / Containment

- Revert PR/section commit; dogfood redeploy previous worker version.
- Feature remains behind existing authz; no public data leak from fixes.

## 9. Field-flow (I16)

N/A — no new collected fields (or listed below).

## 10. Traceability

| Requirement | Section | Spec AC | Test |
| --- | --- | --- | --- |
| Constitution souls mapped in phase index | 10.4 | Success metrics | Named tests above |

## Cross-cutting invariants

- Event scoping: every event-owned query requires `eventId`; wrong event → 404.
- Authz: UI hide is not authz; Worker enforces roles/scopes.
- CSP and dependency inventory unchanged; no new runtime UI packages without owner exception.
- Status semantics never rethemed by event brand; brand only on public/portal scopes.
- Inventory: new REQUIRED controls get `data-testid` + BROWSER_E2E_INVENTORY row same PR.
- Fail-closed: invalid session → login/recovery, never privileged data.

## Wiring / entry-point proof (outside tests)

| Component | Instantiated at |
| --- | --- |
| API routes | `apps/api/src/index.ts` / module `routes.ts` registered on Hono app |
| SPA pages | `apps/web/src/App.tsx` React Router routes |
| Shared DTOs | `packages/shared` imported by api + web |
| E2E | `playwright.config.ts` + `playwright/e2e/*` invoked via `pnpm test:e2e` |

## Frontend ↔ backend (E9 — no orphans)

- Every new or modified UI control calls an existing or newly wired `METHOD /api/...` domain path; no dead buttons.
- Headless Playwright e2e named in Success Metrics drives the real network path (not mocked UI-only).
- Orphan check: inventory + e2e inventory lint must pass for new REQUIRED ids.

## Security / adversarial proofs (must-not)

- **must-not**: unauthenticated user reads admin submissions/evaluations (expect 401/403/redirect).
- **must-not**: speaker role mutates another speaker's submission (403/404).
- **must-not**: closed CFP accepts new submit (4xx) when window closed.
- **must-not**: evaluator sees admin navigation capabilities.
- Named tests: include negative cases in unit/e2e for the above where the section owns the surface.

## Exact AC→test mapping
See Named ACs in this spec (or livability matrix for spo-10.4-demo-auth-session-reliability). Each AC maps to a named playwright/unit test file in plan Files-to-Create/Modify. Completion gate requires each AC ticked in plan.
