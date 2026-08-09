# SpeakerOps Lumen 2 — UX and information architecture decisions

Status: reference candidate  
Machine-readable companion: `page-atlas.json`  
Route source checked: `apps/web/src/App.tsx`  
Governance checked: Lumen IA lock and public-program amendment

This document decides how each SpeakerOps surface should work as a user
experience. It is intentionally concerned with information order, browsing,
view format, context, and decisions—not merely visual styling.

## 1. Product mental model

SpeakerOps is one event-scoped operating loop:

```text
Call for proposals
  → submissions
  → evaluations
  → decisions and speakers
  → schedule
  → communications
  → readiness
```

The navigation follows that model. It must not resemble a generic enterprise
module catalogue. Users should always understand:

1. Which event they are changing.
2. Where the active record is in the program lifecycle.
3. What requires attention.
4. What will happen if they take the next action.

## 2. Navigation model

### 2.1 Admin

Use a persistent left rail at desktop, collapsed menu at tablet/mobile, and a
persistent active-event context. The primary navigation contains destinations,
not actions or filters.

Recommended grouping:

```text
Program
  Overview
  Call for proposals
  Submissions
  Evaluations
  Speakers
  Schedule
  Communications

Workspace
  Settings
```

These groups are visual scan aids only; they do not introduce new product
modules.

### 2.2 Evaluator

Evaluators get a focused shell, not the admin rail. The header contains event,
queue progress, and account/logout. The only product destination is **My
queue**. Proposal review occurs in that context.

### 2.3 Speaker portal

Speaker navigation is mobile-first:

- Home — participation state and next action.
- Tasks — required and completed readiness work.
- Profile — public and private speaker information.
- My sessions — accepted sessions, time, room, and program updates.

Use bottom navigation on mobile and compact top/sub-navigation on desktop. The
current `/portal` route can expose these as local subviews first; dedicated
client routes may follow without new API commands.

### 2.4 Public program

The ratified public navigation remains:

- Sessions — browse by subject/track.
- Speakers — browse by person.
- Agenda — compare parallel rooms for a day.
- Itinerary — follow the full program chronologically.

The header also exposes event identity, dates/timezone, and a proposal action
while the CFP is open. Public pages never expose admin status, tasks, internal
notes, contact details, or submission/evaluation data.

## 3. Label decisions

Two existing locked labels are functional but unnecessarily cryptic. The UX
recommendation is:

| Current locked label | Recommended visible label | Reason |
|---|---|---|
| CFP / Forms | Call for proposals | Names the outcome; removes slash-language and implementation terminology |
| Comms | Communications | Clear to a first-time operator and consistent with campaign work |
| Design Kit | Event brand | Names the task rather than the internal system |

The first two require a small label-only amendment to the ratified Lumen IA
before implementation. Routes, permissions, commands, and inventory IDs do not
change. Until that amendment is approved, implementation agents retain current
labels while using the recommended page composition.

## 4. Choosing the right page format

Use the data and task shape—not visual fashion—to choose a view:

| User need | Best format | Avoid |
|---|---|---|
| Understand health and exceptions | Dashboard with ranked attention queue | Equal-weight card mosaic |
| Scan and compare many records | Table or compact list | Card grid with hidden fields |
| Inspect one record without losing a queue | Master-detail | Modal over a dense table |
| Create a structured artifact | Canvas/outline/inspector | Giant undifferentiated settings form |
| Complete a consequential sequence | Step flow with review | One screen with every control visible |
| Place objects in time/space | Grid plus tray and list alternative | Table-only schedule editor |
| Browse public people | Responsive directory cards | Admin-style data table |
| Follow events in time | Chronological timeline | Room matrix on a phone |
| Configure categories | Settings shell with local navigation | Accordions containing unrelated systems |

Cards are not a default page format. Use them for bounded objects, summaries,
and public browse items—not for every section on every route.

## 5. Admin destinations

### 5.1 Overview

**Question answered:** Is this program on track, and what needs me now?

Default format: readiness dashboard.

Information order:

1. Active event, date context, and concise program status.
2. Four program outcomes: submissions, evaluation coverage, confirmed
   speakers, schedule readiness.
3. Readiness dimensions with visible calculation inputs.
4. Ranked attention queue with direct destination/action.
5. Momentum and activity after exceptions.

The Overview is not an analytics report. Avoid decorative charts, vanity
counts, and activity feeds above required work. New events receive a guided
setup path; complete events receive a calm “all clear” with next milestone.

### 5.2 Call for proposals

**Question answered:** What will applicants see, and is the form ready to
publish?

Default format: three-pane builder at desktop.

- Left: ordered section outline.
- Centre: public form canvas with direct field selection/reorder.
- Right: inspector for the selected field or section.

Local views:

- Build — normal editing.
- Public preview — actual renderer, actual event tokens, representative device
  widths.
