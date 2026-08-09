# Phase 10 product reliability keystone — section 10.7 (I12)

**Section:** 10.7 Phase 10 product reliability keystone e2e  
**Workspace:** speakerops-build  
**Date:** 2026-08-09  
**Proof class:** **F only** (local/CI). Live **D** re-proof of all Phase 10 souls is **11.9**.  
**Exit claim at 10.7:** Phase 10 F floor green — **not** `dogfood_ready` (11.9 only).

## Claim

I12 keystone: prove **S-SUB-LIST** through **S-CFP-DRAFT** (and constitution souls **S-SCHED-CHROME**, **S-EVAL-EXPORT**) together on dogfood-shaped fixture data so Phase 11 can recompose UI safely.

Single keystone suite green for all eight Phase 10 product souls.

## Souls (F proofs)

| Soul | AC | Implementation F proof | Keystone re-proof |
|------|----|------------------------|-------------------|
| **S-SUB-LIST** | AC-10.1-A | `playwright/e2e/submissions_list_reliability.spec.ts` | ≥150 seed; `page-submissions` + row; loading ≤5s |
| **S-EVAL-UI** | AC-10.2-A | `playwright/e2e/evaluations_progress.spec.ts` | `/admin/evaluations` no “Response validation failed”; progress/honest empty |
| **S-CFP-SUBMIT** | AC-10.3-A | `playwright/e2e/public_cfp_submit_demo.spec.ts` | DEMO_MODE test site key + public submit confirmation |
| **S-CFP-CLOSED** | AC-10.3-B | same | `public-cfp-closed` + POST submissions 4xx |
| **S-AUTH-ROLES** | AC-10.4-A/B/C | `playwright/e2e/auth_roles_dogfood.spec.ts` | admin shell / portal tasks / evaluator queue; session stick |
| **S-CFP-DRAFT** | AC-10.5-A/B | `playwright/e2e/cfp_draft.spec.ts` | draft save + resume; disabled when closed |
| **S-SCHED-CHROME** | AC-10.6-A | `playwright/e2e/schedule_day_chrome.spec.ts` | week headers ⊆ event dates (no pre-event empty days) |
| **S-EVAL-EXPORT** | AC-10.6-B | `playwright/e2e/eval_export_sort.spec.ts` | sort + CSV export (real `GET …/eval/export`) |

Do not APPROVE 10.7 if any of the eight F proofs fail.

## Evidence path

| Artifact | Path |
|----------|------|
| This report | `initiative/PHASE10_11_GAP_CLOSE/evidence/phase10-keystone.md` |
| Keystone Playwright | `playwright/e2e/phase10_product_keystone.spec.ts` |
| Constitution | `initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md` |
| Livability matrix | `initiative/PHASE10_11_GAP_CLOSE/02_LIVABILITY_MATRIX.md` |
| Inventory | `KMS-competition/initiative/BROWSER_E2E_INVENTORY.md` |

## Inventory tags (documented; 1:1 ownership unchanged)

Active `@inv` ownership remains on implementation specs (duplicate owners forbidden). Keystone documents:

| Tag | test_id | Soul |
|-----|---------|------|
| E01 | e2e/admin/sub-list | S-SUB-LIST (L05 scale path) |
| F01 | e2e/eval/queue family / admin progress | S-EVAL-UI |
| A06 | e2e/public/cfp-submit | S-CFP-SUBMIT |
| A07 | e2e/public/cfp-closed | S-CFP-CLOSED |
| B01–B06 | auth role landings | S-AUTH-ROLES |
| A17 | e2e/public/cfp-draft | S-CFP-DRAFT |
| I03 | e2e/sched/week | S-SCHED-CHROME |
| F05 | e2e/eval/export | S-EVAL-EXPORT |

New Phase 10 inventory IDs **A17** and **F05** remain **REQUIRED / PASS** (no new controls in 10.7).

## Security / adversarial (must-not)

| Case | Expected |
|------|----------|
| Unauthenticated admin submissions/evaluations/events | 401/403/404 or login redirect; never privileged rows |
| Evaluator opens `/admin` | access-denied; no `admin-shell` |
| Evaluator `GET …/eval/export` | 403 |
| Closed CFP `POST …/submissions` | 4xx with closed semantics |

## Scope / non-goals

- No multi-round review boards, embeds, gallery CMS, AI auto-schedule/evaluator, full CRM
- No sbek harness scoring/rubric/agent changes
- No new runtime UI packages
- No claim of live dogfood D proof (11.9)

## Gate commands

```bash
pnpm typecheck
pnpm test:ci
pnpm test:e2e:inventory
# Keystone only:
pnpm test:e2e:phase10-keystone
# All Phase 10 soul implementation files + keystone (one CI job):
pnpm test:e2e:phase10
```

## Gate results (2026-08-09, local F)

### pnpm typecheck
```
> tsc -b --pretty false
exit: 0
```

### pnpm test:ci
```
# tests 464
# pass 464
# fail 0
 Test Files  51 passed (51)
      Tests  485 passed (485)
exit: 0
```

### pnpm test:e2e:inventory
```
[test:e2e:inventory] OK: baseline 110 IDs intact (110 REQUIRED non-DEFER, 0 DEFER);
  inventory 110 REQUIRED, 110 unique IDs, 110 unique test_ids; fingerprints match
[test:e2e:inventory] OK: @inv on Playwright-bound test() titles cover 110 implemented/status-owned IDs
exit: 0
```

### pnpm test:e2e:phase10-keystone
```
Running 7 tests using 1 worker
  ✓ keystone: S-AUTH-ROLES admin + S-SUB-LIST + S-EVAL-UI + S-EVAL-EXPORT
  ✓ keystone: S-CFP-SUBMIT DEMO + S-CFP-DRAFT save/resume
  ✓ keystone: S-CFP-CLOSED closed UI + POST 4xx
  ✓ keystone: S-AUTH-ROLES speaker portal + evaluator queue
  ✓ keystone: S-SCHED-CHROME week days ⊆ event range
  ✓ keystone: must-not unauth admin + evaluator no export/admin
  ✓ keystone: documents all eight Phase 10 F soul proofs
  7 passed
exit: 0
```

### pnpm test:e2e:phase10 (implementation ACs + keystone)
```
Running 28 tests using 1 worker
  28 passed (36.9s)
  — includes AC-10.1-A … AC-10.6-B owners + phase10_product_keystone.spec.ts
exit: 0
```

## Rollback

Revert section 10.7 commit; prior Phase 10.1–10.6 implementation remains. No schema migration in 10.7. Dogfood redeploy prior worker if a later D re-proof regresses (owned by 11.9).

## Notes

- No secrets, API keys, or magic-link tokens in this evidence file.
- Local e2e uses `E2E_WEB_SERVER=1` (Vite + `scripts/e2e-api-server.mjs` with `DEMO_MODE=1`).
- S-SUB-LIST 5s protocol: clock starts at navigation commit to `/admin/submissions` after active event bind; pass = `page-submissions` visible, `submissions-loading` hidden, ≥1 row within 5000ms, total 150.
- Phase 11 presentation recompose must not weaken these F proofs; inventory anti-shrinkage + 11.9 D re-proof guard regression.
