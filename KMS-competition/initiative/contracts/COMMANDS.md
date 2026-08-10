# SpeakerOps domain command registry (planning contract)

All writes go through named commands. HTTP and CLI map 1:1.  
Auth: session cookie **or** API key with scopes.

## Auth & session
| Command | Scope/role | Input | Output |
|---------|------------|-------|--------|
| `Auth.RequestMagicLink` | public/admin bootstrap | email, purpose, eventId? | { sent: true } |
| `Auth.ExchangeMagicLink` | public | token | Set-Cookie session |
| `Auth.Logout` | any authed | — | cleared cookie |
| `Auth.CreateInvite` | admin | email, role, eventId | { inviteId } |
| `Auth.JudgeAccess` | shared demo only (`ROLE_SWITCHER_ENABLED=1` + `JUDGE_ACCESS_CODE` secret) | code, role (admin\|evaluator\|speaker) | { ok, role, email, eventId, redirectTo } + Set-Cookie 4h session for seeded demo persona on the demo event — constant-time code compare, generic 401, rate-limited, audit `Auth.JudgeAccess`; demo sessions denied `Keys.Create` |
| `Auth.DevRoleSwitch` | dogfood/dev only (`ROLE_SWITCHER_ENABLED=1` / local e2e) | role (admin\|evaluator\|speaker), eventId? | { ok, role, email, eventId, redirectTo } + Set-Cookie session for seeded demo user — **never** registered on public production default; controlled Worker requires existing **admin** session (401 if unauthenticated, 403 if non-admin) |

