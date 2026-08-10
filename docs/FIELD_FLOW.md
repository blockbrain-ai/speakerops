# Field flow (forms & portal)

> **Soul:** **S-DOCS** · **Owner prose:** section **9.4** · **IA:** [9.1](./sections/9.1-docs-ia.md)  
> **Highlight:** initiative **I16** (forms → submission → portal tasks)  
> **Contracts:** [SCHEMA](../KMS-competition/initiative/contracts/SCHEMA.md) · [COMMANDS](../KMS-competition/initiative/contracts/COMMANDS.md)

## Purpose

Operator-facing highlights of how **form builder fields** flow into public CFP submissions, evaluation, accept/reject decisions, and speaker portal tasks — including file uploads (R2) and status surfaces. Complements deep architecture without replacing schema contracts.

Must remain owned (0.5): this file is not a stub after section **9.4**.

---

## 1. End-to-end sketch

```text
Form builder (admin)  Form.Create / Form.UpdateDraftFields
        │
        ▼
   Form.Publish  →  form_versions + fields/rules pinned
        │
        ▼
Public CFP  Form.GetPublic + Submission.Create (+ Turnstile)
        │  answers stored against form_version
        ▼
Evaluation  Eval.Score / assignments
        │
        ▼
Decision.Record  accept | reject | waitlist  (+ audit)
        │  accept → people/participations + speaker_tasks
        ▼
Portal  Portal.GetHome · Task.Complete · File.* (R2)
        │
        ▼
Readiness / schedule consumers  Reports.Readiness · Schedule.*
        │
        ▼ (async)
Outbox → comms / Airtable projection (one-way)
```

---

## 2. Domain identity along the path

| Stage | Identity | Table(s) |
|-------|----------|----------|
| Draft form | Event-scoped form | `forms`, `form_fields`, `form_rules` |
| Published form | Immutable version snapshot | `form_versions` (+ field snapshot) |
| Submitter answers | Submission under version | `submissions`, `submission_answers`, `submission_speakers` |
| Durable person | Email/name identity | `people` |
| Event speaker | Participation | `event_participations` (Person ≠ Speaker) |
| Portal work | Tasks | `speaker_tasks` (+ templates) |
| Files | Metadata + bytes | `file_assets` + R2 `FILES` when configured (hosted demo: D1 `file_blobs`) |
| Program slot | Session (post-accept / direct) | sessions + `session_speakers` |

**Person ≠ Speaker:** accepting a submission links or creates a **participation** for a **person**; it does not create a parallel person row per event. See [0.4 domain map](./governance/0.4-domain-map.md).

**Submission ≠ Session:** applications are not automatically program slots; accept/decision side-effects bridge them under commands.

---

## 3. Form fields → answers (I16 core)

| Concern | Behavior |
|---------|----------|
| Field definitions | Admin form builder (types, required, conditional rules) |
| Publish | Version pin — public CFP reads **published** version only |
| Submit | `submission_answers` store values keyed to field ids on that version |
| Old submissions | Keep historical answers even if draft form later changes |
| Multi-speaker | `submission_speakers` rows; later map to participations on accept |
| Validation | Zod on Worker; 400 `VALIDATION_ERROR` on bad payloads |
| XSS | Stored as text; render as text — proof **A10** |

Commands: `Form.*`, `Submission.Create`, `Submission.List/Get`.

---

## 4. Evaluation → decision

| Step | Command | Effect |
|------|---------|--------|
| Rubric | `Eval.UpsertRubric` | Criteria for event/round |
| Assign | `Submission.AssignEvaluators` | Assignments table |
| Score | `Eval.Score` | Scores + comments; evaluator role |
| Decide | `Decision.Record` | accept/reject/waitlist; **audit**; scope `decisions:write` for keys |

Human authority is required (AI multi-round review is **struck** — [COMPETITION.md](./COMPETITION.md)).

On **accept**, expected side-effects (implementation detail in 3.5/4.1):

- Ensure `people` / `event_participations`  
- Materialize **speaker tasks** from templates  
- Enqueue projection/outbox topics as designed  
- Never skip audit / correlation  

---

## 5. Portal tasks & files

| Surface | Flow |
|---------|------|
| Home | `Portal.GetHome` — tasks, status, session context for speaker role |
| Profile | `Participation.UpdateProfile` — bio, etc. on participation |
| Upload | `File.PresignUpload` → client put → `File.CompleteUpload` |
| Storage | Bytes in **R2** when configured; the hosted demo stores bytes as durable D1 `file_blobs` rows (no R2 binding). D1 `file_assets` holds metadata either way |
| Constraints | Mime/size checks; logo SVG reject (**C09**); private by default |
| Complete | `Task.Complete` — marks task done; readiness consumers update |

