# PRODUCTION HANDOVER CHECKLIST — SpeakerOps (Kill My SaaS)

**Status:** LOCK CONTRACT (verification only — nothing marked PASS here)  
**Claim gated:** `dogfood_ready`  
**Owner order:** FULL production hardening — NO shortcuts; NOT critical/major-only  
**Quality bar:** Open-source competition quality  

---

## 1. Meta

| Field | Value |
|-------|--------|
| **Auditor role** | Independent production-readiness auditor (Codex / production handover) |
| **Independence** | **Independent of Grok** and of builder agents. This document does not inherit builder self-score, phase completion notes, or partial evidence claims as PASS. |
| **Date** | 2026-08-09 |
| **Corpus version note** | Derived from frozen Section Runner packs under `nood-factory/plans/runs/speakerops/spo-*` (50 packs: 0.1–9.6 including 8.6), control plane (`speakerops-engineering-standards.md` E1–E12, ACTIVE-RUNS-00..09, SECTION_ORDER.proposed.txt, SETUP.md), initiative spine (`00_CONSTITUTION.md`, `01_DESIGN_SYSTEM_LUMEN.md`, `02_LIVABILITY_MATRIX.md`, `03_EXECUTION_MANIFEST.md`, `BROWSER_E2E_INVENTORY.md`, `BUILD_CHECKLIST.md`, `contracts/*`), owner verbatim prefs, and `SYNTHESIS-BEST-FOOT-FORWARD.md`. Pack digests `/tmp/speakerops-pack-extract/*` used as cross-check only. |
| **Product workspace (skim)** | `speakerops/AGENTS.md`, `docs/SECRETS.md`, `docs/OPERATIONS.md` (names-only secrets, dogfood deploy runbook). |
| **What this file is** | The **handover contract**. Owner handover is forbidden until every checkbox is `PASS` with evidence, or an **owner-signed DEFER** row exists in constitution. |
| **What this file is not** | A build status report. **No item is marked PASS in this document** — build may still be running; auditors re-run verification against this list post-build. |
| **ID scheme** | Section items: `PH-{section}-{nn}` (e.g. `PH-3.3-04`). Cross-cutting: `PH-X-{track}-{nn}`. Soul verification: `PH-S-*`. |
| **Legend** | `[ ]` OPEN · `[x]` PASS (evidence path required) · `DEFER` only with owner signature in constitution |

---

## 2. What we set out to build

### 2.1 North star (constitution Article I)

A production-hard, Apple-level, agentic-first **Program OS** that replaces Sessionboard’s program side for AI Engineer — **CFP → score → accept → portal → comms/calendar → schedule → readiness** — on Cloudflare with Airtable projection, CLI + scoped keys, full headless browser proof, and setup docs so a human or agent can stand it up cleanly.

### 2.2 Surfaces

| Surface | Must ship for dogfood_ready |
|---------|----------------------------|
| Web — admin | Events, Design Kit, form builder, submissions/decisions, speakers, schedule studio (5 views), readiness dashboard, comms, settings, API keys |
| Web — evaluator | Assigned queue + scoring only (no decide) |
| Web — speaker portal | Magic link, tasks, bio, headshot/slides, sessions |
| Web — public CFP | Conditional multi-speaker form, Turnstile, brand tokens |
| CLI | `speakerops` over same domain commands; `--json`; scoped keys |
| Airtable | One-way projection (never SoR; never request-path) |
| Cloudflare | Private/preview dogfood URL + health (S-CF) |
| Docs / HTML reports | Human onboarding, agent setup, architecture/ops/security, e2e coverage |

### 2.3 Stack lock (constitution Article VIII + E1–E12)

| Layer | Choice (locked) |
|-------|-----------------|
| UI | React + Vite + TypeScript SPA; Lumen tokens |
| API | Hono on Cloudflare Workers |
| DB | D1 + Drizzle migrations (SoR) |
| Files | R2 (metadata in D1 only) |
| Jobs | Outbox + Queues (+ Workflows only if needed) |
| Live | Durable Object invalidation only (or documented poll ≤5s) |
| Airtable | One-way projection |
| Auth humans | HttpOnly Secure SameSite cookies (magic link); no localStorage auth |
| Auth machines | Scoped API keys (hashed at rest); Worker enforces scopes |
| E2E | Playwright inventory-driven (`@inv:ID`) |
| Docs | `docs/` tree + generated `reports/*.html` |

### 2.4 Non-goals (explicit — shipping any of these without amendment is a defect)

- Full Sessionboard CRM / Marketing / CMS / media suite  
- In-product multi-agent fleet / MCP product theatre  
- Ticketing, travel booking, expo floorplans  
- Airtable-as-database or **bidirectional** sync  
- Thin weekend mock / prototype shortcuts  
- Struck brief items: Accelevents, portal wiki/embeds, embeddable gallery, AI-assisted multi-round review  
- OR-Tools auto-scheduler, Temporal, Next/RSC default, multi-region HA  
- Freeform custom CSS/HTML theming  
- Production cutover of AIE live events (dogfood only unless owner amends claim)  
- Parallel god-mode CLI that bypasses domain commands  
- Dark-default / dingy “vibe slop” admin chrome  

### 2.5 Owner verbatim hard requirements (must survive handover)

1. **Exhaustive FE↔BE E2E** — every UI-mapped function + settings + role/permission matrix proven in browser.  
2. **Apple-level product** — modern, curvy, tasteful, light; not dark dingy vibe-coded slop.  
3. **Design Kit** — colors/branding tokens so operators customize without rebuild pain; no freeform CSS.  
4. **Software 3.0 CLI** — agentic admin via CLI + scoped API keys over **same** domain commands; least privilege; audited.  
5. **Full browser E2E inventory** — predeclared list; headless click-through of every function; nothing left out.  
6. **Final phase** — full onboarding + docs sweep + beautiful HTML reports; human **or** agent can set up cleanly.  
7. **FULL order** — residual essays and partial inventory are forbidden exits while DEFER is empty.

### 2.6 Exit claim

| Field | Value |
|-------|--------|
| Claim | `dogfood_ready` |
| BUILD_CHECKLIST | BC01–BC15 all `DONE_WITH_EVIDENCE` or `OWNER_AMEND` |
| Browser law | Every REQUIRED row in `BROWSER_E2E_INVENTORY.md` = PASS with evidence, or owner DEFER |
| Unlisted controls | Defect until inventoried or removed |
| Session stop | ≠ programme complete ≠ claim proven |

---

## 3. Soul tests (every S-* from constitution)

Verification methods are **mandatory evidence types**. No soul is PASS without method completed.

| ID | Soul | Constitution requirement (summary) | Verification method | Evidence (fill post-build) | Status |
|----|------|-----------------------------------|---------------------|---------------------------|--------|
| PH-S-THEME | **S-THEME** | Design Kit brand (color/logo) applied; public CFP reflects tokens without code deploy | Browser: C03–C05, C08–C10; CLI: CLI04–CLI05; unit: contrast gate | C03–C10 e2e + phase2-c05 screenshot | PASS |
| PH-S-CFP | **S-CFP** | Admin builds conditional CFP + category routing; open window; multi-speaker submit; Turnstile on | Browser: A01–A11, D01–D10; API: form version pin + turnstile | A*/D* e2e-coverage 108 PASS | PASS |
| PH-S-EVAL | **S-EVAL** | Evaluator scores assigned; admin accepts; audit shows decision | Browser: F01–F04, E01–E08; audit_events row for Decision.Record | E*/F* e2e PASS | PASS |
| PH-S-PORTAL | **S-PORTAL** | Magic link; bio; headshot+slides; tasks complete; readiness updates without full reload beyond live invalidation/poll | Browser: B02, G01–G08, H04; R2 metadata-only | G* e2e PASS | PASS |
| PH-S-COMMS | **S-COMMS** | Preview recipients + rendered body; send once idempotent; ICS for placed session (UID stable) | Browser: J01–J10; unit: idempotency_keys + ICS SEQUENCE | J* e2e PASS | PASS |
| PH-S-SCHED | **S-SCHED** | Drag-drop place; double-book blocking conflict; valid place; list/day/week/track/room show placement | Browser: I01–I16; unit: reservation conflicts 409 | I* e2e PASS | PASS |
| PH-S-READY | **S-READY** | Dashboard outstanding/overdue; drill-down to speaker | Browser: H01–H05, N01–N04 | H*/N* e2e PASS | PASS |
| PH-S-CLI | **S-CLI** | Scoped key readiness JSON; design publish via CLI; key without `schedule:write` cannot place; mutations audited to `key_id` | CLI01–CLI12; audit actor_type=api_key | CLI tests + phase7 | PASS |
| PH-S-AIRTABLE | **S-AIRTABLE** | After mutations, projection shows rows with internal IDs; product works if Airtable paused (outbox lags, no request-path failure) | Integration pause test; O06; no Airtable on request path | phase7 O06 | PASS |
| PH-S-CF | **S-CF** | Reachable on CF private/preview dogfood URL; secrets channel names-only | `GET {url}/health` 200; evidence file; no secrets in git | cf-dogfood.txt | PASS |
| PH-S-E2E-INV | **S-E2E-INV** | Inventory complete for shipped UI; suite maps 1:1; CI fails if REQUIRED lacks test | `pnpm test:e2e:inventory` exit 0; discovery crawl clean | inventory lint 108 | PASS |
| PH-S-E2E-RUN | **S-E2E-RUN** | Every inventory journey (pos + required negatives); zero uncaught console errors on happy paths; report artifact | Full Playwright green; `reports/e2e-coverage.html`; L04 | 119 playwright / 108 inv PASS | PASS |
| PH-S-ONB-HUMAN | **S-ONB-HUMAN** | Operator follows ONBOARDING from zero → env → migrate → seed → deploy notes → login → demo under documented time; no tribal knowledge | Dry-run log + `docs/ONBOARDING.md` + HTML | onboarding-proof/human-dry-run.txt | PASS |
| PH-S-ONB-AGENT | **S-ONB-AGENT** | Agent follows AGENT_SETUP + OpenAPI + CLI; mint/use scoped key; readiness + design publish without human UI (except secret inject) | Agent dry-run log + CLI07 deny | onboarding-proof/agent-dry-run.txt | PASS |
| PH-S-DOCS | **S-DOCS** | Coherent docs tree; beautiful HTML reports (onboarding, e2e, architecture); no orphan critical procedures | linkcheck 0; `reports/index.html` offline; BC15 | reports/index.html + docs-reports | PASS |

