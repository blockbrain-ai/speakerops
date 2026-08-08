# Data Architecture Report: Airtable vs Canonical DB for an Agentic Sessionboard Clone

**Date:** 2026-08-08  
**Repo:** KMS-competition  
**Question:** If we build to their stack (Cloudflare + Airtable) *and* design for an agentic, first-principles product, is Airtable the database—or do we keep a real internal DB and push some data across?

**Advisors:** independent audits from Claude and Codex (see `AUDIT-claude.md`, `AUDIT-codex.md`)  
**Synthesis:** this document

---

## TL;DR

**Yes, build to their stack. No, do not make Airtable the system of record.**

| Layer | Role |
|--------|------|
| **Cloudflare D1** | Canonical business database (truth) |
| **R2** | Files (headshots, slides, docs) |
| **Queues + outbox** | Side effects (email, Airtable projection, later embeddings) |
| **Durable Objects** | Live coordination (schedule drag-drop, dashboard fan-out)—not a second DB |
| **Airtable** | Human/judge-facing **projection** (and optionally a command inbox later)—never owns domain state |

**One sentence:** *D1 decides; Airtable displays or requests; queues deliver; agents propose and explain.*

That gives you:

1. **Bonus optics** — judges can open Airtable and “see the data”
2. **Team affinity** — their ops culture already lives in grids
3. **Agent-ready core** — SQL, migrations, audit, typed commands, schema-in-git
4. **No architectural trapdoor** — CFP bursts, schedule conflicts, and concurrent edits don’t sit behind a 5 req/s spreadsheet API

---

## What the brief actually rewards

From the competition brief:

- Stack is free choice  
- **Mild bonus:** deploy on **Cloudflare**  
- **Bonus:** persistence/DB using **Airtable**  
- Reason: *those are what we use on our team*  
- Tiebreaker: product judgment calls they would actually **use/buy**  
- Explicit: open-source clone **you make and keep**

So “build to their stack” is real—but it means **meet them where they work**, not **implement Sessionboard on top of Airtable’s API limits**.

Airtable also showed up in the struck list only as *ops surface*, not as the product engine. Accelevents integration was the other “existing platform” item and is deprioritized.

---

## The real design tension

You’re balancing three forces that pull in different directions:

| Force | Pulls toward |
|--------|----------------|
| **Weekend + bonus** | Airtable-as-DB, free admin grid, fast demo |
| **Product correctness** | Relational DB, transactions, conflict constraints |
| **Agentic longevity** | Schema-in-repo, audit trail, tool-mediated writes, queryable truth |

Airtable-as-primary optimizes force #1 and slowly poisons #2 and #3.  
Canonical DB + Airtable projection pays a small weekend tax and wins #2 and #3 while still collecting most of #1.

---

## Options evaluated

| Option | Idea | Verdict |
|--------|------|---------|
| **A** | Airtable is the primary DB | Fast demo, wrong product. Integrity, bursts, agents, and realtime all lose. |
| **B** | Internal DB is SoR; push/sync to Airtable for ops | Correct direction. Must be **one-way** projection, not “broadly editable mirror.” |
| **C** | Split ownership (Airtable owns speakers/tasks; DB owns schedule…) | **Trap.** Looks diplomatic; creates distributed transactions on every important workflow. |
| **D** | Internal DB + Airtable as read-only export/projection | Best **weekend** profile. |
| **E** | D + validated **command inbox** from Airtable | Best **durable** target once ops insist on editing from Airtable. |

Claude frames the answer as **B/D hybrid** (near-live one-way projection).  
Codex frames it as **E** (projection + optional command inbox), with **D** as the weekend cut.  

Those are the same architecture at different maturity stages.

---

## Advisor consensus (Claude + Codex)

Both advisors independently landed on the same core position. Disagreements are mostly framing and post-win detail.

### Agreement (load-bearing)

1. **Airtable must not own business truth.**  
   Forms, M:N speakers↔sessions, multi-round evals, task state, and especially **schedule conflict detection** need joins, uniqueness constraints, and multi-row atomic writes. Airtable has none of that as a real transactional DB.

2. **Rate limits make Airtable-as-primary unsafe for the public CFP path.**  
   ~5 requests/sec/base + 100-record pages. A submission often needs several writes (submission, answers, speakers, links). Deadline bursts will hurt. The walkthrough already complains Sessionboard is *slow*—do not re-create that by putting every write on Airtable.

