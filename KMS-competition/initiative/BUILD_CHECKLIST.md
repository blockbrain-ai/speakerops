# BUILD_CHECKLIST — SpeakerOps FULL order

**Claim:** dogfood_ready  
**Status legend:** OPEN | IN_PROGRESS | DONE_WITH_EVIDENCE | NEED_* | OWNER_AMEND

| id | soul_ref | done_when | evidence_expected | status | evidence_path | notes |
|----|----------|-----------|-------------------|--------|---------------|-------|
| BC01 | S-THEME | Design Kit publish reflects on public CFP | e2e C05 PASS + screenshot | DONE_WITH_EVIDENCE | initiative/evidence/phase2-e2e.txt | 2.5 keystone · C03–C10 Design Kit + publish → public brand |
| BC02 | S-CFP | Conditional multi-speaker submit works | inventory A* PASS | DONE_WITH_EVIDENCE | initiative/evidence/phase3-e2e.txt | 3.6 keystone · A01–A11 public CFP |
| BC03 | S-EVAL | Score + accept audited | E/F inventory PASS | DONE_WITH_EVIDENCE | initiative/evidence/phase3-e2e.txt | 3.6 keystone · E01–E08 + F01–F04 |
| BC04 | S-PORTAL | Magic link + files + tasks | G* PASS | DONE_WITH_EVIDENCE | initiative/evidence/phase4-e2e.txt | 4.4 keystone · G01–G08 |
| BC05 | S-COMMS | Preview send + ICS | J* PASS | DONE_WITH_EVIDENCE | initiative/evidence/phase5-e2e.txt | 5.4 keystone · J01–J10 |
| BC06 | S-SCHED | Five views + conflict | I* PASS | DONE_WITH_EVIDENCE | initiative/evidence/phase6-e2e.txt | 6.4 keystone |
| BC07 | S-READY | Live outstanding dashboard | H* PASS | DONE_WITH_EVIDENCE | initiative/evidence/phase6-e2e.txt | 6.4 keystone |
| BC08 | S-CLI | Scoped CLI admin path | cli test report | DONE_WITH_EVIDENCE | initiative/evidence/phase7-e2e.txt | 7.4 keystone + CLI07 |
| BC09 | S-AIRTABLE | One-way projection | integration log | DONE_WITH_EVIDENCE | initiative/evidence/phase7-e2e.txt | 7.4 keystone + pause |
| BC10 | S-CF | CF dogfood URL healthy | smoke URL note | DONE_WITH_EVIDENCE | initiative/evidence/cf-dogfood.txt | Live redacted workers.dev URL + GET /health 200 recorded via deploy-dogfood.sh |
| BC11 | S-E2E-INV | Inventory complete | BROWSER_E2E_INVENTORY.md | DONE_WITH_EVIDENCE | initiative/BROWSER_E2E_INVENTORY.md | 8.1 inventory completeness · anti-shrinkage baseline 108 |
| BC12 | S-E2E-RUN | Full browser suite green | playwright HTML report | DONE_WITH_EVIDENCE | initiative/evidence/e2e-full.txt | 8.2 full suite + 8.5 coverage HTML (e2e-coverage.txt) |
| BC13 | S-ONB-HUMAN | Onboarding doc walkthrough | docs/ONBOARDING.md + HTML | DONE_WITH_EVIDENCE | initiative/evidence/onboarding-proof/human-dry-run.txt | 9.6 keystone; checklist initiative/evidence/onboarding-proof/README.md |
| BC14 | S-ONB-AGENT | Agent setup path | docs/AGENT_SETUP.md | DONE_WITH_EVIDENCE | initiative/evidence/onboarding-proof/agent-dry-run.txt | 9.6 keystone; deny-scope + readiness/design path |
| BC15 | S-DOCS | HTML reports + tree | reports/*.html | DONE_WITH_EVIDENCE | initiative/evidence/onboarding-proof/docs-reports.txt | 9.6 keystone; linkcheck 0 + reports/index.html portal |

**End-check before CLAIM_PROVEN:** all rows DONE_WITH_EVIDENCE or OWNER_AMEND; no OPEN/IN_PROGRESS/NEED_*.