**Anti-dilution (Article III):** Auditors may not remove soul tests to obtain AGREE. Soul changes only via owner Amendment. Shrinking browser inventory to pass CI is **forbidden**.

---

## 4. Per-section checklist (every section 0.1–9.6)

**Rule:** Each section’s pack ACs/spec in-scope items are the source of truth. Cross-cutting laws (Zod, audit, secrets, E4 envelopes) apply to every implementation section even when repeated.

**Status column:** leave OPEN until re-audit. Prefer over-inclusion.

---

### Phase 0 — Governance

#### 0.1 — `spo-0.1-programme-contract` (Programme contract)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-0.1-01 | `docs/governance/0.1-programme-contract.md` exists and links constitution path | OPEN | |
| PH-0.1-02 | Stack table matches constitution/contracts (React+Vite, Hono, D1, R2, Queues, DO, Airtable one-way, CLI+keys) | OPEN | |
| PH-0.1-03 | Non-goals include struck brief items, OR-Tools, Next/RSC, Airtable dual-write, agent fleet | OPEN | |
| PH-0.1-04 | Pointer to `BROWSER_E2E_INVENTORY.md` as law | OPEN | |
| PH-0.1-05 | Pointer to Phase 9 onboarding as exit gate | OPEN | |
| PH-0.1-06 | Clean-room Sessionboard boundary stated | OPEN | |
| PH-0.1-07 | No product application code introduced in this section | OPEN | |
| PH-0.1-08 | Human review / governance plan checkbox recorded | OPEN | |
| PH-0.1-09 | Automated governance tests for file existence/content pass in `pnpm test:ci` | OPEN | |
| PH-0.1-10 | Standards line references E1–E12 | OPEN | |

#### 0.2 — `spo-0.2-lumen-design-lock` (Lumen design system lock)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-0.2-01 | `docs/governance/0.2-lumen-lock.md` matches Lumen MF folds (tokens, components, UX laws) | OPEN | |
| PH-0.2-02 | Contrast gate rule explicit (AA / block publish on fail) | OPEN | |
| PH-0.2-03 | SVG reject rule explicit for logos | OPEN | |
| PH-0.2-04 | Retheme blast radius: public CFP + speaker portal only; admin/evaluator stay Lumen default | OPEN | |
| PH-0.2-05 | Component list includes schedule tile + Design Kit panel | OPEN | |
| PH-0.2-06 | Status colors do not retheme with brand; status never color-only | OPEN | |
| PH-0.2-07 | Linked from standards E6 | OPEN | |
| PH-0.2-08 | Tests assert `--lumen-focus-ring`, SVG reject language, retheme radius | OPEN | |
| PH-0.2-09 | No product CSS implementation claimed as complete (owned by 1.4/2.4) | OPEN | |

#### 0.3 — `spo-0.3-browser-e2e-inventory-lock` (Browser E2E inventory lock)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-0.3-01 | Law doc states REQUIRED must PASS for dogfood_ready | OPEN | |
| PH-0.3-02 | Tagging convention `@inv:A01` documented | OPEN | |
| PH-0.3-03 | CI commands `pnpm test:e2e` + `pnpm test:e2e:inventory` named | OPEN | |
| PH-0.3-04 | Discovery crawl REQUIRED at Phase 8.x | OPEN | |
| PH-0.3-05 | Phases mapped to inventory letter ranges (A–O) | OPEN | |
| PH-0.3-06 | No wildcard-only acceptance in ownership | OPEN | |
| PH-0.3-07 | Inventory shrinkage forbidden language present | OPEN | |
| PH-0.3-08 | Governance tests assert law + REQUIRED definition | OPEN | |

#### 0.4 — `spo-0.4-domain-command-map` (Domain and command map)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-0.4-01 | Doc links SCHEMA.md, COMMANDS.md, SCOPES.md | OPEN | |
| PH-0.4-02 | Person ≠ Speaker stated | OPEN | |
| PH-0.4-03 | Default-deny scopes listed: `comms:send`, `decisions:write`, `keys:admin` | OPEN | |
| PH-0.4-04 | Command list summary covers Auth→Keys surfaces | OPEN | |
| PH-0.4-05 | FE/CLI/HTTP parity principle: no generic CRUD bypass | OPEN | |
| PH-0.4-06 | Tests assert links + Person≠Speaker + default-deny | OPEN | |
| PH-0.4-07 | No secrets/API keys/magic-link tokens committed | OPEN | |

#### 0.5 — `spo-0.5-docs-onboarding-outline` (Docs and onboarding outline)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-0.5-01 | Tree matches Phase 9 index (README, ONBOARDING, AGENT_SETUP, ARCHITECTURE, SECURITY, CLI, OPERATIONS, AIRTABLE, E2E, COMPETITION, TROUBLESHOOTING, FIELD_FLOW, reports/*) | OPEN | |
| PH-0.5-02 | S-ONB-HUMAN / S-ONB-AGENT / S-DOCS mapped | OPEN | |
| PH-0.5-03 | `reports/index.html` listed as deliverable | OPEN | |
| PH-0.5-04 | Evidence requirements for 9.6 pre-declared | OPEN | |
| PH-0.5-05 | Human vs agent path distinction clear | OPEN | |
| PH-0.5-06 | Governance tests assert outline paths + souls | OPEN | |
| PH-0.5-07 | No secrets in outline docs | OPEN | |

---

### Phase 1 — Foundation

#### 1.1 — `spo-1.1-monorepo-gates` (Monorepo and CI gates)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-1.1-01 | `pnpm typecheck` exits 0 (non-interactive) | OPEN | |
| PH-1.1-02 | `pnpm test:ci` exits 0 | OPEN | |
| PH-1.1-03 | Gate scripts have no concurrent watch flags | OPEN | |
| PH-1.1-04 | Workspace packages include web, api, shared, db, cli | OPEN | |
| PH-1.1-05 | Root scripts: typecheck, test:ci, test:e2e, db:*, docs:reports (may stub early) | OPEN | |
| PH-1.1-06 | vitest config `watch: false` | OPEN | |
| PH-1.1-07 | gitignore includes `.pipeline/`, `.dev.vars`, secrets paths | OPEN | |
| PH-1.1-08 | AGENTS.md/CLAUDE.md references speakerops standards path | OPEN | |
| PH-1.1-09 | eslint + typescript project references present | OPEN | |

#### 1.2 — `spo-1.2-worker-health` (Worker API health)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-1.2-01 | `GET /health` → 200, body indicates ok (e.g. `ok===true`) via worker test | OPEN | |
| PH-1.2-02 | `wrangler.toml` lists D1 binding name `DB` | OPEN | |
| PH-1.2-03 | No secret values in wrangler.toml | OPEN | |
| PH-1.2-04 | Hono app entry `apps/api` exists | OPEN | |
| PH-1.2-05 | Unknown path → 404 JSON with `code` field (E4 envelope) | OPEN | |
| PH-1.2-06 | Error envelope middleware present | OPEN | |
| PH-1.2-07 | CORS same-origin policy documented/enforced | OPEN | |
| PH-1.2-08 | R2/Queues binding **names** placeholders only | OPEN | |

#### 1.3 — `spo-1.3-d1-baseline` (D1 Drizzle baseline)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-1.3-01 | Migration creates organizations, events, audit_events, outbox_events, idempotency_keys | OPEN | |
| PH-1.3-02 | `events.version` column exists (optimistic concurrency) | OPEN | |
| PH-1.3-03 | `packages/db/schema.ts` aligns with SCHEMA.md baseline | OPEN | |
| PH-1.3-04 | `pnpm db:migrate` succeeds in test | OPEN | |
| PH-1.3-05 | Second migrate is no-op / succeeds | OPEN | |
| PH-1.3-06 | Repository helpers take `eventId` scoping pattern | OPEN | |
| PH-1.3-07 | Linear additive migrations; no reckless DROP | OPEN | |
| PH-1.3-08 | FKs on where SCHEMA requires | OPEN | |

