# SpeakerOps Phase 10–11 — Product reliability + Lumen 2 parity — Constitution

**Status:** LOCKED v1.2 — owner execute authorization 2026-08-09 (full completion, no stubs/residuals); dual G4 final folded (Codex residual pack depth + Claude ADOPT notes)  
**Date:** 2026-08-09  
**Programme:** intent-to-build full adversarial SR path  
**Claimed completion state:** `dogfood_ready`  
**G4 fold:** Codex + Claude REVISE 2026-08-09 folded (livability paths, dogfood F/D split, inventory gate, residual BC-17/18, pack snapshot, DEMO fail-closed).  
**Check back at every gate.** If a change violates this document, stop — do not narrow soul until gone.

---

## Article 0 — Completion contract (required)

| Field | Value |
|-------|-------|
| Owner order | **FULL** |
| Surfaces | Web SPA (admin, evaluator, speaker portal, public CFP, public program) + Worker API on dogfood deploy |
| Exit claim | **dogfood_ready** |
| Owner-approved DEFER | *(empty — no DEFER rows; agent-incomplete blocks claim)* |

**Session stop ≠ programme complete ≠ claim proven.**  
**Forbidden exit:** residual essay while order=FULL, DEFER empty, and agent-incomplete remains.

**BUILD_CHECKLIST:** `initiative/PHASE10_11_GAP_CLOSE/BUILD_CHECKLIST.md` — progressive fill; end-check before CLAIM_PROVEN.

---

## Article I — What we are building

**One-sentence north star:** Close every **real product** defect that blocks operator/speaker workflows and bring the frontend to **Lumen 2 parity** (≥8.0 overall, no primary surface &lt;7.0) so dogfood is handover-ready — without chasing sbek harness scores or constitution non-goals.

**It is:**
- Fix and prove functional defects found in sbek run + independent code inspection (submissions load, evaluations validation, CFP captcha/closed window on demo, auth-edge for DEMO, real submitter gaps we choose in-scope).
- Migrate `apps/web` presentation to the approved Lumen 2 design pack (tokens, primitives, shell, six canonical workflows + remaining routes, states/a11y/responsive, visual gates).
- Ship on dogfood (`www.speakerops.org`) with tests, inventory, and handover evidence.

**It is not:**
- Patching or changing sbek judging/scoring/rubrics.
- Implementing constitution **struck** surfaces: embeds/iframe kits, gallery CMS, AI auto-scheduler, AI evaluator, full CRM/travel booking, personal attendee “my schedule” planner, Sessionboard dual SoR.
- A cosmetic token-only reskin without workflow composition.
- New runtime dependencies (UI kits, icon packages, chart/form/DnD/font packages) without owner+security exception.

### Non-goals (explicit)

| Non-goal | Reason |
|----------|--------|
| sbek harness fixes | Owner: do not fix the evaluation framework |
| Embeds / gallery CMS / AI placer / AI multi-round | Constitution struck |
| Human multi-round review boards | Optional P3; not required for this FULL order unless soul demands — **not** a soul here |
| Full CRM / logistics booking | Struck / out of scope |
| Label renames requiring governance amendment | Keep locked labels (`CFP / Forms`, `Comms`) until separate label-only amendment |
| Production multi-tenant SaaS packaging | Separate authority |

### Product vs harness classification (binding)

| Class | Treatment in this programme |
|-------|------------------------------|
| **P — Real product defect** | **MUST fix** with automated + dogfood proof |
| **S — Setup/deploy lag** | **MUST re-prove** on live dogfood; fix product if repro fails |
| **H — Harness/agent only** | Document; **do not** build product features solely to score sbek |
| **C — Constitution miss** | Accept; do not implement |
| **D — Deprioritized** | Only if owner amends souls into scope |

**Authoritative residual product list (P/S in-scope):**

