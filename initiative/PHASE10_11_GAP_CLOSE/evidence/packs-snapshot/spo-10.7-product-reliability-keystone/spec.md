# Spec 10.7 — Phase 10 product reliability keystone e2e

> **Source Concept**: Single keystone suite green for all Phase 10 souls. | **Complexity**: high | **Risk**: high | **Domain**: e2e

## Source Documents

- `speakerops-engineering-standards.md` (E1–E12)
- `ACTIVE-RUNS-10-PRODUCT-RELIABILITY.md` and/or `ACTIVE-RUNS-11-LUMEN2-PARITY.md`
- `speakerops/initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md`
- `docs/audits/SBEK_RUN_REPORT.md` (product vs harness)
- `design-pack at speakerops/initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/ (checksum: evidence/design-pack-snapshot.SHA256). Do NOT use laptop ChatGPT design-pack paths on the box.` (AGENT_IMPLEMENTATION_SPEC, QA_CHECKLIST, page-atlas) for Phase 11
- `evidence/design-pack-snapshot/SPEAKEROPS_DESIGN_AUDIT.md` for Phase 11

## Goal

Single keystone suite green for all Phase 10 souls.

## Current Build Contract

- **Status**: Cumulative on dependencies ['10.1', '10.2', '10.3', '10.4', '10.5', '10.6']
- **Requirement**: Meet every AC without inventing out-of-scope product surface or new runtime deps.

## 1. What Already Exists

| Layer | Current State |
| --- | --- |
| Prior | 10.1–10.6 |
| E2E harness | playwright inventory |

## 2. Items In Scope

### Keystone
- Orchestrated e2e covering souls 1–6
- Evidence report path under initiative/PHASE10_11_GAP_CLOSE/evidence/
- Inventory completeness for new controls


## 3. Out of Scope

- Multi-round review boards (optional P3 — not this section)
- Personal attendee schedule, embed widgets
- Changing sbek eval kit
- sbek harness scoring/rubric/agent changes
- Constitution struck: embeds, gallery CMS, AI auto-schedule, AI evaluator, full CRM
- New npm UI kits / icon / chart / font packages

## 4. Hard Dependencies

| Dependency | Run | What's Needed |
| --- | --- | --- |
| Prior | 10.1 | Prior section complete |
| Prior | 10.2 | Prior section complete |
| Prior | 10.3 | Prior section complete |
| Prior | 10.4 | Prior section complete |
| Prior | 10.5 | Prior section complete |
| Prior | 10.6 | Prior section complete |

## 5. Success Metrics

| Metric | Criteria |
| --- | --- |
| Keystone | All Phase 10 souls pass in one CI job |
| Report | evidence/phase10-keystone.md written |

### Tests that prove these (E9)

- e2e keystone product-reliability
- inventory lint

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
| Constitution souls mapped in phase index | 10.7 | Success metrics | Named tests above |

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

## Proof class
**F only** at 10.7 (local/CI). Live **D** re-proof of souls 1–6 owned by **11.9** after dogfood deploy. Do not claim dogfood_ready at 10.7.

## Phase 10 F keystone — all eight product souls

| Soul | F proof required in this section |
| --- | --- |
| S-SUB-LIST | submissions_list_reliability.spec.ts AC-10.1-A |
| S-EVAL-UI | evaluations_progress.spec.ts AC-10.2-A |
| S-CFP-SUBMIT | public_cfp_submit_demo.spec.ts AC-10.3-A |
| S-CFP-CLOSED | public_cfp_submit_demo.spec.ts AC-10.3-B |
| S-AUTH-ROLES | auth_roles_dogfood.spec.ts AC-10.4-* |
| S-CFP-DRAFT | cfp_draft.spec.ts AC-10.5-* |
| S-SCHED-CHROME | schedule_day_chrome.spec.ts AC-10.6-A |
| S-EVAL-EXPORT | eval_export_sort.spec.ts AC-10.6-B or recorded proof-of-absence with owner-visible note in evidence |

Do not APPROVE 10.7 if any of the eight F proofs fail. Dogfood D re-proof is 11.9 only.

## Exact AC→test mapping
See Named ACs in this spec (or livability matrix for spo-10.7-product-reliability-keystone). Each AC maps to a named playwright/unit test file in plan Files-to-Create/Modify. Completion gate requires each AC ticked in plan.
