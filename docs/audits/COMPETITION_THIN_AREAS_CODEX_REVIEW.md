# Competition thin areas — Codex review

**Date:** 2026-08-10

**Reviewer:** Independent Codex review

**Verdict:** **REVISE**

## Basis and standard

This review uses only `docs/COMPETITION.md`, `docs/governance/0.1-programme-contract.md`, `KMS-competition/initiative/00_CONSTITUTION.md`, the draft, and spot-checks of the shipped product code. A retained thin area must plausibly damage independent evaluation of the defined program loop or the practical “would we use or buy this?” judgment at a 100–150-speaker event. Passing a narrow soul test is relevant but not conclusive; conversely, an optional adjacent capability is not a competition thin area merely because the code does not contain it.

The draft identifies genuine operational friction, but it overstates evaluation weakness, treats two non-required extensions as competition gaps, and splits one speaker-lifecycle break into two items. The final list should contain four areas, not seven. No new area is added; the acceptance/portal finding below is a code-grounded rewrite of draft item 7 and the calendar finding is a rewrite of item 3.

## Item-by-item disposition

| Draft item | Disposition | Reason |
|---|---|---|
| **1. Bulk program decisions stop at preview** | **KEEP, with tighter wording** | The claim is accurate. The only bulk route is explicitly preview-only (`apps/api/src/modules/decisions/routes.ts`), and the UI has no commit action after preview (`apps/web/src/pages/Submissions.tsx`). Single-decision execution is unusually robust, but requiring chairs to reopen and decide every submission is a serious cohort-scale break in the accept/reject workflow. |
| **2. Evaluation workflow tooling is assignment-minimal** | **REWRITE** | “Assignment-minimal” is fair; the wider claim is not. The product already has rubric configuration, evaluator-owned queues, comments, aggregate scoring, sortable CSV export, per-submission coverage, and an overall completion bar (`apps/web/src/pages/AdminEvaluations.tsx`). Retain only the assignment bottleneck: an admin opens one submission and types an evaluator user ID, with no evaluator directory/picker, cross-submission batch assignment, or workload view (`apps/web/src/pages/Submissions.tsx`). |
| **3. Communications are template-send, not program-lifecycle automation** | **REWRITE AND MERGE WITH 7** | The campaign system itself is not thin: it has segmented audiences, rendered-recipient preview, idempotent outbox send, and delivery evidence. State-driven automation is not stated strongly enough in the allowed intent documents to justify a broad automation requirement. The code does expose a narrower and more serious gap: calendar creation is a manual fixture-style form, and the email consumer sends subject/body without attaching the stored ICS (`apps/web/src/pages/Comms.tsx`; `apps/api/src/workers/emailConsumer.ts`). |
| **4. No first-class published public agenda surface** | **DROP** | Product reality is correctly described: the SPA exposes a public CFP but no public agenda, while schedule reads are admin/API-key protected (`apps/web/src/App.tsx`; `apps/api/src/modules/schedule/routes.ts`). However, the allowed intent defines Schedule Studio as the judged workflow and names public CFP—not public schedule—as the public product surface. A hosted agenda could be valuable later, but there is insufficient authority to rank it as a competition-winning defect. |
| **5. No cohort import path for standing up a real event graph** | **DROP** | The code has no event/program CSV import path; the absence is real. Import is nevertheless absent from the six judged workflows, platform MUSTs, and soul tests. It is an adoption accelerator, not a demonstrated failure of the competition program loop, and retaining it would let optional migration scope displace defects in the required flow. |
| **6. CLI covers a slice of agentic admin, not the full program loop** | **REWRITE AND KEEP, LOWER PRIORITY** | The draft under-credits a complete S-CLI implementation: readiness JSON, design get/set/publish, scoped schedule placement, file/profile operations, comms preview/send, key creation, and OpenAPI are present (`packages/cli/src/main.ts`). But the ratified north star also calls the product agentic-first and describes the CLI as operating the same domain commands as the web. There are no CLI verbs for forms, submissions, evaluator assignment/scoring, or decisions; moreover, evaluator assignment is session-only rather than API-key enabled (`apps/api/src/modules/eval/routes.ts`), so an agent cannot simply use the documented API to close that gap. |
| **7. Decision → speaker handoff messaging is operator-manual** | **REWRITE AND MERGE WITH 3** | The issue is more fundamental than a missing notification button. Accept creates an event participation with `userId: null` and does not create a user, speaker membership, or invitation (`apps/api/src/modules/decisions/commands.ts`). In the production-default controlled auth policy, an unknown email receives a silent success response but no magic link, and comms merge data contains no portal-entry field (`apps/api/src/modules/auth/commands.ts`; `apps/api/src/modules/comms/commands.ts`). This can break the required accept → portal transition for a real CFP entrant, so it belongs at the top of the final list. |

