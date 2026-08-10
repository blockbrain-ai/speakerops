# Competition thin areas — draft analysis

**Status:** DRAFT for Codex review (not final)  
**Date:** 2026-08-10  
**Authority inputs (only):**
- Official competition brief (Word): primary feature bullets, open-source + deployed site submission rules, AIE-team evaluation, subjective “would we use/buy” tiebreaker
- Programme contract / constitution / `docs/COMPETITION.md` / synthesis production bars for brief workflows **1–6** + platform MUST
- Explicit **non-goals / struck** items are **out of this list** (absence is not thinness)

**Method:** Judge “too thin to win” as risk that an AIE evaluator walking the brief’s program loop at **cohort scale** (~100–150 speakers, real CFP volume) would conclude the product is not yet something they would run a multi-day event on — even if soul tests and dogfood gates pass.

**Out of scope for this document:** incumbent product comparisons; third-party commentary; struck surfaces (CRM/marketing/CMS/media, Accelevents, portal wiki/embeds, embeddable gallery, AI multi-round review, agent-fleet UI, OR-Tools, etc.).

---

## Thin areas (draft)

### 1. Bulk program decisions stop at preview

**What exists:** Admin can select submissions and run **bulk preview** for accept / reject / waitlist. Single-submission `Decision.Record` is production-grade (audit, accept side-effects, tasks).

**Why too thin:** The brief’s production bar is operating a real multi-day conference cohort, not one-off decisions. Program selection at AIE scale requires applying the same decision to many submissions after a trust-before-write preview. Preview without a matching **bulk commit** leaves the highest-volume admin action incomplete. Subjective “would we use this for the next event” is weakened when chairs must click accept/reject hundreds of times.

**Brief / contract link:** Brief evaluation + accept path; synthesis “bulk admin actions with exact preview”; cohort-scale production bar on workflows 1–6.

---

### 2. Evaluation workflow tooling is assignment-minimal

**What exists:** Rubric, assign evaluators, evaluator score queue, per-assignment comments, admin score rollup/export, human-only final decision (AI multi-round correctly out).

**Why too thin:** Brief asks for **evaluation and scoring workflows**, not only a score form. For a high-volume CFP, operators need more than one-by-one assignment: e.g. required reviews per submission, workload caps, incomplete-reviewer chase, clearer multi-evaluator completion state before decide. Schema allows rounds; product surface is effectively single active round with manual assign. A judge simulating a full program committee pass may find the workflow correct but not operable at volume.

**Brief / contract link:** Brief feature “Submission evaluation and scoring workflows”; synthesis production bar for workflow #2 / #4 (assignments, rubric, rollup, accept/reject); S-EVAL completeness is necessary but may not be sufficient for “buy” judgment.

---

### 3. Communications are template-send, not program-lifecycle automation

**What exists:** Templates, merge fields, audience preview, idempotent send, delivery log, ICS generation with stable UID/SEQUENCE for placed sessions; readiness entry point for chasing tasks.

**Why too thin:** The brief primary bullet calls for **automated**, templated speaker communications including **reminders** and **calendar invites delivered to each speaker’s calendar**. The product proves the primitives (compose → preview → send; ICS artifacts) but is thin on **state-driven automation**: decision-time accept/reject messaging, overdue-task reminder batches wired from readiness, and a dogfood-visible path that clearly lands invites on Gmail/Outlook/iCal for a speaker. Judges can still complete a manual send demo; “automated communications” as stated in the brief can still feel unfinished.

**Brief / contract link:** Brief primary communications bullet; S-COMMS (preview/send + ICS); synthesis production bar for comms + calendar.

---

### 4. No first-class published public agenda surface

**What exists:** Full admin Schedule Studio (views, drag-drop, conflicts, undo). ICS via comms for speakers. No public, unauthenticated agenda/itinerary page for the event program.

**Why too thin:** After accept + place, organizers still need a simple way to **show the program** to the world (or to staff without admin chrome). Embeddable website widgets and gallery are **struck** and must not be built. A minimal **hosted public schedule page** (read-only, mobile-clean) is not struck and is listed as synthesis SHOULD polish. Without it, the schedule loop ends inside admin tools; the “agenda is real and publishable” story for independent evaluators is weaker.