3. **Option C (split ownership) is the worst “reasonable-sounding” option.**  
   Accepting a talk touches speakers, submission, tasks, audit, notifications. Ownership by “ops table vs high-churn table” is the wrong boundary.

4. **Never call Airtable on the request path.**  
   Outbox → queue → projector. Product must keep working if Airtable is down, rate-limited, or deleted.

5. **Bidirectional sync is an anti-pattern for this weekend and this product.**  
   Echo loops, delete ambiguity, partial linked-record writes, last-write-wins during crunch week. If you need reverse flow, use a **command inbox**, not field-level merge.

6. **Agentic design wants typed domain commands + SQL + audit, not raw spreadsheet access.**  
   Agents (and humans) go through the same validation path. Embeddings/Vectorize are optional derived indexes later (brief struck AI review for MVP).

7. **Cloudflare-native is the right default, not just a bonus chase.**  
   Workers + D1 + R2 + Queues (+ DO for live schedule/dashboard).

### Nuances between advisors

| Topic | Claude | Codex |
|--------|--------|--------|
| Label | B/D hybrid, one-way near-live mirror | Option E as durable target; D for weekend |
| Schedule correctness | ScheduleDO serializes mutations, writes through to D1 | Prefer **DB unique constraints** as truth; DO for UX invalidation only |
| Airtable editing later | `Ops Requests` command table | Same idea + stronger: validate identity, expected version, tiny allow-list |
| Calendar | ICS email attachment first (covers brief) | Same: idempotent calendar UID/sequence later |
| D1 limits honesty | Fine for conference scale; shard per org later | Same; keep storage-neutral IDs so Postgres remains an escape hatch |

**Synthesis judgment on schedule:** take both.  
- **Enforce** conflicts with D1 constraints / transactional checks (truth).  
- **Coordinate** concurrent drag-drop UX with a per-event Durable Object (latency + SSE).  
Never hide the schedule *only* inside DO memory.

---

## Recommendation (this report)

### Primary recommendation: **Canonical D1 + one-way Airtable projection (Option D), designed so Option E is a small add-on**

```
Public CFP / Speaker portal / Admin UI / Agent tools
                    │
            Cloudflare Worker API
         (auth + domain commands only)
                    │
     ┌──────────────┼──────────────┐
     │              │              │
    D1           R2 files     Event DO
  (truth,       (bytes)     (live locks /
   audit,                    invalidation)
   outbox)
     │
   Queue consumers
     ├─► Airtable projector (read-only mirror)
     ├─► email + ICS
     └─► (later) embeddings → Vectorize
```

### Why not Airtable-only?

Because the jobs-to-be-done are **workflow + constraints**, not “a nicer base”:

| Job | Needs |
|-----|--------|
| Conditional CFP forms | Versioned schema, stable field IDs |
| Evaluation rounds | Assignments, uniqueness, aggregates |
| Accept → tasks | Atomic status + task materialization |
| Drag-drop schedule | Atomic multi-resource booking, conflict rules |
| Outstanding-task dashboard | Fast multi-table query, live-ish updates |
| Agents over time | Reproducible queries, audit, migrations in git |

Airtable is excellent as a **shared ops lens**. It is a weak **transactional core** for this domain.

### Why still “use Airtable”?

Because the bonus and the culture are real:

- Operators already think in Airtable  
- Judges can verify “yes, data is in Airtable”  
- Grid views, filters, and linked records are free admin UX for non-engineers  
- A rebuildable mirror is low-risk if projection lags or breaks  

**Positioning for the README / demo:**  
> “Airtable is our ops and reporting surface. Cloudflare D1 is the product database. We project live program data into your Airtable so the team keeps their workflow.”

That *is* building to their stack. It’s just not **confusing a CRM grid with a conference OS**.

---

## What lives where

### D1 (canonical)

- Orgs, events, users, roles  
- Forms + **immutable form versions** + fields/rules  
- Submissions, answers, speakers, M:N links  
- Eval rounds, assignments, scores, decisions  
- Sessions, tracks, rooms, schedule placements / reservations  
- Task templates + instances  
- Message templates, jobs, delivery log  
- Audit log, outbox, projection mapping, idempotency keys  
- (Later) agent runs / tool calls / approvals  

