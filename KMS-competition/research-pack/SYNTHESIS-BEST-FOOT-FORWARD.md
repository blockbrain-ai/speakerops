# Best foot forward — vision, features, stack, and reasoning

**Date:** 2026-08-08  
**Status:** Canonical synthesis for planning / Section Runner (supersedes pack scope where they conflict)  
**Synthesizer:** Grok  
**Independent audits:** `AUDIT-claude.md`, `AUDIT-codex.md`  
**Advisory input (not binding):** `pack/ai_engineer_speakerops_research_pack/`  
**Also used:** official competition Word brief, YT walkthrough, `architecture/*`, `design/*`

---

## Owner message (passed to auditors verbatim)

> The agent that put that pack together did not have the word document yet that gave us some information about the existing tech stack and those sorts of things. So this is advisory only. It is made an assumption that of who the actual end user of this product is based on the screenshot and it's gone and done a deep dive. So do you agree, does it make sense that they're the likely end user of this? And if so, I want you to either agree with or challenge everything in the report report… production, hard and quality, not an MVP… no unnecessary over-engineering…

This document is the answer.

---

## Executive verdict (one screen)

| Question | Answer |
|----------|--------|
| Is the pack’s end-user ID right? | **Yes.** Customer = **AI Engineer / Software 3.0**; product to replace = **Sessionboard**. Brief now **confirms** both. |
| Who actually uses the product day-to-day? | **Program operators**, **reviewers**, **speakers/submitters** — not marketing, travel, sponsors-as-CRM, or an “agent fleet.” |
| Follow the pack’s product thesis? | **No.** Pack over-indexes on **agent control plane** + post-acceptance/import wedge. Customer on video: *“I don't care about the AI workflow thing.”* Brief **starts with CFP forms**. |
| What do we build? | A **production-hard Program OS**: full loop **CFP → score → accept → portal → comms/calendar → schedule → readiness dashboard** — beautiful, fast, Cloudflare-native, Airtable-projected — plus a **CLI + scoped API keys** so their agents can administer the same commands (Software 3.0). |
| MVP? | **No thin MVP.** Ship fewer surfaces, each one **correct, tested, operable**. |
| Over-engineering? | **Cut** in-product multi-agent fleets/MCP theatre/OR-Tools/Temporal/Postgres+Next default/config meta-platform/struck features. **Keep** Person≠Speaker, typed commands, audit, idempotent sends, conflict detection, design tokens. **Add** customer-owned **CLI over those commands** (not a parallel god-mode). |

**Working product name:** *SpeakerOps* (or Program OS — name free; substance fixed).

---

## 1. End-user identification

### Agree: the pack’s customer hypothesis was excellent

| Claim | Confidence now | Why |
|-------|----------------|-----|
| Buyer/customer is **AI Engineer** (operated by **Software 3.0 Inc**) | **~99%** | Quote named AIE events; About page names Software 3.0; competition evaluated by **AIE team**; swyx walkthrough is “we are a real customer.” |
| Quoted SaaS is **Sessionboard** | **100%** (was ~90–95% in pack) | Official Word brief: *“replace Sessionboard, which costs >$40k a year.”* Pack’s quote forensics (speaker-count units, ~$66/person, custom email domain) were strong *before* confirmation. |
| Host/media layer = Latent.Space / swyx | High | Competition presentation; not the same as “who lives in the tool daily.” |

### Challenge: “end user” is not “the whole company”

The pack deep-dived the **company** (media, sponsors, travel, multi-continent portfolio). That research is valuable **context**, but the **end users of this build** are:

| Role | Jobs | In scope? |
|------|------|-----------|
| **Program admin / ops** | Forms, decisions, schedule, comms, readiness | **Primary** |
| **Evaluator / committee** | Score assigned submissions | **Yes** |
| **Submitter / speaker** | CFP + portal tasks | **Yes (external)** |
| Marketing / content studio | Clips, advocacy, CMS | **No** (video: not marketing side) |
| Travel / finance | Bookings, reimbursement | **No** |
| Sponsor sales ops | Package fulfillment CRM | **No** (sponsor session = direct-entry flag only) |
| **Customer agents (via CLI/API keys)** | Administer platform through **same** domain commands; design tweaks, uploads, reports, mutations under **scoped** keys | **Yes — owner requirement** (Software 3.0 surface) |
| In-product multi-agent control plane / MCP product UI | Built-in autonomous fleet with ledgers | **No** (pack overfit; customer deprioritized “AI workflow thing”) |