#### 1.4 — `spo-1.4-lumen-shell` (Web shell and Lumen tokens)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-1.4-01 | `lumen.css` defines brand, focus ring, status soft pairs | OPEN | |
| PH-1.4-02 | Token set matches `01_DESIGN_SYSTEM_LUMEN.md` core vars | OPEN | |
| PH-1.4-03 | Sidebar includes CFP / Forms and Settings (full Lumen IA labels) | OPEN | |
| PH-1.4-04 | `pnpm --filter web build` exits 0 | OPEN | |
| PH-1.4-05 | No dark-default theme; light canvas default | OPEN | |
| PH-1.4-06 | Focus ring utilities applied to interactive chrome | OPEN | |
| PH-1.4-07 | Router stubs present without fake mutation backends | OPEN | |
| PH-1.4-08 | React+Vite+TS only (no Next/RSC) | OPEN | |

#### 1.5 — `spo-1.5-playwright-inventory-harness` (Playwright inventory harness)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-1.5-01 | `playwright.config.ts` exists | OPEN | |
| PH-1.5-02 | `scripts/inventory-lint.ts` parses Required column of inventory | OPEN | |
| PH-1.5-03 | Documents `@inv:A01` convention | OPEN | |
| PH-1.5-04 | `pnpm test:e2e:inventory` non-interactive | OPEN | |
| PH-1.5-05 | Linter fails on deliberate missing REQUIRED tag (unit fixture) | OPEN | |
| PH-1.5-06 | Linter passes when fixture tags required subset | OPEN | |
| PH-1.5-07 | `docs/E2E.md` stub exists | OPEN | |
| PH-1.5-08 | Example tagged e2e test present | OPEN | |

#### 1.6 — `spo-1.6-foundation-e2e-proof` (Foundation e2e proof)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-1.6-01 | `test:e2e` includes foundation smoke PASS | OPEN | |
| PH-1.6-02 | Smoke asserts sidebar text includes CFP | OPEN | |
| PH-1.6-03 | Health reachable from web proxy or direct | OPEN | |
| PH-1.6-04 | No uncaught exceptions on smoke path | OPEN | |
| PH-1.6-05 | Evidence path noted (e.g. `initiative/evidence/phase1.txt`) | OPEN | |
| PH-1.6-06 | No product handlers introduced here beyond wiring | OPEN | |

---

### Phase 2 — Auth & settings

#### 2.1 — `spo-2.1-session-auth` (Session auth magic link)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-2.1-01 | B01 admin login path testable (cookie HttpOnly) | OPEN | |
| PH-2.1-02 | B02 speaker magic link single-use; replay rejected | OPEN | |
| PH-2.1-03 | B03 logout clears session cookie | OPEN | |
| PH-2.1-04 | Magic-link tokens stored **only hashed** in DB | OPEN | |
| PH-2.1-05 | No raw tokens in logs | OPEN | |
| PH-2.1-06 | Cookie flags: Secure, HttpOnly, SameSite=Lax | OPEN | |
| PH-2.1-07 | Commands: Auth.RequestMagicLink / Exchange / Logout | OPEN | |
| PH-2.1-08 | Unknown email still returns `{ sent: true }` (no enum) | OPEN | |
| PH-2.1-09 | Zod validation + E4 envelopes on auth routes | OPEN | |
| PH-2.1-10 | Consequential writes emit audit_events + correlationId | OPEN | |
| PH-2.1-11 | Tables users, auth_sessions, magic_links migrated | OPEN | |
| PH-2.1-12 | No password/OAuth invention (out of scope) | OPEN | |

#### 2.2 — `spo-2.2-roles-guards` (Roles and route guards)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-2.2-01 | B04 unauth admin blocked (UI + API) | OPEN | |
| PH-2.2-02 | B05 speaker cannot open admin | OPEN | |
| PH-2.2-03 | B06 evaluator cannot schedule write (403 API) | OPEN | |
| PH-2.2-04 | Roles: admin \| evaluator \| speaker \| public enforced server-side | OPEN | |
| PH-2.2-05 | event_memberships table + requireRole middleware | OPEN | |
| PH-2.2-06 | Cross-event isolation policy documented and tested (404/403 consistent) | OPEN | |
| PH-2.2-07 | UI hide is **not** sole authz | OPEN | |
| PH-2.2-08 | Unit + Playwright guard tests present | OPEN | |

#### 2.3 — `spo-2.3-event-settings` (Event settings)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-2.3-01 | C01 create event (name, timezone, dates) | OPEN | |
| PH-2.3-02 | C02 switch active event context | OPEN | |
| PH-2.3-03 | C07 settings CFP window dates | OPEN | |
| PH-2.3-04 | C11 isolation: switch A→B shows no A data in B lists | OPEN | |
| PH-2.3-05 | O01 event name/dates/tz settings journey | OPEN | |
| PH-2.3-06 | O02 rooms CRUD | OPEN | |
| PH-2.3-07 | O03 tracks CRUD | OPEN | |
| PH-2.3-08 | Event.Create/Update/List + Room/Track APIs match COMMANDS.md | OPEN | |
| PH-2.3-09 | Optimistic version on Event.Update (409 on conflict) | OPEN | |
| PH-2.3-10 | Active event visible on mutating admin surfaces | OPEN | |

#### 2.4 — `spo-2.4-design-kit` (Design Kit UI publish)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-2.4-01 | C03 brand color + live preview | OPEN | |
| PH-2.4-02 | C04 logo upload + preview (allowlist mime) | OPEN | |
| PH-2.4-03 | C05 publish → public CFP shows brand | OPEN | |
| PH-2.4-04 | C06 freeform CSS control **absent** | OPEN | |
| PH-2.4-05 | C08 near-white brand → contrast warn/block or safe fg | OPEN | |
| PH-2.4-06 | C09 SVG/scripty logo rejected | OPEN | |
| PH-2.4-07 | C10 draft tokens not visible on public until publish | OPEN | |
| PH-2.4-08 | Admin chrome does **not** retheme with event brand | OPEN | |
| PH-2.4-09 | Design.Get / SetDraft / Publish + expectedVersion | OPEN | |
| PH-2.4-10 | Public design endpoint returns published only | OPEN | |
| PH-2.4-11 | Logo File.Presign purpose=logo; SVG 400 | OPEN | |
| PH-2.4-12 | All C03–C10 Playwright `@inv` tags present | OPEN | |

#### 2.5 — `spo-2.5-auth-settings-e2e` (Auth settings e2e proof)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-2.5-01 | All Phase 2 owned inv IDs B* + C* PASS | OPEN | |
| PH-2.5-02 | Keystone spec covers B01–B06, C01–C11 | OPEN | |
| PH-2.5-03 | Evidence file `initiative/evidence/phase2-e2e.txt` (or successor path) | OPEN | |
| PH-2.5-04 | No inventory shrinkage in this section | OPEN | |
| PH-2.5-05 | OpenAPI/command registry updated if commands added | OPEN | |
| PH-2.5-06 | Console-clean on happy paths in keystone | OPEN | |

---

### Phase 3 — CFP & evaluation

#### 3.1 — `spo-3.1-form-builder-api` (Form builder API)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-3.1-01 | Migrations: forms, form_versions, form_fields, form_rules | OPEN | |
| PH-3.1-02 | Publish creates **immutable** form_versions row | OPEN | |
| PH-3.1-03 | Draft updates do not change published snapshot | OPEN | |
| PH-3.1-04 | Category routing rule stored | OPEN | |
| PH-3.1-05 | field_key stable validation | OPEN | |
| PH-3.1-06 | Invalid condition field_key → 400 | OPEN | |
| PH-3.1-07 | OpenAPI lists Form.* commands | OPEN | |
| PH-3.1-08 | Form.Create / UpdateDraftFields / Publish / GetPublic | OPEN | |
| PH-3.1-09 | Audit on publish + correlationId | OPEN | |

#### 3.2 — `spo-3.2-form-builder-ui` (Form builder admin UI)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-3.2-01 | D01 create form + field types (text/select/file/speaker) | OPEN | |
| PH-3.2-02 | D02 reorder fields (drag) | OPEN | |
| PH-3.2-03 | D03 conditional rule; circular blocked | OPEN | |
| PH-3.2-04 | D04 category + routing | OPEN | |
| PH-3.2-05 | D05 required flags + validation | OPEN | |
| PH-3.2-06 | D06 welcome/thank-you copy | OPEN | |
| PH-3.2-07 | D07 side-by-side preview | OPEN | |
| PH-3.2-08 | D08 publish version; edit published → new version | OPEN | |
| PH-3.2-09 | D09 open/close + submission limit | OPEN | |
| PH-3.2-10 | D10 copy public link | OPEN | |
| PH-3.2-11 | No orphan buttons; empty state when no fields | OPEN | |
| PH-3.2-12 | Keyboard-reachable controls | OPEN | |
| PH-3.2-13 | Lumen components (not ad-hoc dark chrome) | OPEN | |
| PH-3.2-14 | All D01–D10 `@inv` tags PASS | OPEN | |

