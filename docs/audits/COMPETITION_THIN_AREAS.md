# Competition thin areas

**Status:** FINAL (v2 — folded UX feedback)  
**Date:** 2026-08-10  
**Process:**
1. Independent draft → Codex review (**REVISE**) → v1 final (4 ops/handoff items) + Codex **AGREE**
2. Independent reviewer UX feedback (proposal visibility, deliberation, scale UX, form fidelity) folded into this synthesis

**Authority:** Official competition brief primary features and submission rules; programme contract / constitution; `docs/COMPETITION.md` judged workflows **1–6** and platform MUST; product code spot-checks; adversarial UX review of CFP/eval surfaces  

**Standard:** An area is listed only if it can plausibly hurt **AIE independent evaluation** of the required program loop or the subjective **“would we use / buy this?”** judgment for a multi-day tech conference cohort (~100–150 speakers). Passing a narrow soul test does not automatically clear an area.

**Thesis:** Intake and program-loop **mechanics** are largely in place. The product still loses “genuinely good CFP tool” credibility where (a) reviewers cannot **read and deliberate** on proposals, (b) cohort-scale **ops** stop short of commit/assign/browse, (c) **form fidelity** bugs break trust, or (d) **accept → portal → calendar** is not closed-loop for a real entrant.

**Not listed:** Struck / non-goal surfaces (AI multi-round review, Accelevents, portal wiki/embeds, embeddable gallery, CRM/marketing/CMS/media, cross-event history, OR-Tools auto-scheduler, in-product agent fleet, dual-write Airtable, etc.). Absence of those is intentional, not thinness.

---

## Thin areas

### 1. Evaluators score without the proposal in front of them

**What exists:** Evaluator queue with progress, rubric score panel, overall comment, keyboard save. Queue DTO carries submission `id`, `title`, `category`, `status` only (`packages/shared/src/eval.ts` EvalQueueItem). Score panel renders title + criteria — not abstract, field answers, or speakers (`apps/web/src/pages/EvaluatorQueue.tsx`).

**Why too thin:** Evaluation and scoring is a brief primary workflow. A reviewer cannot responsibly score a talk from title/category alone. This is a **critical miss**: inventory can pass “score criteria + save” while the product fails as a CFP review tool. Cohort judges simulating committee work will hit this first.

**Evidence anchors:** queue DTO (`packages/shared/src/eval.ts` ~152); score panel (`EvaluatorQueue.tsx` ~332).

**Win risk:** **Critical** — undermines S-EVAL credibility under “would we use this?” even when gates are green.

---

### 2. Accepted-speaker handoff and calendar delivery are not closed-loop

**What exists:** Accept materializes session, participation, and speaker tasks; portal and task models exist; ICS can be generated with stable UID/SEQUENCE; comms templates, preview, idempotent send, delivery log.

**Why too thin:** Accept leaves participation **unbound** (`userId: null`) and does not provision speaker membership or invitation as part of the decision. Production-default controlled magic-link policy does not cleanly self-onboard an arbitrary accepted CFP email the way seeded demo accounts do. Comms merge data lacks a portal-entry field. The outbox email consumer sends subject/body **without attaching** the stored ICS. ICS UI may require retyping placement data rather than one-click invite from a placement.

**Win risk:** **Critical** — seeded/allowlisted dogfood can pass while a real CFP entrant cannot complete accept → portal → calendar (brief portal + communications story).

---

### 3. Review deliberation: no individual review visibility or discussion

**What exists:** Assigned-only evaluator queue (by design / inventory F01). Admin evaluations show coverage and **aggregate** scores, not per-reviewer comments. No reply threads, no “see other reviews” policy (private / reveal-after-submit / open committee).

**Why too thin:** Brief evaluation is a **workflow** for a program committee, not only private numeric entry. Chairs deciding accept/reject need to read **who said what**, not only a mean. Reviewers often need controlled visibility into peers (even if the queue stays assigned-only). Without a clear visibility policy and surfaces for individual comments (and optional discussion), deliberation escapes to external tools — the product looks like a score form, not a CFP system.