**Falsifiers that would change this** (none currently apply): judges demand CRM/Marketing/CMS; frozen walkthrough removes native CFP; different team owns the workflow.

---

## 2. What the research pack got right (keep)

Both auditors and this synthesis **keep**:

1. **Clean-room** — original IA, design, code; no Sessionboard trade dress/private APIs.  
2. **Person ≠ Speaker** — durable person + event/session participation (roles, tasks, consent, status).  
3. **Submission ≠ Session** — applications vs program slots (incl. sponsor/direct entry).  
4. **Exception-first readiness** — who is blocking, not endless grids.  
5. **Preview → approve → idempotent send** for communications.  
6. **Deterministic integrity** — conflict rules, authz, audit, optimistic concurrency — not LLM-owned timers.  
7. **Human authority on accept/reject** — especially since AI-assisted review is **struck**.  
8. **Non-goals** — no ticketing, attendee app, payments, video suite, badge printing.  
9. **Performance as a feature** — customer mocks Sessionboard slowness **twice** on video.  
10. **Modular monolith + typed domain commands** (principle, not pack’s exact stack).

---

## 3. What the pack got wrong (challenge hard)

| Pack direction | Verdict | Why |
|----------------|---------|-----|
| Wedge = import → post-acceptance ops; CFP secondary | **Reject** | Brief feature **#1** = custom CFP; video centers form builder. Full program loop. |
| Differentiator = agent control plane (agents, MCP, autonomy, ledgers) | **Reject** | Customer: *don’t care about AI workflow*; AI review **struck**. |
| 83+ P0s / 151 requirements as build plan | **Reject** | Priority system that prioritizes everything prioritizes nothing. |
| OR-Tools / CP-SAT agenda solver | **Defer** | Need drag-drop + **conflict detection** + five views — human is the solver. |
| Postgres + Next + Temporal + Python sidecar as default | **Replace** | Misses CF/Airtable bonuses; Next/RSC security posture; too many moving parts for deadline. |
| Bidirectional integration reconciliation | **Reject** | Settled: **D1 SoR, Airtable one-way projection**. |
| Travel, sponsor CRM, media/transcription, embeds, wiki, Accelevents | **Out** | Struck or absent from brief. |
| Five-layer config-as-code / plugin SDK | **Out** | Over-engineering. Real “customizable” = forms, fields, templates, brand tokens. |
| 48h plan that under-builds form builder & drag-drop schedule | **Do not follow** | Both auditors flag this as competition-losing if executed as written. |

---

## 4. Auditor consensus (Claude + Codex)

| Topic | Claude | Codex | Synthesis |
|-------|--------|-------|-----------|
| Customer/vendor ID | Agree, confirmed | Agree, confirmed | **Lock** |
| Full program loop vs post-accept only | Challenge pack | Challenge pack | **Full loop** |
| Kill agent plane for competition | Yes | Yes | **Kill** |
| Keep Person≠Speaker, audit, idempotency | Yes | Yes | **Keep** |
| Drag-drop + conflict validator, no OR-Tools | Yes | Yes | **Keep** |
| Cloudflare + D1 + R2 + Queues; Airtable projection | Yes | Yes | **Lock** |
| React+Vite SPA, not Next/RSC | Yes | Yes | **Lock** |
| Design kit / Apple-level UX mandatory | Yes | Yes | **Lock** |
| Production-hard, not prototype shortcuts | Yes | Yes | **Lock** |
| Calendar = real iCal UID/SEQUENCE lifecycle | Emphasized | Emphasized hard | **Must-quality** |

No second audit round required: agreement is high enough to freeze scope.

---

## 5. What we are building (features)

### Product one-liner

**A calm, fast, open-source Program OS that takes an event from conditional CFP through human evaluation, speaker onboarding, templated comms/calendar, conflict-safe scheduling, and a live readiness dashboard — deployed on Cloudflare, mirrored into Airtable, owned by the customer forever.**

### The six judged workflows (MUST — production-hard)

Each item below is **complete enough to operate a real multi-day tech conference cohort** (seed ~100–150 speakers), not a screenshot mock.