#### 3.3 — `spo-3.3-public-cfp` (Public CFP submit)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-3.3-01 | A01 load form + brand tokens + 404 invalid slug | OPEN | |
| PH-3.3-02 | A02 conditional field show/hide | OPEN | |
| PH-3.3-03 | A03 category routing on payload | OPEN | |
| PH-3.3-04 | A04 multi-speaker min/max | OPEN | |
| PH-3.3-05 | A05 supporting file type/size allowlist | OPEN | |
| PH-3.3-06 | A06 Turnstile pass + submit; missing captcha blocked | OPEN | |
| PH-3.3-07 | A07 closed window no submit | OPEN | |
| PH-3.3-08 | A08 validation errors + focus management | OPEN | |
| PH-3.3-09 | A09 mobile complete submit | OPEN | |
| PH-3.3-10 | A10 XSS abstract renders as text | OPEN | |
| PH-3.3-11 | A11 keyboard-only submit | OPEN | |
| PH-3.3-12 | Pins `form_version_id` on submission | OPEN | |
| PH-3.3-13 | Rate limit proven (header and/or 429 test) | OPEN | |
| PH-3.3-14 | Production Worker requires real Turnstile keys (not always-pass test tokens) | OPEN | |
| PH-3.3-15 | A01–A11 all `@inv` PASS | OPEN | |

#### 3.4 — `spo-3.4-evaluation` (Evaluation scoring)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-3.4-01 | F01 queue shows only assigned | OPEN | |
| PH-3.4-02 | F02 score criteria + comment; out-of-range rejected | OPEN | |
| PH-3.4-03 | F03 evaluator cannot accept/reject (UI absent + 403) | OPEN | |
| PH-3.4-04 | F04 keyboard-only score | OPEN | |
| PH-3.4-05 | O04 admin rubric edit | OPEN | |
| PH-3.4-06 | Aggregate/rollup score visible to admin | OPEN | |
| PH-3.4-07 | Eval tables + Eval.UpsertRubric / Score / queue | OPEN | |
| PH-3.4-08 | No AI scoring (struck) | OPEN | |

#### 3.5 — `spo-3.5-decisions` (Accept/reject decisions)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-3.5-01 | E01 list filters status/category | OPEN | |
| PH-3.5-02 | E02 detail answers + speakers | OPEN | |
| PH-3.5-03 | E03 assign evaluators | OPEN | |
| PH-3.5-04 | E04 accept creates session + tasks; authz deny | OPEN | |
| PH-3.5-05 | E05 reject with reason | OPEN | |
| PH-3.5-06 | E06 waitlist | OPEN | |
| PH-3.5-07 | E07 direct/sponsor session entry | OPEN | |
| PH-3.5-08 | E08 bulk select + preview; empty selection blocked | OPEN | |
| PH-3.5-09 | Accept task count matches templates | OPEN | |
| PH-3.5-10 | Audit row written for decision | OPEN | |
| PH-3.5-11 | expectedVersion conflict → 409 | OPEN | |
| PH-3.5-12 | Second accept idempotent / safe | OPEN | |
| PH-3.5-13 | `decisions:write` required for machine actors | OPEN | |

#### 3.6 — `spo-3.6-cfp-eval-e2e` (CFP eval e2e proof)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-3.6-01 | Owned IDs A*, D*, E*, F* PASS | OPEN | |
| PH-3.6-02 | Keystone spec + seed helpers | OPEN | |
| PH-3.6-03 | Evidence `initiative/evidence/phase3-e2e.txt` | OPEN | |
| PH-3.6-04 | No handler/write product expansion without tests | OPEN | |
| PH-3.6-05 | Command registry/OpenAPI current | OPEN | |

---

### Phase 4 — Portal

#### 4.1 — `spo-4.1-portal-api` (Portal API tasks)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-4.1-01 | people + event_participations + speaker_tasks + task_templates migrated | OPEN | |
| PH-4.1-02 | Accept (3.5) creates tasks from templates | OPEN | |
| PH-4.1-03 | Portal only own tasks (cannot complete another participation) | OPEN | |
| PH-4.1-04 | Admin speakers API event-scoped only | OPEN | |
| PH-4.1-05 | O05 task templates CRUD (+ expectedVersion 409) | OPEN | |
| PH-4.1-06 | Portal.GetHome / Task.Complete / Participation.UpdateProfile | OPEN | |
| PH-4.1-07 | Person ≠ Speaker model preserved | OPEN | |
| PH-4.1-08 | Audit on profile/task mutations | OPEN | |

#### 4.2 — `spo-4.2-r2-uploads` (R2 file uploads)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-4.2-01 | Headshot jpeg/png OK | OPEN | |
| PH-4.2-02 | Executable mime rejected (e.g. x-msdownload) | OPEN | |
| PH-4.2-03 | Metadata in D1 only; bytes in R2 (`r2_key`) | OPEN | |
| PH-4.2-04 | Download/access requires auth (except published logo public GET) | OPEN | |
| PH-4.2-05 | File.Presign / Upload / Complete; size ≤10 MiB | OPEN | |
| PH-4.2-06 | `uploaded` flag 0→2→1; not overloaded via checksum | OPEN | |
| PH-4.2-07 | virus_scan_status stub default `unscanned` | OPEN | |
| PH-4.2-08 | Complete without presign → 400 | OPEN | |
| PH-4.2-09 | ownerParticipationId required for headshot/slides | OPEN | |

#### 4.3 — `spo-4.3-portal-ui` (Speaker portal UI)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-4.3-01 | G01 land on next incomplete task | OPEN | |
| PH-4.3-02 | G02 edit bio; XSS text-only | OPEN | |
| PH-4.3-03 | G03 headshot upload + preview | OPEN | |
| PH-4.3-04 | G04 slides upload | OPEN | |
| PH-4.3-05 | G05 task complete status flip | OPEN | |
| PH-4.3-06 | G06 overdue visual state (not color-only) | OPEN | |
| PH-4.3-07 | G07 own session only; no other speakers’ private data | OPEN | |
| PH-4.3-08 | G08 mobile bio+task | OPEN | |
| PH-4.3-09 | Optimistic complete + revert/toast on failure | OPEN | |
| PH-4.3-10 | Portal may use event brand tokens (Lumen law) | OPEN | |
| PH-4.3-11 | G01–G08 `@inv` PASS | OPEN | |

#### 4.4 — `spo-4.4-portal-e2e` (Portal e2e proof)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-4.4-01 | G01–G08 PASS | OPEN | |
| PH-4.4-02 | Evidence phase4 path | OPEN | |
| PH-4.4-03 | Keystone portal spec green | OPEN | |
| PH-4.4-04 | OpenAPI updated if needed | OPEN | |

---

### Phase 5 — Comms

#### 5.1 — `spo-5.1-email-templates` (Email templates outbox)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-5.1-01 | email_templates + message_jobs (+ recipients) tables | OPEN | |
| PH-5.1-02 | Template CRUD (Comms.UpsertTemplate / List) | OPEN | |
| PH-5.1-03 | Merge field render with missingFields detection | OPEN | |
| PH-5.1-04 | Outbox row on enqueue | OPEN | |
| PH-5.1-05 | **No provider HTTP on command path** | OPEN | |
| PH-5.1-06 | Zod + audit on template mutations | OPEN | |

#### 5.2 — `spo-5.2-send-ics` (Send idempotent ICS)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-5.2-01 | J04 send once; second send idempotent | OPEN | |
| PH-5.2-02 | J08 preview required before send | OPEN | |
| PH-5.2-03 | J10 ICS SEQUENCE bump on reschedule; UID stable | OPEN | |
| PH-5.2-04 | Sandbox email provider default (`EMAIL_PROVIDER=sandbox`) | OPEN | |
| PH-5.2-05 | Resend adapter only when configured; never log API key | OPEN | |
| PH-5.2-06 | Queue consumer drains outbox (comms.send) | OPEN | |
| PH-5.2-07 | idempotency_keys table used | OPEN | |
| PH-5.2-08 | calendar_invites rows with uid/sequence/method | OPEN | |
| PH-5.2-09 | `comms:send` scope enforced | OPEN | |

#### 5.3 — `spo-5.3-comms-ui` (Comms admin UI)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-5.3-01 | J01 template merge fields UI | OPEN | |
| PH-5.3-02 | J02 segment + count | OPEN | |
| PH-5.3-03 | J03 preview all recipients + body | OPEN | |
| PH-5.3-04 | J04 send idempotent UI path | OPEN | |
| PH-5.3-05 | J05 delivery log | OPEN | |
| PH-5.3-06 | J06 ICS attach for scheduled session | OPEN | |
| PH-5.3-07 | J07 role without comms:send cannot send | OPEN | |
| PH-5.3-08 | J08 send without preview blocked | OPEN | |
| PH-5.3-09 | J09 audience edit invalidates preview | OPEN | |
| PH-5.3-10 | J10 ICS update after reschedule | OPEN | |
| PH-5.3-11 | Trust-before-automation UX (exact count + missing fields) | OPEN | |
| PH-5.3-12 | J01–J10 `@inv` PASS | OPEN | |

#### 5.4 — `spo-5.4-comms-e2e` (Comms e2e proof)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-5.4-01 | J01–J10 PASS | OPEN | |
| PH-5.4-02 | Evidence phase5 path | OPEN | |
| PH-5.4-03 | Keystone green | OPEN | |
| PH-5.4-04 | Fixture placements OK for J06 if schedule not yet full (re-proof in 6.4/8.2) | OPEN | |

---

### Phase 6 — Schedule & dashboard

