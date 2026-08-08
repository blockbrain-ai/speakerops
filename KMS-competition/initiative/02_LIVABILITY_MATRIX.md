# Livability matrix — soul → section → AC → e2e

**Programme:** SpeakerOps  
**Rule:** 100% of constitution soul tests mapped before implementation sections APPROVE.

| Soul | Section(s) | Named AC (summary) | testid / inventory | e2e proof |
|------|------------|--------------------|--------------------|-----------|
| S-THEME | 2.4 Design Kit, 7.2 CLI design | Tokens publish to public CFP | C03–C05, CLI design | Phase 8 suite + CLI test |
| S-CFP | 3.1–3.3 Form builder + public CFP | Conditional + category + multi-speaker submit | A01–A10, D01–D10 | Phase 8 |
| S-EVAL | 3.4–3.5 Eval + decisions | Score + accept audit | E01–E06, F01–F03 | Phase 8 |
| S-PORTAL | 4.1–4.3 Portal + files + tasks | Magic link + uploads + tasks | B02, G01–G08 | Phase 8 |
| S-COMMS | 5.1–5.2 Templates + send/ICS | Preview + idempotent send + ICS | J01–J07 | Phase 8 |
| S-SCHED | 6.1–6.2 Schedule + conflicts | 5 views + drag + conflict | I01–I12 | Phase 8 |
| S-READY | 6.3 Dashboard live | Outstanding + live update | H01–H05 | Phase 8 |
| S-CLI | 7.1–7.3 Keys + CLI + OpenAPI | Scoped key deny + readiness JSON | unit/cli + inv K* | Phase 7+8 |
| S-AIRTABLE | 7.3 Airtable projection | Mirror lag ok; app survives pause | M10 + integration | Phase 7+8 |
| S-CF | 1.x scaffold + deploy notes 9.x | Health on CF URL | deploy smoke | Phase 9 + dogfood |
| S-E2E-INV | 8.1 Inventory lock | Inventory complete for UI | inventory CI | Phase 8 |
| S-E2E-RUN | 8.2 Full Playwright | All REQUIRED PASS | full report | Phase 8 keystone |
| S-ONB-HUMAN | 9.1–9.2 Onboarding docs | Zero→running path documented | docs review + dry-run | Phase 9 |
| S-ONB-AGENT | 9.2–9.3 Agent setup + CLI | Agent setup doc works | agent dry-run checklist | Phase 9 |
| S-DOCS | 9.1–9.5 docs + HTML reports + tree | HTML reports + coherent tree | report generation gate | Phase 9 |

**Settings in-wave:** M01–M10 covered by C/D/J/K/admin sections — not deferred to bolt-on.

**Empty chrome forbidden:** each soul surface ships usable UI in its phase, not “coming soon”.
