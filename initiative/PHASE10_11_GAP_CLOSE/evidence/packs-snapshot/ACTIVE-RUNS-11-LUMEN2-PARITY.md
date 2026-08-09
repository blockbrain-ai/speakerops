# Phase 11 — Lumen 2 frontend parity

> **Updated:** 2026-08-09 | **Status:** execution-ready (G4 fold; dual final)  
> **Design authority:** `speakerops/initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/ (checksum: evidence/design-pack-snapshot.SHA256). Do NOT use laptop ChatGPT design-pack paths on the box.`  
> **Audit baseline:** `SPEAKEROPS_DESIGN_AUDIT.md` (implemented 4.4/10 → target ≥8.0)

## Why this phase exists

Independent design audit scored the shipped UI **4.4/10**: functional Lumen-themed scaffold, not the Northstar+Greenroom+Program OS synthesis. The approved **Lumen 2 design pack** (9.1/10 self-review) is the implementation contract. This phase migrates `apps/web` to that contract **without new runtime dependencies**, after Phase 10 reliability.

## Required baseline

- Phase 10 complete (10.7 keystone green).
- Design pack + HANDOVER_BRIEF read; `lumen.css` remains token SoT.
- No unapproved label amendments (keep `CFP / Forms`, `Comms` until governance).

## Core rules (must not violate)

- **No new runtime deps** (UI kit, icons package, charts, fonts, DnD libs).
- **Do not parallel-theme** — map L2 semantics into `--lumen-*`.
- **Preserve behavior** — permissions, CSP, domain commands, inventory.
- **Composition over tokens** — page formats from `page-atlas.json` / AGENT_IMPLEMENTATION_SPEC.
- **Visual quality is a gate** — not optional screenshots.
- **Admin chrome neutral** — event brand only on public/portal scopes.

## Model roles

Same estate default as Phase 10 (builder grok-4.5; phase audit Codex sol xhigh; 8 iterations).

## Test and cleanup policy

- Typecheck + test:ci + e2e inventory + visual suite (11.8)
- QA_CHECKLIST evidence required for primary routes

## Delivered build order

1. **11.0 — Foundation primitives** (`spo-11.0-lumen2-foundation-primitives`) — S-L2-SYSTEM  
2. **11.1 — Shell + Overview** (`spo-11.1-lumen2-shell-overview`) — S-L2-SHELL  
3. **11.2 — Communications campaign** (`spo-11.2-lumen2-comms-campaign`) — S-L2-COMMS  
4. **11.3 — CFP builder + public** (`spo-11.3-lumen2-cfp-builder-public`) — S-L2-CFP  
5. **11.4 — Submissions + evaluations UI** (`spo-11.4-lumen2-submissions-evaluations`) — S-L2-SUB  
6. **11.5 — Schedule Studio** (`spo-11.5-lumen2-schedule-studio`) — S-L2-SCHED  
7. **11.6 — Speakers + portal** (`spo-11.6-lumen2-speakers-portal`) — S-L2-PORTAL  
8. **11.7 — Settings + states + a11y** (`spo-11.7-lumen2-settings-states-a11y`) — S-L2-A11Y  
9. **11.8 — Visual suite + taste score** (`spo-11.8-lumen2-visual-score-gates`) — S-L2-SCORE  
10. **11.9 — Dogfood + handover keystone (I12)** (`spo-11.9-lumen2-dogfood-handover-keystone`) — S-DOGFOOD  

## Critical path

```
10.7 → 11.0 → 11.1 → 11.2
                 ↓
               11.3 → 11.4 → 11.5 → 11.6 → 11.7 → 11.8 → 11.9 (I12 exit)
```

11.2–11.6 may partially parallel after 11.0 if builder capacity allows; **do not** start 11.8 until 11.2–11.7 complete.

## Expected outcome

- Weighted design score ≥ **8.0**; no primary surface &lt; **7.0**.
- Communications operable at 150 speakers without raw checkbox wall.
- QA_CHECKLIST + taste score + soul evidence complete.
- Dogfood deploy healthy; programme claim **dogfood_ready** with FULL checklist green.

## Follow-on (out of programme)

- Label-only governance amendments (`Call for proposals`, `Communications`).
- Production multi-tenant packaging — separate authority.