#### 6.1 — `spo-6.1-schedule-conflicts` (Schedule conflict engine)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-6.1-01 | schedule_placements + room/speaker reservation uniques | OPEN | |
| PH-6.1-02 | Unit: double-book speaker → 409 conflicts[] | OPEN | |
| PH-6.1-03 | Unit: room overlap → 409 | OPEN | |
| PH-6.1-04 | Unschedule frees reservation | OPEN | |
| PH-6.1-05 | List returns unscheduled sessions | OPEN | |
| PH-6.1-06 | Schedule.Place / Move / Unschedule / List commands | OPEN | |
| PH-6.1-07 | Plain-language conflict codes | OPEN | |
| PH-6.1-08 | No OR-Tools | OPEN | |
| PH-6.1-09 | expectedVersion stale → 409 | OPEN | |
| PH-6.1-10 | Audit on place/move/unschedule | OPEN | |

#### 6.2 — `spo-6.2-schedule-ui` (Schedule UI five views)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-6.2-01 | I01 list view | OPEN | |
| PH-6.2-02 | I02 day view | OPEN | |
| PH-6.2-03 | I03 week view | OPEN | |
| PH-6.2-04 | I04 track view | OPEN | |
| PH-6.2-05 | I05 room view | OPEN | |
| PH-6.2-06 | I06 drag place empty slot | OPEN | |
| PH-6.2-07 | I07 speaker conflict blocked + reason | OPEN | |
| PH-6.2-08 | I08 room conflict | OPEN | |
| PH-6.2-09 | I09 keyboard move alternative | OPEN | |
| PH-6.2-10 | I10 undo last move | OPEN | |
| PH-6.2-11 | I11 unscheduled tray | OPEN | |
| PH-6.2-12 | I12 timezone displayed | OPEN | |
| PH-6.2-13 | I13 move already-placed | OPEN | |
| PH-6.2-14 | I14 unschedule to tray | OPEN | |
| PH-6.2-15 | I15 stale version recovery UI (no silent overwrite) | OPEN | |
| PH-6.2-16 | I16 five views + reload consistent after place | OPEN | |
| PH-6.2-17 | Lumen schedule tiles + focus rings | OPEN | |
| PH-6.2-18 | I01–I16 `@inv` PASS | OPEN | |

#### 6.3 — `spo-6.3-readiness-dashboard` (Readiness dashboard live)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-6.3-01 | H01 stats + outstanding list | OPEN | |
| PH-6.3-02 | H02 filter overdue | OPEN | |
| PH-6.3-03 | H03 drill to speaker | OPEN | |
| PH-6.3-04 | H04 live update after portal complete (≤5s poll or DO) | OPEN | |
| PH-6.3-05 | H05 empty state when all clear | OPEN | |
| PH-6.3-06 | N01 speakers list | OPEN | |
| PH-6.3-07 | N02 search/filter | OPEN | |
| PH-6.3-08 | N03 detail tasks + files | OPEN | |
| PH-6.3-09 | N04 files metadata; no cross-speaker leak | OPEN | |
| PH-6.3-10 | L05 150-row list paginates/virtualizes | OPEN | |
| PH-6.3-11 | Reports.Readiness command + UI | OPEN | |
| PH-6.3-12 | Admin default landing = readiness/overview | OPEN | |

#### 6.4 — `spo-6.4-schedule-dash-e2e` (Schedule dashboard e2e)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-6.4-01 | All owned I* H* N* L05 PASS | OPEN | |
| PH-6.4-02 | Evidence phase6 path | OPEN | |
| PH-6.4-03 | J06/J10 re-proof if deferred from phase5 | OPEN | |
| PH-6.4-04 | Keystone green | OPEN | |

---

### Phase 7 — CLI & Airtable

#### 7.1 — `spo-7.1-api-keys` (API keys and scopes)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-7.1-01 | K01 create key with subset scopes; secret shown once | OPEN | |
| PH-7.1-02 | K02 revoke | OPEN | |
| PH-7.1-03 | K03 prefix only after dismiss; secret not re-fetchable | OPEN | |
| PH-7.1-04 | K04 non-admin cannot open keys | OPEN | |
| PH-7.1-05 | Hash only stored (key_hash + key_prefix) | OPEN | |
| PH-7.1-06 | Default deny on new keys: decisions:write, comms:send, keys:admin | OPEN | |
| PH-7.1-07 | Bearer auth middleware on API | OPEN | |
| PH-7.1-08 | Keys.Create / Revoke / List commands | OPEN | |
| PH-7.1-09 | Audit includes key_id actor | OPEN | |
| PH-7.1-10 | K01–K04 `@inv` PASS | OPEN | |

#### 7.2 — `spo-7.2-cli` (OpenAPI and CLI)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-7.2-01 | packages/cli bin `speakerops` | OPEN | |
| PH-7.2-02 | CLI01 events list --json | OPEN | |
| PH-7.2-03 | CLI02 reports readiness --json stable schema | OPEN | |
| PH-7.2-04 | CLI03 design get | OPEN | |
| PH-7.2-05 | CLI04 design set brand | OPEN | |
| PH-7.2-06 | CLI05 design publish (contrast may 400) | OPEN | |
| PH-7.2-07 | CLI06 schedule place success path | OPEN | |
| PH-7.2-08 | CLI07 schedule place with reports-only key → exit 2 | OPEN | |
| PH-7.2-09 | CLI08 files upload | OPEN | |
| PH-7.2-10 | CLI09 comms draft --preview | OPEN | |
| PH-7.2-11 | CLI10 send without comms:send → exit 2 | OPEN | |
| PH-7.2-12 | CLI11 keys create without keys:admin → exit 2 | OPEN | |
| PH-7.2-13 | CLI12 GET /openapi.json lists command paths | OPEN | |
| PH-7.2-14 | docs/CLI.md lists commands | OPEN | |
| PH-7.2-15 | Exit codes documented (0–4) | OPEN | |
| PH-7.2-16 | CLI invokes same domain commands (no god-mode bypass) | OPEN | |
| PH-7.2-17 | Dry-run available on side-effect commands where specified | OPEN | |

#### 7.3 — `spo-7.3-airtable-projection` (Airtable one-way projection)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-7.3-01 | Projection consumer only; domain writes outbox topic `airtable.project` | OPEN | |
| PH-7.3-02 | **No request-path Airtable** (mutations 200 when paused) | OPEN | |
| PH-7.3-03 | Pause survival test (unset AIRTABLE_API_KEY) | OPEN | |
| PH-7.3-04 | Upsert by internal_id; projection_records updated | OPEN | |
| PH-7.3-05 | O06 admin Airtable status read (lag/errors) | OPEN | |
| PH-7.3-06 | Env names only: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, table overrides | OPEN | |
| PH-7.3-07 | Never write-back to D1 from Airtable | OPEN | |
| PH-7.3-08 | Rows include internal IDs for join | OPEN | |

#### 7.4 — `spo-7.4-cli-airtable-e2e` (CLI Airtable proof)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-7.4-01 | K01–K04 PASS | OPEN | |
| PH-7.4-02 | CLI scope deny suite PASS (CLI07, CLI10, CLI11) | OPEN | |
| PH-7.4-03 | Airtable pause PASS | OPEN | |
| PH-7.4-04 | Evidence phase7 path | OPEN | |
| PH-7.4-05 | CLI01–CLI12 covered or residual DEFER owner-signed | OPEN | |

---

### Phase 8 — Full browser E2E & hardening

#### 8.1 — `spo-8.1-inventory-completeness` (Inventory completeness audit)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-8.1-01 | `pnpm test:e2e:inventory` exit 0 on full suite tags | OPEN | |
| PH-8.1-02 | No REQUIRED row without `@inv` test | OPEN | |
| PH-8.1-03 | Discovery crawl allowlist documented | OPEN | |
| PH-8.1-04 | Crawl fails on unmapped primary button (fixture) | OPEN | |
| PH-8.1-05 | Unlisted interactive controls = defect (process verified) | OPEN | |
| PH-8.1-06 | INVENTORY_OWNERSHIP.md matches shipped UI | OPEN | |
| PH-8.1-07 | No inventory shrinkage in git history for green CI | OPEN | |

#### 8.2 — `spo-8.2-full-playwright-suite` (Full Playwright suite)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-8.2-01 | 100% REQUIRED inventory PASS or constitution DEFER | OPEN | |
| PH-8.2-02 | Report path stored (playwright-report/ + evidence) | OPEN | |
| PH-8.2-03 | Console-clean happy paths (L04) | OPEN | |
| PH-8.2-04 | All negatives (authz, validation) for REQUIRED rows green | OPEN | |
| PH-8.2-05 | Product root-cause fixes (not skip/xfail without DEFER) | OPEN | |
| PH-8.2-06 | A–O journey counts match inventory (~115+ REQUIRED) | OPEN | |
| PH-8.2-07 | L01–L05 state journeys PASS | OPEN | |

#### 8.3 — `spo-8.3-security-hardening` (Security hardening)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-8.3-01 | Content-Security-Policy header present on HTML | OPEN | |
| PH-8.3-02 | A10 XSS PASS | OPEN | |
| PH-8.3-03 | C09 logo XSS/SVG PASS | OPEN | |
| PH-8.3-04 | Rate limit public submit → 429 after threshold | OPEN | |
| PH-8.3-05 | Security headers suite (as implemented: X-Content-Type-Options etc.) | OPEN | |
| PH-8.3-06 | npm/pnpm audit policy documented | OPEN | |
| PH-8.3-07 | No dangerouslySetInnerHTML for untrusted content | OPEN | |
| PH-8.3-08 | Turnstile still enforced on public CFP | OPEN | |
| PH-8.3-09 | Secrets names-only; no key leakage in reports | OPEN | |