1. Admin submissions list must load for large seeded events (dogfood 150+).  
2. Admin evaluations must load without “Response validation failed”.  
3. Public CFP on DEMO/dogfood must accept submit without captcha dead-end.  
4. CFP closed window: UI closed state + server reject after past close (+ republish if required).  
5. Organizer/evaluator/speaker sessions usable on dogfood (mint path or DEMO auth edge — no casual public outbox).  
6. CFP draft save (CFP-07) — real submitter gap; **in scope** for FULL product quality.  
7. Minor schedule week-grid extra-day chrome if still present after load.  
8. ABS-13-class export/score sort if already partially shipped elsewhere — prove or finish **without** multi-round boards.

**Frontend audit gaps (all in scope for Phase 11):** Lumen 2 system + shell + six canonical screens + remaining admin/settings routes + states/a11y/responsive + visual quality gates per design-pack `QA_CHECKLIST.md` and audit acceptance (≥8.0 / no primary &lt;7.0).

### Overlap rule

| Overlap | Rule |
|---------|------|
| Submissions/evaluations/CFP/comms/schedule | Phase 10 fixes **correctness/reliability** first; Phase 11 recomposes **presentation** on fixed behaviour — do not “design over” broken APIs |
| Public CFP / portal | Captcha + closed window + draft are Phase 10; branded composition Phase 11 |
| Auth session | Phase 10 reliability; Phase 11 login/portal visual only after session works |

---

## Article II — Soul tests (fail = incomplete)

A human (or inventory e2e) on **dogfood** must be able to:

### Product reliability (Phase 10)

**Proof classes:** **F** = local/CI fixture at Phase 10 keystone (10.7). **D** = live `https://www.speakerops.org` after wave deploy at **11.9**. Phase 10 souls pass **F then D**; dogfood_ready requires **D** for all 18 IDs.

### Product reliability (Phase 10) — souls 1–8

1. **S-SUB-LIST** — Admin opens `/admin/submissions` on seeded event (≥150 rows) and sees non-empty table within 5s (not perpetual Loading).  
2. **S-EVAL-UI** — Admin opens `/admin/evaluations` and sees progress UI without Response validation failed.  
3. **S-CFP-SUBMIT** — Public submits valid proposal on dogfood CFP without captcha dead-end; DEMO token **fail-closed** outside allowlisted demo host/event.  
4. **S-CFP-CLOSED** — After close date past (+ republish if required), closed UI + API rejects submit.  
5. **S-AUTH-ROLES** — Organizer/speaker/evaluator land on correct homes via **real session cookies** (mint path OK; docs-only is not a pass).  
6. **S-CFP-DRAFT** — Submitter saves draft with minimal fields and resumes.  
7. **S-SCHED-CHROME** — Schedule week grid does not invent out-of-range days (or documented TZ exception).  
8. **S-EVAL-EXPORT** — Single-round score sort + CSV export, or recorded proof-of-absence.  

### Lumen 2 parity (Phase 11) — souls 9–18

9. **S-L2-SYSTEM** — Shared primitives (Button, Field, DataTable, Alert, Modal, EmptyState, Icon) exist, tokenized from `--lumen-*`, no new runtime deps, state sheet reviewable.  
10. **S-L2-SHELL** — Admin shell + Overview answer “what needs me now?” in five seconds with readiness + attention queue.  
11. **S-L2-COMMS** — Communications uses Audience→Message→Review→Send flow; 150-speaker audience is searchable/filterable without raw 150-checkbox wall; **J01–J10** preserved.  
12. **S-L2-CFP** — CFP builder uses outline/canvas/inspector composition; public CFP branded with recovery states.  
13. **S-L2-SUB** — Submissions master-detail with toolbar, selection bar, filter state.  
14. **S-L2-SCHED** — Schedule Studio full-height with sticky headers, clear conflicts, keyboard place/move.  
15. **S-L2-PORTAL** — Speaker portal mobile-first branded progress + next task.  
16. **S-L2-A11Y** — Keyboard, focus, contrast, 390px public/portal, session-expired recovery (not auth alert inside shell).  
17. **S-L2-SCORE** — Independent taste ≥8.0 overall; no primary surface &lt;7.0; protocol + QA_CHECKLIST evidence.  
18. **S-DOGFOOD** — Deploy healthy at **`https://www.speakerops.org` only**; keystone e2e non-skipped with deploy revision + report hash; **all 18 soul IDs** re-proven D after Phase 11 recompose; handover evidence complete.

