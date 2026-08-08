# Architecture Audit — Data Architecture for the Sessionboard Clone

**Advisor:** Claude
**Date:** 2026-08-08
**Verdict up front:** Option **B/D hybrid** — a canonical internal DB on Cloudflare (D1 + Durable Objects + R2), with Airtable as a **one-way, eventually-consistent projection** for human ops and judge optics. Airtable never owns state. Bidirectional sync is explicitly rejected.

---

## 1. Executive recommendation

**Build on Cloudflare D1 as the single system-of-record. Push a read-only mirror to Airtable via an outbox queue. Never read application state back from Airtable.**

Reasoning, compressed:

1. **The product's core loops are relational and transactional.** Scoring rounds (evaluator × submission × round), many-to-many speakers↔sessions, schedule conflict detection (overlapping time × room × speaker), submission limits and close-date enforcement — every one of these is a `JOIN` or a transaction. Airtable has neither joins nor transactions. You would be reimplementing a database's integrity guarantees in Worker code against a 5 req/s API. That is the definition of building on sand.
2. **The CFP form is a public, unauthenticated write endpoint.** A CFP deadline produces a burst of submissions in the final hours (every conference organizer knows this curve). Airtable at ~5 req/s/base, with each submission needing 3–6 API calls (submission + answers + speakers + links), saturates at roughly one submission per second — before any dashboard reads. D1 doesn't blink at this.
3. **The bonus points are for "persistence/DB using Airtable," and judges may literally open Airtable to see the data.** A faithful, near-live mirror satisfies that optics requirement almost as well as Airtable-as-primary, at a tiny fraction of the correctness risk. You get the grid views, the judge legibility, and the "our team already lives in Airtable" affinity — without betting conflict detection on a rate-limited HTTP API.
4. **"An open source clone that YOU make (and keep)"** — the brief is explicit that this should outlive the weekend. Airtable-as-primary is a weekend hack that becomes a permanent ceiling: monthly record quotas, no migrations, no referential integrity, attachment URLs that expire (~2h), and schema that drifts every time an ops person renames a column. The tiebreaker goes to "judgment calls for the product they would actually use/buy" — a real database *is* that judgment call.
5. **Agents want SQL.** The 2026 agentic requirement is served best by a schema agents can `SELECT` against, an append-only audit log, and deterministic migrations in the repo. Airtable's API is a bad tool surface: paginated at 100, rate-limited, untyped, and un-diffable.

The one honest argument for Airtable-as-primary (Option A) is raw weekend shippability — no schema migrations, free admin UI. It loses anyway: you'd spend the saved time hand-rolling uniqueness checks, link management, and rate-limit backoff, and you'd still have no good story for conflict detection or the real-time dashboard.

---

## 2. Decision matrix

Scale: ✅ good · ⚠️ workable with effort · ❌ disqualifying pain.

| Criterion | A: Airtable primary | B: Internal DB → push to Airtable | C: Split ownership hybrid | D: Airtable read-only export |
|---|---|---|---|---|
| Weekend shippability | ✅ (fastest start) | ✅ (D1 + Drizzle is hours, not days) | ⚠️ (two write paths to build) | ✅ |
| Public form burst / rate limits | ❌ 5 req/s wall | ✅ | ⚠️ (depends where submissions land) | ✅ |
| Transactions & relational integrity | ❌ none | ✅ | ❌ split-brain across the boundary | ✅ |
| Conflict detection / drag-drop schedule | ❌ N+1 API reads | ✅ SQL + Durable Object | ⚠️ | ✅ |
| Real-time dashboard | ❌ polling a rate-limited API | ✅ DO + SSE | ⚠️ | ✅ |
| Judge optics ("open Airtable, see data") | ✅ | ✅ (near-live mirror) | ✅ | ⚠️ (only if sync is frequent, i.e. converges to B) |
| Ops team can *edit* in Airtable | ✅ | ⚠️ (by design, no — see §5) | ✅ nominally, ❌ in practice | ❌ |
| Agent queryability / audit | ❌ | ✅ | ⚠️ | ✅ |
| Long-term keepability | ❌ quotas, drift, lock-in | ✅ | ❌ | ✅ |
| Sync failure surface | n/a | ✅ small (one direction, idempotent) | ❌ largest possible | ✅ small |