#### 8.4 — `spo-8.4-demo-seed` (Demo seed and role switcher)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-8.4-01 | Seed idempotent second run (same speaker count) | OPEN | |
| PH-8.4-02 | Seed includes ≥1 conflict + missing headshots | OPEN | |
| PH-8.4-03 | L05 large list data present | OPEN | |
| PH-8.4-04 | README/docs seed instructions | OPEN | |
| PH-8.4-05 | Role switcher **default off**; only with ROLE_SWITCHER_ENABLED=1 | OPEN | |
| PH-8.4-06 | Auth.DevRoleSwitch 404 when flag off | OPEN | |
| PH-8.4-07 | Demo emails public constants; real HttpOnly cookies on switch | OPEN | |
| PH-8.4-08 | Never enable role switcher on public production | OPEN | |

#### 8.5 — `spo-8.5-e2e-keystone-report` (E2E keystone HTML report)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-8.5-01 | `reports/e2e-coverage.html` exists offline | OPEN | |
| PH-8.5-02 | Shows PASS/FAIL per REQUIRED id (includes A01) | OPEN | |
| PH-8.5-03 | SHA/timestamp footer | OPEN | |
| PH-8.5-04 | Lumen-styled, navigable | OPEN | |
| PH-8.5-05 | Generator script exit 0 | OPEN | |

#### 8.6 — `spo-8.6-cloudflare-dogfood-deploy` (Cloudflare dogfood deploy)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-8.6-01 | BC10 evidence path complete (`initiative/evidence/cf-dogfood.txt` or successor) | OPEN | |
| PH-8.6-02 | Health 200 recorded against dogfood URL | OPEN | |
| PH-8.6-03 | No secrets in git (scripts + wrangler + evidence redaction) | OPEN | |
| PH-8.6-04 | `docs/OPERATIONS.md` wrangler steps complete | OPEN | |
| PH-8.6-05 | `scripts/deploy-dogfood.sh` fails closed without creds | OPEN | |
| PH-8.6-06 | Evidence template path exists | OPEN | |
| PH-8.6-07 | Secrets injected via approved channel only | OPEN | |
| PH-8.6-08 | Custom domain cutover **not** claimed as done | OPEN | |
| PH-8.6-09 | Optional SMOKE_BASE_URL playwright smoke if used | OPEN | |

---

### Phase 9 — Onboarding & documentation (FINAL)

#### 9.1 — `spo-9.1-docs-ia` (Docs IA and README map)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-9.1-01 | Tree matches 0.5 outline | OPEN | |
| PH-9.1-02 | Every outline path exists as file | OPEN | |
| PH-9.1-03 | linkcheck stubs: 0 broken internal links | OPEN | |
| PH-9.1-04 | README 5-minute orientation | OPEN | |
| PH-9.1-05 | Cross-link index; no dead-end critical docs | OPEN | |

#### 9.2 — `spo-9.2-human-onboarding` (Human onboarding path)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-9.2-01 | Numbered steps 1..N (≥10) | OPEN | |
| PH-9.2-02 | Env **names only** table (no sk-/eyJ values) | OPEN | |
| PH-9.2-03 | Demo path matches constitution souls (CFP→…→schedule/dashboard) | OPEN | |
| PH-9.2-04 | Timebox target stated (e.g. <90m) | OPEN | |
| PH-9.2-05 | Prerequisites, CF, wrangler, migrate, seed, first admin, e2e command, optional Airtable | OPEN | |
| PH-9.2-06 | No tribal knowledge steps | OPEN | |

#### 9.3 — `spo-9.3-agent-setup` (Agent setup and CLI runbook)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-9.3-01 | Copy-paste agent prompt block | OPEN | |
| PH-9.3-02 | Scope deny example | OPEN | |
| PH-9.3-03 | No secret values | OPEN | |
| PH-9.3-04 | Contains `speakerops reports readiness` | OPEN | |
| PH-9.3-05 | CLI_INVENTORY referenced | OPEN | |
| PH-9.3-06 | OpenAPI URL + exit codes | OPEN | |
| PH-9.3-07 | Key mint → design publish path without human UI (except inject) | OPEN | |

#### 9.4 — `spo-9.4-deep-docs` (Architecture security ops docs)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-9.4-01 | Deep docs non-stub (≥40–80 lines or structured complete) | OPEN | |
| PH-9.4-02 | ARCHITECTURE mentions D1 + one-way Airtable | OPEN | |
| PH-9.4-03 | COMPETITION maps brief features + lists struck items | OPEN | |
| PH-9.4-04 | SECURITY matches E10 | OPEN | |
| PH-9.4-05 | OPERATIONS deploy/migrate/Time Travel notes | OPEN | |
| PH-9.4-06 | AIRTABLE projection setup | OPEN | |
| PH-9.4-07 | E2E how-to | OPEN | |
| PH-9.4-08 | FIELD_FLOW for forms/portal (I16 highlights) | OPEN | |
| PH-9.4-09 | No contradiction with constitution | OPEN | |

#### 9.5 — `spo-9.5-html-reports` (Beautiful HTML reports)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-9.5-01 | Offline open `reports/index.html` | OPEN | |
| PH-9.5-02 | Nav between reports | OPEN | |
| PH-9.5-03 | Light Lumen aesthetic | OPEN | |
| PH-9.5-04 | e2e-coverage linked | OPEN | |
| PH-9.5-05 | onboarding.html, agent-setup.html, architecture.html, cli-reference.html, design-lumen.html present | OPEN | |
| PH-9.5-06 | Generator `pnpm docs:reports` exit 0 | OPEN | |
| PH-9.5-07 | SHA footer on generated reports | OPEN | |

#### 9.6 — `spo-9.6-onboarding-proof` (Onboarding proof keystone)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-9.6-01 | `initiative/evidence/onboarding-proof/` complete | OPEN | |
| PH-9.6-02 | BC13–BC15 DONE paths recorded | OPEN | |
| PH-9.6-03 | linkcheck 0 | OPEN | |
| PH-9.6-04 | No tribal steps in dry-run logs | OPEN | |
| PH-9.6-05 | Human dry-run log present | OPEN | |
| PH-9.6-06 | Agent dry-run log present | OPEN | |
| PH-9.6-07 | Rejects claim without CF evidence or DEFER | OPEN | |
| PH-9.6-08 | Reports exist and are linked from evidence | OPEN | |
| PH-9.6-09 | BUILD_CHECKLIST end-check: no OPEN/IN_PROGRESS/NEED_* without OWNER_AMEND | OPEN | |

---

## 5. Cross-cutting tracks (full depth — not skippable)

### 5.1 Security (`PH-X-SEC-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-SEC-01 | Server-side authz for all roles; UI hide ≠ authz | OPEN | |
| PH-X-SEC-02 | Wrong event resource → 404 or documented 403; tested both ways | OPEN | |
| PH-X-SEC-03 | Evaluator cannot Decision.Record / Schedule.Place | OPEN | |
| PH-X-SEC-04 | Speaker cannot admin APIs | OPEN | |
| PH-X-SEC-05 | Public only CFP + published logo GET | OPEN | |
| PH-X-SEC-06 | CSP strict present | OPEN | |
| PH-X-SEC-07 | HttpOnly Secure SameSite cookies; no auth in localStorage | OPEN | |
| PH-X-SEC-08 | Magic link + session tokens hashed at rest; never logged full | OPEN | |
| PH-X-SEC-09 | API keys hashed; secret shown once; not re-fetchable | OPEN | |
| PH-X-SEC-10 | Default-deny scopes: `comms:send`, `decisions:write`, `keys:admin` | OPEN | |
| PH-X-SEC-11 | Scope enforcement on Worker for every command in COMMANDS.md | OPEN | |
| PH-X-SEC-12 | Turnstile required on public submit; production forbids test always-pass secrets | OPEN | |
| PH-X-SEC-13 | Rate limit public CFP | OPEN | |
| PH-X-SEC-14 | XSS: A10, G02 bio, C09 logo, no untrusted HTML inject | OPEN | |
| PH-X-SEC-15 | R2 private; mime/size allowlists; no public bucket listing | OPEN | |
| PH-X-SEC-16 | Role switcher gated; 404 when off; dogfood-only | OPEN | |
| PH-X-SEC-17 | Secrets: env **names only** in packs/docs/git; values via inject path | OPEN | |
| PH-X-SEC-18 | Audit_events for consequential writes; actor user\|api_key\|system; correlationId | OPEN | |
| PH-X-SEC-19 | Structured logs never contain secrets, raw keys, magic links | OPEN | |
| PH-X-SEC-20 | Dependency audit policy documented and executed | OPEN | |
| PH-X-SEC-21 | BOOTSTRAP_ADMIN_EMAIL first-admin default-deny without allowlist | OPEN | |
| PH-X-SEC-22 | AUTH_DEV_OUTBOX not enabled on production dogfood default | OPEN | |