## Proposed final ordered list

### 1. Accepted-speaker handoff and calendar delivery are not closed-loop

The required program loop moves directly from human acceptance to a speaker using the portal, completing tasks, receiving communications, and getting a working calendar invite. The accept command creates the session, participation, and tasks, but leaves the participation unbound to an auth user and does not provision membership or issue an invitation; production-controlled magic-link behavior does not create an arbitrary accepted speaker on demand. The campaign sender also has no portal-entry merge field, while the ICS panel asks an operator to retype placement data and the outbox consumer does not attach the generated ICS to its email. Seeded or allowlisted proof can therefore pass while a real CFP entrant cannot complete the same journey, which is a direct independent-evaluation and adoption risk.

### 2. Bulk decision preview has no matching execution path

The UI lets an admin select many submissions and inspect an exact accept/reject/waitlist preview, but the workflow ends there. Applying the result still requires one detail view and one decision request per submission. This is especially damaging because the single-item decision command already has the hard parts—optimistic concurrency, audit, idempotency, session materialization, and task creation—so the missing cohort operation is conspicuous rather than an architectural limitation. A production program chair deciding a large CFP would encounter this bottleneck immediately.

### 3. Evaluator assignment is not cohort-operable

The scoring side is competition-quality: rubric editing, private evaluator queues, comments, weighted aggregates, coverage state, sorting, and export are already present and should not be called thin. The weak point is setup: an admin must open a submission and type raw user IDs, even though the API can accept several evaluator IDs for that one submission. There is no visible evaluator roster, workload distribution, or batch assignment across a selection of submissions. For a committee reviewing a large CFP, creating the work queue is therefore the dominant manual operation and can undermine the otherwise strong evaluation story.

### 4. The scoped agent surface does not cover the core program loop

The existing CLI satisfies the constitution’s explicit S-CLI scenario and should be presented as a strength. It does not yet match the broader agentic-first promise in the programme contract: forms, submission triage, evaluator assignment, scoring administration, and decision recording are absent from CLI dispatch. Some corresponding HTTP commands accept scoped keys, but evaluation assignment and form operations remain human-session-only, so OpenAPI discovery is not a functional substitute. This ranks below the human workflow breaks above, but it matters to the product’s stated differentiation and to buyers expecting unattended program operations rather than a curated CLI demonstration.

## Not retained for lack of competition authority

- **Hosted public agenda:** useful adjacent product work, but not one of the defined judged or public surfaces in the allowed intent documents.
- **CSV or vendor-shaped program import:** useful migration work, but not part of workflows 1–6, the platform MUSTs, or any soul test.

## Refused as out of scope

I would not add AI-assisted multi-round review, an automatic optimization scheduler, a CRM/marketing/CMS/media suite, ticketing or travel operations, portal wiki/embeds, an embeddable gallery, an in-product agent fleet/control plane, bidirectional Airtable sync, or a second system of record. None is needed to close the four retained competition risks, and several are explicit non-goals.