### Authoritative soul-ID set (count = 18)

`S-SUB-LIST`, `S-EVAL-UI`, `S-CFP-SUBMIT`, `S-CFP-CLOSED`, `S-AUTH-ROLES`, `S-CFP-DRAFT`, `S-SCHED-CHROME`, `S-EVAL-EXPORT`, `S-L2-SYSTEM`, `S-L2-SHELL`, `S-L2-COMMS`, `S-L2-CFP`, `S-L2-SUB`, `S-L2-SCHED`, `S-L2-PORTAL`, `S-L2-A11Y`, `S-L2-SCORE`, `S-DOGFOOD`.

(Note: S-CFP-DEMO-NEG unit proofs attach to S-CFP-SUBMIT/CLOSED section 10.3; not a 19th soul.)

---

## Article III — Anti-dilution

- Auditors **may not remove** soul tests to obtain APPROVE or AGREE.  
- They may add must-fixes that **protect** soul tests.  
- Soul tests change only via **Amendment** with owner approval.  
- “sbek score still low” is **not** a soul failure if H/C causes dominate and P souls pass.

---

## Article IV — Amendment protocol

| Field | Value |
|-------|-------|
| Requested by | |
| Date | |
| Soul tests added/changed/removed | |
| Rationale | |
| Owner approval | pending / yes / no |
| Traceability update | |

Until owner approval is recorded, this LOCKED text (once dual-audited) remains authoritative.

---

## Article V — Constitution gates

| Gate | When | Question |
|------|------|----------|
| G0 Intent | Before packs | Dual-track still correct? |
| G2 Livability | Before build | Every soul → section → AC → testid → e2e? |
| G4 Advisory | Before execute | Dual auditors **ADEQUATE** (or ADOPT_WITH_NOTES fully folded); soul intact? Execute-go request only after ADEQUATE ×2. |
| Mid-build | After 10.x and after 11.x clusters | Product souls still green under FE changes? |
| G7 Exit | Close | All souls green for dogfood_ready? |

---

## Article VI — What we will not sacrifice for schedule

- Empty primary chrome for a soul surface  
- Stub components / “coming soon” for souls  
- Secrets in git  
- New UI dependencies without exception  
- Claiming dogfood_ready on fixture-only when S-DOGFOOD requires live  
- Designing over broken submissions/evaluations APIs  

---

## Article VII — Prior lessons

- sbek low scores were mostly coverage/cannot_judge — do not invent product for H/C.  
- Lumen v1 failed by treating tokens as design; Lumen 2 must ship **compositions + states**.  
- Communications scale (150 speakers) is a design+engineering soul, not a seed demo.  
- Captcha and auth edges block automated and human dogfood equally — prove on deploy.  
- Mid-run deploy lag confuses auditors — record deploy revision in evidence.

---

## Article VIII — Authority sources

| Topic | Authority |
|-------|-----------|
| Product non-goals / struck | `docs/COMPETITION.md`, original constitution |
| SBEK classification | `docs/audits/SBEK_RUN_REPORT.md` v1.1 |
| Frontend direction | `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/*` + `SPEAKEROPS_DESIGN_AUDIT.md` |
| Implementation binding | `design-pack/AGENT_IMPLEMENTATION_SPEC.md` |
| Stack | React 18 + RR6 + Vite 5 + first-party CSS; `apps/web/src/styles/lumen.css` SoT |
| SR standards | `nood-factory/plans/runs/speakerops/speakerops-engineering-standards.md` |
