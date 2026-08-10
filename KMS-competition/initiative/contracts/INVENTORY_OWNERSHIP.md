# Inventory ID → section ownership (exact)

**Rule:** Every REQUIRED browser inventory ID has exactly one **implementation owner** and one **proof owner** (often the phase keystone or 8.2).  
**Wildcards forbidden in ownership cells.**

| Inv ID | Implementation owner | Proof owner | Notes |
|--------|---------------------|-------------|-------|
| A01–A11 | 3.3 | 3.6 then 8.2 | Public CFP |
| B01–B03 | 2.1 | 2.5 then 8.2 | Auth happy |
| B04–B06 | 2.2 | 2.5 then 8.2 | Guards |
| B08 | 2.1 | 2.5 then 8.2 | Multi-membership chooser |
| C01,C02,C07,C11 | 2.3 | 2.5 then 8.2 | Events |
| C03–C06,C08–C10 | 2.4 | 2.5 then 8.2 | Design Kit |
| D01–D10 | 3.2 | 3.6 then 8.2 | Form builder UI |
| E01–E08 | 3.5 | 3.6 then 8.2 | Submissions/decisions |
| F01–F04 | 3.4 | 3.6 then 8.2 | Evaluator |
| G01–G08 | 4.3 | 4.4 then 8.2 | Portal |
| H01–H05 | 6.3 | 6.4 then 8.2 | Dashboard |
| I01–I16 | 6.2 | 6.4 then 8.2 | Schedule |
| J01–J10 | 5.3 | 5.4 then 8.2 | Comms (J06/J10 need 6.1 placements available in seed) |
| K01–K04 | 7.1 | 7.4 then 8.2 | API keys UI |
| L01–L03 | cross-cutting (each UI phase) | 8.2 | States |
| L04 | all e2e | 8.2 | Console clean |
| L05 | 6.3 + 8.4 seed | 6.4 then 8.2 | Large list |
| N01–N04 | 6.3 | 6.4 then 8.2 | Admin speakers |
| O01–O03 | 2.3 | 2.5 then 8.2 | Event/rooms/tracks settings |
| O04 | 3.4 | 3.6 then 8.2 | Rubric settings |
| O05 | 4.1 | 4.4 then 8.2 | Task templates |
| O06 | 7.3 | 7.4 then 8.2 | Airtable status |

**API-only / non-browser proof**

| Surface | Owner | Proof |
|---------|-------|-------|
| Form builder API | 3.1 | unit 3.1 + used by 3.2/3.6 |
| Schedule engine | 6.1 | unit 6.1 + 6.2/6.4 |
| CLI commands | 7.2 | tests/cli + 7.4 |
| Airtable projector | 7.3 | integration + 7.4 |
| CF deploy | 8.6 | evidence URL or DEFER |
| Full inventory | 8.1–8.2 | 8.5 report |
| Onboarding | 9.2–9.6 | 9.6 bundle |

**Sequencing note (J06/J10):** Phase 5 e2e may use fixture placement rows; full ICS-after-reschedule proof re-run in 6.4 or 8.2 after schedule exists.
