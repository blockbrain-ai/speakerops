# SpeakerOps — Constitution

**Status:** DRAFT → pending owner LOCK  
**Date:** 2026-08-08  
**Claimed completion state:** `dogfood_ready` (Cloudflare private deploy + full browser E2E green + onboarding docs usable by human or agent)  
**Programme:** Kill My SaaS / AIE Sessionboard Program replacement  
**Check back at every gate.** If a change violates this document, stop — do not narrow until soul is gone.

---

## Article 0 — Completion contract

| Field | Value |
|-------|-------|
| Owner order | **FULL** |
| Surfaces | Web (admin, evaluator, speaker portal, public CFP); CLI; Airtable projection; Cloudflare deploy |
| Exit claim | **dogfood_ready** |
| Owner-approved DEFER | empty until owner amends |

**DEFER rows** (owner only; not PASS):

| Soul / item | Reason | Date | Owner |
|-------------|--------|------|-------|
| *(none yet)* | | | |

**Session stop ≠ programme complete ≠ claim proven.**  
**Forbidden exit:** residual essay while order=FULL, DEFER empty, and agent-incomplete remains.

**BUILD_CHECKLIST:** `initiative/BUILD_CHECKLIST.md` — progressive fill; end-check before CLAIM_PROVEN.

**Browser E2E law:** claimed dogfood_ready requires **every row** in `initiative/BROWSER_E2E_INVENTORY.md` status `PASS` with evidence path, or an **owner DEFER** row. Unlisted interactive controls discovered in UI = **defect** until inventoried or removed.

**Final phase law:** programme incomplete until **Phase Onboarding & Documentation** ships agent-operable setup docs + HTML reports (see soul tests S-ONB-*).

---

## Article I — What we are building

**One-sentence north star:**  
A production-hard, Apple-level, agentic-first Program OS that replaces Sessionboard’s program side for AI Engineer — CFP → score → accept → portal → comms/calendar → schedule → readiness — on Cloudflare with Airtable projection, CLI+scoped keys, full headless browser proof, and setup docs so a human or agent can stand it up cleanly.

**It is:**
- Open-source system of record (D1) for conference program operations
- Beautiful light/curvy tokenized UI (Design Kit: **Lumen** — see design synthesis)
- Software 3.0 CLI over the same domain commands as the web UI
- One-way Airtable ops mirror (never SoR)
- Exhaustively browser-tested and documented for onboarding

**It is not:**
- Full Sessionboard CRM/Marketing/CMS/media suite
- In-product multi-agent fleet / MCP product theatre
- Ticketing, travel booking, expo floorplans
- Airtable-as-database or bidirectional sync
- Thin weekend mock with prototype shortcuts

### Non-goals (explicit)
- ~~Struck brief items: Accelevents integration, portal wiki/embeds, embeddable gallery~~ — **re-scoped to in-scope primary by Amendment A1 (below)**
- AI-assisted multi-round review (**remains struck** — owner re-confirmed 2026-08-11: evaluation stays fully human-authority)
- OR-Tools auto-scheduler, Temporal, Next/RSC default, multi-region HA
- Freeform custom CSS/HTML theming
- Production cutover of AIE’s live events (dogfood deploy only unless owner amends claim)
- Event microsite; Forge source mirror (owner-excluded 2026-08-11)

