# SpeakerOps canonical schema sketch (planning contract)

**Status:** LOCK for pack deepen — builders implement via Drizzle migrations in section ownership below.  
**SoR:** D1 only. ULIDs/UUIDs for PKs. Soft deletes optional via `deleted_at`. Mutable aggregates carry `version INTEGER NOT NULL DEFAULT 1`.

## Ownership by section

| Tables | First writer section |
|--------|----------------------|
| organizations, events | 1.3 |
| users, sessions (auth), magic_links | 2.1 |
| event_memberships (roles) | 2.2 |
| rooms, tracks | 2.3 |
| design_token_drafts, design_token_published | 2.4 |
| forms, form_versions, form_fields, form_rules | 3.1 |
| submissions, submission_answers, submission_speakers | 3.3 |
| eval_rounds, eval_criteria, eval_assignments, scores | 3.4 |
| decisions | 3.5 |
| people, event_participations, speaker_tasks, task_templates | 3.5 / 4.1 |
| file_assets | 2.4 (logo + `uploaded`) / 4.2 (portal headshot/slides) |
| email_templates, message_jobs, message_recipients, delivery_events, calendar_invites | 5.1–5.2 |
| schedule_slots / placements, room_reservations, speaker_reservations | 6.1 |
| api_keys, api_key_scopes usage | 7.1 |
| audit_events, outbox_events, projection_records, idempotency_keys | 1.3 / cross-cutting |

## Core tables (columns builders must not invent away)

### organizations
`id, name, created_at, updated_at`

### events
`id, org_id, name, slug, timezone, starts_at, ends_at, settings_json, created_at, updated_at, version`  
settings_json (no migration): Wave-1B notification keys + Wave-2 agenda keys `agendaDayStart`/`agendaDayEnd` ("HH:MM" wall time, event timezone) + `slotIntervalMin` (15|30|60), merged passthrough

### users
`id, email, name, created_at, updated_at`

### auth_sessions
`id, user_id, token_hash, expires_at, created_at`

### magic_links
`id, user_id, event_id NULL, purpose, token_hash, expires_at, used_at, created_at`

### event_memberships
`id, event_id, user_id, role (admin|evaluator|speaker), created_at` UNIQUE(event_id, user_id)

### people
`id, org_id, email, name, created_at, updated_at` — canonical identity

### event_participations
`id, event_id, person_id, user_id NULL, role_label, status, bio, company, title, headshot_file_id NULL, version, created_at, updated_at`

### forms / form_versions / form_fields / form_rules
- forms: `id, event_id, name, status, created_at`
- form_versions: `id, form_id, version_num, welcome_md, thank_you_md, opens_at, closes_at, submission_limit, per_submitter_limit (0028), min_speakers, max_speakers (0024), published_at, immutable snapshot_json`
- form_fields: `id, form_version_id, field_key, type, label, required, options_json, sort_order, conditions_json, help_text, placeholder, max_chars (0023), node_kind input|layout, layout_type section|divider (0027)`
- form_rules: category routing rules `id, form_version_id, when_json, route_to_category`

### submissions
`id, event_id, form_version_id, title, category, status (draft|submitted|in_review|accepted|rejected|waitlist|withdrawn), submitted_at, version`

### submission_answers
`id, submission_id, field_key, value_json`

### submission_speakers
`submission_id, person_id, is_primary, sort_order, bio NULL, company NULL, title NULL (0031 — "About this speaker" seed; accept fills only empty participation profile fields)`

### eval_* 
`eval_rounds (+ closes_at, instructions_md 0026, hide_speakers 0029)`, `eval_criteria (round_id, name, max_score, weight)`, `eval_assignments (round_id, submission_id, evaluator_user_id, status)`, `scores (assignment_id, criterion_id, value, comment)` UNIQUE assignment+criterion

### decisions
`id, submission_id, decision (accept|reject|waitlist), reason, decided_by, created_at`

### sessions (program)
`id, event_id, source_submission_id NULL, title, description, track_id NULL, status, version` — sponsor/direct entry allowed without submission

### session_speakers
`session_id, participation_id, is_primary`

### task_templates / speaker_tasks
templates: `id, event_id, title, description, trigger (on_accept|manual), due_offset_days, link_url NULL (https only, 0030), required (INTEGER 0|1 NOT NULL DEFAULT 0, 0030), version`  
tasks: `id, template_id, participation_id, status, due_at, completed_at, version`

### file_assets
`id, event_id, owner_participation_id NULL, r2_key, filename, mime, size, checksum, purpose (logo|headshot|slides|other), created_at, uploaded (INTEGER 0|1|2 NOT NULL DEFAULT 0), virus_scan_status (unscanned|clean|infected|error NOT NULL DEFAULT unscanned)`

- **Metadata in D1 only** — object bytes live in R2 (`r2_key`); never store file bodies in SQLite/D1.
- `size` at insert is the **presign-declared** byte budget (max 10 MiB); after a successful body upload it is the **actual** stored size (≤ declared).
- `uploaded` is the dedicated readiness flag: `0` = pending body, `2` = claim in progress (bytes not stored yet — not ready for Design.SetDraft), `1` = bytes stored. **Only `1` means ready.** File.Upload claims with `0→2`, writes object storage, then completes `2→1`; put failure releases `2→0`. **Never** overload `checksum` as an upload-readiness sentinel — `checksum` is for content digests (`File.CompleteUpload` / portal).
- `virus_scan_status` is a **stub** field (4.2): new rows default to `unscanned`; no scanner worker in dogfood — clean/infected transitions land later.
- `purpose=logo` is owned by Design Kit (2.4); `headshot|slides|other` expand in portal (4.2). Mime allowlists: headshot `image/jpeg|image/png`; slides `application/pdf`; logo `image/png`. Executables (`application/x-msdownload` etc.) rejected at presign.

### rooms / tracks
`id, event_id, name, ...`

### schedule_placements
`id, event_id, session_id, room_id, starts_at, ends_at, version` + unique constraints via reservation tables

### room_block_reservations / speaker_block_reservations
unique (event_id, room_id, start, end) / (event_id, participation_id, start, end) — conflict engine

### email_templates, message_jobs, message_recipients, delivery_events, calendar_invites
jobs carry idempotency_key; calendar: uid, sequence, method

### design_tokens
draft + published JSON: `{ brand, brandSoft, radius, wordmark, logoFileId }` per event

### api_keys
`id, org_id, name, key_prefix, key_hash, scopes_json, event_id NULL, expires_at, revoked_at, created_by, last_used_at`

### audit_events
`id, event_id NULL, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, correlation_id, created_at`

### outbox_events
`id, topic, payload_json, created_at, processed_at, attempts, last_error`

### projection_records
`id, system (airtable), entity_type, internal_id, external_id, source_version, updated_at`

### idempotency_keys
`id, key, request_hash, response_json, created_at`