**Evidence anchors:** assigned-only inventory; admin rollup UI without individual comments.

**Win risk:** **High** — committee operability and “would we run review on this?”  
**Note:** Does not require CRM; keep assigned-only queue if desired; add policy + visibility on the submission/admin side.

---

### 4. Bulk decision preview has no matching execution path

**What exists:** Multi-select + bulk preview for accept / reject / waitlist. Single-submission `Decision.Record` is robust (audit, materialization, tasks).

**Why too thin:** Preview-only route; no bulk commit. Applying results is one detail + one decision per submission. Hard parts already exist on the single path; cohort apply is the missing product step.

**Win risk:** **High** — chair workflow at CFP decision scale.

---

### 5. Cohort navigation and assignment setup are not operable at volume

**What exists:** Evaluator queue lists assigned items (no pagination) but no search, next-unreviewed action, or review-state filters. Admin submissions use previous/next pagination with status/category filters only. Assignment requires typing a raw evaluator **user id** (no roster/picker, workload view, or batch assign across a selection).

**Why too thin:** Hundreds of proposals must be easy to traverse and distribute. Scoring mechanics and assignment APIs exist; **setup and navigation** do not. This merges prior “assignment not cohort-operable” with scale UX (search / next-unreviewed / filters / picker).

**Evidence anchors:** Submissions list/pager; assignment UI (~user id field); eval queue list without search/nav aids.

**Win risk:** **High** — committee and chair time-to-decision.

---

### 6. Form builder is not durable across reload

**What exists:** Admin create / update draft / publish. Public get for published forms. Builder UI holds active form state in the SPA.

**Why too thin:** Admin API surface for forms does not give a practical **get/list and reopen** path for the builder after reload. Refresh loses active builder state; operators cannot reliably resume editing an existing form. That breaks the first brief workflow (custom CFP forms) under ordinary use.

**Evidence anchors:** form routes (create/update/publish-oriented admin surface; no solid builder reload path).

**Win risk:** **High** — admin CFP setup integrity; first surface judges touch.

---

### 7. Public form field fidelity bugs (multi-select and URL vs file)

**What exists:** Conditional fields, category routing, version pin, multi-speaker, draft/resume, windows/limits, Turnstile, uploads — strong intake mechanics overall.

**Why too thin:**
- **Multiselect** is rendered as an ordinary single-value `<select>` on the public CFP (and preview path treats select/multiselect similarly).
- **URL** fields: FormPreview renders a URL textbox; published public form maps the same type inconsistently (file-upload path). Preview and published form **disagree**.

These are correctness bugs, not missing modules. Judges filling or previewing forms will lose trust immediately.

**Evidence anchors:** `FormPreview.tsx` select/multiselect and URL; `PublicCfp.tsx` field render.

**Win risk:** **High** — public CFP is the most visible brief surface.

---

### 8. Public-facing technical copy leaks

**What exists:** Branded public CFP path with Lumen defaults when design unpublished.

**Why too thin:** Operator-facing strings leak to submitters (e.g. “no published brand (Lumen defaults)”, raw file IDs, `?draft=` mechanics surfaced in copy/UI). Captured public CFP visuals show this. Undermines Apple-level / production-hard first impression without adding product scope.

**Win risk:** **Medium** — subjective polish and trust for independent evaluation.

---

### 9. Scoped agent surface does not cover the core program loop

**What exists:** CLI + scoped keys for readiness, design get/set/publish, schedule place, files, speaker profile, comms draft/send, keys, OpenAPI — enough for constitution S-CLI.

**Why too thin:** No CLI verbs for forms, submission triage, evaluator assignment, scoring admin, or decisions. Some HTTP paths remain session-oriented. Programme agentic-first intent is broader than the shipped command set.