| # | Workflow | Why (brief + AIE fit) | Production bar |
|---|----------|----------------------|----------------|
| 1 | **CFP form builder + public submit** | Brief #1; video “fancy form builder” | Conditional logic, category routing, versioned form pinned on submission, multi-speaker, open/close, limits, Turnstile, mobile-clean public UX |
| 2 | **Evaluation & scoring** | Brief #4 (human; AI struck) | Assignments, rubric, comments, rollup, accept/reject/waitlist, audit; single round; schema allows a 2nd round later without rewrite |
| 3 | **Speaker portal** | Brief #2 | Magic link → HttpOnly session; bio, headshot, slides, docs; task checklist; multi-speaker sessions |
| 4 | **Comms + calendar** | Brief #3 | Templates + merge fields; audience preview; approve; **idempotent** send; delivery log; **RFC 5545 ICS** with stable UID / SEQUENCE / cancel |
| 5 | **Schedule studio** | Brief #5 | Drag-drop **and** keyboard; rooms/tracks/times; list/day/week/track/room; **instant** conflict explain; undo; draft/version safety |
| 6 | **Readiness dashboard** | Brief #6 | Outstanding tasks, overdue/blocked; live update when portal completes; drill-down; bulk reminder entry point |

### Platform MUST (invisible but “production hard”)

- **Roles enforced server-side:** admin · evaluator · speaker · public  
- **Typed domain commands** (Zod): authz, validation, `expected_version`, idempotency key, audit event  
- **D1 migrations in git**; R2 private files with type/size checks  
- **Outbox + Queues** for email, reminders, Airtable projection  
- **CSP, secure cookies, no user HTML/CSS injection**, sanitized text  
- **Playwright E2E** for every UI action × allowed and denied roles (owner requirement)  
- **Seeded demo event** + one-command local + **deployed** Cloudflare site + open-source README  

### MUST (owner — Software 3.0 / agentic admin)

**CLI + scoped API keys** — first-class admin surface, not a side project:

| Capability | Detail |
|------------|--------|
| **CLI** | Administer the platform without the browser: events, CFP meta, submissions, speakers/tasks, schedule place, design-kit tokens, uploads, readiness/reporting, comms draft/preview (send gated) |
| **Same commands** | CLI calls the **existing** domain API — agents cannot invent side doors; design tweaks go through Design Kit commands, not raw CSS |
| **API keys** | Hashed at rest; mint once; revoke; expiry; optional per-event bind |
| **Scoped permissions** | e.g. `design:write`, `reports:read`, `schedule:write`, `comms:send`, `decisions:write`, `files:write` — department agents get least privilege |
| **Audit** | Every CLI/API action attributed to `key_id` + scopes, same ledger as UI |
| **Agent-friendly I/O** | `--json`, stable exit codes, dry-run/preview on side effects |
| **OpenAPI** | Generated from the command registry so humans, SPA, CLI, and external agents share one contract |

Full design: `architecture/REPORT-cli-agentic-admin.md`.

**Demo beat (optional but strong for AIE judges):**  
`speakerops reports readiness --json` → agent drafts reminder → `speakerops comms draft --preview` → human or privileged key sends.

### SHOULD (bonus / polish — only after MUST is green)

1. **Airtable one-way projection** (bonus + team affinity) — lag visible, replayable, never request-path  
2. **Design Kit web dashboard** — tokens: brand color, logo, radius, fonts (allow-list); draft/publish; no freeform CSS (**CLI design commands also required** under owner MUST)  
3. **CSV / Sessionize-shaped import** for migration credibility (not live bidirectional sync)  
4. **Hosted public schedule page** (embeds struck; a simple public page is cheap and demos well)  
5. **Bulk admin actions** with exact preview  
6. **Key management UX** polish (usage last-seen, scope templates: “Design bot”, “Read-only reporter”)  

### DEFER (explicit judgment — show in README as roadmap)

| Deferred | Reason |
|----------|--------|
| AI review / **in-product** multi-agent fleets / MCP product UI / NL query / agent ledgers | Struck or customer disinterest in *productized* AI workflow; **customer-owned CLI agents remain in scope** |
| OR-Tools / auto-schedule | Unrequested; drag-drop + conflicts win demos |
| Accelevents, portal wiki, embeddable gallery | **Struck in brief** |
| Travel module, sponsor CRM, media/transcription | Not in brief; company-profile overfit |
| Config meta-platform, plugins, Temporal, multi-region | Over-engineering |
| Bidirectional Airtable / dual-write | Split-brain; rejected architecture |

### Demo story (judging path)

```
Theme event (Design Kit)
  → Publish conditional CFP
  → Public submit (+ multi-speaker)
  → Route → score → accept
  → Speaker completes portal task
  → Dashboard updates live
  → Place on schedule (show conflict, then valid place)
  → Preview + send reminder / calendar invite
  → (Optional) Open Airtable mirror
```

