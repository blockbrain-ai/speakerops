# Architecture advisory request

You are an independent architecture advisor. Do NOT implement anything. Write a sharp audit/opinion only.

## Context
Remote hackathon ("Kill My SaaS"): open-source clone of Sessionboard program/CFP software for a real customer currently paying ~$40k/year.

Core product loop:
- Custom CFP forms (conditional logic, categories)
- Submissions → evaluation/scoring rounds → accept/reject
- Speaker portal (bio, headshots, slides, tasks)
- Templated speaker email + calendar invites
- Drag-drop schedule with conflict detection
- Real-time dashboard of outstanding speaker onboarding tasks

Competition soft preferences (bonus, not hard requirements):
- Deploy on Cloudflare
- Persistence/DB using Airtable
- (Struck/deprioritized: Accelevents one-way integration)

We want an **agentic, first-principles** design for 2026: human operators + coding/ops agents should be able to query, reason over, and improve the system over time. Still worth "building to their stack" (Cloudflare + Airtable affinity).

## Question to answer
What is the right data architecture?

Options to evaluate (and invent better ones if needed):
A) Airtable as system-of-record / primary database
B) Canonical internal DB (D1/Postgres/SQLite/etc.) that pushes/syncs to Airtable for human ops
C) Hybrid: Airtable for ops-facing tables; internal store for high-churn / agent / relational-heavy data
D) Airtable as read-only projection / export surface only
E) Other

Consider:
- Multi-tenant or multi-event conference program data model (forms, submissions, speakers, evals, sessions, rooms, tracks, tasks, emails)
- Real-time dashboards, conflict detection, concurrent edits
- Rate limits (Airtable ~5 req/s/base, pagination 100, monthly quotas on lower plans)
- Schema evolution and relational integrity (many-to-many speakers↔sessions, eval rounds, schedule conflicts)
- Agent access patterns: structured queries, embeddings/RAG over submissions, tool-use, audit trails, eval traces
- Competition scoring: judges may literally want to open Airtable and "see the data"
- Weekend shippability vs product they'll actually keep using
- Failure modes of bidirectional sync
- Cloudflare-native options (D1, Durable Objects, R2, Queues, Workers, Vectorize)

## Deliverable
Write `architecture/AUDIT-<your-name>.md` with:
1. Executive recommendation (pick a path, be opinionated)
2. Decision matrix (options vs criteria)
3. Proposed reference architecture (components + data ownership)
4. What lives in Airtable vs not
5. Sync strategy if any (direction, cadence, conflict rules)
6. Agentic layer implications
7. Risks / anti-patterns
8. MVP weekend cut vs post-win hardening
9. Concrete schema sketch (tables/entities) at high level

Be concise, concrete, adversarial. No fluff. Sign as Codex or Claude.