**Win risk:** **Medium** — differentiation for Software 3.0-style operation; below human-loop breaks.

---

## Explicitly out of scope (do not fatten for competition)

| Topic | Why |
|-------|-----|
| Cross-event history / lasting CRM profiles | Non-goal; correct omission |
| AI multi-round review | Struck |
| Accelevents, portal wiki/embeds, embeddable gallery | Struck |
| Full CRM / marketing / CMS / media | Non-goal |
| OR-Tools auto-scheduler | Non-goal |
| In-product agent fleet / MCP product UI | Non-goal |
| Hosted public agenda page | Optional polish; not a judged MUST (v1 drop) |
| CSV / Sessionize program import | Adoption accelerator; not workflows 1–6 MUST (v1 drop) |

---

## What is already strong (keep; do not thrash)

Public CFP **mechanics** align with the competition CFP workflow: conditional fields, category routing, immutable published versions, multi-speaker, draft/resume, open/close windows and limits, CAPTCHA, uploads, inline errors, retry without data loss, mobile layout, confirmation. Single-decision accept path, schedule studio conflicts, readiness poll, design kit, inventory E2E, and onboarding docs are real strengths. Thinness is concentrated in **reviewer read/deliberate**, **cohort ops**, **form fidelity**, and **post-accept handoff** — not in “missing a form builder concept.”

---

## Priority for fattening (merged)

| Order | Area | Class | Source |
|------:|------|--------|--------|
| 1 | Full proposal (answers, speakers, abstract) beside evaluator rubric | **Critical** | UX feedback |
| 2 | Accept → auth/portal handoff + ICS attached on real send | **Critical** | v1 synthesis |
| 3 | Form builder reloadable (admin get/list + restore state) | **High** | UX feedback |
| 4 | Multi-select + URL/file field consistency | **High** | UX feedback |
| 5 | Individual review visibility + discussion policy (keep assigned queue if desired) | **High** | UX feedback |
| 6 | Bulk decision **commit** after preview | **High** | v1 synthesis |
| 7 | Search, next-unreviewed, filters + evaluator picker / batch assign | **High** | UX + v1 assignment |
| 8 | Strip technical copy from public CFP | **Medium** | UX feedback |
| 9 | CLI/key coverage of core program verbs | **Medium** | v1 synthesis |
| — | Optional: digest/mention notifications via existing comms | **Optional** | UX feedback |

---

## Coverage matrix (v1 report vs UX feedback)

| Finding | In v1 thin-areas? | In this v2? |
|---------|-------------------|-------------|
| Proposal not shown to evaluator | No (under-called scoring) | **Yes — #1** |
| Peer/admin review visibility & discussion | No | **Yes — #3** |
| Scale traverse (search / next-unreviewed) | No | **Yes — #5** |
| Assignment raw user id | Yes (#3) | **Yes — #5** |
| Cross-event history | N/A (OOS) | **OOS** |
| Form builder not reloadable | No | **Yes — #6** |
| Multi-select / URL-file bugs | No | **Yes — #7** |
| Public technical copy leaks | No | **Yes — #8** |
| Accept handoff + ICS attach | Yes (#1) | **Yes — #2** |
| Bulk decision commit | Yes (#2) | **Yes — #4** |
| CLI program loop | Yes (#4) | **Yes — #9** |

---

## Review trail

| Artifact | Role |
|----------|------|
| `docs/audits/COMPETITION_THIN_AREAS_DRAFT.md` | Initial Grok analysis (7 ops candidates) |
| `docs/audits/COMPETITION_THIN_AREAS_CODEX_REVIEW.md` | Codex **REVISE** → 4 items |
| `docs/audits/COMPETITION_THIN_AREAS_CODEX_COSIGN.md` | Codex **AGREE** on v1 final |
| External UX review (proposal panel, deliberation, form fidelity, scale UX) | Folded 2026-08-10 |
| **This file (v2)** | Merged synthesis for competition fattening |

No product code was changed in producing this document.