### R2

- Headshots, slides, supporting docs  
- Large agent payloads / redacted dumps  
- Nightly exports/backups  

**Never** put primary file bytes in Airtable attachments (re-hosting, expiring URLs, double storage).

### Airtable (projection)

Human-friendly tables, denormalized as needed:

- Events, Submissions, Speakers, Sessions, Schedule, Tasks, Score rollups, Email status  
- Stable `Internal ID` / `_id` on every row  
- `View in app` deep link  
- `Last synced` / source version for lag transparency  

### Keep out of Airtable

- Auth secrets, magic-link tokens  
- Conditional-logic AST / executable form schema  
- Outbox, raw audit firehose, agent prompt traces  
- Constraint/reservation rows that only exist for integrity  
- Anything you would be sad to have renamed by a curious operator  

### Optional later: Airtable **command inbox** (not reverse sync)

If ops demand “I edit in Airtable”:

| Do | Don’t |
|----|--------|
| Append-only `Operator Actions` / `Ops Requests` | Treat mirrored fields as writable truth |
| Worker validates → same domain API | Last-write-wins field merge |
| Expected version / reject stale | Silent overwrite of scores/schedule |
| Tiny allow-list (notes, task due date, request accept) | Bulk email / publish schedule without app preview |

---

## Sync strategy (call it projection, not sync)

| Rule | Detail |
|------|--------|
| **Direction** | D1 → Airtable only for mirrored entities |
| **Trigger** | Transactional outbox on domain mutation |
| **Cadence** | Seconds (≤60s fine for demo); coalesce bursts |
| **Identity** | Upsert by internal ULID/UUID, map Airtable record IDs only in `projection_records` |
| **Rate limits** | Token bucket under 5 rps/base; batch upserts; backoff on 429; DLQ |
| **Deletes** | Prefer `Archived` flag over hard delete |
| **Recovery** | Entire Airtable base is disposable and rebuildable from D1 |
| **Product dependency** | Zero. Airtable down ≠ CFP down |

---

## Agentic layer (first principles without thrash)

“Agentic era” does **not** mean “LLM has an Airtable PAT.”

It means:

1. **Single write authority** — humans, UI, agents all call the same domain commands  
2. **Queryable truth** — SQL over a real schema agents can read from `schema.sql` / migrations  
3. **Attributable action** — `audit_log` + optional `agent_runs` with model/tool versions, inputs, outcomes  
4. **Human gates** on irreversible external effects (accept/reject blasts, calendar, publish schedule)  
5. **Derived intelligence later** — Vectorize/RAG over abstracts as an index, never as memory-of-record  

The brief **struck AI-assisted review**. Build the *shape* (audit, tools, outbox hooks), not an AI dependency in the critical path. That is good product judgment for the tiebreaker.

### Why Airtable-as-DB ages poorly for agents

| Agent need | Airtable primary | D1 canonical |
|------------|------------------|--------------|
| “Who is accepted but missing headshot + unopened task email?” | Multi-page API crawl | One SQL query |
| Schema evolution | UI clicks, no PR | Migration PR agents can draft/review |
| Reproducibility | Mutable grid | Versioned rows + audit |
| Tool safety | Stringly fields, easy footguns | Typed commands + FKs |

---

## Risks / anti-patterns (do not ship these)

1. **Bidirectional “sync engine”** as a product  
2. **Airtable on the hot path** (form submit waits on Airtable)  
3. **Split-brain hybrid (Option C)**  
4. **Dynamic form fields as DB/Airtable columns** — use stable field IDs + form versions  
5. **DO as unqueryable second database**  
6. **Vector store as source of truth**  
7. **Assuming at-most-once email/calendar delivery** — design for queue redelivery  
8. **One shared Airtable base for multiple customers** — base-per-customer for isolation  
9. **Spending the weekend on generic agent frameworks** instead of the form→score→accept→portal→schedule loop  

---

## MVP vs post-win

### Weekend cut (prove the loop + stack story)

Ship the demo path the video implies:

**Form → public submit → evaluate → accept → speaker portal/tasks → schedule with conflicts → outstanding-task dashboard → Airtable mirror visible**