## Events & settings
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Event.Create` | admin / events:write | name, timezone, dates | event |
| `Event.Get` | admin / events:read | eventId | event |
| `Event.Update` | admin / events:write | eventId, patch, expectedVersion | event (settings_json carries notification keys + Wave-2 agenda keys `agendaDayStart`/`agendaDayEnd` HH:MM + `slotIntervalMin` 15\|30\|60, merged passthrough) |
| `Event.List` | admin / events:read | — | events[] |
| `Room.List` / `Room.Get` | admin | eventId [, roomId] | rooms[] / room |
| `Room.Upsert` / `Track.Upsert` | admin | eventId, … | entity |
| `Track.List` / `Track.Get` | admin | eventId [, trackId] | tracks[] / track |
| `Design.Get` | design:read | eventId | { draft, published } |
| `Design.SetDraft` | design:write | eventId, tokens, expectedVersion | draft |
| `Design.Publish` | design:write | eventId, expectedVersion | published (contrast validated) |

## CFP
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Form.Create` | cfp:write | eventId, name | form |
| `Form.UpdateDraftFields` | cfp:write | formId, fields[] (nodeKind input\|layout + layoutType section\|divider), rules[], submissionLimit?, perSubmitterLimit?, minSpeakers?, maxSpeakers? | formVersion draft |
| `Form.Publish` | cfp:write | formId | formVersion immutable |
| `Form.GetPublic` | public | eventSlug / form slug | published form + tokens |
| `Submission.Create` | public | formVersionId, answers, speakers[] (Wave 2: optional per-speaker `bio` ≤8000, `company` ≤200, `title` ≤200 — stored trimmed-or-NULL on submission_speakers), turnstile | submission (enforces submissionLimit + perSubmitterLimit — the per-submitter cap is scoped to the logical FORM (all published versions of the pinned version's form_id, matching the “this form” copy) and race-safe: a unique guard row `per-submitter:<formId>:<normalizedEmail>:<n>` in idempotency_keys is claimed atomically WITH the submission insert, so concurrent submits admit at most the cap; file-typed field answers MUST be `file:<id>` tokens referencing an upload for this event and `file:` tokens on non-file fields are rejected; enqueues `Comms.SubmissionConfirmation`; on accept the seed fields fill only EMPTY participation profile fields, never overwriting) |
| `Submission.SaveDraft` | public | formVersionId, title (required), answers?, speakers?, draftId? | submission status=draft + form-field snapshot |
| `Submission.GetDraft` | public | eventSlug, draftId | draft submission + snapshot (event-scoped; non-draft → 404) |
| `Cfp.FileUpload` | public | eventSlug, formVersionId (required pin to the published version being filled), fieldKey? (must be a file field when named), filename, mime, size, contentBase64 | { fileId, mime, size, filename } — supporting file for public CFP; mime/size allowlist enforced; 400 unless the pinned version is published for this event AND collects files (≥1 file-typed field, or the named fieldKey is one) — no anonymous D1 blob writes for forms without file fields |
| `Submission.List` | submissions:read | eventId, filters | page |
| `Submission.ExportCsv` | admin / submissions:read | eventId, status?, category?, q? | text/csv attachment — stable headers (base + answer field_keys sorted), speakers flattened `Name <email>; …`, layout nodes excluded, cells formula-neutralized (Wave 2) |
| `Submission.Get` | submissions:read | submissionId | detail |
| `Submission.AssignEvaluators` | admin | submissionId, userIds[] | assignments |
| `Submission.BulkPreview` | admin / decisions:write | eventId, submissionIds[], decision | preview items (no writes) |

## Evaluation & decisions
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Eval.UpsertRubric` | admin | roundId, criteria[], closesAt?, instructionsMd?, hideSpeakers? | rubric (deadline + evaluator guidance + speaker-identity hiding; post-11.9 depth) |
| `Eval.Score` | evaluator | assignmentId, scores[], comment | assignment (409 after round close) |
| `Eval.Abstain` | evaluator (owner-verified) | assignmentId, reason? | assignment status=abstained (excluded from aggregates; 409 after round close / repeat) |
| `Eval.ExportScores` | admin | eventId, sort? | CSV (scores/status/abstained counts) |
| `Eval.BulkAssign` | admin / submissions:write | roundId, evaluatorIds[], submissionFilter{status?,category?}, mode (all_to_all\|round_robin), reviewersPerSubmission?, maxPerEvaluator?, existing (preserve\|replace), dryRun, previewId? | plan (preview → `previewId` hashed over the FULL estate: round updated_at + matched submissions (id+status — eligibility binds even without a status filter) + evaluator membership rows + every existing round assignment {assignmentId, submissionId, evaluatorId, status, updatedAt} + knobs) / applied plan (commit requires previewId; recomputed at commit — ANY drift → 409; post-commit re-preview mints a NEW token; commit is ONE atomic store batch: removals + additions + audit + single-use idempotency claim `eval.bulk-assign:<previewId>` — concurrent duplicate commits apply exactly once; scored/abstained never removed) (Wave 2) |
| `Decision.Record` | decisions:write | submissionId, decision, reason | decision (+ side effects on accept; dematerialize on leave-accept) |
| `Session.CreateDirect` | admin / decisions:write | eventId, title, description?, trackId?, speakers[] | session + participations + on_accept tasks |

## Portal & files
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Portal.SessionIcs` | speaker session (own participation → session link verified) | sessionId (path), eventId | text/calendar attachment; stored UID/SEQUENCE continuity; 404 non-owned/unknown/unscheduled (no probing); read-only |
| `Portal.GetHome` | speaker | eventId | tasks, sessions |
| `Participation.UpdateProfile` | speaker | participationId, bio, …, expectedVersion | participation |
| `File.PresignUpload` | files:write / speaker / admin | eventId, purpose, mime, size (≤10 MiB), filename?, **ownerParticipationId** (required when purpose is `headshot` or `slides`; ignored/null for `logo`) | { url, fileId, mime, purpose, expiresAt } |
| `File.Upload` | files:write / admin (session) | fileId, eventId (query), raw body (PNG for logo; jpeg/png headshot; pdf slides) | { fileId, uploaded: true, size } — Worker-hosted body transfer for the presign `url` (dogfood/local; production may use R2 signed PUT then CompleteUpload). Enforces declared size, 10 MiB max, `expiresAt` (presign TTL from `created_at`), single-use (reject if already `uploaded`) |
| `File.CompleteUpload` | files:write / speaker | fileId, checksum | file_asset (portal/checksum path; sets checksum; may also mark ready) |
| `File.GetPublic` | public | fileId | image bytes — only when `purpose=logo`, `uploaded=1`, and `logoFileId` is on the event's **published** design tokens (draft-only logos stay private) |
| `Task.Complete` | speaker | taskId, expectedVersion | task |
| `Speakers.List` | admin | eventId, q?, status? | event-scoped speakers[] |
| `Speakers.Get` | admin | eventId, participationId | detail: tasks + files meta |
| `TaskTemplate.List` | admin | eventId | templates[] |
| `TaskTemplate.Create` | admin | eventId, title, description?, trigger, dueOffsetDays, linkUrl? (https only ≤2000), required? | template |
| `TaskTemplate.Update` | admin | eventId, templateId, patch (title?, description?, trigger?, dueOffsetDays?, linkUrl? https-only \| null clears, required?), **expectedVersion** (required; E1 optimistic concurrency) | template \| 409 on version conflict |
| `Speakers.CompleteTask` | admin / speakers:write | eventId, participationId, taskId, **expectedVersion** | task — audited complete-on-behalf; idempotent 200 on already-completed; cancelled 400; cross-event/participation 404; 409 on version conflict (Wave 2) |
| `TaskTemplate.Delete` | admin | eventId, templateId, **expectedVersion** (required; E1 optimistic concurrency) | { deleted: true, id } \| 409 on version conflict |

## Schedule
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Schedule.List` | schedule:read | eventId, view | placements + unscheduled |
| `Schedule.Place` | schedule:write | sessionId, roomId, startsAt, endsAt, expectedVersion | placement \| 409 conflicts (incl. Wave-2 agenda day-window: conflicts[] type `hours` when outside settings_json `agendaDayStart`–`agendaDayEnd` wall time) |
| `Schedule.Move` | schedule:write | placementId, …, expectedVersion | placement \| 409 (incl. agenda day-window `hours` conflicts, Wave 2) |
| `Schedule.Unschedule` | schedule:write | placementId, expectedVersion | ok |

## Comms
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Comms.UpsertTemplate` | admin | eventId, key, subject, body | template |
| `Comms.ListTemplates` | admin | eventId | templates[] |
| `Comms.Preview` | comms:draft | templateId, segment (status? \| participationIds? \| Wave-2 `submissionIds`? — decision hand-off audience: primary speakers of the exact decision result set, participationId NULL when none) | { recipients[], bodies[], missingFields[] } |
| `Comms.Send` | comms:send | previewId / draftId, idempotencyKey | job |
| `Comms.ListJobs` | admin | eventId | jobs[] (delivery log) |
| `Comms.GetJob` | admin | eventId, jobId | job + recipients + delivery_events |
| `Comms.ListIcs` | admin | eventId | calendar_invites[] |
| `Comms.IcsForPlacement` | system/admin | placementId (+ fixture fields) | calendar_invite row |
| `Comms.SubmissionConfirmation` | system (after `Submission.Create`) | event, submission, primary speaker | message_job (queued) + direct-email recipient (participation_id NULL) + outbox + idempotency key `submission-confirmation:<submissionId>` + audit — committed as ONE atomic unit (store `enqueueLifecycleAtomic`: D1 batch / Memory all-or-nothing; a mid-operation failure leaves ZERO rows so the retry enqueues cleanly — never an orphan job replaying as duplicate); lazily seeds the `submission_confirmation` template; disabled/missing template → log + skip, never fails the submission |

## Readiness & reports
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Reports.Readiness` | reports:read | eventId | outstanding[], stats |
| `Reports.AirtableStatus` | airtable:read | eventId | lag, errors |

## API keys
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Keys.Create` | keys:admin | name, scopes[], eventId?, expiresAt? | { id, secret once } |
| `Keys.Revoke` | keys:admin | keyId | ok |
| `Keys.List` | keys:admin | — | keys without secrets |

## CLI mapping
`speakerops <resource> <verb> --json` → same commands.  
Examples: `speakerops reports readiness --event E --json` → `Reports.Readiness`.

## HTTP route map (canonical)

| Method | Path | Command |
|--------|------|---------|
| GET | /health | — |
| POST | /api/auth/magic-link | Auth.RequestMagicLink |
| POST | /api/auth/exchange | Auth.ExchangeMagicLink |
| POST | /api/auth/logout | Auth.Logout |
| POST | /api/auth/judge-access | Auth.JudgeAccess (shared demo; 404 when disabled) |
| POST | /api/auth/dev/role-switch | Auth.DevRoleSwitch (dogfood/dev only; 404 when flag off) |
| GET | /api/events | Event.List |
| POST | /api/events | Event.Create |
| GET | /api/events/:eventId | Event.Get |
| PATCH | /api/events/:eventId | Event.Update |
| GET | /api/events/:eventId/rooms | Room.List |
| GET | /api/events/:eventId/rooms/:roomId | Room.Get |
| PUT | /api/events/:eventId/rooms/:roomId | Room.Upsert |
| GET | /api/events/:eventId/tracks | Track.List |
| GET | /api/events/:eventId/tracks/:trackId | Track.Get |
| PUT | /api/events/:eventId/tracks/:trackId | Track.Upsert |
| GET | /api/events/:eventId/design | Design.Get |
| PUT | /api/events/:eventId/design | Design.SetDraft |
| POST | /api/events/:eventId/design/publish | Design.Publish |
| POST | /api/events/:eventId/forms | Form.Create |
| PUT | /api/forms/:formId/draft | Form.UpdateDraftFields |
| POST | /api/forms/:formId/publish | Form.Publish |
| GET | /api/public/cfp/:slug | Form.GetPublic |
| POST | /api/public/cfp/:slug/submissions | Submission.Create |
| POST | /api/public/cfp/:slug/drafts | Submission.SaveDraft |
| GET | /api/public/cfp/:slug/drafts/:draftId | Submission.GetDraft |
| POST | /api/public/cfp/:slug/files | Cfp.FileUpload |
| GET | /api/events/:eventId/submissions | Submission.List |
| GET | /api/events/:eventId/submissions/export | Submission.ExportCsv (CSV; ?status&category&q; Wave 2) |
| GET | /api/submissions/:submissionId | Submission.Get |
| POST | /api/submissions/:submissionId/assign | Submission.AssignEvaluators |
| POST | /api/events/:eventId/submissions/bulk-preview | Submission.BulkPreview |
| PUT | /api/events/:eventId/eval/rubric | Eval.UpsertRubric |
| GET | /api/events/:eventId/eval/rubric | Eval.GetRubric (read active round) |
| GET | /api/events/:eventId/eval/rollup | Eval.AdminRollup (aggregate scores; ?sort=score_desc\|score_asc\|title) |
| GET | /api/events/:eventId/eval/export | Eval.ExportScores (CSV; ?sort=score_desc\|score_asc\|title) |
| POST | /api/events/:eventId/eval/bulk-assign | Eval.BulkAssign (dryRun=true previews → previewId; commit requires previewId; idempotent replay; Wave 2) |
| POST | /api/assignments/:assignmentId/scores | Eval.Score |
| POST | /api/me/eval-assignments/:assignmentId/abstain | Eval.Abstain (owner-verified; optional reason) |
| GET | /api/me/eval-queue | Eval.GetQueue (assigned only) |
| POST | /api/submissions/:submissionId/decision | Decision.Record |
| POST | /api/events/:eventId/sessions/direct | Session.CreateDirect |
| GET | /api/portal/sessions/:sessionId/invite.ics | Portal.SessionIcs (speaker-owned .ics download) |
| GET | /api/portal/home | Portal.GetHome |
| PATCH | /api/portal/participations/:id | Participation.UpdateProfile |
| POST | /api/portal/tasks/:taskId/complete | Task.Complete |
| POST | /api/files/presign | File.PresignUpload |
| PUT | /api/files/:fileId/upload | File.Upload |
| POST | /api/files/:fileId/complete | File.CompleteUpload |
| GET | /api/public/files/:fileId | File.GetPublic |
| GET | /api/events/:eventId/speakers | Speakers.List |
| GET | /api/events/:eventId/speakers/:participationId | Speakers.Get |
| GET | /api/events/:eventId/task-templates | TaskTemplate.List |
| POST | /api/events/:eventId/task-templates | TaskTemplate.Create |
| PATCH | /api/events/:eventId/task-templates/:templateId | TaskTemplate.Update |
| POST | /api/events/:eventId/speakers/:participationId/tasks/:taskId/complete | Speakers.CompleteTask (Wave 2) |
| DELETE | /api/events/:eventId/task-templates/:templateId | TaskTemplate.Delete |
| GET | /api/events/:eventId/schedule | Schedule.List |
| POST | /api/events/:eventId/schedule/place | Schedule.Place |
| POST | /api/events/:eventId/schedule/move | Schedule.Move |
| POST | /api/events/:eventId/schedule/unschedule | Schedule.Unschedule |
| PUT | /api/events/:eventId/templates/:key | Comms.UpsertTemplate |
| GET | /api/events/:eventId/templates | Comms.ListTemplates |
| GET | /api/events/:eventId/comms/jobs | Comms.ListJobs |
| GET | /api/events/:eventId/comms/jobs/:jobId | Comms.GetJob |
| GET | /api/events/:eventId/comms/ics | Comms.ListIcs |
| POST | /api/events/:eventId/comms/ics | Comms.IcsForPlacement |
| POST | /api/comms/preview | Comms.Preview |
| POST | /api/comms/send | Comms.Send |
| GET | /api/events/:eventId/readiness | Reports.Readiness |
| GET | /api/events/:eventId/airtable/status | Reports.AirtableStatus |
| GET | /api/keys | Keys.List |
| POST | /api/keys | Keys.Create |
| DELETE | /api/keys/:keyId | Keys.Revoke |
| GET | /openapi.json | OpenAPI document |

**Authority:** This file + SCHEMA.md + SCOPES.md under `initiative/contracts/` are canonical for planning; product repo copies them into `docs/contracts/` in section 0.4/9.4 without semantic drift.