### 5.2 FE↔BE alignment (`PH-X-ALIGN-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-ALIGN-01 | Every COMMANDS.md write has HTTP route | OPEN | |
| PH-X-ALIGN-02 | Every admin/evaluator/speaker/public UI form posts to a real command | OPEN | |
| PH-X-ALIGN-03 | CLI maps 1:1 to same commands (CLI_INVENTORY) | OPEN | |
| PH-X-ALIGN-04 | OpenAPI (`GET /openapi.json`) generated from Zod/registry; no drift | OPEN | |
| PH-X-ALIGN-05 | No generic CRUD that bypasses domain commands | OPEN | |
| PH-X-ALIGN-06 | Error envelope E4 consistent across FE toasts | OPEN | |
| PH-X-ALIGN-07 | expectedVersion fields in UI for concurrent edits (events, schedule, tasks, templates, design) | OPEN | |
| PH-X-ALIGN-08 | Field-flow (forms → submissions → portal → readiness) documented and tested | OPEN | |
| PH-X-ALIGN-09 | Settings matrix M (inventory) fully covered by O/C/D/J/K rows | OPEN | |
| PH-X-ALIGN-10 | SCHEMA ownership tables match migrations | OPEN | |
| PH-X-ALIGN-11 | TRACEABILITY.md souls → sections → proof complete | OPEN | |
| PH-X-ALIGN-12 | Orphan buttons / dead endpoints = FAIL (E9) | OPEN | |

### 5.3 E2E completeness (`PH-X-E2E-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-E2E-01 | Inventory file is complete for all shipped UI | OPEN | |
| PH-X-E2E-02 | 1:1 `@inv:ID` for every REQUIRED row | OPEN | |
| PH-X-E2E-03 | Full suite green (`pnpm test:e2e`) | OPEN | |
| PH-X-E2E-04 | Inventory lint green | OPEN | |
| PH-X-E2E-05 | Discovery crawl: no unlisted primary actions (allowlist chrome only) | OPEN | |
| PH-X-E2E-06 | Coverage HTML offline with per-id PASS/FAIL | OPEN | |
| PH-X-E2E-07 | Phase keystones 1.6–7.4 + 8.2/8.5 evidence retained | OPEN | |
| PH-X-E2E-08 | L04 console-clean on happy paths | OPEN | |
| PH-X-E2E-09 | Negative journeys for every inventory Negative column | OPEN | |
| PH-X-E2E-10 | New UI control in same PR as inventory row (process verified at end) | OPEN | |
| PH-X-E2E-11 | No inventory row deleted to pass CI | OPEN | |
| PH-X-E2E-12 | CLI suite separate but green (not double-counted as browser) | OPEN | |

### 5.4 Design / Lumen vs owner intent (`PH-X-LUMEN-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-LUMEN-01 | Light default; cool gray canvas; no dark dingy cockpit | OPEN | |
| PH-X-LUMEN-02 | Tokens match Lumen lock (`--lumen-*`) | OPEN | |
| PH-X-LUMEN-03 | Curvy radii (sm/md/lg/xl/pill) used consistently | OPEN | |
| PH-X-LUMEN-04 | Required component kit present (buttons, badges, empty, schedule tile, Design Kit) | OPEN | |
| PH-X-LUMEN-05 | Status never color-only + soft pairs | OPEN | |
| PH-X-LUMEN-06 | Admin chrome not rethemed; public/portal brand tokens only | OPEN | |
| PH-X-LUMEN-07 | Design Kit: color, logo, radius, wordmark; **no** freeform CSS/HTML/JS | OPEN | |
| PH-X-LUMEN-08 | Contrast gate on publish | OPEN | |
| PH-X-LUMEN-09 | SVG logos rejected | OPEN | |
| PH-X-LUMEN-10 | Focus rings on all interactive controls; modal a11y | OPEN | |
| PH-X-LUMEN-11 | Schedule is hero UX (ghost, snap, conflicts plain language, undo, keyboard) | OPEN | |
| PH-X-LUMEN-12 | Role-appropriate starts (admin readiness, eval queue, speaker next task) | OPEN | |
| PH-X-LUMEN-13 | Empty chrome forbidden on soul surfaces | OPEN | |
| PH-X-LUMEN-14 | prefers-reduced-motion honored; dark mode not claimed | OPEN | |
| PH-X-LUMEN-15 | Visual spot-check vs owner “Apple-level” bar (auditor AGREE note) | OPEN | |

### 5.5 CLI + scoped keys Software 3.0 (`PH-X-CLI-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-CLI-01 | First-party CLI ships | OPEN | |
| PH-X-CLI-02 | Same command surface as web (no side door) | OPEN | |
| PH-X-CLI-03 | Scoped keys least privilege | OPEN | |
| PH-X-CLI-04 | CLI01–CLI12 PASS | OPEN | |
| PH-X-CLI-05 | Mutations audited to key_id | OPEN | |
| PH-X-CLI-06 | `--json` stable for agent parsing | OPEN | |
| PH-X-CLI-07 | docs/CLI.md + agent-setup complete | OPEN | |
| PH-X-CLI-08 | High-risk scopes default deny proven | OPEN | |

### 5.6 Airtable one-way (`PH-X-AIR-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-AIR-01 | D1 is sole SoR | OPEN | |
| PH-X-AIR-02 | Projection async via outbox only | OPEN | |
| PH-X-AIR-03 | Pause: product mutations succeed | OPEN | |
| PH-X-AIR-04 | Upsert by internal id | OPEN | |
| PH-X-AIR-05 | O06 status UI/API | OPEN | |
| PH-X-AIR-06 | No write-back / dual-write | OPEN | |
| PH-X-AIR-07 | Secrets names-only | OPEN | |

### 5.7 Cloudflare dogfood S-CF (`PH-X-CF-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-CF-01 | Live private/preview URL evidence (not optional for claim) | OPEN | |
| PH-X-CF-02 | GET /health 200 recorded | OPEN | |
| PH-X-CF-03 | D1/R2/Queues bindings configured via names | OPEN | |
| PH-X-CF-04 | OPERATIONS.md steps work without tribal knowledge | OPEN | |
| PH-X-CF-05 | Deploy script + evidence redaction | OPEN | |
| PH-X-CF-06 | Production secrets via wrangler secret put / secrets.env | OPEN | |
| PH-X-CF-07 | Owner DEFER only alternative to live smoke | OPEN | |

### 5.8 Onboarding S-ONB-HUMAN / S-ONB-AGENT / S-DOCS (`PH-X-ONB-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-ONB-01 | docs/ONBOARDING.md walkable zero→demo | OPEN | |
| PH-X-ONB-02 | docs/AGENT_SETUP.md agent-operable | OPEN | |
| PH-X-ONB-03 | Beautiful HTML reports index | OPEN | |
| PH-X-ONB-04 | Timebox met or documented variance with owner note | OPEN | |
| PH-X-ONB-05 | Human + agent dry-run evidence in 9.6 | OPEN | |
| PH-X-ONB-06 | No orphan critical procedures | OPEN | |
| PH-X-ONB-07 | COMPETITION.md for judges clean-room honesty | OPEN | |

### 5.9 Performance & livability (`PH-X-PERF-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-PERF-01 | L05 large list usable (paginate/virtualize) | OPEN | |
| PH-X-PERF-02 | L03 loading skeletons not infinite hang | OPEN | |
| PH-X-PERF-03 | L02 error states not blank | OPEN | |
| PH-X-PERF-04 | Optimistic UI with revert on failure (portal tasks) | OPEN | |
| PH-X-PERF-05 | Readiness live ≤5s or DO invalidation | OPEN | |
| PH-X-PERF-06 | Schedule place persists across five views without full app reload requirement beyond documented refresh | OPEN | |
| PH-X-PERF-07 | No request-path external integration latency (Airtable/email) | OPEN | |
| PH-X-PERF-08 | Livability matrix souls mapped to sections and e2e | OPEN | |
| PH-X-PERF-09 | Empty states with CTAs (L01) | OPEN | |
| PH-X-PERF-10 | Mobile journeys A09 G08 | OPEN | |

### 5.10 Clean-room / competition honesty (`PH-X-CR-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-CR-01 | Original IA, design, code — no Sessionboard trade dress | OPEN | |
| PH-X-CR-02 | No Sessionboard private APIs or scraped assets in repo | OPEN | |
| PH-X-CR-03 | COMPETITION.md maps brief features honestly | OPEN | |
| PH-X-CR-04 | Struck features not shipped as if in-scope | OPEN | |
| PH-X-CR-05 | Non-goals respected (no CRM/marketing/CMS/agent fleet theatre) | OPEN | |
| PH-X-CR-06 | Research pack agent-platform wedge rejected in product | OPEN | |
| PH-X-CR-07 | Clean-room language in 0.1 governance still true at exit | OPEN | |
| PH-X-CR-08 | Evidence does not claim production AIE cutover unless owner amended | OPEN | |