**Brief / contract link:** Brief schedule/agenda building; synthesis SHOULD “hosted public schedule page”; non-goal remains embeds/gallery only.

---

### 5. No cohort import path for standing up a real event graph

**What exists:** Seed script for demo graph (~150 speakers); form/public CFP intake; CLI partial admin. No Sessionize-shaped / CSV program import into people, submissions, or sessions.

**Why too thin:** Submission rules and AIE evaluation reward something they would **actually use**. Replacing a paid program tool for an upcoming event implies loading historical or in-flight program data without re-typing. Demo seed proves the UI under load; it does not prove migration. This is not a soul-test failure, but it is a material adoption gap under the “would we use/buy” tiebreaker.

**Brief / contract link:** Open-source replacement intent; synthesis SHOULD “CSV / Sessionize-shaped import”; cohort production bar.

---

### 6. CLI covers a slice of agentic admin, not the full program loop

**What exists:** Scoped API keys; CLI for events list, readiness report, design get/set/publish, schedule place, file upload, speaker profile update, comms draft/send, keys create, OpenAPI — same command layer as HTTP for those verbs.

**Why too thin:** Programme intent treats **CLI + scoped keys** as a first-class Software 3.0 surface over domain commands (not browser-only). The shipped CLI omits high-frequency program verbs judges/agents need for unattended ops: submissions list/filter, assign evaluators, record decisions, list/readiness-adjacent speaker tasks, form publish metadata. Soul S-CLI can pass with readiness + design + schedule scope deny; the **owner MUST** CLI surface described in programme synthesis is still thin. For a customer that lives in agents, that gap is competitive.

**Brief / contract link:** Programme contract agentic admin; synthesis CLI MUST table; S-CLI (minimum bar met; full intent not).

---

### 7. Decision → speaker handoff messaging is operator-manual

**What exists:** Accept materializes person/participation, session, and speaker tasks; portal magic-link path; comms can message accepted speakers if an operator composes a send.

**Why too thin:** The critical handoff in the brief loop is “you are accepted → here is your portal/tasks/calendar path.” Without a first-class **decision notification** path (template + preview + send, or gated auto-send on accept/reject/waitlist), operators must remember a separate comms step. At cohort scale that is error-prone; evaluators may see accept work in data but not in speaker-facing closure.

**Brief / contract link:** Brief portal + automated communications; synthesis demo path score → accept → portal → reminder; S-PORTAL + S-COMMS joint story.

---

## Explicitly not listed (so reviewers do not re-open scope)

| Topic | Why not a thin-area for this competition |
|-------|------------------------------------------|
| AI multi-round review | Struck in brief / programme |
| Accelevents / portal wiki / embeddable gallery | Struck |
| Full CRM / marketing / CMS / media | Non-goals |
| OR-Tools auto-scheduler | Non-goal; human schedule + conflicts required |
| In-product agent fleet / MCP product UI | Non-goal; CLI/keys are the agent surface |
| Blind academic review variants | Not required by brief production bars |

---

## Draft confidence

| # | Thin area | Confidence it hurts win | Effort class (informational) |
|---|-----------|-------------------------|------------------------------|
| 1 | Bulk decision commit | High | Medium |
| 2 | Eval workflow volume tooling | Medium–High | Medium–Large |
| 3 | Lifecycle automation for comms/ICS | High | Medium |
| 4 | Public schedule page | Medium | Small–Medium |
| 5 | CSV/Sessionize import | Medium | Medium |
| 6 | CLI program-loop coverage | Medium–High | Medium |
| 7 | Decision notification handoff | High | Small–Medium |

---

## Reviewer charge (Codex)

1. Challenge any item that is already thick enough for brief + souls (recommend drop).  
2. Challenge any item that reintroduces struck/non-goal scope (recommend drop or rewrite).  
3. Add at most **two** missing thin areas only if grounded in brief/programme intent and observable product gaps.  
4. Merge duplicates.  
5. Output **AGREE**, **AGREE_WITH_NOTES**, or **REVISE** with a proposed final ordered list.
