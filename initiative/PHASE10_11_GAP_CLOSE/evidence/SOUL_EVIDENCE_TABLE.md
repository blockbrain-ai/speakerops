# Soul evidence table — Phase 10–11 FULL (section 11.9 / S-DOGFOOD)

**Claim:** `dogfood_ready`  
**Proof class:** **D** (live) on binding URL **https://www.speakerops.org** only  
**Deploy revision:** see `deploy.md` (git SHA + APP_VERSION)  
**Keystone suite:** `playwright/e2e/phase11_handover_keystone.spec.ts`  
**Keystone run report:** `phase11-keystone-run.json`  
**Report SHA-256:** `1265bc7affc6b126563e2e6f755d3efa7f65e8e3183c1bf7d75d19a661e73a44`  
**Gate commands:** `scripts/with-secrets.sh bash scripts/deploy-dogfood.sh` · `scripts/with-secrets.sh pnpm test:e2e:phase11-keystone` · `pnpm test:e2e:inventory`

> Constitution Article II: all **18** soul IDs must be non-skipped D on dogfood.  
> Failure of any row = section FAIL. No stubs. No narrative-only PASS.

## Deploy provenance

| Field | Value |
|-------|-------|
| Binding URL | https://www.speakerops.org |
| Worker | `speakerops-demo` (`wrangler.toml` `[env.dogfood]`) |
| GET /health | **200** `{"ok":true,"version":"0.1.0-demo+3421b4f"}` |
| Deploy evidence | `initiative/PHASE10_11_GAP_CLOSE/evidence/deploy.md` |
| BC10 evidence | `KMS-competition/initiative/evidence/cf-dogfood.txt` |
| Keystone result | **19 passed** (all D rows + must-not + meta; S-L2-COMMS ≥150 + J05 job row) |
| Report hash file | `initiative/PHASE10_11_GAP_CLOSE/evidence/phase11-keystone-run.SHA256` |

## Per-soul D matrix (all 18)

Every row: named test title · inventory family (ownership stays on implementation specs) · deploy revision · report hash path.

| Soul | Named test title | @inv family (documented) | Deploy rev | Report hash path | Result |
|------|------------------|--------------------------|------------|------------------|--------|
| **S-SUB-LIST** | `D: S-SUB-LIST submissions list on dogfood ≤5s` | E01, L05 | `0.1.0-demo+3421b4f` | `evidence/phase11-keystone-run.SHA256` | **PASS** |
| **S-EVAL-UI** | `D: S-EVAL-UI evaluations progress on dogfood` | F01 | same | same | **PASS** |
| **S-CFP-SUBMIT** | `D: S-CFP-SUBMIT public CFP DEMO submit on dogfood` | A06 | same | same | **PASS** |
| **S-CFP-CLOSED** | `D: S-CFP-CLOSED closed window on dogfood` | A07 | same | same | **PASS** |
| **S-AUTH-ROLES** | `D: S-AUTH-ROLES three role landings on dogfood` | B01–B06 | same | same | **PASS** |
| **S-CFP-DRAFT** | `D: S-CFP-DRAFT draft save/resume on dogfood` | A17 | same | same | **PASS** |
| **S-SCHED-CHROME** | `D: S-SCHED-CHROME + S-L2-SCHED schedule on dogfood` | I03 | same | same | **PASS** |
| **S-EVAL-EXPORT** | `D: S-EVAL-EXPORT export/sort or absence proof on dogfood` | F05 | same | same | **PASS** |
| **S-L2-SYSTEM** | `D: S-L2-SYSTEM state sheet still present post-deploy` | L2-01 | same | same | **PASS** |
| **S-L2-SHELL** | `D: S-L2-SHELL overview attention on dogfood` | H01–H05 | same | same | **PASS** |
| **S-L2-COMMS** | `D: S-L2-COMMS J01–J10 + scale + preview/send + idempotency on dogfood` | J01–J10 | same | same | **PASS** |
| **S-L2-CFP** | `D: S-L2-CFP builder + public on dogfood` | A01–A16 | same | same | **PASS** |
| **S-L2-SUB** | `D: S-L2-SUB submissions UI on dogfood` | E01–E08 | same | same | **PASS** |
| **S-L2-SCHED** | `D: S-SCHED-CHROME + S-L2-SCHED schedule on dogfood` | I01–I16 | same | same | **PASS** |
| **S-L2-PORTAL** | `D: S-L2-PORTAL portal on dogfood` | portal N* | same | same | **PASS** |
| **S-L2-A11Y** | `D: S-L2-A11Y session recovery on dogfood` | L2-02–L2-05 | same | same | **PASS** |
| **S-L2-SCORE** | `D: S-L2-SCORE LUMEN2_TASTE_SCORE.md ≥8.0 with screenshots` | visual suite | same | same + `docs/audits/LUMEN2_TASTE_SCORE.md` (8.3) + `docs/audits/visual-lumen2/*.png` | **PASS** |
| **S-DOGFOOD** | `D: S-DOGFOOD health 200 + deploy.md revision recorded` + all rows above | smoke | same | same + `evidence/deploy.md` | **PASS** |

## Adversarial must-not (same keystone file)

| Case | Named test | Result |
|------|------------|--------|
| Unauth admin submissions/evaluations | `D: must-not unauth admin submissions + evaluator no admin shell` | **PASS** (401/403; no privileged rows) |
| Evaluator no admin shell | same | **PASS** |
| Closed CFP POST 4xx | `D: S-CFP-CLOSED closed window on dogfood` | **PASS** |

## Session mint (dogfood D only)

Live dogfood does not expose `AUTH_DEV_OUTBOX`. Keystone mints short-lived `auth_sessions` rows for seeded demo users (`user_demo_admin` / `_evaluator` / `_speaker`) via Cloudflare D1 HTTP API (`playwright/e2e/helpers/dogfood-session.ts`). Requires env **names** `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (values never committed).

## Inventory gate

```bash
pnpm test:e2e:inventory
```

Must remain green (anti-shrinkage). Phase 11 keystone does **not** re-own `@inv` tags (1:1 ownership stays on implementation specs).

## G7 / SESSION readiness

| Check | Status |
|-------|--------|
| All 18 soul IDs D-proven on www.speakerops.org | **YES** |
| Deploy revision + health 200 recorded | **YES** |
| Keystone report hash recorded | **YES** |
| Handover wave brief | `evidence/PRODUCTION_HANDOVER_WAVE.md` |
| BUILD_CHECKLIST BC-01…BC-20 | filled DONE_WITH_EVIDENCE (section 11.9) |
| Exit claim | **`dogfood_ready`** eligible for G7 owner close |

## Reproduce

```bash
# Deploy Worker + SPA to speakerops-demo (www.speakerops.org)
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh

# Full 18-soul D keystone
scripts/with-secrets.sh pnpm test:e2e:phase11-keystone

# Inventory anti-shrinkage
pnpm test:e2e:inventory
```

## Non-goals (still out of scope)

Multi-round review boards · embeds · gallery CMS · AI auto-schedule/evaluator · full CRM · sbek harness changes · production multi-tenant cutover · new npm UI kits.