That single path covers every active brief requirement and the stack story.

---

## 6. Stack (locked for this program)

Reconciles: pack principles · official CF/Airtable bonuses · architecture consensus · frontend security · design flexibility.

```
┌──────────────────────┐     ┌─────────────────────────────────┐
│ React + Vite SPA     │     │ speakerops CLI + customer agents│
│ Admin · Eval · Portal│     │ API key + scopes · --json I/O   │
│ Public CFP           │     └────────────────┬────────────────┘
└──────────┬───────────┘                      │
           │ cookies                          │ Bearer API key
           └──────────────┬───────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker (Hono) — domain commands only        │
│  authz (session OR key scopes) · Zod · audit · idempot. │
└───┬─────────────┬──────────────┬──────────────┬─────────┘
    │             │              │              │
   D1 SoR        R2 files    Queues/outbox   DO (live
   truth         private     email, ICS,     schedule/
   + audit       assets      Airtable drain  dashboard
   + api_keys                    │           invalidation)
    │                            ▼
    │                     Airtable (one-way projection)
    │                     Email provider (e.g. Resend)
    └──────── migrations in git; Time Travel recovery
```

| Layer | Choice | Not choosing | Why |
|-------|--------|--------------|-----|
| UI | React + Vite SPA + design tokens | Next App Router / RSC default | Security surface, CF fit, flexible design during SR builds |
| API | Hono on Workers | Separate Fastify/Railway fleet | One deploy, one trust boundary |
| DB | **D1** SoR + Drizzle | Postgres dual-stack; Airtable as primary | Workload fits; CF bonus; projection to Airtable for ops |
| Files | **R2** | DB blobs; Airtable attachments | Size, security, URLs |
| Jobs | Outbox + **Queues** (+ Workflows if needed for timers) | Temporal | Enough durability without ops theatre |
| Live | **DO** invalidation only | DO as second DB | Clients re-query D1 |
| Airtable | One-way projection | Bidirectional / SoR | Bonus without split-brain |
| Schedule integrity | In-process conflict engine | OR-Tools sidecar | Brief match; fewer failure modes |
| Auth | Magic link / invite → **HttpOnly Secure** cookies; **API keys** (hashed) + scopes for CLI/agents | localStorage JWT; single god-mode token | XSS resilience; least-privilege machine access |
| CLI | First-party CLI over OpenAPI/domain commands | Separate admin backend / raw SQL REPL | Software 3.0 agentic admin without dual write paths |
| Public CFP | Turnstile + rate limit | Open free-for-all | Spam/deadline bursts |
| Theming | CSS variables + Design Kit | Freeform CSS/HTML | XSS + design flexibility |

**Invariant line (from architecture work + owner CLI requirement):**  
*D1 decides; Worker enforces; Queues deliver; Airtable displays; SPA is fast and beautiful; CLI/agents use the same commands under scoped keys — no parallel god-mode, no in-product agent fleet required.*

---

## 7. Design & frontend (pack missed this; we do not)

Owner + design kits + auditors:

- **Bar:** Apple-level — light, airy, curvy, tasteful. Not dark vibe-coded slop.  
- **Tokens first** so Section Runner can refine beauty over a long build without rewriting components.  
- **Design Kit** as a product surface for event branding (safe controls only).  
- **Hero interactions:** schedule drag-drop; public CFP; speaker checklist; batch email preview.  
- **Speed as brand:** optimistic UI, instant nav, p95 interactions feel native — customer’s Sessionboard complaint.  
- **Role-specific chrome:** admin density; evaluator focus queue; speaker one-next-action; public calm form.  
- **E2E contract:** every control maps to API + role — no FE/BE orphan features.

See: `design/OWNER-PREFERENCES-VERBATIM.md`, `design/design-kit-REPORT-*.html`, `architecture/REPORT-frontend-stack-security.md`.

---

## 8. Quality bar: “production hard” without over-engineering

| Production hard means | Over-engineering means (cut) |
|----------------------|------------------------------|
| Authz on every write | Multi-region, k8s, microservices |
| Idempotent email/calendar | Multi-provider abstraction layers |
| Conflict-safe schedule commits | Auto-schedule solvers |
| Migrations, backups story (D1 Time Travel) | Custom HA database cluster |
| Real deployed env with secrets hygiene | Perfect enterprise SSO/SCIM day one |
| E2E for all six flows × roles | 95 agent tools and MCP server |
| Accessible critical paths | Full formal WCAG certification project |
| Observable errors/logs | Full OpenTelemetry mesh |

