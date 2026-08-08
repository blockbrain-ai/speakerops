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
| `Auth.DevRoleSwitch` | dogfood/dev only (`ROLE_SWITCHER_ENABLED=1` / local e2e) | role (admin\|evaluator\|speaker), eventId? | { ok, role, email, eventId, redirectTo } + Set-Cookie session for seeded demo user — **never** registered on public production default |

## Events & settings
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Event.Create` | admin / events:write | name, timezone, dates | event |
| `Event.Get` | admin / events:read | eventId | event |
| `Event.Update` | admin / events:write | eventId, patch, expectedVersion | event |
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
| `Form.UpdateDraftFields` | cfp:write | formId, fields[], rules[] | formVersion draft |
| `Form.Publish` | cfp:write | formId | formVersion immutable |
| `Form.GetPublic` | public | eventSlug / form slug | published form + tokens |
| `Submission.Create` | public | formVersionId, answers, speakers[], turnstile | submission |
| `Cfp.FileUpload` | public | eventSlug, filename, mime, size, contentBase64 | { fileId, mime, size, filename } — supporting file for public CFP; mime/size allowlist enforced |
| `Submission.List` | submissions:read | eventId, filters | page |
| `Submission.Get` | submissions:read | submissionId | detail |
| `Submission.AssignEvaluators` | admin | submissionId, userIds[] | assignments |
| `Submission.BulkPreview` | admin / decisions:write | eventId, submissionIds[], decision | preview items (no writes) |

## Evaluation & decisions
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Eval.UpsertRubric` | admin | roundId, criteria[] | rubric |
| `Eval.Score` | evaluator | assignmentId, scores[], comment | assignment |
| `Decision.Record` | decisions:write | submissionId, decision, reason | decision (+ side effects on accept; dematerialize on leave-accept) |
| `Session.CreateDirect` | admin / decisions:write | eventId, title, description?, trackId?, speakers[] | session + participations + on_accept tasks |

## Portal & files
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
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
| `TaskTemplate.Create` | admin | eventId, title, description?, trigger, dueOffsetDays | template |
| `TaskTemplate.Update` | admin | eventId, templateId, patch (title?, description?, trigger?, dueOffsetDays?), **expectedVersion** (required; E1 optimistic concurrency) | template \| 409 on version conflict |
| `TaskTemplate.Delete` | admin | eventId, templateId, **expectedVersion** (required; E1 optimistic concurrency) | { deleted: true, id } \| 409 on version conflict |

## Schedule
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Schedule.List` | schedule:read | eventId, view | placements + unscheduled |
| `Schedule.Place` | schedule:write | sessionId, roomId, startsAt, endsAt, expectedVersion | placement \| 409 conflicts |
| `Schedule.Move` | schedule:write | placementId, …, expectedVersion | placement \| 409 |
| `Schedule.Unschedule` | schedule:write | placementId, expectedVersion | ok |

## Comms
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Comms.UpsertTemplate` | admin | eventId, key, subject, body | template |
| `Comms.ListTemplates` | admin | eventId | templates[] |
| `Comms.Preview` | comms:draft | templateId, segment | { recipients[], bodies[], missingFields[] } |
| `Comms.Send` | comms:send | previewId / draftId, idempotencyKey | job |
| `Comms.ListJobs` | admin | eventId | jobs[] (delivery log) |
| `Comms.GetJob` | admin | eventId, jobId | job + recipients + delivery_events |
| `Comms.ListIcs` | admin | eventId | calendar_invites[] |
| `Comms.IcsForPlacement` | system/admin | placementId (+ fixture fields) | calendar_invite row |

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
| POST | /api/public/cfp/:slug/files | Cfp.FileUpload |
| GET | /api/events/:eventId/submissions | Submission.List |
| GET | /api/submissions/:submissionId | Submission.Get |
| POST | /api/submissions/:submissionId/assign | Submission.AssignEvaluators |
| POST | /api/events/:eventId/submissions/bulk-preview | Submission.BulkPreview |
| PUT | /api/events/:eventId/eval/rubric | Eval.UpsertRubric |
| GET | /api/events/:eventId/eval/rubric | Eval.GetRubric (read active round) |
| GET | /api/events/:eventId/eval/rollup | Eval.AdminRollup (aggregate scores) |
| POST | /api/assignments/:assignmentId/scores | Eval.Score |
| GET | /api/me/eval-queue | Eval.GetQueue (assigned only) |
| POST | /api/submissions/:submissionId/decision | Decision.Record |
| POST | /api/events/:eventId/sessions/direct | Session.CreateDirect |
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
