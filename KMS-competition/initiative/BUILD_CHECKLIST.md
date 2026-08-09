# BUILD_CHECKLIST — SpeakerOps FULL order

**Claim:** dogfood_ready  
**Status legend:** OPEN | IN_PROGRESS | DONE_WITH_EVIDENCE | NEED_* | OWNER_AMEND

| id | soul_ref | done_when | evidence_expected | status | evidence_path | notes |
|----|----------|-----------|-------------------|--------|---------------|-------|
| BC01 | S-THEME | Design Kit publish reflects on public CFP | e2e C05 PASS + screenshot | OPEN | | |
| BC02 | S-CFP | Conditional multi-speaker submit works | inventory A* PASS | OPEN | | |
| BC03 | S-EVAL | Score + accept audited | E/F inventory PASS | OPEN | | |
| BC04 | S-PORTAL | Magic link + files + tasks | G* PASS | OPEN | | |
| BC05 | S-COMMS | Preview send + ICS | J* PASS | OPEN | | |
| BC06 | S-SCHED | Five views + conflict | I* PASS | DONE_WITH_EVIDENCE | initiative/evidence/phase6-e2e.txt | 6.4 keystone |
| BC07 | S-READY | Live outstanding dashboard | H* PASS | DONE_WITH_EVIDENCE | initiative/evidence/phase6-e2e.txt | 6.4 keystone |
| BC08 | S-CLI | Scoped CLI admin path | cli test report | DONE_WITH_EVIDENCE | initiative/evidence/phase7-e2e.txt | 7.4 keystone + CLI07 |
| BC09 | S-AIRTABLE | One-way projection | integration log | DONE_WITH_EVIDENCE | initiative/evidence/phase7-e2e.txt | 7.4 keystone + pause |
| BC10 | S-CF | CF dogfood URL healthy | smoke URL note | NEED_LIVE_SMOKE | initiative/evidence/cf-dogfood.txt | PATH_READY only — live redacted workers.dev URL + GET /health 200 still required via deploy-dogfood.sh |
| BC11 | S-E2E-INV | Inventory complete | BROWSER_E2E_INVENTORY.md | OPEN | initiative/BROWSER_E2E_INVENTORY.md | predeclared |
| BC12 | S-E2E-RUN | Full browser suite green | playwright HTML report | OPEN | | |
| BC13 | S-ONB-HUMAN | Onboarding doc walkthrough | docs/ONBOARDING.md + HTML | OPEN | | Phase 9 |
| BC14 | S-ONB-AGENT | Agent setup path | docs/AGENT_SETUP.md | OPEN | | Phase 9 |
| BC15 | S-DOCS | HTML reports + tree | reports/*.html | OPEN | | Phase 9 |

**End-check before CLAIM_PROVEN:** all rows DONE_WITH_EVIDENCE or OWNER_AMEND; no OPEN/IN_PROGRESS/NEED_*.