B and D are the same architecture at different sync cadences; I recommend B's near-live push specifically so the Airtable bonus reads as "persistence *in* Airtable," not "an export." **C is the trap option** — it looks like a diplomatic compromise and is actually the worst of both worlds: every cross-boundary feature (a scoring dashboard that joins ops-owned speakers with internal-owned scores) becomes a distributed-systems problem. Reject it explicitly.

---

## 3. Proposed reference architecture

All Cloudflare-native (bonus points, and genuinely the right shape for this):

```
                       ┌────────────────────────────────────────────┐
 Public CFP form ───►  │  Cloudflare Worker (Hono/Remix/Next-on-CF) │
 Speaker portal  ───►  │  - API + SSR admin UI                      │
 Admin app       ───►  │  - Auth: magic links (speakers), password  │
                       │    or Cloudflare Access (admins)           │
                       └───────┬───────────────┬────────────┬───────┘
                               │               │            │
                     ┌─────────▼───┐  ┌────────▼─────────┐ ┌▼──────────────┐
                     │  D1 (SQLite)│  │ Durable Objects  │ │ R2            │
                     │  system of  │  │ - ScheduleDO per │ │ headshots,    │
                     │  record     │  │   event (locks,  │ │ slides, docs  │
                     │  + outbox   │  │   conflict calc, │ │ (presigned    │
                     │  + audit_log│  │   SSE fan-out)   │ │  URLs)        │
                     └───────┬─────┘  │ - DashboardDO    │ └───────────────┘
                             │        └──────────────────┘
                   ┌─────────▼──────────┐
                   │ Cloudflare Queues  │──► Airtable API (one-way upsert,
                   │ - outbox drain     │     idempotent, rate-limit aware)
                   │ - email send       │──► Email provider (Resend/SES)
                   │   (+ ICS invites)  │     with ICS attachments
                   └────────────────────┘
```

**Data ownership is absolute:** D1 owns everything. Durable Objects hold ephemeral coordination state (drag-drop locks, live dashboard fan-out) and write through to D1. R2 owns binary files; D1 stores keys/metadata. Airtable owns nothing.

Component notes:

- **ScheduleDO (one per event):** serializes schedule mutations. Drag-drop lands here; the DO validates room/time/speaker conflicts against its in-memory copy (hydrated from D1), commits to D1, broadcasts via SSE/WebSocket. This makes "automatic conflict detection with concurrent edits" trivially correct instead of racily approximate. One DO per event is exactly the right concurrency grain — a single conference's schedule editing is low-contention.
- **Real-time dashboard:** the "speakers with outstanding tasks" view is one SQL query; DO-pushed SSE makes it live. (Honest note: 5-second polling would also pass judging — see §8 — but the DO is little extra work once ScheduleDO exists.)
- **Calendar invites:** do *not* start with Google/Microsoft OAuth. An email with a `text/calendar` (`METHOD:REQUEST`) ICS attachment lands in Gmail, Outlook, and Apple Calendar natively and covers the brief's requirement 3 verbatim. It's ~40 lines of string formatting.
- **Email:** template rows in D1, sends via queue with an `email_log` row per attempt. The log doubles as the audit/agent trace.

---

## 4. What lives in Airtable vs not

**In Airtable (mirrored, read-only by convention):**

- One base per event (or one base with per-event views). Tables: `Submissions`, `Speakers`, `Sessions`, `Schedule`, `Scores (rollup)`, `Speaker Tasks`, `Email Log`. Human-friendly denormalizations are fine here — flatten answers into columns, show average score, link speakers↔sessions with Airtable linked records for browsability.
- Every mirrored record carries the internal ULID in an `_id` field and a `View in app →` URL field. This makes the mirror self-describing and makes idempotent upserts trivial.

**Never in Airtable:**

- Form definitions and conditional logic (JSON, meaningless in a grid).
- Auth material, magic-link tokens, sessions.
- Raw per-question submission answers (mirror a flattened summary instead).
- Files. Link to R2 presigned URLs in a URL column; do not upload attachments (Airtable re-hosts them, URLs expire, and you double storage).
- The outbox, audit log, and email queue internals.
- Individual evaluator scores during an active round, if you want blind review — mirror aggregates only until the round closes. (Judgment call; flag it in the README.)

---

## 5. Sync strategy

**Direction:** strictly one-way, D1 → Airtable. **Mechanism:** transactional outbox.

