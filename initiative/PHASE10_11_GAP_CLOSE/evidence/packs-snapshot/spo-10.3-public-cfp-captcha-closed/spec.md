# Spec 10.3 — Public CFP DEMO captcha + closed window proof

> **Source Concept**: Prove DEMO Turnstile path and closed-window enforcement on public CFP for dogfoo | **Complexity**: high | **Risk**: high | **Domain**: fullstack

## Source Documents

- `speakerops-engineering-standards.md` (E1–E12)
- `ACTIVE-RUNS-10-PRODUCT-RELIABILITY.md` and/or `ACTIVE-RUNS-11-LUMEN2-PARITY.md`
- `speakerops/initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md`
- `docs/audits/SBEK_RUN_REPORT.md` (product vs harness)
- `design-pack at speakerops/initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/ (checksum: evidence/design-pack-snapshot.SHA256). Do NOT use laptop ChatGPT design-pack paths on the box.` (AGENT_IMPLEMENTATION_SPEC, QA_CHECKLIST, page-atlas) for Phase 11
- `evidence/design-pack-snapshot/SPEAKEROPS_DESIGN_AUDIT.md` for Phase 11

## Goal

Prove DEMO Turnstile path and closed-window enforcement on public CFP for dogfood.

## Current Build Contract

- **Status**: Cumulative on dependencies ['10.2', '3.3']
- **Requirement**: Meet every AC without inventing out-of-scope product surface or new runtime deps.

## 1. What Already Exists

| Layer | Current State |
| --- | --- |
| Turnstile | `apps/api/src/modules/publicCfp/turnstile.ts`, DEMO_MODE in env |
| UI closed | `apps/web/src/pages/PublicCfp.tsx` public-cfp-closed |
| Commands | `apps/api/src/modules/publicCfp/commands.ts` window state |

## 2. Items In Scope

### Demo captcha
- Ensure DEMO_MODE forces test sitekey + accept DEV_PASS_TOKEN path
- Document deploy requirement for DEMO_MODE on dogfood worker
### Closed window
- Close date + republish form version if required
- UI closed banner; API reject; e2e both


## 3. Out of Scope

- Multi-round review boards (optional P3 — not this section)
- Personal attendee schedule, embed widgets
- Changing sbek eval kit
- Building a new captcha vendor integration
- sbek harness scoring/rubric/agent changes
- Constitution struck: embeds, gallery CMS, AI auto-schedule, AI evaluator, full CRM
- New npm UI kits / icon / chart / font packages

## 4. Hard Dependencies

| Dependency | Run | What's Needed |
| --- | --- | --- |
| Prior | 10.2 | Prior section complete |
| Prior | 3.3 | Prior section complete |

## 5. Success Metrics

| Metric | Criteria |
| --- | --- |
| Submit | Valid form submit succeeds under DEMO_MODE |
| Closed | Past close → banner + API reject |
| Deploy note | OPERATIONS or DEMO_HOST documents DEMO_MODE name |

### Tests that prove these (E9)

- Unit: window closed rejects
- Unit: turnstile demoMode
- e2e: submit + closed

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

| Field | Source | Consumers | Fallback | Same-value proof |
|---|---|---|---|---|
| turnstileToken | public CFP form | verifyTurnstile → submit command | DEMO_MODE test token | unit demoMode accept |
| closesAt | form version / settings | computeCfpWindowState + PublicCfp | open if null | closed e2e |

## 10. Traceability

| Requirement | Section | Spec AC | Test |
| --- | --- | --- | --- |
| Constitution souls mapped in phase index | 10.3 | Success metrics | Named tests above |

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

## Named ACs

| ID | Assertion |
| --- | --- |
| AC-10.3-A | DEMO_MODE allowlisted host/event: valid submit succeeds |
| AC-10.3-B | Closed window: public-cfp-closed + POST 4xx |
| AC-10.3-C | demoMode false rejects TURNSTILE_DEV_PASS_TOKEN (unit) |
| AC-10.3-D | DEMO token not accepted on non-allowlisted hosts |

## Exact AC→test mapping
See Named ACs in this spec (or livability matrix for spo-10.3-public-cfp-captcha-closed). Each AC maps to a named playwright/unit test file in plan Files-to-Create/Modify. Completion gate requires each AC ticked in plan.