| Include | Cut without guilt |
|---------|-------------------|
| D1 + migrations (Drizzle or SQL) | Multi-round complex eval workflows |
| Form builder + conditional show-if | Payments, multi-language |
| One eval round + accept/reject | AI review (struck) |
| Magic-link speaker portal + R2 uploads | Accelevents (struck) |
| Drag-drop schedule + server-side conflicts | Pixel-perfect Sessionboard UI |
| Templated email + **ICS attachments** | Full Google/Outlook OAuth calendar APIs |
| Outbox → Airtable projection | Bidirectional sync / command inbox |
| Audit on state changes | Embeddings, multi-tenant SaaS polish |

### Post-win hardening

- Operator command inbox from Airtable  
- Multi-round / blind review controls  
- Projection lag SLO, reconciliation UI, DLQ replay  
- Calendar update/cancel sequences  
- Vectorize for duplicate detection / assistive review (optional)  
- Public schedule embed (struck but easy and high-value)  
- Backups: D1 export → R2; restore drills  
- Postgres escape hatch only if interval-heavy scheduling or scale demands it  

---

## Schema sketch (high level)

Keep **everything event-scoped**. PKs = ULID/UUID. Mutable aggregates carry `version` for optimistic concurrency.

```
workspaces / events / users / memberships
forms → form_versions → form_fields / form_rules
submissions → submission_answers → submission_speakers
speakers (event-scoped profiles) ↔ people/users
eval_rounds → assignments → scores → decisions
sessions (optional source_submission_id) → session_speakers
tracks / rooms / time_blocks or schedule_slots
reservations (room × block, speaker × block)  -- uniqueness = conflict prevention
task_templates → speaker_tasks
message_templates → message_jobs → delivery_events
files (R2 keys only in D1)
audit_events + outbox_events + projection_records + idempotency_keys
```

**Sessionboard-aligned modeling note (from the walkthrough):**  
- **Submissions/abstracts** = applications  
- **Sessions** = program slots (accepted talks *or* sponsor/guaranteed slots with no CFP)  

That distinction belongs in the schema early; it prevents ugly null-hack migrations later.

---

## Competition strategy angle

| Goal | How this architecture serves it |
|------|----------------------------------|
| Pass independent eval | Real program loop works without Airtable uptime |
| Tiebreaker “we’d use this” | Fast product core + Airtable where their team already lives |
| Cloudflare bonus | Native Workers/D1/R2/Queues/DO |
| Airtable bonus | Live, browsable mirror with Internal IDs + deep links |
| Keep after weekend | No Airtable API ceiling baked into the engine |
| Agentic future | SQL + tools + audit without rewriting storage |

**Demo line that wins both judges and operators:**

> “Click submit on the public CFP. Watch the submission appear in the admin app *and* in Airtable within a minute. Drag the talk onto the schedule—conflict detection blocks double-booking. Accept a speaker—tasks appear in the portal and in Airtable. The app never waits on Airtable to do the right thing.”

---

## Final answer to your question

> *Is there a canonical internal database that pushes to Airtable, or do we rely on Airtable as the database?*

**Canonical internal database (D1). Push/project to Airtable. Do not rely on Airtable as the database.**

> *If Airtable doesn’t have the flexibility agents will need over time, do we still push some data across and keep a more agentic stack in the middle?*

**Yes.** That is the design:

- **Middle (and bottom):** agentic product stack on Cloudflare—relational truth, commands, audit, queues  
- **Edge toward their ops world:** Airtable as a projection (and later a request UI)  
- **Not:** two half-databases meeting in the middle (Option C)

You are not rejecting their stack. You are **mapping roles correctly**:

- **Airtable** = collaboration and visibility layer for humans who already live there  
- **D1** = system of record for a real multi-step conference program tool  
- **Agents** = operators on the same API, not spreadsheet co-authors with root access  

---

## Artifacts in this folder

| File | What it is |
|------|------------|
| `advisor-prompt.md` | Prompt given to both advisors |
| `AUDIT-claude.md` | Claude’s full independent audit |
| `AUDIT-codex.md` | Codex’s full independent audit |
| `REPORT-data-architecture.md` | This synthesis + recommendation |

---

*— Synthesis by Grok, with independent audits from Claude and Codex*
