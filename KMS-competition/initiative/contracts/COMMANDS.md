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
| `Submission.List` | submissions:read | eventId, filters | page |
| `Submission.Get` | submissions:read | submissionId | detail |
| `Submission.AssignEvaluators` | admin | submissionId, userIds[] | assignments |

## Evaluation & decisions
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Eval.UpsertRubric` | admin | roundId, criteria[] | rubric |
| `Eval.Score` | evaluator | assignmentId, scores[], comment | assignment |
| `Decision.Record` | decisions:write | submissionId, decision, reason | decision (+ side effects on accept) |

## Portal & files
| Command | Scope | Input | Output |
|---------|-------|-------|--------|
| `Portal.GetHome` | speaker | eventId | tasks, sessions |
| `Participation.UpdateProfile` | speaker | participationId, bio, …, expectedVersion | participation |
| `File.PresignUpload` | files:write / speaker | purpose, mime, size | { url, fileId } |
| `File.CompleteUpload` | files:write / speaker | fileId, checksum | file_asset |
| `Task.Complete` | speaker | taskId, expectedVersion | task |

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
| `Comms.Preview` | comms:draft | templateId, segment | { recipients[], bodies[], missingFields[] } |
| `Comms.Send` | comms:send | previewId / draftId, idempotencyKey | job |
| `Comms.IcsForPlacement` | system/admin | placementId | calendar_invite row |

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
| GET | /api/events/:eventId/submissions | Submission.List |
| GET | /api/submissions/:submissionId | Submission.Get |
| POST | /api/submissions/:submissionId/assign | Submission.AssignEvaluators |
| PUT | /api/events/:eventId/eval/rubric | Eval.UpsertRubric |
| POST | /api/assignments/:assignmentId/scores | Eval.Score |
| GET | /api/me/eval-queue | (query assignments) |
| POST | /api/submissions/:submissionId/decision | Decision.Record |
| POST | /api/events/:eventId/sessions/direct | (direct session) |
| GET | /api/portal/home | Portal.GetHome |
| PATCH | /api/portal/participations/:id | Participation.UpdateProfile |
| POST | /api/portal/tasks/:taskId/complete | Task.Complete |
| POST | /api/files/presign | File.PresignUpload |
| POST | /api/files/:fileId/complete | File.CompleteUpload |
| GET | /api/events/:eventId/speakers | (admin speakers list) |
| GET | /api/events/:eventId/schedule | Schedule.List |
| POST | /api/events/:eventId/schedule/place | Schedule.Place |
| POST | /api/events/:eventId/schedule/move | Schedule.Move |
| POST | /api/events/:eventId/schedule/unschedule | Schedule.Unschedule |
| PUT | /api/events/:eventId/templates/:key | Comms.UpsertTemplate |
| POST | /api/comms/preview | Comms.Preview |
| POST | /api/comms/send | Comms.Send |
| GET | /api/events/:eventId/readiness | Reports.Readiness |
| GET | /api/events/:eventId/airtable/status | Reports.AirtableStatus |
| GET | /api/keys | Keys.List |
| POST | /api/keys | Keys.Create |
| DELETE | /api/keys/:keyId | Keys.Revoke |
| GET | /openapi.json | OpenAPI document |

**Authority:** This file + SCHEMA.md + SCOPES.md under `initiative/contracts/` are canonical for planning; product repo copies them into `docs/contracts/` in section 0.4/9.4 without semantic drift.