1. Every domain mutation, in the same D1 transaction, inserts an `outbox` row: `(id, entity_type, entity_id, op, payload_json, created_at, synced_at NULL)`.
2. A queue consumer (or a 30–60s cron in the weekend cut) drains the outbox: batches up to 10 records per Airtable call (their batch limit), upserts keyed on the `_id` field, marks `synced_at`, retries with backoff on 429/5xx. Idempotent by construction — replays are harmless.
3. Deletes propagate as either Airtable deletes or a `Status = archived` flag (prefer the flag; ops people hate rows vanishing).

**Conflict rules:** there are none, because there is no reverse flow. An edit made in Airtable is overwritten by the next push touching that record. Say this loudly in the README and lock mirrored fields where Airtable's field permissions allow.

**If ops-side edits become a real demand post-win**, do *not* upgrade to bidirectional sync. Add an explicit **command inbox**: a dedicated `Ops Requests` table (or designated editable columns like `Ops Notes`) that a poller reads, applies through the same API/validation path as any user, records in the audit log, and clears. Airtable becomes a UI for *submitting commands*, never a peer database. This preserves a single write-authority and keeps every change validated and audited.

---

## 6. Agentic layer implications

This is where B beats A structurally, not just operationally:

- **SQL is the agent interface.** A coding/ops agent pointed at this repo gets `schema.sql`, migrations, and `wrangler d1 execute` — it can answer "which accepted speakers have no headshot and haven't opened the last email?" in one query. Against Airtable it gets pagination loops, rate limits, and stringly-typed fields.
- **Append-only `audit_log`** (`actor` = user | agent | system, `action`, `entity`, `before/after` JSON) means agents can act *and be reviewed*. Route agent mutations through the same API handlers as humans — never raw DB writes — so validation and audit are uniform. The `email_log` and `outbox` give agents (and judges) a legible trace of every side effect.
- **Schema in the repo = agents can evolve it.** Migrations are diffable, reviewable PRs. Airtable schema changes are clicks in a UI that no agent can review and no git history records.
- **Embeddings/RAG:** the brief *struck* AI-assisted review — do not build it for the weekend. But the shape is ready: a Vectorize index keyed by `submission_id`, populated from the same outbox events. Zero rearchitecting later.
- **Durable Objects as agent-safe locks:** an agent proposing schedule changes goes through ScheduleDO like any human drag-drop, so it cannot corrupt the schedule concurrently with a human.

---

## 7. Risks / anti-patterns

