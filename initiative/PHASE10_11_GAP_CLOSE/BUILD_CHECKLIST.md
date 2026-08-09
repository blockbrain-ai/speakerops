# BUILD_CHECKLIST — Phase 10–11 FULL

**Claim:** dogfood_ready  
**Order:** FULL  
**Status legend:** OPEN | IN_PROGRESS | DONE_WITH_EVIDENCE | NEED_* | OWNER_AMEND

| id | soul_ref | done_when | evidence_expected | status | evidence_path | notes |
|----|----------|-----------|-------------------|--------|---------------|-------|
| BC-01 | S-SUB-LIST | Submissions table loads dogfood | e2e pass + screenshot | OPEN | | |
| BC-02 | S-EVAL-UI | Evaluations no validation fail | e2e pass | OPEN | | |
| BC-03 | S-CFP-SUBMIT | Public submit DEMO | e2e pass | OPEN | | |
| BC-04 | S-CFP-CLOSED | Closed UI + API reject | e2e + unit | OPEN | | |
| BC-05 | S-AUTH-ROLES | 3 roles land | e2e pass | OPEN | | |
| BC-06 | S-CFP-DRAFT | Draft save/resume | e2e pass | OPEN | | |
| BC-07 | S-L2-SYSTEM | Primitives + tokens | unit + state sheet | OPEN | | |
| BC-08 | S-L2-SHELL | Overview 5s test | e2e + note | OPEN | | |
| BC-09 | S-L2-COMMS | Campaign flow + scale | e2e | OPEN | | |
| BC-10 | S-L2-CFP | Builder + public | e2e | OPEN | | |
| BC-11 | S-L2-SUB | Master-detail polish | e2e | OPEN | | |
| BC-12 | S-L2-SCHED | Studio polish | e2e | OPEN | | |
| BC-13 | S-L2-PORTAL | Portal polish | e2e | OPEN | | |
| BC-14 | S-L2-A11Y | a11y + session recovery | e2e + checklist | DONE_WITH_EVIDENCE | 11.7 | docs/audits/LUMEN2_QA_EVIDENCE.md · playwright/e2e/session_states_a11y.spec.ts |
| BC-15 | S-L2-SCORE | ≥8.0 / no primary &lt;7 | taste score doc | OPEN | | |
| BC-16 | S-DOGFOOD | Deploy + keystone on www.speakerops.org | deploy log + e2e | OPEN | | |
| BC-17 | S-SCHED-CHROME | Schedule day chrome fixed or absence proven | e2e or absence note | OPEN | | residual #7 |
| BC-18 | S-EVAL-EXPORT | Export/sort fixed or absence proven | e2e or absence note | OPEN | | residual #8 |
| BC-19 | Inventory gate | `pnpm test:e2e:inventory` green after 11.x | CI log | OPEN | | anti-shrinkage |
| BC-20 | Lockfile | No unapproved new runtime deps | package.json+lock hash diff | OPEN | | zero-deps |