- Publish summary — changed fields, validation, response-data implications,
  and live impact.

Do not land on an empty cards page if there is one active CFP per event. If the
domain later supports multiple forms, add a lightweight form switcher above the
builder rather than turning the route into a generic form-management product.

### 5.3 Submissions

**Question answered:** Which proposals need a decision or assignment?

Default format: table with master-detail pane.

Primary columns:

- Proposal title + stable ID.
- Speaker(s).
- Track/category.
- Assignment/coverage.
- Aggregate score when permitted.
- Decision state.
- Last activity or deadline risk.

Saved views are task-based: All, Unassigned, In review, Decision needed,
Accepted, Waitlist. Search and filters remain visible as a summary and survive
detail navigation.

Desktop selection opens a side detail pane. Mobile selection opens a dedicated
full-screen detail, returning to the exact scroll/filter state. Bulk decisions
always enter a preview that names count, records, resulting state, and side
effects before confirmation.

### 5.4 Evaluations

**Question answered:** Is review coverage sufficient, fair, and on time?

Default format: coverage table grouped by submission.

Alternate views:

- By submission — default; identifies under-reviewed proposals.
- By evaluator — workload, completion, and overdue assignments.
- Overdue — exception queue.
- Conflicts — declared or suspected conflicts needing reassignment.

The detail pane shows assignment list, rubric completeness, due dates, and
reassignment controls. Do not blend this admin oversight page with the
evaluator’s scoring workspace.

### 5.5 Speakers

**Question answered:** Which accepted participants are not program-ready?

Default format: lifecycle table over event participations.

This is not a portrait gallery. Useful columns include person, confirmation,
profile, tasks/files, session assignment, travel/readiness where applicable,
and last contact. These are separate dimensions; do not compress them into one
opaque “status.”

Saved views: Needs action, All speakers, Unconfirmed, Profile incomplete,
Travel/tasks. The detail pane contains contact information, public profile,
sessions, tasks, files, communication history, and internal notes with clear
privacy boundaries.

### 5.6 Schedule

**Question answered:** Where can this session be placed without creating a
program conflict?

Default desktop format: selected day × room grid with unscheduled tray.

Views and their purpose:

| View | Purpose |
|---|---|
| Day | Primary editing and conflict resolution |
| Week | Understand multi-day shape and coverage |
| List | Fast audit, keyboard editing, export-like scanning |
| Track | Check thematic distribution and track conflicts |
| Room | Check capacity and room continuity |

Selection opens session details without obscuring the affected slots. Conflicts
appear on the tile and in a navigable summary. Drag is a convenience; Place,
Move, and Unschedule actions remain keyboard/touch accessible.

On mobile, do not squeeze the full room grid. Use a day agenda editor with
time-grouped sessions and explicit Place/Move actions; room and track become
filters.

### 5.7 Communications

**Question answered:** Who has been contacted, what will be sent next, and is
delivery healthy?

Default route format: campaign index, not a permanently open composer.

Local views:

- Campaigns — Draft, Scheduled, Sending, Sent.
- Templates — reusable event messages.
- Delivery issues — bounced, suppressed, and retryable recipients.

A campaign opens the four-step flow:

1. Audience — plain-language rules, live count, sample, exclusions.
2. Message — template/content, sender, reply-to, merge variables, personal
   preview.
3. Review — exact count, invalid/bounced contacts, missing variables, schedule
   and timezone, test-send state.
4. Send — explicit consequence confirmation, durable progress, partial result.

This replaces raw checkbox walls. Individual record selection is a narrow
exception layered on top of a defined audience, not the primary selection
model.

### 5.8 Settings

**Question answered:** Which controlled part of this event/workspace am I
configuring?

Default format: settings shell with local vertical navigation at desktop and a
settings index at mobile.

| Item | Purpose | Best format |
|---|---|---|
| Event | Dates, timezone, rooms, tracks | Sectioned form; rooms/tracks as editable tables |
| Evaluation rubric | Review criteria and scale | Ordered criterion editor + evaluator preview |
| Task templates | Repeatable speaker tasks | Master-detail list/editor |
| Event brand | Public identity and publish state | Controls beside scoped live preview |
| API keys | Machine credentials and scopes | Active/revoked table + guarded create/revoke |
| Airtable | One-way projection health | Health summary + exception list |

Each settings destination owns one dirty state and one save region. Do not
combine all settings into a single, endlessly scrolling page.

## 6. Evaluator experience

### My queue `/eval`

**Question answered:** What is my next review, and can I complete it safely?

Default desktop: compact queue left, proposal/rubric workspace right. Mobile:
queue list, then full-screen review.

Queue filters: To do, Completed, Conflict. Each item shows title, deadline,
progress, and conflict state. The review workspace keeps proposal evidence,
rubric, private notes, and autosave status visible. A network failure preserves
local work and provides retry. Conflict-of-interest is a primary action, not a
menu afterthought.

