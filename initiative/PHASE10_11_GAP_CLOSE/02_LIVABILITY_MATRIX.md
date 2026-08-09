# Livability matrix — Phase 10–11 (v2 after G4 REVISE)

**Rule:** every soul → section → named AC id → testid (exist|new) → `@inv` → `playwright/e2e/<file>` → fixture vs dogfood proof.

**Playwright root:** `playwright/e2e/` (snake_case `*.spec.ts`) — **not** `tests/e2e/`.

**Proof classes:**
- **F** = local/fixture (E2E_BASE_URL local or CI)
- **D** = dogfood `https://www.speakerops.org` with deploy revision recorded

Phase 10 sections prove **F** at 10.7; **all Phase 10 souls re-prove D at 11.9** after dogfood deploy (no claim of live dogfood until 11.9).

| Soul | Sec | AC id | Assertion | testid | exist? | @inv | playwright file | F | D owner |
|------|-----|-------|-----------|--------|--------|------|-----------------|---|--------|
| S-SUB-LIST | 10.1 | AC-10.1-A | ≥1 row ≤5s; spinner gone; ≥150 seed | `page-submissions`, `submissions-loading` | yes | **E01**, **L05** | `playwright/e2e/submissions_list_reliability.spec.ts` | 10.7 | 11.9 |
| S-EVAL-UI | 10.2 | AC-10.2-A | No Response validation failed; progress/empty honest | `page-evaluations` | yes | **F01** (admin progress surface) + admin eval routes | `playwright/e2e/evaluations_progress.spec.ts` | 10.7 | 11.9 |
| S-CFP-SUBMIT | 10.3 | AC-10.3-A | DEMO allowlist submit succeeds | `public-cfp-submit` | yes | **A06** | `playwright/e2e/public_cfp_submit_demo.spec.ts` | 10.7 | 11.9 |
| S-CFP-CLOSED | 10.3 | AC-10.3-B | Closed UI + API 4xx | `public-cfp-closed` | yes | **A07** | same | 10.7 | 11.9 |
| S-CFP-DEMO-NEG | 10.3 | AC-10.3-C/D | Non-demo rejects DEV_PASS_TOKEN; non-allowlist host rejects | n/a | n/a | unit turnstile | `apps/api/src/modules/publicCfp/turnstile.test.ts` | 10.3 | n/a |
| S-AUTH-ROLES | 10.4 | AC-10.4-A/B/C | Session cookie landings admin/speaker/eval | shells | partial | **B01–B06** | `playwright/e2e/auth_roles_dogfood.spec.ts` | 10.7 | 11.9 |
| S-CFP-DRAFT | 10.5 | AC-10.5-A/B | Draft save + resume | `cfp-draft-save` | **new** | new **A17** (add inventory) | `playwright/e2e/cfp_draft.spec.ts` | 10.7 | 11.9 |
| S-SCHED-CHROME | 10.6 | AC-10.6-A | Week days ⊆ event range | schedule | yes | **I03** | `playwright/e2e/schedule_day_chrome.spec.ts` | 10.7 | 11.9 |
| S-EVAL-EXPORT | 10.6 | AC-10.6-B | Sort + CSV or proof-of-absence | eval | partial | new **F05** or absence note | `playwright/e2e/eval_export_sort.spec.ts` | 10.7 | 11.9 |
| S-L2-SYSTEM | 11.0 | AC-11.0-A | Primitives + tokens; no new UI deps | `l2-state-sheet` | **new** | new **L2-01** | `playwright/e2e/lumen2_state_sheet.spec.ts` | 11.0 | 11.9 |
| S-L2-SHELL | 11.1 | AC-11.1-A | Attention + metrics 5s | `page-readiness` | yes | **H01–H05** | `playwright/e2e/overview_lumen2.spec.ts` | 11.1 | 11.9 |
| S-L2-COMMS | 11.2 | AC-11.2-* | **J01–J10** regression + 150 scale | comms | yes | **J01–J10** | `comms_keystone.spec.ts` + `comms_lumen2.spec.ts` | 11.2 | 11.9 |
| S-L2-CFP | 11.3 | AC-11.3-A/B | Builder regions + public branded | form/public | yes | **A01–A16** + form builder inv | `playwright/e2e/cfp_lumen2.spec.ts` | 11.3 | 11.9 |
| S-L2-SUB | 11.4 | AC-11.4-A | Master-detail + bulk | submissions-bulk | yes | **E01–E08** | `playwright/e2e/submissions_lumen2.spec.ts` | 11.4 | 11.9 |
| S-L2-SCHED | 11.5 | AC-11.5-A | Sticky + conflict + keyboard | schedule | yes | **I01–I16** | `playwright/e2e/schedule_lumen2.spec.ts` | 11.5 | 11.9 |
| S-L2-PORTAL | 11.6 | AC-11.6-A | Next-task mobile | portal | yes | portal N* inv (existing portal suite) | `playwright/e2e/portal_lumen2.spec.ts` | 11.6 | 11.9 |
| S-L2-A11Y | 11.7 | AC-11.7-A/B | Session recovery + a11y | session panel | **new** | **L02–L04** + new | `playwright/e2e/session_states_a11y.spec.ts` | 11.7 | 11.9 |
| S-L2-SCORE | 11.8 | AC-11.8-A | ≥8.0 / no primary &lt;7.0 | screenshots | n/a | visual suite | `visual_lumen2.spec.ts` + `docs/audits/LUMEN2_TASTE_SCORE.md` | 11.8 | 11.9 |
| S-DOGFOOD | 11.9 | AC-11.9-A/B | www.speakerops.org health + **all 18 souls D** | n/a | n/a | smoke | `phase11_handover_keystone.spec.ts` + `cf_dogfood_smoke.spec.ts` | n/a | **11.9** |

## S-SUB-LIST 5-second protocol

| Field | Value |
|-------|-------|
| Start | `page.goto('/admin/submissions')` networkidle or spinner hidden |
| Seed | dogfood / fixture with **≥150** submissions |
| Pass | `data-testid=page-submissions` visible AND `submissions-loading` **not** visible AND ≥1 row within **5000ms** |
| Fail | spinner &gt;5s OR validation error toast |
| Retries | 0 for timing assertion (CI may retry whole test once) |

## Taste score protocol (S-L2-SCORE)

| Field | Value |
|-------|-------|
| Scorer | Independent human (not implementing builder); dual preferred |
| Denominator primary surfaces | Shell, Overview, Comms, CFP builder, Public CFP, Submissions, Schedule, Portal, Login/session recovery |
| Scale | 1–10 per surface; overall weighted mean ≥8.0; none of primary &lt;7.0 |
| Evidence | Screenshots from visual suite + `docs/audits/LUMEN2_TASTE_SCORE.md` |

## Design-gap / page-atlas coverage (Phase 11)

Every `page-atlas.json` route maps to a section: `/admin`→11.1; `/admin/cfp`→11.3; `/admin/submissions`→11.4; `/admin/evaluations`→11.4; `/admin/speakers`→11.6; `/admin/schedule`→11.5; `/admin/comms`→11.2; `/admin/settings/**`→11.7; `/cfp/**`→11.3; `/portal/**`→11.6; public program→11.3/public already shipped polish in 11.3 scope note.

Full table: `evidence/PAGE_ATLAS_COVERAGE.md` (maintained with packs).