Admin speakers list is over **participations** joined to people — not a free-form speaker table.

---

## 6. Downstream consumers

| Consumer | Reads | Notes |
|----------|-------|-------|
| Readiness dashboard | Tasks outstanding / overdue / blocked | S-READY |
| Schedule studio | Sessions / speakers / rooms | Conflicts server-side |
| Comms templates | Merge fields from person/participation/session | Preview before send |
| Airtable projection | Snapshot fields + `internal_id` | One-way only |
| Public brand | Design tokens published | S-THEME |

Field names for merge/projection must stay aligned with SCHEMA — do not invent columns without contract update.

---

## 7. I16 highlight table (operator)

| Field / concept | Source UI | Command | Storage | Consumers | Proof |
|-----------------|-----------|---------|---------|-----------|-------|
| Form field def | Form builder | `Form.UpdateDraftFields` | `form_fields` | Publish · public CFP | D* inventory |
| Published version | Publish | `Form.Publish` | `form_versions` | Public get · pin on submit | 3.6 keystone |
| Answer value | Public CFP | `Submission.Create` | `submission_answers` | Eval · decision | A* |
| Person email/name | Submit / admin | create/link | `people` | Portal · comms · projection | domain tests |
| Participation bio | Portal | `Participation.UpdateProfile` | `event_participations` | Readiness · schedule | G* |
| Task status | Portal | `Task.Complete` | `speaker_tasks` | Readiness | G* · H* |
| File object | Portal upload | `File.*` | R2 (or D1 `file_blobs` on the hosted demo) + `file_assets` | Portal · admin | 4.2 |
| Decision outcome | Submissions admin | `Decision.Record` | `decisions` + side-effects | Tasks · audit | E* |
| Projection id | System | outbox drain | `projection_records.internal_id` | Airtable | O06 · 7.3 |

---

## 8. Authz along the path

| Step | Who |
|------|-----|
| Build / publish form | Event **admin** |
| Public submit | **public** + Turnstile |
| Score | **evaluator** (assigned) |
| Decide | **admin** (+ `decisions:write` for keys) |
| Portal tasks | **speaker** (own participation) |
| Readiness / schedule write | **admin** (+ scopes for keys) |

Server enforces; UI hiding is not security ([SECURITY.md](./SECURITY.md)).

---

## 9. Failure modes on this path

| Failure | Status / behavior |
|---------|-------------------|
| Unauthenticated admin/portal | **401** |
| Evaluator scores unassigned | **403** |
| Invalid answer shape | **400** `VALIDATION_ERROR` |
| Stale form version race | Publish/pin rules; validation |
| Accept without tasks | Treat as defect if templates expected |
| Upload SVG logo | Reject (not stored as executable) |
| Airtable down | Product still 200; outbox lags |

---

## 10. Performance notes

- Public CFP: avoid multi-second blank screen; skeleton allowed.  
- Admin submissions list: p95 &lt; 200ms local warm load for seed ≤150 rows.  
- Portal home: D1 reads for tasks + metadata; file bytes via R2 when configured (the hosted demo serves bytes from D1 `file_blobs` because R2 is not bound).

---

## 11. Section notes (implementation)

- Form builder API/UI: [3.1](./sections/3.1-form-builder-api.md) · [3.2](./sections/3.2-form-builder-ui.md)  
- Public CFP: [3.3](./sections/3.3-public-cfp.md)  
- Evaluation / decisions: [3.4](./sections/3.4-evaluation.md) · [3.5](./sections/3.5-decisions.md)  
- Portal + R2: [4.1](./sections/4.1-portal-api.md) · [4.2](./sections/4.2-r2-uploads.md) · [4.3](./sections/4.3-portal-ui.md)  
- Readiness / schedule: [6.1](./sections/6.1-schedule-conflicts.md) · [6.3](./sections/6.3-readiness-dashboard.md)  
- Airtable slice: [AIRTABLE.md](./AIRTABLE.md) · [7.3](./sections/7.3-airtable-projection.md)  

## Related contracts & docs

| Topic | Doc |
|-------|-----|
| Architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| E2E journeys | [E2E.md](./E2E.md) · inventory A*/D*/E*/F*/G* |
| Human demo path | [ONBOARDING.md](./ONBOARDING.md) |
| Troubleshooting | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| Design tokens | [0.2 Lumen lock](./governance/0.2-lumen-lock.md) |
| Competition mapping | [COMPETITION.md](./COMPETITION.md) |