## 7. Speaker portal experience

### Home

Order: participation state, single next action, profile completion, session
record, important event update. Do not show an admin dashboard to a speaker.

### Tasks

Use an ordered list grouped by Needs attention, Upcoming, Complete. Each task
explains why it is required, due date, submission action, and completion state.

### Profile

Group public identity separately from private/logistical information. Explain
where each public field appears. File uploads show requirements and progress.

### My sessions

Use session cards with current title, format, time, room, co-speakers, and
program-change state. Edits that require organizer approval state that process
before submission.

## 8. Public experience

### CFP

Lead with event promise, deadline, formats, estimated effort, support, and
save-and-return behavior. Use four meaningful steps: About you, Your session,
Experience, Agreement. Progress is persistent; validation is local and
recoverable. Confirmation states what was received and when to expect a reply.

### Sessions

Default: vertical session-card list, grouped by day/time once schedule data is
available. Search title/description/speaker; filter by track. Cards show title,
time, room, track, and speakers. The page must remain useful without images.

### Speakers

Default: responsive portrait directory because public discovery benefits from
human identity. Fall back gracefully to initials/text when a headshot is
missing. Search name, title, company, and session. Detail is a dedicated URL so
it can be shared and accessed directly.

### Agenda

Purpose: compare concurrency. Desktop uses day tabs and room columns aligned to
time. Mobile uses day tabs, a room filter, and a chronological selected-room
list. This is the planning/comparison view.

### Itinerary

Purpose: follow what happens next. Use a day-grouped ordered timeline across
all rooms, clearly grouping simultaneous sessions. This is the chronological
view and is not a personal saved agenda.

## 9. Cross-page browse behavior

### Search

- Search is scoped to the current dataset and names that scope in its label.
- Search updates results without destroying current filters.
- Empty results preserve the query and offer filter reset.
- Search state belongs in the URL when it is useful to share or restore.

### Filters

- Common task views appear as named tabs/chips.
- Advanced filters open a sheet/popover and collapse to a readable summary.
- Active filters show count and can be removed individually.
- “Clear all” does not clear search unless explicitly stated.

### Sorting

- Defaults are task-based, not alphabetical by accident.
- Table sorting is visible and keyboard accessible.
- Public timelines always sort chronologically; relevance applies only to
  search results where explained.

### Detail

- Use a side pane when users must preserve and compare a queue.
- Use a dedicated route when details are shareable, deep, or mobile-primary.
- Use a modal only for a bounded decision that must block the background.
- Never put an entire record-editing workflow in a small modal.

### Multi-selection

- Selection is for an explicit bulk action, not a default browse mode.
- The action bar states selected count and scope.
- “All” distinguishes visible page from all matching results.
- Preview consequences before bulk decisions, sends, or destructive changes.

## 10. Mobile navigation and view conversion

- Admin rail becomes a menu sheet; active event remains visible before
  mutating work.
- Master-detail becomes list → full-screen detail with state restoration.
- Inspector becomes a bottom/full-height sheet.
- Room grids become day lists with room filters and explicit placement actions.
- Dense tables become either controlled horizontal regions or purpose-built
  record rows; do not hide critical state merely to avoid scroll.
- Public primary navigation may scroll horizontally or collapse behind a clear
  Program menu, while the current destination remains visible.
- Speaker portal uses bottom navigation and keeps the next action above the
  fold.

## 11. Empty, loading, and failure UX by page type

| Page type | Empty state | Failure priority |
|---|---|---|
| Dashboard | Guided setup or “all clear” | Preserve last-known summary and mark stale |
| Table/queue | Explain how records arrive | Keep filters; retry failed data region |
| Builder | Create/start action | Preserve local edits and expose retry/export where possible |
| Schedule | Add rooms/time then sessions | Never lose placements; reconcile version conflict |
| Campaign | Create first campaign | Preserve audience/message; never imply send success |
| Public browse | Program not published yet | Event identity and recovery/contact remain visible |
| Portal | State next expected milestone | Preserve task/profile input and explain organizer impact |

## 12. Decision summary

The key UX corrections are structural:

- Overview becomes attention-first, not empty-card-first.
- CFP becomes a real builder, not a long engineering form.
- Submissions, evaluations, and speakers use distinct operational tables
  because their questions differ.
- Schedule uses a spatial editor with meaningful alternatives.
- Communications lands on campaign history and uses a consequence-safe creation
  flow.
- Settings becomes a navigable system rather than an endless page.
- Public Sessions, Speakers, Agenda, and Itinerary have distinct browse models.
- Evaluator and speaker roles receive focused shells instead of reduced admin.

Implementation agents must use `page-atlas.json` as the route-by-route machine
contract and this document as the interaction rationale.