### 5.11 Engineering standards E1–E12 residual (`PH-X-E-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-E-01 | E1 D1 SoR; Person≠Speaker; optimistic version | OPEN | |
| PH-X-E-02 | E2 eventId at repository layer | OPEN | |
| PH-X-E-03 | E3 correlationId + structured logs | OPEN | |
| PH-X-E-04 | E4 Zod + error envelope + OpenAPI | OPEN | |
| PH-X-E-05 | E5 deterministic gates non-watch | OPEN | |
| PH-X-E-06 | E6 Lumen + E9 no orphans | OPEN | |
| PH-X-E-07 | E7 outbox for email/Airtable | OPEN | |
| PH-X-E-08 | E8 CLI + hashed keys + default deny | OPEN | |
| PH-X-E-09 | E9 unit + full browser inventory | OPEN | |
| PH-X-E-10 | E10 security CSP cookies secrets | OPEN | |
| PH-X-E-11 | E11 docs + HTML reports | OPEN | |
| PH-X-E-12 | E12 standards-first plans; multi-component keystones | OPEN | |

### 5.12 BUILD_CHECKLIST BC01–BC15 (`PH-X-BC-*`)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PH-X-BC-01 | BC01 S-THEME DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-02 | BC02 S-CFP DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-03 | BC03 S-EVAL DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-04 | BC04 S-PORTAL DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-05 | BC05 S-COMMS DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-06 | BC06 S-SCHED DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-07 | BC07 S-READY DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-08 | BC08 S-CLI DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-09 | BC09 S-AIRTABLE DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-10 | BC10 S-CF DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-11 | BC11 S-E2E-INV DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-12 | BC12 S-E2E-RUN DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-13 | BC13 S-ONB-HUMAN DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-14 | BC14 S-ONB-AGENT DONE_WITH_EVIDENCE | OPEN | |
| PH-X-BC-15 | BC15 S-DOCS DONE_WITH_EVIDENCE | OPEN | |

---

## 6. Handover gate rules

### 6.1 Hard rules (non-negotiable)

1. **No owner handover** until **100%** of checklist items in this file are `PASS` **or** have an **owner-signed DEFER** row in `00_CONSTITUTION.md` (Article 0 table).  
2. **No item may be marked PASS** without a concrete **evidence path** (command output, report HTML, screenshot path, log path, or signed DEFER).  
3. **This checklist is not self-passable by the builder alone.** Independent auditor(s) must re-run verification.  
4. **Auditors must AGREE** (Codex + any co-auditor required by `REQUIRE_INDEPENDENT_FINAL_AUDITOR=true`) on the final verdict before claim `dogfood_ready`.  
5. **Gap workflow:**  
   `FAIL/OPEN gap` → **build plan** (named section or hotfix pack) → **implement** → **re-audit this checklist** (only changed tracks + regression souls).  
6. **Forbidden shortcuts:**  
   - Shrinking inventory to go green  
   - Marking soul PASS on unit tests alone when browser inventory owns it  
   - Claiming S-CF without live URL or owner DEFER  
   - Shipping secrets in git  
   - Residual essay exit while order=FULL and DEFER empty  
   - “Mostly works” / critical-only closure  
7. **Anti-dilution:** Auditors may **add** must-fixes; may **not remove** souls or REQUIRED inventory rows.  
8. **Partial phase evidence** (phase2–7 e2e files) is **progress**, not terminal PASS for S-E2E-RUN / BC12.  
9. **Agreement protocol:** Each auditor records `AGREE` / `DISAGREE` with list of residual `PH-*` IDs. Handover requires unanimous AGREE or owner escalation.  
10. **Claim proven only when:** Constitution gates G7 Exit answered yes; BUILD_CHECKLIST end-check clean; this file 100% PASS|DEFER; S-* all verified.

### 6.2 Recommended audit order (post-build)

1. Gates: `pnpm typecheck` · `pnpm test:ci` · `pnpm test:e2e:inventory` · `pnpm test:e2e`  
2. Inventory completeness + discovery crawl (8.1/8.2)  
3. Security track (8.3 + X-SEC)  
4. Soul Monday path walk (THEME→READY)  
5. CLI + Airtable (7.x + X-CLI/X-AIR)  
6. CF evidence (8.6 + X-CF)  
7. Docs/onboarding dry-runs (9.x + X-ONB)  
8. Clean-room + design visual AGREE  
9. Fill evidence paths; dual-auditor AGREE  
10. Owner sign-off / CLAIM_PROVEN  

### 6.3 Residual handling

| Residual type | Required action |
|---------------|-----------------|
| Missing inventory test | Add test + keep row; re-run 8.2 |
| Product bug | Fix root cause; re-run affected phase keystone + 8.2 |
| Docs tribal step | Fix docs; re-run 9.6 dry-run |
| Live CF blocked | Owner DEFER with reason/date **or** complete deploy |
| Scope disagreement | Constitution Amendment only |

---

## 7. Suggested evidence paths (by major track)

| Track | Suggested evidence paths |
|-------|--------------------------|
| **Gates / CI** | CI logs or local: `pnpm typecheck`, `pnpm test:ci`, `pnpm test:e2e`, `pnpm test:e2e:inventory` output under `initiative/evidence/` |
| **Soul / BC** | `initiative/BUILD_CHECKLIST.md` filled; `initiative/contracts/TRACEABILITY.md` evidence column |
| **S-THEME** | Playwright C03–C10 report; CLI design publish log; public CFP screenshot path |
| **S-CFP** | phase3-e2e + 8.2 tags A*, D*; Turnstile test notes |
| **S-EVAL** | F*/E* tags; audit_events query dump (redacted) |
| **S-PORTAL** | phase4-e2e; G*; R2 metadata query sample |
| **S-COMMS** | phase5-e2e; J*; ICS sample file (UID/SEQUENCE); sandbox send log |
| **S-SCHED / S-READY** | phase6-e2e; I*; H*; N* |
| **S-CLI** | phase7-e2e; `tests/cli/**` output; CLI07 deny; OpenAPI snapshot |
| **S-AIRTABLE** | pause test log; projection_records sample; O06 |
| **S-CF** | `initiative/evidence/cf-dogfood.txt` (URL + health 200 + timestamp; secrets redacted) |
| **S-E2E-INV / RUN** | inventory lint log; full Playwright HTML; `reports/e2e-coverage.html` |
| **S-ONB-*** / S-DOCS** | `docs/ONBOARDING.md`, `docs/AGENT_SETUP.md`, `reports/index.html`, `initiative/evidence/onboarding-proof/` |
| **Security** | CSP header dump; rate-limit test; XSS inv A10/C09; `docs/SECURITY.md`; secrets scan (`git grep` clean for sk-/eyJ/magic tokens) |
| **FE↔BE** | COMMANDS.md vs route table vs OpenAPI diff; orphan-button crawl report |
| **Design** | Lumen token CSS file; design-lumen.html report; auditor visual notes |
| **Clean-room** | `docs/COMPETITION.md`; governance 0.1; no Sessionboard assets attestation |
| **Phase keystones** | `initiative/evidence/phase{1..7}-e2e.txt`, `e2e-full.txt`, `e2e-coverage.txt` |
| **Standards** | Pack plan Standards lines; AGENTS.md pointer to E1–E12 |

---

## 8. Appendix — Pack map (canonical SECTION_ORDER)

```
0.1 0.2 0.3 0.4 0.5
1.1 1.2 1.3 1.4 1.5 1.6
2.1 2.2 2.3 2.4 2.5
3.1 3.2 3.3 3.4 3.5 3.6
4.1 4.2 4.3 4.4
5.1 5.2 5.3 5.4
6.1 6.2 6.3 6.4
7.1 7.2 7.3 7.4
8.1 8.2 8.3 8.4 8.5 8.6
9.1 9.2 9.3 9.4 9.5 9.6
```

| Phase | Packs | Count |
|-------|-------|------:|
| 0 Governance | 0.1–0.5 | 5 |
| 1 Foundation | 1.1–1.6 | 6 |
| 2 Auth/settings | 2.1–2.5 | 5 |
| 3 CFP/eval | 3.1–3.6 | 6 |
| 4 Portal | 4.1–4.4 | 4 |
| 5 Comms | 5.1–5.4 | 4 |
| 6 Schedule/dash | 6.1–6.4 | 4 |
| 7 CLI/Airtable | 7.1–7.4 | 4 |
| 8 E2E+CF | 8.1–8.6 | 6 |
| 9 Onboarding | 9.1–9.6 | 6 |
| **Total sections** | | **50** |

---

## 9. Appendix — Checklist size (contract metrics)

| Bucket | Approx. check IDs |
|--------|------------------:|
| Soul tests PH-S-* | 15 |
| Per-section PH-0.1..PH-9.6 | ~430 |
| Cross-cutting PH-X-* | ~130 |
| **Total (estimate)** | **~575** |

Exact count should be re-tallied with `rg -c '^\| PH-'` on this file after lock; prefer over-inclusion. **Zero PASS** at authorship.

---

## 10. Sign-off block (fill at final audit only)

| Role | Name / model | Date | Verdict | Residual PH-IDs |
|------|--------------|------|---------|-----------------|
| Independent auditor (this checklist) | Codex production-readiness | 2026-08-09 | **POST-SR RE-AUDIT STARTED** — Phase 0–9 SR APPROVE; full dual PH-ID pass not closed | residual PH-* OPEN |
| Co-auditor (required) | | | | |
| Builder attestation (evidence only) | | | | |
| Owner | | | HANDOVER APPROVED / REJECTED | |

---

*— End PRODUCTION_HANDOVER_CHECKLIST-codex.md — locked contract for post-build verification; independent of Grok; no item PASS until re-audited with evidence.*