### Amendment A1 — 2026-08-11 (owner-directed; competition brief v2)
The updated competition brief (`$10,0000 Kill My SaaS - Competition Brief.docx`, 2026-08-11, 42 screenshots) names as **primary** three features this constitution originally struck. By owner direction they are promoted to **in-scope primary**:
1. **Accelevents one-way integration** — outbox projector (same pattern as Airtable): identity mapping, idempotent upserts, retries, tombstones, lag/status, replay. Never dual-write; no request-path calls; D1 stays SoR. Conditional on API credentials — if genuinely unavailable, the limitation is disclosed honestly, never stubbed.
2. **Portal resources / wiki + sandboxed HTML embeds** — versioned rich-content pages, audience/event scoping, allowlisted embed blocks rendered in a sandboxed iframe with separate CSP (never in the SPA origin).
3. **Embeddable, mobile-friendly public programme** — Speaker Gallery + Schedule Itinerary (plus Sessions/Speakers/Agenda) as first-class public pages AND styled-HTML embeds with device preview + copy-code, driven by a versioned **published programme read model** (public field allowlist; drafts never public).
Also ratified under A1: **Airtable projection reactivated** (brief bonus); the master build governance lives outside this repo (owner's `MASTER_FIX_PLAN.md`); estate-truth correction — live invalidation is **polling-based** today (Durable Object invalidation is a design intent, not a deployed fact) and dogfood file storage uses the D1 `file_blobs` fallback where R2 is not provisioned. Judge-facing coverage docs (`docs/COMPETITION.md` §3) are updated to "in build" now and to "delivered" only when each feature ships with proof.

---

## Article II — Soul tests (fail = incomplete)

A human (or agent following docs) on the claimed environment must be able to:

### Program loop (Monday path)
1. **S-THEME** Apply Design Kit brand (color/logo) to an event; public CFP reflects tokens without code deploy.
2. **S-CFP** Admin builds a conditional CFP form with category routing; publishes open window; public submitter completes multi-speaker submission (Turnstile on).
3. **S-EVAL** Evaluator scores assigned submission; admin accepts; audit shows decision.
4. **S-PORTAL** Speaker opens magic link, updates bio, uploads headshot + slides, completes tasks; readiness dashboard updates without full page reload requirement beyond live invalidation/poll.
5. **S-COMMS** Admin previews recipient list + rendered reminder; sends once (idempotent); ICS calendar invite works for a placed session (UID stable).
6. **S-SCHED** Admin places session via drag-drop; double-book shows blocking conflict; valid place succeeds; list/day/week/track/room views all show placement.
7. **S-READY** Dashboard lists outstanding/overdue tasks; drill-down to speaker works.

### Agentic admin
8. **S-CLI** CLI with scoped API key lists readiness as JSON; design token update via CLI publishes; key without `schedule:write` cannot place sessions; all mutations audited to `key_id`.

### Integrations & host
9. **S-AIRTABLE** After domain mutations, Airtable projection shows rows with internal IDs; product works if Airtable is paused (outbox lags, no request-path failure).
10. **S-CF** App is reachable on Cloudflare private/preview URL used for dogfood; env uses names-only secrets channel.

### Browser proof (owner-hard)
11. **S-E2E-INV** `BROWSER_E2E_INVENTORY.md` is complete for all shipped UI; Playwright suite maps 1:1 to inventory IDs; CI gate fails if inventory row lacks test id or test fails.
12. **S-E2E-RUN** Headless browser run executes **every** inventory journey (positive + required negatives for authz/deny); zero uncaught console errors on happy paths; report artifact stored.

### Onboarding & documentation (final phase — owner-hard)
13. **S-ONB-HUMAN** A new operator following `docs/ONBOARDING.md` (or HTML report) can go from zero → env configured → migrate → seed → deploy notes → first login → demo path in under documented time, without tribal knowledge.
14. **S-ONB-AGENT** An agent following `docs/AGENT_SETUP.md` + OpenAPI + CLI help can mint/use a scoped key and complete readiness report + design publish without human UI (except secret inject).
15. **S-DOCS** Documentation tree is coherent (README → architecture → ops → CLI → E2E → security); beautiful HTML reports generated for onboarding, E2E coverage, and architecture overview; no orphan critical procedures.

---

## Article III — Anti-dilution

- Auditors and advisors **may not remove** soul tests to obtain APPROVE or AGREE.
- They may add must-fixes that **protect** soul tests.
- Soul tests change only via **Amendment** with owner approval.
- Shrinking browser inventory to pass CI is **forbidden**; only owner DEFER removes a row from required PASS set.

---

## Article IV — Amendment protocol

| Field | Value |
|-------|-------|
| Requested by | |
| Date | |
| Soul tests added/changed/removed | |
| Rationale | |
| Owner approval | pending / yes / no |
| Traceability update (livability rows) | |

Until owner approval is recorded, the prior LOCKED text remains authoritative.

---

## Article V — Constitution gates

| Gate | When | Question |
|------|------|----------|
| G0 Intent | Before packs | North star + FULL order + dogfood claim still match? |
| G2 Livability | Before implementation | Every soul → section → AC → e2e id? |
| G4 Advisory | Before execute | Codex notes folded; soul intact? |
| Mid-build | After each feature phase | Soul cluster browser inventory green or tracked? |
| E2E gate | End of E2E phase | Full inventory PASS? |
| Docs gate | End of final phase | S-ONB-* and S-DOCS green? |
| G7 Exit | Close | dogfood_ready evidence complete? |

---

## Article VI — What we will not sacrifice for schedule

- Empty primary chrome for any soul surface
- Deferred settings when soul requires them
- Secrets in git or run packs (names only)
- Silent role/ACL leaks
- Skipping keystone browser e2e for “unit tests enough”
- Claiming dogfood on partial inventory
- Shipping without agent-operable onboarding docs (final phase)
- Parallel god-mode CLI that bypasses domain commands
- Airtable dual-write

---

## Article VII — Prior lessons & synthesis anchors

- Research pack: good ID/domain; wrong agent-platform wedge — keep Person≠Speaker, typed commands; cut OR-Tools/Temporal/in-product agent fleet
- Data architecture: D1 SoR; Airtable one-way projection
- Frontend security: React+Vite SPA; no Next/RSC default; CSP; HttpOnly cookies
- Design: synthesize three kits into **Lumen** (see `01_DESIGN_SYSTEM_LUMEN.md`)
- Owner: Section Runner; production-hard; CLI agentic; full browser E2E; final phase = onboarding + docs HTML

---

## Article VIII — Stack lock (summary)

| Layer | Choice |
|-------|--------|
| UI | React + Vite + TS + Lumen tokens |
| API | Hono on Cloudflare Workers |
| DB | D1 + Drizzle migrations |
| Files | R2 |
| Jobs | Outbox + Queues (+ Workflows if needed) |
| Live | Durable Object invalidation only |
| Airtable | One-way projection |
| Auth | Cookies (humans); scoped API keys (CLI/agents) |
| E2E | Playwright inventory-driven |
| Docs | `docs/` tree + generated HTML reports |

---

*— Constitution for SpeakerOps intent-to-build programme*
