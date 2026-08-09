# BUILD_CHECKLIST — Phase 10–11 FULL

**Claim:** dogfood_ready  
**Order:** FULL  
**Status legend:** OPEN | IN_PROGRESS | DONE_WITH_EVIDENCE | NEED_* | OWNER_AMEND

| id | soul_ref | done_when | evidence_expected | status | evidence_path | notes |
|----|----------|-----------|-------------------|--------|---------------|-------|
| BC-01 | S-SUB-LIST | Submissions table loads dogfood | e2e pass + screenshot | DONE_WITH_EVIDENCE | 11.9 · evidence/SOUL_EVIDENCE_TABLE.md · phase11_handover_keystone D:S-SUB-LIST | ≥150 seed; ≤5s |
| BC-02 | S-EVAL-UI | Evaluations no validation fail | e2e pass | DONE_WITH_EVIDENCE | 11.9 · SOUL_EVIDENCE_TABLE · D:S-EVAL-UI | |
| BC-03 | S-CFP-SUBMIT | Public submit DEMO | e2e pass | DONE_WITH_EVIDENCE | 11.9 · D:S-CFP-SUBMIT | DEMO allowlist host |
| BC-04 | S-CFP-CLOSED | Closed UI + API reject | e2e + unit | DONE_WITH_EVIDENCE | 11.9 · D:S-CFP-CLOSED | |
| BC-05 | S-AUTH-ROLES | 3 roles land | e2e pass | DONE_WITH_EVIDENCE | 11.9 · D:S-AUTH-ROLES | D1 session mint |
| BC-06 | S-CFP-DRAFT | Draft save/resume | e2e pass | DONE_WITH_EVIDENCE | 11.9 · D:S-CFP-DRAFT | |
| BC-07 | S-L2-SYSTEM | Primitives + tokens | unit + state sheet | DONE_WITH_EVIDENCE | 11.0 + 11.9 D:S-L2-SYSTEM | l2-state-sheet post-deploy |
| BC-08 | S-L2-SHELL | Overview 5s test | e2e + note | DONE_WITH_EVIDENCE | 11.1 + 11.9 D:S-L2-SHELL | |
| BC-09 | S-L2-COMMS | Campaign flow + scale | e2e | DONE_WITH_EVIDENCE | 11.2 + 11.9 D:S-L2-COMMS | J01–J10 preserved |
| BC-10 | S-L2-CFP | Builder + public | e2e | DONE_WITH_EVIDENCE | 11.3 + 11.9 D:S-L2-CFP | |
| BC-11 | S-L2-SUB | Master-detail polish | e2e | DONE_WITH_EVIDENCE | 11.4 + 11.9 D:S-L2-SUB | |
| BC-12 | S-L2-SCHED | Studio polish | e2e | DONE_WITH_EVIDENCE | 11.5 + 11.9 D:S-L2-SCHED | |
| BC-13 | S-L2-PORTAL | Portal polish | e2e | DONE_WITH_EVIDENCE | 11.6 + 11.9 D:S-L2-PORTAL | |
| BC-14 | S-L2-A11Y | a11y + session recovery | e2e + checklist | DONE_WITH_EVIDENCE | 11.7 · docs/audits/LUMEN2_QA_EVIDENCE.md · 11.9 D:S-L2-A11Y | |
| BC-15 | S-L2-SCORE | ≥8.0 / no primary &lt;7 | taste score doc | DONE_WITH_EVIDENCE | 11.8 · docs/audits/LUMEN2_TASTE_SCORE.md (8.3) · visual-lumen2/ · 11.9 D:S-L2-SCORE | |
| BC-16 | S-DOGFOOD | Deploy + keystone on www.speakerops.org | deploy log + e2e | DONE_WITH_EVIDENCE | evidence/deploy.md · SOUL_EVIDENCE_TABLE.md · phase11-keystone-run.SHA256 | binding URL only |
| BC-17 | S-SCHED-CHROME | Schedule day chrome fixed or absence proven | e2e or absence note | DONE_WITH_EVIDENCE | 10.6 + 11.9 D:S-SCHED-CHROME | closed in-wave |
| BC-18 | S-EVAL-EXPORT | Export/sort fixed or absence proven | e2e or absence note | DONE_WITH_EVIDENCE | 10.6 + 11.9 D:S-EVAL-EXPORT | closed in-wave |
| BC-19 | Inventory gate | `pnpm test:e2e:inventory` green after 11.x | CI log | DONE_WITH_EVIDENCE | 11.9 gate | anti-shrinkage |
| BC-20 | Lockfile | No unapproved new runtime deps | package.json+lock hash diff | DONE_WITH_EVIDENCE | 11.9 zero new UI kits | zero-deps |

## Wave close

| Field | Value |
|-------|-------|
| Handover | `evidence/PRODUCTION_HANDOVER_WAVE.md` |
| Soul table | `evidence/SOUL_EVIDENCE_TABLE.md` |
| Deploy | `evidence/deploy.md` |
| Keystone | `playwright/e2e/phase11_handover_keystone.spec.ts` |
| Claim readiness | **dogfood_ready** / **CLAIM_PROVEN** — all BC rows DONE_WITH_EVIDENCE · dogfood `0.1.0-demo+3421b4f` · postbuild dual-eval closed (`evidence/postbuild-eval/SYNTHESIS_POSTBUILD.md`) |