1. **Bidirectional sync (the #1 anti-pattern here).** No transactions across the boundary, Airtable webhooks are at-least-once and laggy, echo loops require change-origin tagging, deletes are ambiguous, and last-writer-wins will silently destroy scoring data during the exact final-week crunch when both ops and evaluators are active. If you find yourself designing "conflict resolution rules," you have already lost.
2. **Option C's split ownership.** Any feature joining across the boundary becomes a distributed query. The boundary will migrate weekly as features grow. Reject at the design stage.
3. **Sync coupling on the write path.** Never call Airtable synchronously inside a request handler. A CFP submission must succeed with Airtable down, rate-limited, or deleted. Outbox or nothing.
4. **Airtable attachments for speaker files.** Expiring URLs (~2h) break the speaker portal and any embedded gallery. R2 + presigned URLs only.
5. **Conflict detection in the client.** If the browser computes conflicts, two concurrent drags create an undetected conflict. Server-side in ScheduleDO, atomically, is the only correct place.
6. **D1 limits, honestly stated:** 10GB/database, SQLite single-writer semantics. For one conference program (thousands of submissions, not millions) this is nowhere near a constraint. If true multi-tenancy arrives post-win, shard one D1 database per event/org — the schema below already keys everything by `event_id`, and per-event D1 databases are a natural Cloudflare pattern.
7. **Auth scope creep.** Speakers need magic links only. Do not build password auth, OAuth, or roles beyond `admin | evaluator | speaker` for the weekend.
8. **Mirror lag misread as data loss.** Judges may edit-in-app then check Airtable instantly. Keep drain cadence ≤60s and put a `Last synced` timestamp column in every mirrored table so lag is visible, not suspicious.

---

## 8. MVP weekend cut vs post-win hardening

**Ship by Wed Aug 12 (in priority order — the demo path is form → submit → score → accept → portal → schedule → dashboard):**

- D1 schema + migrations (Drizzle), single org, multi-event-capable but one event seeded.
- Form builder: field types (text, textarea, select, multi-select, file, checkbox), required flags, and conditional logic as simple `show field X when field Y = value` JSON rules. Category field routes to review queues. Public form page + confirmation email.
- Speaker portal: magic-link login, edit bio, upload headshot/slides to R2, task checklist, see submission status.
- Evaluation: **one** scoring round, per-evaluator assignments, 1–5 scores + comment, aggregate view, accept/reject action.
- Schedule: drag-drop grid (rooms × time), conflict detection via ScheduleDO (room overlap + speaker double-booking), list/day/track/room views (these are the same query, four sort orders — cheap and the brief names them).
- Emails: 4 templates (received, accepted+tasks, rejected, schedule-confirmed w/ ICS attachment). Send log.
- Dashboard: outstanding-tasks-per-speaker. SSE if ScheduleDO is done early, else 5s polling — judges cannot tell the difference and it's not worth a Saturday.
- Airtable mirror: outbox + cron drain for `Submissions`, `Speakers`, `Sessions`, `Schedule`, `Tasks`. This is maybe 150 lines and captures the bonus.

**Cut without guilt (weekend):** multi-round evals, Google/Outlook OAuth calendar APIs (ICS covers it), AI review (struck), Accelevents (struck), embeddable gallery (struck), wiki pages (struck), multi-language, payments, draft submissions, per-field validation rules beyond required/type.

**Post-win hardening:** multi-round evaluation with round gating and blind-review controls; Ops Requests command inbox (§5); per-event D1 sharding + real multi-tenancy; Vectorize embeddings for duplicate-submission detection and reviewer assistance; calendar-API push (updates/cancellations, not just invites); public schedule embed (this is just a read-only Worker route over the same D1 — cheap win, was struck but is high-value); rate limiting + Turnstile on the public form; backup/export (D1 export to R2 nightly).

---

## 9. Schema sketch (D1)

All PKs are ULIDs. Everything below `events` carries `event_id`. Timestamps omitted for brevity; every table gets `created_at`/`updated_at`.

```
orgs            (id, name)                          -- 1 row for MVP
users           (id, org_id, email, name, role)     -- role: admin|evaluator|speaker
events          (id, org_id, name, starts_at, ends_at, timezone, settings_json)

forms           (id, event_id, name, kind,          -- kind: abstract|session
                 welcome_md, opens_at, closes_at,
                 submission_limit, thank_you_md, status)
form_fields     (id, form_id, label, type, options_json,
                 required, sort, conditions_json)   -- show-if rules
submissions     (id, event_id, form_id, title, abstract,
                 category, status,                  -- draft|submitted|in_review|accepted|rejected|withdrawn
                 submitted_at)
answers         (id, submission_id, field_id, value_json)

speakers        (id, event_id, user_id, name, email, bio,
                 headshot_r2_key, company, title)
submission_speakers (submission_id, speaker_id, is_primary)   -- M:N

eval_rounds     (id, event_id, name, status, closes_at)       -- 1 row for MVP
eval_assignments(id, round_id, submission_id, evaluator_user_id)
scores          (id, assignment_id, value, comment)
                 -- UNIQUE(assignment_id): one score per evaluator per submission per round

rooms           (id, event_id, name, capacity)
tracks          (id, event_id, name, color)
sessions        (id, event_id, submission_id NULL,  -- NULL = manually added (sponsor slot)
                 title, description, track_id, status)
schedule_slots  (id, event_id, session_id, room_id, starts_at, ends_at)
                 -- conflict check: overlapping (room_id, time) or (speaker via session, time)

task_templates  (id, event_id, title, description, due_offset_days, trigger)  -- trigger: on_accept|manual
speaker_tasks   (id, task_template_id, speaker_id, status, completed_at)

email_templates (id, event_id, key, subject, body_md)
email_log       (id, event_id, to_email, template_key, payload_json,
                 status, provider_id, sent_at)      -- queued|sent|failed
files           (id, event_id, owner_speaker_id, r2_key, filename, mime, size)

audit_log       (id, event_id, actor_type,          -- user|agent|system
                 actor_id, action, entity_type, entity_id,
                 before_json, after_json, at)
outbox          (id, entity_type, entity_id, op, payload_json,
                 created_at, synced_at NULL, attempts, last_error)
```

Notes: `sessions` vs `submissions` mirrors Sessionboard's own distinction from the walkthrough (applications vs guaranteed slots) — keeping both, with `sessions.submission_id` nullable, cleanly handles sponsor sessions that never went through the CFP. Conflict detection is one indexed query over `schedule_slots` joined through `submission_speakers`; that single sentence is most of the case against Airtable-as-primary.

---

*— Claude*
