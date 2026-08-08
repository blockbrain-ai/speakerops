# Data Architecture Audit

**Recommendation:** Option E — D1 as the only canonical business database, Airtable as a rebuildable operations projection, plus a narrow append-only command inbox if operators must initiate changes from Airtable.

## 1. Executive recommendation

Do not use Airtable as the system of record. Do not split ownership by table. Do not build general bidirectional sync.

Use a Cloudflare D1 relational database for canonical program state. Put uploads in R2. Use Queues for side effects, a Durable Object per event for live invalidation/coordination where useful, and Vectorize only for derived retrieval data. Project selected, human-readable records into one Airtable base per customer so judges and operators can see the program. If Airtable editing proves necessary, accept only explicit commands in an `Operator Actions` table; validate them through the same domain API as the product.

This is not generic “hybrid.” Every datum has one owner:

- D1 owns business truth and workflow state.
- R2 owns file bytes; D1 owns their metadata.
- Airtable owns only Airtable-local presentation fields and unprocessed action requests.
- Vectorize owns no truth; every vector is reproducible from a versioned D1/R2 source.
- Durable Objects own connections and short-lived coordination, not a second copy of the domain.

For the weekend, ship the simpler Option D profile: D1 plus a one-way Airtable projection. Add the command inbox after the core workflow is credible. This scores the Airtable bonus without putting the app's latency, correctness, or availability behind Airtable's API. Airtable currently caps the Web API at **5 requests/second per base**, paginates at **100 records**, and applies plan-dependent monthly call quotas ([Airtable API limits](https://support.airtable.com/getting-started-with-airtables-web-api), [monthly limits](https://support.airtable.com/docs/managing-api-call-limits-in-airtable)). Those are projection constraints, not acceptable transaction-system constraints.

D1 is the right default for this customer-sized, multi-event deployment, not a universal database recommendation. Keep the domain API and IDs storage-neutral. Move to managed Postgres rather than inventing distributed locks if arbitrary interval scheduling, heavy cross-tenant analytics, or sustained write contention becomes real.

## 2. Decision matrix

Scale: 1 = poor, 5 = strong. “Failure isolation” asks whether an Airtable outage or malformed edit can damage or stop the product.

| Option | Weekend | Integrity / evolution | Realtime / concurrency | Agent queries | Airtable / judge fit | Failure isolation | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| A. Airtable system of record | 5 | 1 | 1 | 2 | 5 | 2 | Fast demo; wrong product architecture |
| B. Canonical DB plus broadly editable mirror | 2 | 3 | 4 | 5 | 5 | 1 | Sync product disguised as a CFP product |
| C. Split ownership by table | 3 | 2 | 4 | 4 | 5 | 1 | Cross-store invariants become impossible |
| D. Canonical DB plus read-only projection | 4 | 5 | 4 | 5 | 4 | 5 | Best weekend cut |
| E. Projection plus validated command inbox | 3 | 5 | 5 | 5 | 5 | 4 | Best durable target; recommended |

Why A loses despite its bonus:

- Custom forms require versioned schemas and stable field IDs, not live Airtable column creation.
- Evaluation, speaker/session joins, tasks, and scheduling need foreign keys, uniqueness constraints, and atomic multi-row changes.
- A schedule drag can touch a placement plus room and speaker reservations. Partial success is corruption.
- A real-time dashboard cannot poll a 5 req/s integration API for every browser.
- Agents need reproducible queries and histories. A mutable spreadsheet-like surface is a poor audit boundary.

Why C is worse than it looks: “Airtable owns speakers and tasks; D1 owns schedules and audits” creates distributed transactions on almost every important action. Accepting a submission creates speakers, a session candidate, tasks, audit entries, and notifications. Table-level ownership is the wrong boundary.

## 3. Proposed reference architecture

```text
Speaker portal     Reviewer/admin UI       Typed agent tools
       \                 |                       /
        +---------- Cloudflare Worker API ------+
                    auth + domain commands
                             |
          +------------------+------------------+
          |                  |                  |
      D1 canonical       R2 file bytes     Event Durable Object
    relational state     signed access     WebSocket invalidation
    audit + outbox                          narrow coordination only
          |
     outbox dispatcher -> Cloudflare Queue (at-least-once)
                              |
            +-----------------+------------------+
            |                 |                  |
      Airtable projector   email/calendar    embedding worker
      disposable views     idempotent sends   -> Vectorize
```

### Canonical write path

1. The Worker authenticates the actor and runs a typed command.
2. D1 enforces foreign keys, uniqueness, status transitions, and optimistic version checks. Domain mutation, audit entry, and outbox entry commit together using a D1 batch; D1 batches are transactional ([D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)). An expected-version miss must abort that batch; noticing a zero-row update after commit is too late.
3. The response returns the new entity version. Side effects never hold the user request open.
4. A scheduled dispatcher publishes undispatched outbox work and retries the enqueue gap. Consumers are idempotent because Cloudflare Queues can redeliver; Cloudflare explicitly recommends unique IDs and deduplication for non-repeatable effects ([Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)).
5. The event Durable Object broadcasts an invalidation/version to connected dashboards. Clients refetch authoritative data. Do not copy the business model into the Durable Object.

### Scheduling correctness

Model the agenda as declared time blocks, not arbitrary timestamps, for the first product. A move atomically changes `session_placements`, `room_block_reservations`, and `speaker_block_reservations`. Unique keys on `(event_id, room_id, block_id)` and `(event_id, speaker_id, block_id)` turn conflicts into deterministic constraint failures. A Durable Object may improve collaborative UX, but database constraints—not WebSocket state—must prevent double-booking.

If arbitrary overlapping intervals are later required, Postgres exclusion constraints are cleaner than reproducing an interval-lock manager in D1 or Durable Objects.

### Deployment and tenancy

Default to one deployment, D1 database, and Airtable base per customer/workspace; support many events inside it. This matches an open-source product a customer can keep and sharply reduces tenant-leak risk. Carry `workspace_id` and `event_id` through every applicable key so a hosted model remains possible.

D1's paid limit is currently 10 GB per database and each database processes queries single-threaded, so keep bytes and bulky traces out of it and index hot queries ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)). That is ample for conference records when files live in R2. Do not enable read replicas for the weekend. If enabled later, use D1 Sessions bookmarks for read-your-writes; replicas are asynchronous without that discipline ([D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)).

## 4. What lives in Airtable—and what does not

Use stable internal IDs in visible `Internal ID` fields. Airtable record IDs are projection metadata, never domain foreign keys.

| Project to Airtable | Keep out of Airtable |
|---|---|
| Events and CFP windows | Auth identities, sessions, secrets, grants |
| Form catalogue/version/status, not executable schema | Conditional-logic AST and immutable form schemas |
| Submission summary, category, stage, selected answers, app link | Draft autosaves, answer revision history, routing internals |
| Speakers, bios, consent/onboarding summary | Canonical file bytes and signed URLs with long lifetimes |
| Evaluation assignment/status and score summary | Raw agent reasoning, eval traces, prompt payloads |
| Accepted sessions and linked speaker display | Join/reservation rows used to enforce constraints |
| Rooms, tracks, flattened schedule placements | Locks, versions, idempotency keys, outbox rows |
| Outstanding tasks and due dates | Email provider events and calendar delivery internals |
| Communication status, not credentials or full event stream | Audit log, embeddings, chunks, Vectorize IDs |
| `Operator Actions` requests and their result | Any field whose direct edit is assumed canonical |

It is reasonable to expose submission text and speaker contact data when operators genuinely use it, but treat Airtable as another privileged PII surface: least-privilege base access, no public shares, and explicit retention. Project R2-backed files as authenticated app deep links, not permanent bearer URLs.

## 5. Sync strategy

Call it **projection plus commands**, not sync.

### D1 to Airtable

- **Direction:** one-way for all mirrored domain records.
- **Trigger:** committed outbox event. Never call Airtable inside a domain transaction or user request.
- **Cadence:** coalesce rapid changes by entity; target seconds, not synchronous consistency. Run a nightly full reconciliation and expose lag/error counts.
- **Rate control:** one token bucket per base below 5 req/s; batch/upsert records, back off on 429, and send poison work to a dead-letter path. Airtable supports batching and `performUpsert`; its Sync API can reduce initial bulk-load calls ([Airtable call-limit guidance](https://support.airtable.com/docs/managing-api-call-limits-in-airtable)).
- **Identity:** map `(projection_name, internal_id)` to Airtable record ID and last projected source version/hash in `projection_records`.
- **Ordering:** ignore an event older than the recorded source version. A retry must be harmless.
- **Deletes:** project an `Archived` tombstone first. Avoid hard deletes that break Airtable links and obscure history.
- **Recovery:** the entire base is rebuildable from D1. A broken base is an inconvenience, never data loss.

### Airtable to D1

Do not ingest edits to projected rows. They are overwritten on reconciliation and should be locked/read-only where Airtable permissions allow.

If Airtable-native operations matter, provide one append-only `Operator Actions` table with fields such as `Action ID`, `Action Type`, `Entity ID`, `Expected Version`, `Payload`, `Requested By`, `Submitted At`, `Status`, and `Result`. Airtable webhooks can notify on new/changed records ([Webhooks overview](https://support.airtable.com/docs/airtable-webhooks-api-overview)); a scheduled scan is the missed-notification backstop.

The Worker copies a submitted action into D1 once, freezes its payload hash, authorizes the Airtable-created-by identity rather than trusting the free-text `Requested By` field, validates `Expected Version`, and invokes the normal domain command. D1 always wins. A stale action is rejected visibly; there is no field-level merge and no last-write-wins clock contest. The projector writes the result back to Airtable. Start with a tiny allow-list: request task status/due-date changes, request submission decisions, and request session metadata changes. Do not allow bulk email sends or schedule publication without an in-app preview/approval.

## 6. Agentic layer implications

“Agent-friendly” means typed, attributable operations—not giving an LLM raw SQL and an Airtable token.

- Expose read tools such as `search_submissions`, `get_submission_packet`, `list_schedule_conflicts`, `get_outstanding_tasks`, and `explain_score`. Expose writes as domain commands with `expected_version`, `reason`, `idempotency_key`, and `dry_run`.
- Make tools enforce workspace/event scope and actor permissions. Agents use the same invariant-preserving write path as humans.
- Return internal IDs, entity versions, and source references so an answer or proposal can be reproduced.
- Store every material run in `agent_runs` and `agent_tool_calls`: actor, model/tool/prompt versions, input entity versions, retrieved sources, proposed diff, approval, outcome, latency, and cost. Put large/redactable payloads in R2 with retention rules; keep hashes and metadata in D1.
- Require human approval for accept/reject decisions, external communications, calendar changes, and schedule publication. An agent can propose a batch; it cannot silently cause external effects.
- Use SQL for facts and Vectorize only for fuzzy retrieval over abstracts, bios, and documents. Every chunk carries workspace, event, entity, source version, ACL class, and content hash. Namespace/filter before search; never filter tenant data after retrieval. Vectorize supports namespaces and metadata filtering ([Vectorize queries](https://developers.cloudflare.com/vectorize/best-practices/query-vectors/)).
- Re-embed asynchronously on source-version change. Stale or missing vectors degrade search, never the core workflow.

The brief explicitly deprioritizes AI-assisted review. Preserve that judgment: build agent affordances and evidence trails, not an AI dependency in the critical path.

## 7. Risks and anti-patterns

1. **General bidirectional sync.** It creates loops, partial linked-record writes, delete ambiguity, clock skew, and field-ownership arguments. A weekend team will not make it reliable.
2. **Airtable on the request path.** The customer already complains that the incumbent is slow. Do not replace it with a UI waiting on a 5 req/s integration API.
3. **Split truth by “high churn” versus “ops.”** Churn is not an ownership boundary. One workflow routinely crosses both categories.
4. **Dynamic form fields as database/Airtable columns.** Labels change; answers must not. Use stable field IDs and immutable form versions.
5. **JSON for everything.** Keep versioned form payloads in JSON, but promote relationships, workflow states, scores, dates, and routing fields into constrained tables.
6. **Durable Object as an unqueryable second database.** Use one per event for connections/coordination. Do not hide canonical sessions or tasks inside it.
7. **Vector store as memory.** Embeddings are lossy derived indexes. Never make a decision unrecoverable without the cited source record/version.
8. **At-most-once assumptions for email/calendar.** Queue redelivery is normal. Use stable message IDs and calendar UID/sequence values; deduplicate at both app and provider boundary.
9. **One Airtable base for unrelated customers.** A filtered view is not tenant isolation. Use a base per deployed customer.
10. **Premature event sourcing or microservices.** An append-only audit log plus transactional outbox is enough. Do not turn the weekend into infrastructure theatre.

## 8. MVP weekend cut versus post-win hardening

| Weekend: prove the loop | Post-win: make it dependable |
|---|---|
| Single-customer, multi-event D1 schema and migrations | Tenant isolation decision: deployment/database per customer or deliberate hosted sharding |
| Immutable form versions; submissions pin a version | Form migration tooling, schema compatibility tests, retention/export |
| Fixed schedule blocks and unique room/speaker reservations | Rich constraints, unavailability, spanning blocks; move to Postgres if arbitrary intervals win |
| R2 direct upload; D1 file metadata | Malware scanning, image transforms, retention, legal deletion |
| One-way projection of Events, Submissions, Speakers, Sessions, Tasks, Schedule | Command inbox, webhook renewal, reconciliation UI, DLQ/replay, sync SLO |
| Queue email/reminders with idempotency | Provider event ingestion, suppression, bounce handling, stable calendar updates |
| Dashboard refetch/poll or one event-scoped WebSocket invalidator | Hibernatable WebSockets, presence, load tests, reconnect/version protocol |
| Audit every state-changing command | Tamper-evident exports, restore drills, D1 Time Travel procedures |
| Agent-readable API and source/version IDs; no required AI feature | Vectorize pipeline, agent approvals, trace retention/redaction, evaluation suite |
| Basic metrics: command errors, outbox age, projection lag, send failures | Alerts, SLOs, security review, abuse controls, backup/export drills |

Do not spend the weekend on Airtable-originated writes, read replicas, multi-region cleverness, or a generic agent framework. The winning demo is the complete operator loop with visible Airtable data and no architectural trapdoor.

## 9. Concrete schema sketch

Use application-generated UUID/ULID identifiers. Every mutable aggregate has `version`, `created_at`, `updated_at`, and, where required, `deleted_at`. All event-scoped uniqueness includes `workspace_id`/`event_id`. Enable foreign keys. Do not use Airtable IDs outside projection metadata.

| Domain | Canonical tables / important constraints |
|---|---|
| Tenancy and access | `workspaces`, `users`, `workspace_members`, `events`, `event_members`; unique membership and role scope |
| People | `people`, `event_speakers`; normalized identity is distinct from event-specific bio/status |
| Forms | `forms`, immutable `form_versions`, `form_fields`, `form_options`, `form_rules`; rules reference stable field IDs, not labels |
| CFP | `submissions`, `submission_versions`, `submission_answers`, `submission_speakers`; submission pins `form_version_id`; answer values are typed/versioned |
| Evaluation | `review_rounds`, `review_criteria`, `reviewer_assignments`, `scores`, `decisions`; unique evaluator/submission/round assignment and criterion score |
| Program | `sessions`, `session_speakers`, `tracks`, `rooms`; accepted session may reference `source_submission_id`, while invited/sponsor sessions need not |
| Schedule | `time_blocks`, `session_placements`, `room_block_reservations`, `speaker_block_reservations`, `speaker_unavailability`; unique resource/block keys prevent double-booking |
| Onboarding | `task_templates`, `task_instances`, `task_evidence`; explicit speaker/session subject constraint, due date, assignee, state |
| Files | `file_assets`; R2 key, owner, media type, size, checksum, scan state, retention class—bytes remain in R2 |
| Communications | `message_templates`, `template_versions`, `message_jobs`, `message_recipients`, `delivery_events`, `calendar_invites`; rendered snapshot, stable idempotency key, calendar UID/sequence |
| Reliability | `audit_events`, `outbox_events`, `idempotency_keys`, `projection_records`, `operator_commands`; mutation/audit/outbox share a transaction |
| Agent retrieval | `content_sources`, `content_chunks`, `embedding_jobs`; source version/hash and Vectorize reference, never canonical prose only in the vector store |
| Agent governance | `agent_runs`, `agent_tool_calls`, `approval_requests`; inputs, proposed changes, evidence, approvals, and outcomes |

Critical indexes should follow operator questions, not table fashion: submissions by event/category/status, assignments by reviewer/round/state, tasks by event/status/due date, placements by event/block/room, speakers by event/onboarding status, outbox by processing state/next attempt, and audit events by entity/time.

The central architectural rule is simple: **D1 decides; Airtable displays or requests; queues deliver; agents propose and explain.**

— **Codex**, 8 August 2026
