# Phase 10–11 product brief — reasoning, classification, dual-track design

**Date:** 2026-08-09  
**Mode:** plan (intent-to-build G0–G1)

---

## 1. Why two tracks

Owner ordered: (1) close **real** programme gaps from sbek analysis, **not** harness gaps; (2) close **all** frontend gaps from the independent design audit / Lumen 2 pack; (3) full adversarial SR process; (4) handover-ready code; no stubs/residuals.

These are **not the same work**:

| Track | Failure mode if skipped |
|-------|-------------------------|
| **A — Product reliability** | Operators cannot load submissions/evaluations; public submit broken; dogfood unusable regardless of polish |
| **B — Lumen 2 parity** | Product works but remains ~4.4/10 design scaffold; fails competition design bar and handover visual quality |

**Overlap:** same routes (submissions, CFP, comms, schedule, portal). **Order:** fix reliability (Phase 10) **then** recompose UI (Phase 11) so builders do not paint over broken APIs.

---

## 2. SBEK findings → include / exclude

### Include (real P / S)

| Item | Class | Why real |
|------|-------|----------|
| Submissions perpetual Loading | P | Agent + logic: blocks decision/assign chains; large event likely |
| Evaluations “Response validation failed” | P | Server Zod/output mismatch pattern exists across modules |
| Captcha dead-end on public CFP | S/P | DEMO_MODE path must work on dogfood deploy |
| CFP closed UI after past close | S (verify) | Code exists; deploy/republish must prove |
| Auth session for personas | H+P edge | Product login copy + cookie/session durability for dogfood ops |
| CFP draft save | P (product UX) | not_found in sbek; legitimate submitter need |
| Schedule extra day chrome | P minor | UI correctness |
| Score sort / export (ABS-13 class) | P if missing | Plan commitment; single-round only |

### Exclude (do not build)

| Item | Class | Why |
|------|-------|-----|
| Multi-round AI / AI triage | C | Struck |
| AI auto-schedule | C | Struck |
| Embeds / personal schedule / gallery CMS | C | Struck |
| CRM travel booking | C | Struck |
| Dedicated CRM “Add speaker” form | D/R | Domain via submissions/sessions |
| sbek turn caps / Haiku agent / drag hang | H | Owner: do not fix harness |
| Wrong-event thrash scoring | H | Notes/agent issue |

---

## 3. Frontend audit → include (all for FULL)

From `SPEAKEROPS_DESIGN_AUDIT.md` (4.4/10) and design-pack:

- Foundation: type/space/elevation/border/control/icon/motion tokens + primitives  
- Shell + Overview/readiness composition  
- Communications campaign flow + 150 audience scale  
- CFP builder composition + public CFP  
- Submissions/evaluations composition  
- Schedule Studio polish  
- Speakers + portal  
- Settings / Design Kit / API keys surfaces  
- Empty/loading/error/session-expired  
- Mobile admin shell strategy  
- Visual gates (screenshot suite) + independent ≥8.0 score  

**Constraint:** zero new runtime deps; map L2 tokens into `lumen.css`; no parallel theme.

---

## 4. SR programme shape

| Phase | Id range | Purpose |
|-------|----------|---------|
| 10 | `spo-10.*` | Product reliability + functional gaps |
| 11 | `spo-11.*` | Lumen 2 system + surface migration + keystone dogfood handover |

**Models (estate default):** builder `grok`/`grok-4.5`; section audit off; phase audit Codex `gpt-5.6-sol` @ xhigh; `MAX_FINAL_AUDIT_ITERATIONS=8`.

**I12 keystones:** `10.7` product e2e; `11.9` visual+dogfood handover e2e.

---

## 5. Success = handover ready

Not “packs exist” and not “sbek headline green”.  
**dogfood_ready** means: souls 1–16 pass with evidence paths; BUILD_CHECKLIST end-check green; dual G7 advisory; deploy revision recorded; no agent-incomplete residuals.
