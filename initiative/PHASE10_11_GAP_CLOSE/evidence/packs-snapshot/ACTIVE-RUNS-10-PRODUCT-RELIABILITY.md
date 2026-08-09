# Phase 10 — Product reliability & real functional gaps

> **Updated:** 2026-08-09 | **Status:** execution-ready (G4 fold; dual final)  
> **Constitution:** `speakerops/initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md`  
> **Claim:** dogfood_ready (with Phase 11)

## Why this phase exists

sbek run `2026-08-09T09-56-39` and dual-audited `SBEK_RUN_REPORT.md` v1.1 established that **headline scores are not a product grade**, but several **real product walls** block operators: submissions list Loading, evaluations Response validation failed, DEMO captcha path, closed-window prove, session reliability, and CFP draft. This phase fixes **P/S product defects only**. It does **not** change the sbek harness and does **not** implement constitution non-goals.

Phase 11 (Lumen 2) must not paint over broken APIs — Phase 10 is the reliability floor.

## Required baseline

- Phases 0–9 complete (product + dogfood deploy path exists).
- DEMO-PACK seed on dogfood event `dogfood-2026` / `evt_dogfood`.
- Constitution Phase 10–11 locked after dual advisory.

## Core rules (must not violate)

- **No harness surgery** — do not modify sbek scoring, rubrics, or agent tools.
- **No struck features** — embeds, gallery CMS, AI placer, AI evaluator, full CRM, personal attendee planner.
- **No stubs** — every soul has automated proof; no “coming soon”.
- **Secrets names only** in packs and docs.
- **Zero new runtime UI dependencies**.

## Model roles (estate default)

| Role | Provider | Model |
|------|----------|-------|
| Builder | grok | grok-4.5 |
| Section audit | off | — |
| Phase auditor | codex | gpt-5.6-sol @ xhigh |
| Max final audit iterations | 8 | fail on nonconverge |

## Test and cleanup policy

- Gate: `GATE_TYPECHECK_CMD` + `GATE_TEST_CMD` from `.env.speakerops`
- UI sections: also `pnpm test:e2e` inventory where controls change
- Worktree-local cleanup only

## Delivered build order

1. **10.1 — Submissions list reliability** (`spo-10.1-submissions-list-reliability`) — S-SUB-LIST  
2. **10.2 — Evaluations response validation** (`spo-10.2-evaluations-response-validation`) — S-EVAL-UI  
3. **10.3 — Public CFP captcha + closed** (`spo-10.3-public-cfp-captcha-closed`) — S-CFP-SUBMIT, S-CFP-CLOSED  
4. **10.4 — DEMO auth session reliability** (`spo-10.4-demo-auth-session-reliability`) — S-AUTH-ROLES  
5. **10.5 — CFP draft save** (`spo-10.5-cfp-draft-save`) — S-CFP-DRAFT  
6. **10.6 — Eval export/sort + schedule chrome** (`spo-10.6-eval-export-schedule-chrome`)  
7. **10.7 — Product reliability keystone e2e (I12)** (`spo-10.7-product-reliability-keystone`) — souls 1–6 together  

## Critical path

```
8.4/3.5 → 10.1 → 10.2 → 10.3 → 10.4 → 10.5 → 10.6 → 10.7 (I12) → 11.0
```

## Expected outcome

- Admin submissions and evaluations usable on dogfood with 150+ rows.
- Public CFP submit + closed window proven under DEMO_MODE.
- Three roles can land on correct homes.
- Draft save/resume works.
- Keystone e2e green; evidence under `initiative/PHASE10_11_GAP_CLOSE/evidence/`.

## Follow-on

- Phase 11 Lumen 2 parity recomposes presentation on this reliability floor.