Narrow surface + deep correctness > wide surface + soft prototype.

---

## 9. Risks we refuse

1. Building agent demo instead of form builder + schedule.  
2. Following pack 48h plan that deprioritizes brief #1 and #5.  
3. Airtable dual-write or “split ownership hybrid.”  
4. Next/RSC default under known RCE-class history without explicit decision.  
5. Shipping untested role bypasses or double-send emails.  
6. Scope creep into struck or company-overfit modules.  
7. Freeform theming that becomes XSS.

---

## 10. Full top-level vision (for judges and for us)

### Who it’s for

The **AI Engineer program team** — a lean, technical conference operator paying **>$40k/year** for Sessionboard and using primarily the **program** surface: forms, evaluation, speakers, schedule, tasks, and messages. Not a full event-suite buyer.

### What problem we solve

Closed, expensive, hard-to-customize SaaS that is **slow** and broader than needed. They want something they **own**, that fits **their** loop, that their team can run on **Cloudflare + Airtable**, and that feels like a **modern product**.

### What the product is

**SpeakerOps** is the system of record for:

1. Designing and publishing **conditional CFPs**  
2. **Routing and scoring** submissions (humans)  
3. Turning accepts into **speaker work** (portal tasks, files)  
4. **Communicating** with templates and **calendar invites**  
5. **Scheduling** without double-booking  
6. Seeing **who still blocks showtime**

Customization = forms, fields, templates, brand tokens — self-serve, no support ticket.  
**Agentic ops (Software 3.0)** = first-party **CLI + scoped API keys** so *their* agents can run the same admin/report/design/upload paths humans use in the UI — least privilege per department, full audit.  
Intelligence = **excellent tool surface**, not a mandatory built-in multi-agent product (customer can bring Claude/Codex/internal bots).

### Why this wins the tiebreaker (“would we use/buy this?”)

- Matches the **named** six features, not Sessionboard’s catalogue.  
- **Faster and calmer** than the incumbent they complained about.  
- Lives on **their** stack (CF deploy + Airtable visibility).  
- **Open source** — they keep it.  
- **CLI + scoped keys** — fits how a Software 3.0 / AI-native team actually wants to operate (agents on a leash, not spreadsheet hell and not a closed SaaS).  
- Shows **judgment**: struck features stay struck; no fake in-app agent platform; real agentic admin via tools they control.

### How we build it

Section Runner packs against this frozen scope; UI contracts + E2E first; design tokens early; no agent/solver/meta-platform epics.

---

## 11. Artifact map

| Path | Role |
|------|------|
| `research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md` | **This file — scope authority** |
| `research-pack/AUDIT-claude.md` | Independent audit |
| `research-pack/AUDIT-codex.md` | Independent audit |
| `research-pack/pack/...` | Advisory research only |
| `architecture/REPORT-data-architecture.md` | D1 + Airtable projection |
| `architecture/REPORT-frontend-stack-security.md` | Stack security filter |
| `architecture/REPORT-cli-agentic-admin.md` | CLI + scoped API keys (owner Software 3.0 requirement) |
| `design/*` | Design kits + owner FE preferences (incl. CLI verbatim) |
| Official Word brief + YT transcript | Customer requirements ground truth |

---

## 12. Decision freeze (for planning)

1. **Customer:** AIE program team · **Product replaces:** Sessionboard Program  
2. **Scope:** six brief features, production-hard · struck items out  
3. **Differentiator:** speed, craft, ownership, fit + **agentic CLI** (customer agents on scoped keys)  
4. **Stack:** CF Worker + D1 + R2 + Queues + DO + React/Vite + Airtable projection + **CLI/OpenAPI**  
5. **Data:** D1 decides; Airtable displays  
6. **Design:** tokenized Apple-level system + Design Kit (UI **and** CLI)  
7. **Test:** FE↔API↔role E2E + **CLI/key scope denial** tests  
8. **Agentic admin:** same domain commands; scoped API keys; no parallel write path  
9. **Pack:** use for domain insight; **do not** execute pack 48h plan or in-product agent PRD as written  

---

*— Synthesized by Grok from independent Claude and Codex audits, the official brief, walkthrough, architecture/design work, and the advisory SpeakerOps research pack.*
