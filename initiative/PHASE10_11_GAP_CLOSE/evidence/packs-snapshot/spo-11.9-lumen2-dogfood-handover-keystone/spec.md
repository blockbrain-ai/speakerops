# Spec 11.9 — Dogfood deploy + Phase 11 keystone + handover

> **Source Concept**: Dogfood healthy + full soul evidence table + handover package. | **Complexity**: high | **Risk**: high | **Domain**: ops

## Source Documents

- `speakerops-engineering-standards.md` (E1–E12)
- `ACTIVE-RUNS-10-PRODUCT-RELIABILITY.md` and/or `ACTIVE-RUNS-11-LUMEN2-PARITY.md`
- `speakerops/initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md`
- `docs/audits/SBEK_RUN_REPORT.md` (product vs harness)
- `design-pack at speakerops/initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/ (checksum: evidence/design-pack-snapshot.SHA256). Do NOT use laptop ChatGPT design-pack paths on the box.` (AGENT_IMPLEMENTATION_SPEC, QA_CHECKLIST, page-atlas) for Phase 11
- `evidence/design-pack-snapshot/SPEAKEROPS_DESIGN_AUDIT.md` for Phase 11

## Goal

Dogfood healthy + full soul evidence table + handover package.

## Current Build Contract

- **Status**: Cumulative on dependencies ['10.7', '11.8', '8.6']
- **Requirement**: Meet every AC without inventing out-of-scope product surface or new runtime deps.

## 1. What Already Exists

| Layer | Current State |
| --- | --- |
| Deploy | scripts/deploy-dogfood.sh, wrangler |
| Prior | 10.7 + 11.0–11.8 |

## 2. Items In Scope

### Keystone
- Deploy dogfood (names-only secrets)
- Run Phase 10+11 keystone e2e against https://www.speakerops.org (binding; no alternate smoke URL for S-DOGFOOD)
- Fill BUILD_CHECKLIST evidence paths
- Write SOUL_EVIDENCE_TABLE.md + SESSION readiness for G7
- PRODUCTION_HANDOVER or wave handover appendix


## 3. Out of Scope

- Multi-round review boards (optional P3 — not this section)
- Personal attendee schedule, embed widgets
- Changing sbek eval kit
- Production multi-tenant cutover
- sbek harness scoring/rubric/agent changes
- Constitution struck: embeds, gallery CMS, AI auto-schedule, AI evaluator, full CRM
- New npm UI kits / icon / chart / font packages

## 4. Hard Dependencies

| Dependency | Run | What's Needed |
| --- | --- | --- |
| Prior | 10.7 | Prior section complete |
| Prior | 11.8 | Prior section complete |
| Prior | 8.6 | Prior section complete |

## 5. Success Metrics

| Metric | Criteria |
| --- | --- |
| Health | Dogfood 200 |
| Souls | All 18 constitution soul IDs (S-SUB-LIST through S-DOGFOOD including S-SCHED-CHROME and S-EVAL-EXPORT) evidence |
| Handover | Brief complete for this wave |

### Tests that prove these (E9)

- keystone e2e full
- deploy evidence file

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
| Constitution souls mapped in phase index | 11.9 | Success metrics | Named tests above |

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

## Dogfood target (binding)
URL must be `https://www.speakerops.org` for S-DOGFOOD. Record deploy revision, timestamp, health 200, e2e report hash. Re-proof Phase 10 souls D after recompose. Gate includes `pnpm test:e2e:inventory`.

## Per-soul D matrix (all 18 — non-skipped against https://www.speakerops.org)

Every row must have: named test title, @inv IDs, deploy revision, report hash path under initiative/PHASE10_11_GAP_CLOSE/evidence/.

| Soul | D test artifact |
| --- | --- |
| S-SUB-LIST | phase11 keystone re-run submissions list on dogfood |
| S-EVAL-UI | evaluations progress on dogfood |
| S-CFP-SUBMIT | public CFP submit DEMO on dogfood |
| S-CFP-CLOSED | closed window on dogfood |
| S-AUTH-ROLES | three role landings on dogfood |
| S-CFP-DRAFT | draft save/resume on dogfood |
| S-SCHED-CHROME | schedule week chrome on dogfood |
| S-EVAL-EXPORT | export/sort or absence proof on dogfood |
| S-L2-SYSTEM | state sheet still present post-deploy |
| S-L2-SHELL | overview attention on dogfood |
| S-L2-COMMS | J01–J10 + scale on dogfood |
| S-L2-CFP | builder+public on dogfood |
| S-L2-SUB | submissions UI on dogfood |
| S-L2-SCHED | schedule on dogfood |
| S-L2-PORTAL | portal on dogfood |
| S-L2-A11Y | session recovery on dogfood |
| S-L2-SCORE | LUMEN2_TASTE_SCORE.md ≥8.0 with screenshots |
| S-DOGFOOD | health 200 + deploy.md revision + all rows above |

Failure of any row = section FAIL. No stubs. No narrative-only PASS.

## Exact AC→test mapping
See Named ACs in this spec (or livability matrix for spo-11.9-lumen2-dogfood-handover-keystone). Each AC maps to a named playwright/unit test file in plan Files-to-Create/Modify. Completion gate requires each AC ticked in plan.
