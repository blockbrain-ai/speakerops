# SpeakerOps — PRODUCTION HANDOVER CHECKLIST (LOCKED)

| Field | Value |
|-------|-------|
| **Status** | **POST-SR VERIFICATION IN PROGRESS** — tip `ce32819` · gates green · §14 not yet dual-AGREE |
| **Date locked** | 2026-08-09 |
| **Claim** | `dogfood_ready` — full production-hard, competition-grade, open-source quality |
| **Owner order** | FULL — **no shortcuts**; not critical/major-only |
| **Handover rule** | **Do not hand over to owner until every row is PASS or OWNER_SIGNED_DEFER, and Grok + Codex both AGREE** |
| **Corpus** | 50 SR packs @ `nood-factory/plans/runs/speakerops/spo-*` + initiative spine + E1–E12 + 108 inventory + 12 CLI IDs |
| **Authors** | Grok (synthesis + primary checklist) · Codex Sol (independent checklist; merge notes in §13) |
| **Out of band** | Live secrets never in git; DEFER only with owner signature |

---

## 0. How this document is used

1. **While SR runs:** do not flip PASS rows optimistically. This file is the *exit contract*, not mid-build noise.
2. **When SR reports 50/50 complete:** re-sync product tree + packs evidence; then execute this checklist end-to-end.
3. **Any FAIL/GAP:** open a build plan (section-sized or cross-cutting), implement, re-run gates, re-audit with Codex, update row → PASS only with evidence path.
4. **Agreement:** Grok synthesizes; Codex re-audits; both mark §14 AGREE. Owner receives handover only after §14.
5. **Forbidden:** shrinking inventory; weakening CSP/scopes for demo; claiming dogfood on partial e2e; shipping without Phase 9 onboarding; Airtable dual-write; inventing endpoints outside COMMANDS.md without updating contracts.

**Row status legend:** `OPEN` · `PASS` · `FAIL` · `GAP` · `OWNER_SIGNED_DEFER`

---

## 1. What we set out to build (intent baseline)

### 1.1 North star (constitution)
A production-hard, Apple-level, agentic-first **Program OS** that replaces Sessionboard’s program side for **AI Engineer** — **CFP → score → accept → portal → comms/calendar → schedule → readiness** — on **Cloudflare** with **Airtable one-way projection**, **CLI + scoped keys**, **full headless browser proof**, and **setup docs** so a human or agent can stand it up cleanly.

### 1.2 Surfaces
- Web: admin, evaluator, speaker portal, public CFP
- CLI (`speakerops`) + scoped API keys
- Airtable projection (ops mirror, never SoR)
- Cloudflare private dogfood deploy

### 1.3 Stack lock
| Layer | Choice |
|-------|--------|
| UI | React + Vite + TS + **Lumen** tokens |
| API | Hono on Cloudflare Workers |
| DB SoR | D1 + Drizzle (sole) |
| Files | R2 |
| Jobs | Outbox + Queues |
| Live | DO invalidation only (not DB) |
| Airtable | One-way projection only |
| Auth humans | HttpOnly Secure SameSite cookies (magic link) |
| Auth agents | Hashed API keys + scopes |
| E2E | Playwright inventory-driven (108 REQUIRED) |

### 1.4 Explicit non-goals
- Full Sessionboard CRM/Marketing/CMS/media suite
- In-product multi-agent fleet / MCP theatre
- Ticketing, travel, expo floorplans, payments
- Airtable-as-DB or bidirectional sync
- Struck brief: Accelevents, portal wiki/embeds, embeddable gallery, AI multi-round review
- OR-Tools auto-scheduler, Temporal, Next/RSC default, multi-region HA
- Freeform custom CSS/HTML theming
- Thin MVP / prototype shortcuts
- Production cutover of AIE live events (dogfood only unless owner amends)

### 1.5 Owner verbatim hard requirements (from `design/OWNER-PREFERENCES-VERBATIM.md`)
| ID | Requirement | Verification |
|----|-------------|--------------|
| OV-01 | Section Runner build with exhaustive FE↔BE mapping and e2e of every UI function | Full inventory PASS + FE/BE audit |
| OV-02 | Settings + permissions matrix (admin etc.) complete | Roles/scopes tests + UI guards B04–B06 + K* |
| OV-03 | Modern easy high-quality UI — Apple-level, curvy, tasteful; **not** dark dingy vibe-coded slop | Lumen lock + design kit C* + visual review |
| OV-04 | Design flexible during long build; design kit dashboard for colors/branding | S-THEME C03–C10 + CLI design |
| OV-05 | First-party **CLI** for agentic admin over **existing** domain commands | CLI01–CLI12 + S-CLI |
| OV-06 | API keys with **scoped** permissions for departments/agents | K01–K04 + default-deny high-risk scopes |
| OV-07 | Full **headless browser** e2e of every function; predeclared list; nothing left out | S-E2E-INV + S-E2E-RUN; 108/108 |
| OV-08 | Final phase: full onboarding + docs sweep + beautiful HTML reports for humans **and agents** | Phase 9 + S-ONB-* + S-DOCS |

---

## 2. Soul tests (constitution Article II) — all must PASS

| ID | Soul | Done when | Primary proof |
|----|------|-----------|---------------|
| ST-01 | S-THEME | Design Kit publish reflects on public CFP without code deploy | C03–C05 e2e + screenshot |
| ST-02 | S-CFP | Conditional form + category + multi-speaker + Turnstile submit | A01–A11, D01–D10 |
| ST-03 | S-EVAL | Evaluator scores; admin accept audited | E*, F* |
| ST-04 | S-PORTAL | Magic link, bio, headshot/slides, tasks; readiness updates | B02, G01–G08 |
| ST-05 | S-COMMS | Preview recipients; idempotent send; ICS for placed session | J01–J10 |
| ST-06 | S-SCHED | Drag-drop place; double-book blocked; 5 views show placement | I01–I16 |
| ST-07 | S-READY | Outstanding/overdue list; drill-down works | H01–H05, N* |
| ST-08 | S-CLI | Scoped key readiness JSON; design publish; schedule deny without scope; audit key_id | CLI* + K* |
| ST-09 | S-AIRTABLE | Projection rows with internal ids; app works if Airtable paused | O06 + 7.4 |
| ST-10 | S-CF | Reachable private CF URL; GET /health 200 recorded (redacted) | cf-dogfood.txt BC10 |
| ST-11 | S-E2E-INV | Inventory complete; every REQUIRED has @inv; lint hard-fail | inventory lint phase8 |
| ST-12 | S-E2E-RUN | Every REQUIRED journey executed green; console-clean happy paths; report artifact | e2e full + reports/e2e-coverage.html |
| ST-13 | S-ONB-HUMAN | Stranger follows ONBOARDING.md zero→running without tribal knowledge | 9.2 + 9.6 evidence |
| ST-14 | S-ONB-AGENT | Agent follows AGENT_SETUP.md + CLI after secrets inject | 9.3 + 9.6 evidence |
| ST-15 | S-DOCS | Coherent docs tree + beautiful HTML portal offline | 9.1–9.5 + reports/index.html |

---

## 3. BUILD_CHECKLIST (BC01–BC15) — elevated to mandatory exit

| ID | Soul | Done when | Status | Evidence |
|----|------|-----------|--------|----------|
| BC01 | S-THEME | Design Kit publish on public CFP | PASS | initiative/evidence/phase2-e2e.txt + phase2-c05-public-cfp.png |
| BC02 | S-CFP | Conditional multi-speaker submit | PASS | initiative/evidence/phase3-e2e.txt |
| BC03 | S-EVAL | Score + accept audited | PASS | initiative/evidence/phase3-e2e.txt |
| BC04 | S-PORTAL | Magic link + files + tasks | PASS | initiative/evidence/phase4-e2e.txt |
| BC05 | S-COMMS | Preview send + ICS | PASS | initiative/evidence/phase5-e2e.txt |
| BC06 | S-SCHED | Five views + conflict | PASS | initiative/evidence/phase6-e2e.txt |
| BC07 | S-READY | Live outstanding dashboard | PASS | initiative/evidence/phase6-e2e.txt |
| BC08 | S-CLI | Scoped CLI admin path | PASS | initiative/evidence/phase7-e2e.txt |
| BC09 | S-AIRTABLE | One-way projection + pause survival | PASS | initiative/evidence/phase7-e2e.txt |
| BC10 | S-CF | CF dogfood URL healthy (live smoke, not PATH_READY only) | PASS | initiative/evidence/cf-dogfood.txt |
| BC11 | S-E2E-INV | Inventory complete + lint | PASS | BROWSER_E2E_INVENTORY.md + initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| BC12 | S-E2E-RUN | Full browser suite 108/108 green | PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt |
| BC13 | S-ONB-HUMAN | Onboarding walkthrough | PASS | onboarding-proof/human-dry-run.txt |
| BC14 | S-ONB-AGENT | Agent setup path | PASS | onboarding-proof/agent-dry-run.txt |
| BC15 | S-DOCS | HTML reports + tree | PASS | onboarding-proof/docs-reports.txt + reports/index.html |

---

## 4. Engineering standards E1–E12 (cross-cutting, full depth)

| ID | Standard | Checks |
|----|----------|--------|
| E1-01 | D1 sole SoR | No Postgres dual-stack; no Airtable as SoR |
| E1-02 | Person ≠ Speaker | people + participations; submissions ≠ sessions |
| E1-03 | Optimistic version | CAS on mutable aggregates; 409 paths tested |
| E1-04 | Migrations linear additive | packages/db/migrations; migrate tests |
| E2-01 | eventId at repository | No cross-event leaks |
| E2-02 | Roles admin\|evaluator\|speaker\|public | Server-side enforce |
| E2-03 | Wrong event → 404 policy | Consistent + tested |
| E2-04 | UI hide ≠ authz | API denies proven |
| E3-01 | correlationId UUIDv7 | On request/CLI |
| E3-02 | audit_events on writes | actor user\|api_key\|system |
| E3-03 | No secret/magic-link logs | Log redaction review |
| E4-01 | Zod all bodies | Every accepting route |
| E4-02 | E4 error envelope | code machine-readable |
| E4-03 | OpenAPI from commands | GET /openapi.json |
| E4-04 | No generic CRUD bypass | COMMANDS.md only |
| E5-01 | pnpm typecheck | 0 errors non-watch |
| E5-02 | pnpm test:ci | 0 failures |
| E5-03 | pnpm test:e2e | full REQUIRED |
| E5-04 | pnpm test:e2e:inventory | phase8 gate |
| E6-01 | Lumen tokens only | No freeform CSS theming |
| E6-02 | No Next/RSC default | Vite SPA |
| E6-03 | a11y keyboard schedule + focus | I* + Lumen |
| E6-04 | data-testid critical controls | inventory aligned |
| E7-01 | Outbox for email/airtable | No request-path provider |
| E7-02 | ICS UID/SEQUENCE | J* |
| E7-03 | Idempotent sends | J04 |
| E8-01 | CLI same domain commands | CLI01–12 |
| E8-02 | Keys hashed; scopes least privilege | 7.1 |
| E8-03 | Default deny comms:send, decisions:write, keys:admin | SCOPES.md |
| E9-01 | Unit for conflicts/authz/idempotency | test:ci |
| E9-02 | Every UI control → inventory row same PR | 8.1 |
| E9-03 | Negatives for authz/validation | inventory |
| E10-01 | HttpOnly Secure SameSite cookies | no localStorage auth |
| E10-02 | CSP strict; Turnstile public CFP | 8.3 + A06 |
| E10-03 | No dangerouslySetInnerHTML untrusted | XSS A10 C09 |
| E10-04 | R2 constraints type/size | 4.2 |
| E10-05 | Secrets names only in repo | gitleaks + docs |
| E11-01 | docs tree Phase 9 shape | ACTIVE-RUNS-09 |
| E11-02 | AGENT_SETUP + ONBOARDING | 9.2 9.3 |
| E11-03 | reports HTML portal | 9.5 |
| E12-01 | No soul dilution | constitution Article III |
| E12-02 | Clean-room Sessionboard | no trade dress / private API |

---

## 5. Browser E2E inventory — every REQUIRED id (108)

**Rule:** Each ID must have Playwright `@inv:ID`, status PASS in full suite report, and no inventory shrinkage.

### 5.A — Public CFP (11 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-A01 | `A01` | public · `/cfp/:slug` · Load form; see welcome; brand tokens visible |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A01 |
| E2E-A02 | `A02` | public · CFP · Fill required fields; conditional field appears when rule met |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A02 |
| E2E-A03 | `A03` | public · CFP · Select category; observe routing metadata on submit payload |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A03 |
| E2E-A04 | `A04` | public · CFP · Add second speaker block; min/max speaker rules |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A04 |
| E2E-A05 | `A05` | public · CFP · Upload supporting file within type/size |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A05 |
| E2E-A06 | `A06` | public · CFP · Pass Turnstile (test key); submit success + confirmation |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A06 |
| E2E-A07 | `A07` | public · CFP · Closed window shows closed state; no submit |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A07 |
| E2E-A08 | `A08` | public · CFP · Validation errors inline; focus management |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A08 |
| E2E-A09 | `A09` | public · CFP · Mobile viewport complete submit |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A09 |
| E2E-A10 | `A10` | public · CFP · XSS string in abstract renders as text not script |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A10 |
| E2E-A11 | `A11` | public · CFP · Keyboard-only complete valid submit |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:A11 |

### 5.B — Auth sessions (6 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-B01 | `B01` | admin · `/login` · Magic/invite login → session cookie set HttpOnly path |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:B01 |
| E2E-B02 | `B02` | speaker · magic link · Single-use link → portal; second use fails |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:B02 |
| E2E-B03 | `B03` | any · any authed · Logout clears session |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:B03 |
| E2E-B04 | `B04` | public · `/admin` · Unauthed redirect/401 |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:B04 |
| E2E-B05 | `B05` | speaker · `/admin` · Speaker cannot open admin |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:B05 |
| E2E-B06 | `B06` | evaluator · `/speakers` admin write · Evaluator cannot mutate schedule |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:B06 |

### 5.C — Settings / Design Kit (11 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-C01 | `C01` | admin · Events · Create event; timezone; dates |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C01 |
| E2E-C02 | `C02` | admin · Events · Switch active event context |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C02 |
| E2E-C03 | `C03` | admin · Design Kit · Set brand color; live preview updates |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C03 |
| E2E-C04 | `C04` | admin · Design Kit · Upload logo; preview |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C04 |
| E2E-C05 | `C05` | admin · Design Kit · Publish tokens; public CFP shows brand |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C05 |
| E2E-C06 | `C06` | admin · Design Kit · Cannot inject freeform CSS field (control absent) |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C06 |
| E2E-C07 | `C07` | admin · Settings · Edit event name/close dates for CFP window |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C07 |
| E2E-C08 | `C08` | admin · Design Kit · Near-white brand → contrast warn/block or derived text on public CFP |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C08 |
| E2E-C09 | `C09` | admin · Design Kit · SVG/scripty logo rejected; never executes |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C09 |
| E2E-C10 | `C10` | admin · Design Kit · Draft tokens not visible on public CFP until publish |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C10 |
| E2E-C11 | `C11` | admin · Events · Switch event A→B; no A data in B lists |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:C11 |

### 5.D — Form builder admin (10 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-D01 | `D01` | admin · Forms · Create form; add text/select/file/speaker fields |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D01 |
| E2E-D02 | `D02` | admin · Forms · Reorder fields drag |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D02 |
| E2E-D03 | `D03` | admin · Forms · Conditional rule: show field if select=X |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D03 |
| E2E-D04 | `D04` | admin · Forms · Category field + routing target |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D04 |
| E2E-D05 | `D05` | admin · Forms · Required flags + validation |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D05 |
| E2E-D06 | `D06` | admin · Forms · Welcome/thank-you copy |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D06 |
| E2E-D07 | `D07` | admin · Forms · Preview side-by-side |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D07 |
| E2E-D08 | `D08` | admin · Forms · Publish version; pin version on new submission |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D08 |
| E2E-D09 | `D09` | admin · Forms · Open/close + submission limit |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D09 |
| E2E-D10 | `D10` | admin · Forms · Copy public link |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:D10 |

### 5.E — Submissions / decisions (8 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-E01 | `E01` | admin · Submissions · List filters by status/category |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:E01 |
| E2E-E02 | `E02` | admin · Submissions · Open detail; answers; speakers |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:E02 |
| E2E-E03 | `E03` | admin · Submissions · Assign to evaluator |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:E03 |
| E2E-E04 | `E04` | admin · Submissions · Accept creates session + tasks |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:E04 |
| E2E-E05 | `E05` | admin · Submissions · Reject with reason |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:E05 |
| E2E-E06 | `E06` | admin · Submissions · Waitlist status |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:E06 |
| E2E-E07 | `E07` | admin · Submissions · Direct/sponsor session entry (no CFP) |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:E07 |
| E2E-E08 | `E08` | admin · Submissions · Bulk select + preview bulk status change |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:E08 |

### 5.F — Evaluation scoring (4 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-F01 | `F01` | evaluator · Queue · See only assigned |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:F01 |
| E2E-F02 | `F02` | evaluator · Score · Score criteria + comment; save |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:F02 |
| E2E-F03 | `F03` | evaluator · Score · Cannot accept/reject |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:F03 |
| E2E-F04 | `F04` | evaluator · Score · Keyboard-only complete score |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:F04 |

### 5.G — Speaker portal (8 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-G01 | `G01` | speaker · Portal · Land on next incomplete task |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:G01 |
| E2E-G02 | `G02` | speaker · Profile · Edit bio; save |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:G02 |
| E2E-G03 | `G03` | speaker · Files · Upload headshot; preview |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:G03 |
| E2E-G04 | `G04` | speaker · Files · Upload slides |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:G04 |
| E2E-G05 | `G05` | speaker · Tasks · Complete task; status flips |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:G05 |
| E2E-G06 | `G06` | speaker · Tasks · Overdue visual state |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:G06 |
| E2E-G07 | `G07` | speaker · Sessions · View own session status |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:G07 |
| E2E-G08 | `G08` | speaker · Portal · Mobile complete bio+task |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:G08 |

### 5.H — Readiness dashboard (5 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-H01 | `H01` | admin · Dashboard · Stats + outstanding list |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:H01 |
| E2E-H02 | `H02` | admin · Dashboard · Filter overdue |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:H02 |
| E2E-H03 | `H03` | admin · Dashboard · Drill to speaker |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:H03 |
| E2E-H04 | `H04` | admin · Dashboard · Live update after portal complete (same session or poll ≤5s) |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:H04 |
| E2E-H05 | `H05` | admin · Dashboard · Empty state when all clear |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:H05 |

### 5.I — Schedule studio (16 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-I01 | `I01` | admin · Schedule · List view shows sessions |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I01 |
| E2E-I02 | `I02` | admin · Schedule · Day view |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I02 |
| E2E-I03 | `I03` | admin · Schedule · Week view |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I03 |
| E2E-I04 | `I04` | admin · Schedule · Track view |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I04 |
| E2E-I05 | `I05` | admin · Schedule · Room view |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I05 |
| E2E-I06 | `I06` | admin · Schedule · Drag place into empty slot |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I06 |
| E2E-I07 | `I07` | admin · Schedule · Drag causes speaker conflict; blocked with reason |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I07 |
| E2E-I08 | `I08` | admin · Schedule · Room overlap conflict |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I08 |
| E2E-I09 | `I09` | admin · Schedule · Keyboard move alternative |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I09 |
| E2E-I10 | `I10` | admin · Schedule · Undo last move |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I10 |
| E2E-I11 | `I11` | admin · Schedule · Unscheduled tray |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I11 |
| E2E-I12 | `I12` | admin · Schedule · Timezone displayed |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I12 |
| E2E-I13 | `I13` | admin · Schedule · Move already-placed session to new slot |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I13 |
| E2E-I14 | `I14` | admin · Schedule · Unschedule back to tray |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I14 |
| E2E-I15 | `I15` | admin · Schedule · Stale version conflict shows recovery UI |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I15 |
| E2E-I16 | `I16` | admin · Schedule · After place, all five views + reload consistent |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:I16 |

### 5.J — Comms (10 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-J01 | `J01` | admin · Comms · Create/edit template merge fields |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J01 |
| E2E-J02 | `J02` | admin · Comms · Segment audience; count |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J02 |
| E2E-J03 | `J03` | admin · Comms · Preview all recipients + body |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J03 |
| E2E-J04 | `J04` | admin · Comms · Send once; second send idempotent |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J04 |
| E2E-J05 | `J05` | admin · Comms · Delivery log visible |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J05 |
| E2E-J06 | `J06` | admin · Comms · ICS attach for scheduled session |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J06 |
| E2E-J07 | `J07` | admin · Comms · Role without comms:send cannot send |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J07 |
| E2E-J08 | `J08` | admin · Comms · Send without completed preview blocked |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J08 |
| E2E-J09 | `J09` | admin · Comms · Edit audience invalidates preview |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J09 |
| E2E-J10 | `J10` | admin · Comms · ICS update after reschedule keeps UID bumps SEQUENCE |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:J10 |

### 5.K — API keys UI (4 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-K01 | `K01` | admin · API Keys · Create key with subset of scopes; secret shown once |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:K01 |
| E2E-K02 | `K02` | admin · API Keys · Revoke key |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:K02 |
| E2E-K03 | `K03` | admin · API Keys · Copy prefix only after dismiss |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:K03 |
| E2E-K04 | `K04` | admin · API Keys · Non-admin cannot open keys |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:K04 |

### 5.L — Perf / scale / mobile (5 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-L01 | `L01` | admin · Submissions · Empty list CTA |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:L01 |
| E2E-L02 | `L02` | admin · Network · Offline/API 500 shows error state not blank |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:L02 |
| E2E-L03 | `L03` | any · Slow · Loading skeletons not infinite hang |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:L03 |
| E2E-L04 | `L04` | any · Happy paths · No uncaught console errors |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:L04 |
| E2E-L05 | `L05` | admin · Lists · 150-row seed list paginates or virtualizes usable |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:L05 |

### 5.N — Admin speakers (4 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-N01 | `N01` | admin · Speakers · List speakers for event |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:N01 |
| E2E-N02 | `N02` | admin · Speakers · Search/filter |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:N02 |
| E2E-N03 | `N03` | admin · Speakers · Detail: tasks + files |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:N03 |
| E2E-N04 | `N04` | admin · Speakers · Open headshot/slides metadata |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:N04 |

### 5.O — Ops settings / misc (6 ids)
| Check ID | Inv | Surface / assert (from inventory) | Status | Evidence |
|----------|-----|-----------------------------------|--------|----------|
| E2E-O01 | `O01` | admin · Settings · Event name/dates/tz |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:O01 |
| E2E-O02 | `O02` | admin · Settings · Rooms CRUD |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:O02 |
| E2E-O03 | `O03` | admin · Settings · Tracks CRUD |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:O03 |
| E2E-O04 | `O04` | admin · Settings · Eval rubric edit |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:O04 |
| E2E-O05 | `O05` | admin · Settings · Task templates on accept |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:O05 |
| E2E-O06 | `O06` | admin · Settings · Airtable projection status read |  PASS | reports/e2e-coverage.html + initiative/evidence/handover/e2e-full-rerun-20260809.txt · @inv:O06 |

---

## 6. CLI inventory (CLI01–CLI12)

| Check ID | CLI | Assert | Status | Evidence |
|----------|-----|--------|--------|----------|
| CLI01-CHK | `CLI01` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI02-CHK | `CLI02` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI03-CHK | `CLI03` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI04-CHK | `CLI04` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI05-CHK | `CLI05` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI06-CHK | `CLI06` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI07-CHK | `CLI07` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI08-CHK | `CLI08` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI09-CHK | `CLI09` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI10-CHK | `CLI10` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI11-CHK | `CLI11` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |
| CLI12-CHK | `CLI12` | See CLI_INVENTORY.md row | PASS | packages/cli tests in pnpm test:ci + initiative/evidence/phase7-e2e.txt + docs/CLI.md |

---

## 7. Per-section pack checklist (0.1–9.6)

Each section must: (a) meet pack ACs, (b) not invent out-of-scope surface, (c) keep contracts updated if APIs/schema added, (d) leave clean gates.

### §0.1 — `spo-0.1-programme-contract`
**Intent:** Ratify SpeakerOps programme contract: north star, stack lock, non-goals, soul test pointer, clean-room, dogfood_ready claim — so no later section invents CRM/agent-fleet/Next/Postgres dual-stack. This section is a hard d

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-0.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-0.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-0.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-0.1-01 | Document exists and links constitution path | OPEN | |
| PH-0.1-02 | Stack matches initiative/contracts | OPEN | |
| PH-0.1-03 | Non-goals include struck brief items | OPEN | |
| PH-0.1-04 | Human review checkbox in plan | OPEN | |
| PH-0.1-05 | No product code in this section | OPEN | |

### §0.2 — `spo-0.2-lumen-design-lock`
**Intent:** Freeze Lumen tokens, retheme blast radius, Design Kit security, component list for all UI sections. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-THEME).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-0.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-0.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-0.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-0.2-01 | Doc matches Lumen MF folds | OPEN | |
| PH-0.2-02 | Contrast + SVG rules explicit | OPEN | |
| PH-0.2-03 | Component list includes schedule tile + design kit | OPEN | |
| PH-0.2-04 | Linked from standards E6 | OPEN | |

### §0.3 — `spo-0.3-browser-e2e-inventory-lock`
**Intent:** Ratify inventory law: REQUIRED rows, @inv tags, Phase 8 full run, no shrinkage, discovery crawl. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-E2E-INV, S-E2E-RUN).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-0.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-0.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-0.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-0.3-01 | Law doc states REQUIRED must PASS for dogfood | OPEN | |
| PH-0.3-02 | Lists discovery crawl REQUIRED at 8.x | OPEN | |
| PH-0.3-03 | Maps phases to inventory letter ranges | OPEN | |
| PH-0.3-04 | No wildcard-only acceptance | OPEN | |

### §0.4 — `spo-0.4-domain-command-map`
**Intent:** Publish command registry + schema ownership so FE/CLI/API stay aligned. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CLI).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-0.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-0.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-0.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-0.4-01 | Doc links three contract files | OPEN | |
| PH-0.4-02 | Person≠Speaker stated | OPEN | |
| PH-0.4-03 | Scopes default-deny for send/decisions/keys listed | OPEN | |
| PH-0.4-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §0.5 — `spo-0.5-docs-onboarding-outline`
**Intent:** Pre-declare docs/ tree and reports/ HTML portal so Phase 9 is execution not invention. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-ONB-HUMAN, S-ONB-AGENT, S-DOCS).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-0.5-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-0.5-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-0.5-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-0.5-01 | Tree matches Phase 9 index | OPEN | |
| PH-0.5-02 | S-ONB-HUMAN/AGENT/S-DOCS mapped | OPEN | |
| PH-0.5-03 | reports/index.html listed | OPEN | |
| PH-0.5-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §1.1 — `spo-1.1-monorepo-gates`
**Intent:** Create pnpm monorepo with apps/web, apps/api, packages/{shared,db,cli}, non-interactive typecheck and test:ci so Section Runner gates never hang. This section is a hard dependency for later SpeakerOps phases and for cons

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-1.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-1.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-1.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-1.1-01 | pnpm typecheck 0 | OPEN | |
| PH-1.1-02 | pnpm test:ci 0 | OPEN | |
| PH-1.1-03 | No concurrent watch flags in gate scripts | OPEN | |
| PH-1.1-04 | Workspace lists web api shared db cli | OPEN | |
| PH-1.1-05 | AGENTS.md references speakerops standards path | OPEN | |

### §1.2 — `spo-1.2-worker-health`
**Intent:** Hono app on Cloudflare Workers with GET /health returning {ok:true, version} for local and CF smoke. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CF (health)).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-1.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-1.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-1.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-1.2-01 | GET /health 200 locally via vitest miniflare or worker test | OPEN | |
| PH-1.2-02 | wrangler.toml lists D1 database binding name DB | OPEN | |
| PH-1.2-03 | No secrets in wrangler.toml | OPEN | |
| PH-1.2-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-1.2-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-1.2-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §1.3 — `spo-1.3-d1-baseline`
**Intent:** Drizzle schema + first migration for organizations, events, audit_events, outbox_events, idempotency_keys; migrate script. This section is a hard dependency for later SpeakerOps phases and for constitution souls (— (supp

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-1.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-1.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-1.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-1.3-01 | 0001 migration creates listed tables | OPEN | |
| PH-1.3-02 | events has version column | OPEN | |
| PH-1.3-03 | audit_events and outbox_events exist | OPEN | |
| PH-1.3-04 | pnpm db:migrate succeeds in test | OPEN | |
| PH-1.3-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-1.3-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §1.4 — `spo-1.4-lumen-shell`
**Intent:** Vite React SPA with Lumen CSS variables, admin chrome shell, router placeholders, shared layout. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-THEME foundation).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-1.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-1.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-1.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-1.4-01 | lumen.css defines brand, focus, status soft pairs | OPEN | |
| PH-1.4-02 | Sidebar includes CFP / Forms and Settings | OPEN | |
| PH-1.4-03 | Build pnpm --filter web build 0 | OPEN | |
| PH-1.4-04 | No dark-default theme | OPEN | |
| PH-1.4-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-1.4-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §1.5 — `spo-1.5-playwright-inventory-harness`
**Intent:** Playwright config + inventory linter that fails if any REQUIRED inventory ID lacks @inv:ID in tests. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-E2E-INV).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-1.5-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-1.5-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-1.5-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-1.5-01 | Linter parses Required column | OPEN | |
| PH-1.5-02 | Documents @inv:A01 convention | OPEN | |
| PH-1.5-03 | CI script non-interactive | OPEN | |
| PH-1.5-04 | Fails on deliberate missing tag in unit of linter | OPEN | |
| PH-1.5-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-1.5-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §1.6 — `spo-1.6-foundation-e2e-proof`
**Intent:** I12 keystone: health 200 + SPA shell loads Lumen chrome without console errors. This section is a hard dependency for later SpeakerOps phases and for constitution souls (— (supports programme)).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-1.6-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-1.6-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-1.6-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-1.6-01 | test:e2e includes foundation smoke PASS | OPEN | |
| PH-1.6-02 | No uncaught exceptions | OPEN | |
| PH-1.6-03 | Evidence path noted in section completion | OPEN | |
| PH-1.6-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §2.1 — `spo-2.1-session-auth`
**Intent:** Magic-link auth exchanging single-use tokens for HttpOnly Secure session cookies for admin and speaker purposes. This section is a hard dependency for later SpeakerOps phases and for constitution souls (— (supports progr

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-2.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-2.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-2.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-2.1-01 | B01 admin login path testable | OPEN | |
| PH-2.1-02 | B02 speaker single-use | OPEN | |
| PH-2.1-03 | B03 logout clears cookie | OPEN | |
| PH-2.1-04 | Tokens only hashed in DB | OPEN | |
| PH-2.1-05 | No token in logs | OPEN | |
| PH-2.1-06 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-2.1-07 | Consequential writes emit audit_events with correlationId | OPEN | |

### §2.2 — `spo-2.2-roles-guards`
**Intent:** event_memberships roles admin|evaluator|speaker enforced on API and UI guards; browser B04–B06. This section is a hard dependency for later SpeakerOps phases and for constitution souls (— (supports programme)).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-2.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-2.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-2.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-2.2-01 | B04 unauth admin blocked | OPEN | |
| PH-2.2-02 | B05 speaker blocked from admin | OPEN | |
| PH-2.2-03 | B06 evaluator cannot schedule write | OPEN | |
| PH-2.2-04 | Tests for API and UI | OPEN | |
| PH-2.2-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-2.2-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §2.3 — `spo-2.3-event-settings`
**Intent:** Create/update events, timezone, rooms, tracks; active event context; inventory C01 C02 C07 C11 O01–O03. This section is a hard dependency for later SpeakerOps phases and for constitution souls (— (supports programme)).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-2.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-2.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-2.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-2.3-01 | C01 create event | OPEN | |
| PH-2.3-02 | C02 switch context | OPEN | |
| PH-2.3-03 | C07 settings | OPEN | |
| PH-2.3-04 | C11 isolation | OPEN | |
| PH-2.3-05 | O01–O03 | OPEN | |
| PH-2.3-06 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-2.3-07 | Consequential writes emit audit_events with correlationId | OPEN | |

### §2.4 — `spo-2.4-design-kit`
**Intent:** Design Kit draft/publish with contrast gate, logo upload PNG only, no freeform CSS; C03–C10. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-THEME).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-2.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-2.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-2.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-2.4-01 | C03–C10 all tagged tests | OPEN | |
| PH-2.4-02 | Admin chrome does not retheme | OPEN | |
| PH-2.4-03 | Public CFP uses published tokens only | OPEN | |
| PH-2.4-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-2.4-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-2.4-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §2.5 — `spo-2.5-auth-settings-e2e`
**Intent:** I12: login → set design → publish → public sees brand; role guards proven. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-THEME).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-2.5-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-2.5-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-2.5-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-2.5-01 | All phase 2 inv IDs PASS | OPEN | |
| PH-2.5-02 | Evidence path initiative/evidence/phase2-e2e.txt | OPEN | |
| PH-2.5-03 | Automated tests in Tests section are implemented and pass in pnpm test:ci | OPEN | |
| PH-2.5-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |
| PH-2.5-05 | OpenAPI or command registry updated if new commands were added | OPEN | |

### §3.1 — `spo-3.1-form-builder-api`
**Intent:** Versioned forms API: fields, conditionals, category routing, publish immutable version. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CFP).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-3.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-3.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-3.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-3.1-01 | Publish creates immutable form_versions row | OPEN | |
| PH-3.1-02 | Draft updates do not change published | OPEN | |
| PH-3.1-03 | Category routing rule stored | OPEN | |
| PH-3.1-04 | OpenAPI lists Form commands | OPEN | |
| PH-3.1-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-3.1-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §3.2 — `spo-3.2-form-builder-ui`
**Intent:** Admin UI to build conditional CFP forms with live preview; inventory D01–D10. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CFP).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-3.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-3.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-3.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-3.2-01 | D01–D10 Playwright @inv tagged PASS | OPEN | |
| PH-3.2-02 | No orphan buttons | OPEN | |
| PH-3.2-03 | Empty state when no fields | OPEN | |
| PH-3.2-04 | Keyboard reachable controls | OPEN | |
| PH-3.2-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-3.2-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §3.3 — `spo-3.3-public-cfp`
**Intent:** Public conditional CFP with Turnstile, multi-speaker, file, XSS-safe; A01–A11. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CFP).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-3.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-3.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-3.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-3.3-01 | A01–A11 PASS | OPEN | |
| PH-3.3-02 | Rate limit header/test | OPEN | |
| PH-3.3-03 | Pins form_version_id on submission | OPEN | |
| PH-3.3-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-3.3-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-3.3-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §3.4 — `spo-3.4-evaluation`
**Intent:** Rubric, assignments, evaluator queue and scoring F01–F04 O04; human only. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-EVAL).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-3.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-3.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-3.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-3.4-01 | F01–F04 O04 PASS | OPEN | |
| PH-3.4-02 | Aggregate score visible to admin | OPEN | |
| PH-3.4-03 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-3.4-04 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-3.4-05 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |
| PH-3.4-06 | OpenAPI or command registry updated if new commands were added | OPEN | |

### §3.5 — `spo-3.5-decisions`
**Intent:** Decision.Record accept/reject/waitlist; accept materializes session + tasks; E01–E08; direct sponsor session. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-EVAL, S-PORTAL).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-3.5-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-3.5-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-3.5-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-3.5-01 | E01–E08 PASS | OPEN | |
| PH-3.5-02 | Accept creates tasks | OPEN | |
| PH-3.5-03 | Audit row written | OPEN | |
| PH-3.5-04 | expectedVersion conflict 409 | OPEN | |
| PH-3.5-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-3.5-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §3.6 — `spo-3.6-cfp-eval-e2e`
**Intent:** I12 full path form publish → public submit → score → accept → tasks exist; all phase 3 inv PASS. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CFP, S-EVAL).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-3.6-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-3.6-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-3.6-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-3.6-01 | A D E F owned IDs PASS | OPEN | |
| PH-3.6-02 | Evidence initiative/evidence/phase3-e2e.txt | OPEN | |
| PH-3.6-03 | Automated tests in Tests section are implemented and pass in pnpm test:ci | OPEN | |
| PH-3.6-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |
| PH-3.6-05 | OpenAPI or command registry updated if new commands were added | OPEN | |

### §4.1 — `spo-4.1-portal-api`
**Intent:** Speaker portal APIs + admin speakers list API; task templates O05; Person/participation model. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-PORTAL, S-READY).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-4.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-4.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-4.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-4.1-01 | Accept from 3.5 creates tasks via templates | OPEN | |
| PH-4.1-02 | Portal only own tasks | OPEN | |
| PH-4.1-03 | Admin speakers API returns event-scoped only | OPEN | |
| PH-4.1-04 | O05 templates CRUD | OPEN | |
| PH-4.1-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-4.1-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §4.2 — `spo-4.2-r2-uploads`
**Intent:** Signed R2 uploads with mime/size/checksum; headshot slides purposes. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-PORTAL).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-4.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-4.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-4.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-4.2-01 | Headshot jpeg ok | OPEN | |
| PH-4.2-02 | exe rejected | OPEN | |
| PH-4.2-03 | Metadata in D1 not bytes | OPEN | |
| PH-4.2-04 | Download requires auth | OPEN | |
| PH-4.2-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-4.2-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §4.3 — `spo-4.3-portal-ui`
**Intent:** Speaker portal UI G01–G08 mobile-clean; next task home. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-PORTAL).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-4.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-4.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-4.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-4.3-01 | G01–G08 PASS | OPEN | |
| PH-4.3-02 | Mobile viewport G08 | OPEN | |
| PH-4.3-03 | Lumen speaker surface may use brand tokens | OPEN | |
| PH-4.3-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-4.3-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-4.3-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §4.4 — `spo-4.4-portal-e2e`
**Intent:** I12 G* PASS after accept path. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-PORTAL).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-4.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-4.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-4.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-4.4-01 | G01–G08 PASS | OPEN | |
| PH-4.4-02 | Evidence phase4 | OPEN | |
| PH-4.4-03 | Automated tests in Tests section are implemented and pass in pnpm test:ci | OPEN | |
| PH-4.4-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |
| PH-4.4-05 | OpenAPI or command registry updated if new commands were added | OPEN | |

### §5.1 — `spo-5.1-email-templates`
**Intent:** Email templates + outbox message jobs; no request-path provider calls. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-COMMS).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-5.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-5.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-5.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-5.1-01 | Template CRUD | OPEN | |
| PH-5.1-02 | Outbox row on enqueue | OPEN | |
| PH-5.1-03 | No provider HTTP in command path | OPEN | |
| PH-5.1-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-5.1-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-5.1-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §5.2 — `spo-5.2-send-ics`
**Intent:** Comms.Preview/Send idempotent; ICS UID/SEQUENCE; provider adapter sandbox. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-COMMS).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-5.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-5.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-5.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-5.2-01 | J04 idempotent | OPEN | |
| PH-5.2-02 | J08 preview required | OPEN | |
| PH-5.2-03 | J10 SEQUENCE bump helper | OPEN | |
| PH-5.2-04 | Sandbox default | OPEN | |
| PH-5.2-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-5.2-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §5.3 — `spo-5.3-comms-ui`
**Intent:** Comms UI J01–J10 trust-before-send. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-COMMS).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-5.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-5.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-5.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-5.3-01 | J01–J10 PASS | OPEN | |
| PH-5.3-02 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-5.3-03 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-5.3-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |
| PH-5.3-05 | OpenAPI or command registry updated if new commands were added | OPEN | |
| PH-5.3-06 | README/docs cross-links updated if user-facing setup changed | OPEN | |

### §5.4 — `spo-5.4-comms-e2e`
**Intent:** I12 J* PASS. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-COMMS).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-5.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-5.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-5.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-5.4-01 | J01–J10 PASS | OPEN | |
| PH-5.4-02 | Evidence phase5 | OPEN | |
| PH-5.4-03 | Automated tests in Tests section are implemented and pass in pnpm test:ci | OPEN | |
| PH-5.4-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |
| PH-5.4-05 | OpenAPI or command registry updated if new commands were added | OPEN | |

### §6.1 — `spo-6.1-schedule-conflicts`
**Intent:** Placement commands with hard conflict detection speaker/room; versioned placements. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-SCHED).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-6.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-6.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-6.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-6.1-01 | Unit tests double book | OPEN | |
| PH-6.1-02 | Unschedule frees reservation | OPEN | |
| PH-6.1-03 | List returns unscheduled sessions | OPEN | |
| PH-6.1-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-6.1-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-6.1-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §6.2 — `spo-6.2-schedule-ui`
**Intent:** Schedule Studio hero UX I01–I16. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-SCHED).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-6.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-6.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-6.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-6.2-01 | I01–I16 PASS | OPEN | |
| PH-6.2-02 | Focus ring keyboard | OPEN | |
| PH-6.2-03 | Lumen tiles | OPEN | |
| PH-6.2-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-6.2-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-6.2-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §6.3 — `spo-6.3-readiness-dashboard`
**Intent:** Readiness dashboard H* + admin speakers N* + live update ≤5s + L05 large list. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-READY).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-6.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-6.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-6.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-6.3-01 | H01–H05 N01–N04 L05 PASS | OPEN | |
| PH-6.3-02 | Live update after portal complete | OPEN | |
| PH-6.3-03 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-6.3-04 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-6.3-05 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |
| PH-6.3-06 | OpenAPI or command registry updated if new commands were added | OPEN | |

### §6.4 — `spo-6.4-schedule-dash-e2e`
**Intent:** I12 I* H* N* L05 PASS. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-SCHED, S-READY).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-6.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-6.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-6.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-6.4-01 | All owned inv PASS | OPEN | |
| PH-6.4-02 | Evidence phase6 | OPEN | |
| PH-6.4-03 | Automated tests in Tests section are implemented and pass in pnpm test:ci | OPEN | |
| PH-6.4-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |
| PH-6.4-05 | OpenAPI or command registry updated if new commands were added | OPEN | |

### §7.1 — `spo-7.1-api-keys`
**Intent:** API keys mint/revoke UI+API; hashed secrets; scopes; K01–K04. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CLI).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-7.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-7.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-7.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-7.1-01 | K01–K04 PASS | OPEN | |
| PH-7.1-02 | Secret not re-fetchable | OPEN | |
| PH-7.1-03 | Hash only stored | OPEN | |
| PH-7.1-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-7.1-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-7.1-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §7.2 — `spo-7.2-cli`
**Intent:** speakerops CLI + OpenAPI; same commands; --json; scope deny; S-CLI. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CLI).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-7.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-7.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-7.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-7.2-01 | Readiness JSON schema stable | OPEN | |
| PH-7.2-02 | schedule:write deny proven | OPEN | |
| PH-7.2-03 | design:write publish works | OPEN | |
| PH-7.2-04 | OpenAPI served GET /openapi.json | OPEN | |
| PH-7.2-05 | docs/CLI.md lists commands | OPEN | |
| PH-7.2-06 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-7.2-07 | Consequential writes emit audit_events with correlationId | OPEN | |

### §7.3 — `spo-7.3-airtable-projection`
**Intent:** Outbox→Airtable upsert; pause survival; O06 status; S-AIRTABLE. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-AIRTABLE).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-7.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-7.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-7.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-7.3-01 | Pause survival test | OPEN | |
| PH-7.3-02 | Upsert by internal id | OPEN | |
| PH-7.3-03 | No request-path Airtable | OPEN | |
| PH-7.3-04 | O06 UI/API | OPEN | |
| PH-7.3-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-7.3-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §7.4 — `spo-7.4-cli-airtable-e2e`
**Intent:** I12 K* + CLI deny + airtable pause. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CLI, S-AIRTABLE).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-7.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-7.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-7.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-7.4-01 | K01–K04 PASS | OPEN | |
| PH-7.4-02 | CLI scope deny PASS | OPEN | |
| PH-7.4-03 | Airtable pause PASS | OPEN | |
| PH-7.4-04 | Evidence phase7 | OPEN | |

### §8.1 — `spo-8.1-inventory-completeness`
**Intent:** Machine-check every REQUIRED id has @inv test; every primary admin control mapped. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-E2E-INV).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-8.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-8.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-8.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-8.1-01 | Lint 0 on full suite tags | OPEN | |
| PH-8.1-02 | Crawl allowlist documented | OPEN | |
| PH-8.1-03 | No REQUIRED without test | OPEN | |
| PH-8.1-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §8.2 — `spo-8.2-full-playwright-suite`
**Intent:** All REQUIRED inventory PASS; close product gaps; raw report artifact. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-E2E-RUN).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-8.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-8.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-8.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-8.2-01 | 100% REQUIRED PASS or constitution DEFER | OPEN | |
| PH-8.2-02 | Report path stored | OPEN | |
| PH-8.2-03 | Console-clean happy paths | OPEN | |
| PH-8.2-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §8.3 — `spo-8.3-security-hardening`
**Intent:** CSP headers, XSS proofs, Turnstile, rate limit, cookie flags production-ready. This section is a hard dependency for later SpeakerOps phases and for constitution souls (— (supports programme)).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-8.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-8.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-8.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-8.3-01 | CSP present | OPEN | |
| PH-8.3-02 | XSS tests PASS | OPEN | |
| PH-8.3-03 | Rate limit test | OPEN | |
| PH-8.3-04 | npm/pnpm audit policy documented | OPEN | |
| PH-8.3-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-8.3-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §8.4 — `spo-8.4-demo-seed`
**Intent:** Deterministic seed ~150 speakers; dogfood role switcher for judges. This section is a hard dependency for later SpeakerOps phases and for constitution souls (— (supports programme)).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-8.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-8.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-8.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-8.4-01 | Seed idempotent second run | OPEN | |
| PH-8.4-02 | L05 data present | OPEN | |
| PH-8.4-03 | README seed instructions | OPEN | |
| PH-8.4-04 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-8.4-05 | Consequential writes emit audit_events with correlationId | OPEN | |
| PH-8.4-06 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §8.5 — `spo-8.5-e2e-keystone-report`
**Intent:** reports/e2e-coverage.html from inventory + playwright results for S-E2E evidence. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-E2E-RUN).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-8.5-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-8.5-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-8.5-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-8.5-01 | HTML exists offline | OPEN | |
| PH-8.5-02 | Shows PASS/FAIL per REQUIRED id | OPEN | |
| PH-8.5-03 | SHA/timestamp footer | OPEN | |
| PH-8.5-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §8.6 — `spo-8.6-cloudflare-dogfood-deploy`
**Intent:** Own S-CF: private CF URL health 200 with evidence; deploy script names-only secrets. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-CF).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-8.6-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-8.6-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-8.6-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-8.6-01 | BC10 evidence path | OPEN | |
| PH-8.6-02 | Health 200 recorded | OPEN | |
| PH-8.6-03 | No secrets in git | OPEN | |
| PH-8.6-04 | OPERATIONS.md steps | OPEN | |
| PH-8.6-05 | All new HTTP handlers validate with Zod and return E4 error envelopes | OPEN | |
| PH-8.6-06 | Consequential writes emit audit_events with correlationId | OPEN | |

### §9.1 — `spo-9.1-docs-ia`
**Intent:** Create full docs/ tree stubs and README map; zero dead links among stubs. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-DOCS).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-9.1-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-9.1-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-9.1-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-9.1-01 | Tree matches 0.5 outline | OPEN | |
| PH-9.1-02 | linkcheck stubs pass | OPEN | |
| PH-9.1-03 | README 5-minute orientation | OPEN | |
| PH-9.1-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §9.2 — `spo-9.2-human-onboarding`
**Intent:** docs/ONBOARDING.md zero→dogfood checklist timed; S-ONB-HUMAN. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-ONB-HUMAN).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-9.2-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-9.2-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-9.2-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-9.2-01 | Numbered steps 1..N | OPEN | |
| PH-9.2-02 | Env names only table | OPEN | |
| PH-9.2-03 | Demo path matches constitution souls | OPEN | |
| PH-9.2-04 | Timebox target e.g. <90m stated | OPEN | |

### §9.3 — `spo-9.3-agent-setup`
**Intent:** docs/AGENT_SETUP.md + CLI.md complete; agent prompt block; S-ONB-AGENT. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-ONB-AGENT).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-9.3-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-9.3-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-9.3-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-9.3-01 | Copy-paste agent block | OPEN | |
| PH-9.3-02 | Scope deny example | OPEN | |
| PH-9.3-03 | No secret values | OPEN | |
| PH-9.3-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §9.4 — `spo-9.4-deep-docs`
**Intent:** Deep docs ARCHITECTURE SECURITY OPERATIONS AIRTABLE E2E COMPETITION TROUBLESHOOTING consistent with contracts. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-DOCS).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-9.4-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-9.4-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-9.4-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-9.4-01 | All files non-stub (>80 lines or structured complete) | OPEN | |
| PH-9.4-02 | COMPETITION maps brief features | OPEN | |
| PH-9.4-03 | SECURITY matches E10 | OPEN | |
| PH-9.4-04 | No secrets, API keys, or magic-link tokens committed or logged in full | OPEN | |

### §9.5 — `spo-9.5-html-reports`
**Intent:** pnpm docs:reports builds Lumen-styled reports portal offline. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-DOCS).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-9.5-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-9.5-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-9.5-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-9.5-01 | Offline open index | OPEN | |
| PH-9.5-02 | Nav between reports | OPEN | |
| PH-9.5-03 | Light Lumen aesthetic | OPEN | |
| PH-9.5-04 | e2e report linked | OPEN | |

### §9.6 — `spo-9.6-onboarding-proof`
**Intent:** Bounded evidence for S-ONB-HUMAN/AGENT/S-DOCS/S-CF; programme exit. This section is a hard dependency for later SpeakerOps phases and for constitution souls (S-ONB-HUMAN, S-ONB-AGENT, S-DOCS, S-CF).

| Check ID | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| PH-9.6-SCOPE | Implements only pack in-scope; no struck features / dual-write / agent fleet | OPEN | |
| PH-9.6-CONTRACT | COMMANDS/SCHEMA/SCOPES updated if surface added; no invented routes | OPEN | |
| PH-9.6-GATES | Relevant gates green (typecheck/test:ci/e2e as owned) | PASS | SR 50/50 + Phase final Codex APPROVE + pnpm test:ci (governance section tests) + tip ce32819 · initiative/evidence/handover/post-sr-gates-20260809T0146Z.txt |
| PH-9.6-01 | initiative/evidence/onboarding-proof/ complete | OPEN | |
| PH-9.6-02 | BC13–15 DONE paths | OPEN | |
| PH-9.6-03 | linkcheck 0 | OPEN | |
| PH-9.6-04 | No tribal steps | OPEN | |

---

## 8. Cross-cutting production tracks (full depth)

### 8.1 Security review (SEC-*)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| SEC-01 | Magic-link tokens single-use, hashed at rest, never logged | OPEN | |
| SEC-02 | Session cookies HttpOnly Secure SameSite=Lax; not in localStorage | OPEN | |
| SEC-03 | Role guards: unauth admin blocked; wrong role denied (B04–B06 + API) | OPEN | |
| SEC-04 | Role switcher OFF by default; if enabled, **no privilege escalation** to admin for speaker/evaluator | OPEN | |
| SEC-05 | API keys: secret once at mint; hash stored; revoke → 401; list never returns full secret | OPEN | |
| SEC-06 | Default-deny scopes: `comms:send`, `decisions:write`, `keys:admin` not auto-granted | OPEN | |
| SEC-07 | Scopes enforced on Worker for every CLI/HTTP command path | OPEN | |
| SEC-08 | Turnstile required on public submit; production rejects test/always-pass secrets | OPEN | |
| SEC-09 | CSP present and production-safe; **dev/e2e still runnable** (no empty React root) | OPEN | |
| SEC-10 | XSS: untrusted content text-not-script (A10, C09, related) | OPEN | |
| SEC-11 | Rate limit public submit → 429 under test | OPEN | |
| SEC-12 | R2 private; mime/size enforced; virus_scan_status field used as designed | OPEN | |
| SEC-13 | No secrets in git history (gitleaks clean on final tip) | OPEN | |
| SEC-14 | Error responses never leak stack traces to client | OPEN | |
| SEC-15 | Audit trail on keys, decisions, sends, design publish, placements | OPEN | |
| SEC-16 | Dependency audit policy documented; critical CVEs addressed or waived with reason | OPEN | |
| SEC-17 | CORS / origin policy appropriate for SPA+Worker | OPEN | |
| SEC-18 | Bootstrap admin path default-deny without BOOTSTRAP_ADMIN_EMAIL | OPEN | |

### 8.2 Frontend ↔ backend alignment (FEBE-*)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| FEBE-01 | Every COMMANDS.md HTTP route implemented and wired in composition root | OPEN | |
| FEBE-02 | Every UI action calls real domain API (no mock-only soul chrome) | OPEN | |
| FEBE-03 | Shared Zod DTOs in packages/shared used by web + api (no drift copies) | OPEN | |
| FEBE-04 | OpenAPI lists all admin/CLI-facing paths; CLI targets same paths | OPEN | |
| FEBE-05 | Form builder field model I16 flows match public CFP submit payload | OPEN | |
| FEBE-06 | Portal task/file APIs match G* UI | OPEN | |
| FEBE-07 | Schedule place/move UI matches conflict engine errors | OPEN | |
| FEBE-08 | Comms preview recipient count matches send job recipients | OPEN | |
| FEBE-09 | Design kit publish tokens match public CFP CSS variables | OPEN | |
| FEBE-10 | Error envelope codes surfaced in UI for validation/authz | OPEN | |
| FEBE-11 | Optimistic concurrency: UI recovery on 409 (I15 etc.) | OPEN | |
| FEBE-12 | Active event context consistent across admin nav surfaces | OPEN | |

### 8.3 Design / Lumen vs owner intent (DES-*)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| DES-01 | Light default Lumen theme (not dark dingy default) | OPEN | |
| DES-02 | Token scale: brand, focus, status, radius, spacing used consistently | OPEN | |
| DES-03 | Design Kit: contrast gate, PNG logo only, no freeform CSS | OPEN | |
| DES-04 | Component checklist from Lumen (schedule tile, form builder, cards, etc.) present | OPEN | |
| DES-05 | Public CFP + portal + admin feel coherent (same system) | OPEN | |
| DES-06 | Empty states / focus rings / status not color-only | OPEN | |
| DES-07 | Mobile paths A09 G08 L* acceptable | OPEN | |
| DES-08 | Visual bar matches “Apple-level / curvy / tasteful” intent (human review) | OPEN | |

### 8.4 E2E completeness (beyond per-ID table)

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| E2E-ALL-01 | 108/108 REQUIRED PASS in one clean full run | OPEN | |
| E2E-ALL-02 | Inventory lint phase8: all @inv bound; no spoofed tags | OPEN | |
| E2E-ALL-03 | Discovery crawl: no unlisted primary admin actions (or filed as defects) | OPEN | |
| E2E-ALL-04 | Console-clean happy paths (zero uncaught errors) | OPEN | |
| E2E-ALL-05 | reports/e2e-coverage.html accurate vs run (not zero PASS mask) | OPEN | |
| E2E-ALL-06 | Partial run reports do not poison inventory discovery | OPEN | |
| E2E-ALL-07 | Negatives for authz/validation listed in inventory all pass | OPEN | |
| E2E-ALL-08 | Flakes quarantined only with owner-visible ticket — not silent skip | OPEN | |

### 8.5 Integrations & host

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| INT-01 | Airtable projection outbox-only; pause → product still 200 | OPEN | |
| INT-02 | Email sandbox default; Resend only when EMAIL_PROVIDER=resend | OPEN | |
| INT-03 | CF dogfood deploy script redacts tokens in evidence | OPEN | |
| INT-04 | Live GET /health 200 on redacted workers.dev (or OWNER_SIGNED_DEFER) | OPEN | |
| INT-05 | D1 Time Travel / rollback notes in OPERATIONS | OPEN | |

### 8.6 Onboarding & competition docs

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| DOC-01 | README map links all critical docs | OPEN | |
| DOC-02 | docs/ONBOARDING.md zero→dogfood timed checklist | OPEN | |
| DOC-03 | docs/AGENT_SETUP.md + CLI.md agent-operable | OPEN | |
| DOC-04 | ARCHITECTURE, SECURITY, OPERATIONS, AIRTABLE, E2E, COMPETITION, TROUBLESHOOTING complete | OPEN | |
| DOC-05 | reports/index.html offline portal Lumen-styled | OPEN | |
| DOC-06 | COMPETITION.md maps brief features 1–6 + non-goals honestly | OPEN | |
| DOC-07 | 9.6 dry-run evidence recorded for human + agent paths | OPEN | |

### 8.7 Performance & livability

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| PERF-01 | Admin list p95 target with seed ≤150 documented | OPEN | |
| PERF-02 | Public CFP no multi-second blank (skeleton ok) | OPEN | |
| PERF-03 | L05 large speaker list usable | OPEN | |
| PERF-04 | No empty primary chrome on soul surfaces | OPEN | |

### 8.8 Clean-room & competition honesty

| ID | Check | Status | Evidence |
|----|-------|--------|----------|
| CR-01 | No Sessionboard trade dress, private APIs, or copied proprietary assets | OPEN | |
| CR-02 | Original IA/design/code | OPEN | |
| CR-03 | Non-goals honored (no struck features smuggled in) | OPEN | |

---

## 9. Final gate commands (must all be green on handover tip)

```bash
pnpm typecheck
pnpm test:ci
E2E_INVENTORY_GATE=phase8 pnpm test:e2e:inventory
pnpm test:e2e
pnpm docs:e2e-report   # if applicable
pnpm docs:reports      # Phase 9
# optional live:
# scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
# SMOKE_BASE_URL=… playwright cf smoke
```

| ID | Gate | Status | Evidence |
|----|------|--------|----------|
| GATE-01 | typecheck | OPEN | |
| GATE-02 | test:ci | OPEN | |
| GATE-03 | inventory phase8 | OPEN | |
| GATE-04 | full Playwright | OPEN | |
| GATE-05 | docs:reports | OPEN | |
| GATE-06 | gitleaks / secret scan on tip | OPEN | |
| GATE-07 | CF live smoke or OWNER_SIGNED_DEFER | OPEN | |

---

## 10. Gap → build plan protocol

When any checklist row is FAIL/GAP after SR “complete”:

1. **Record** gap with check ID, severity (still fix all — severity only orders work), evidence of failure.
2. **Plan** a bounded fix (files, tests, inventory if needed) — update contracts in same change if APIs change.
3. **Auditor review of plan** (Codex) before large rewrites.
4. **Implement** on box/workspace; keep clean commits `fix(handover): …` or section-scoped.
5. **Re-verify** affected gates + original check row.
6. **Codex + Grok re-agree** on that cluster.
7. **No handover** until §11–§14 complete.

---

## 11. Backup & remote (operational, post-SR)

| ID | Action | Status |
|----|--------|--------|
| OPS-01 | Final git bundle/pull from made-pilot → local `Documents/speakerops` | OPEN |
| OPS-02 | Secret scan clean on final tip | OPEN |
| OPS-03 | Push to private `blockbrain-ai/speakerops` | OPEN |
| OPS-04 | Optional: archive packs from ClawdSpeakerOpsRuns / nood-factory (not required for product OSS) | OPEN |
| OPS-05 | This checklist committed/updated with PASS evidence paths | OPEN |

---

## 12. Grok independent notes (pack corpus read)

- Read all **50** pack `task.md` intents + `spec.md` AC sets via full tree walk; digest at `/tmp/speakerops-pack-extract/DIGEST.md` (~400 AC bullets).
- Control plane path: `~/Documents/nood-factory/plans/runs/speakerops/` (packs **not** in product git).
- Initiative spine: constitution, Lumen, livability, BUILD_CHECKLIST, contracts, 108-row inventory, owner verbatim.
- Standards E1–E12 and ACTIVE-RUNS 0–9 (especially Phase 8 keystone + Phase 9 exit) folded into tracks above.
- Mid-build observation (not PASS/FAIL yet): Phase 8 audit already flags role-switch escalation, CSP vs Vite e2e, inventory partial-report coupling, BC10 NEED_LIVE_SMOKE — these **must** clear under SEC/E2E/BC before handover.

---

## 13. Codex independent checklist — dual-lock agreement

| Field | Value |
|-------|-------|
| **Codex artifact (independent)** | `initiative/audits/PRODUCTION_HANDOVER_CHECKLIST-codex.md` |
| **Grok master (this file)** | `initiative/PRODUCTION_HANDOVER_CHECKLIST.md` |
| **Agreement date** | 2026-08-09 |
| **Merge rule** | **UNION — both documents are binding.** A row is closed only when the corresponding requirement is satisfied for **both** lists (stricter interpretation wins). Never drop soul / inventory / CLI / security / onboarding rows from either. |
| **ID schemes** | Grok uses `E2E-A01`, `SEC-01`, `PH-3.3-01`… · Codex uses `PH-3.3-04`, `PH-X-SEC-*`, `PH-S-*`… — different IDs may name the same requirement; auditors map by substance. |
| **Counts (approx.)** | Grok master ~600+ table checks (incl. **108 individual inventory rows**); Codex independent ~585–600 PH-* checks; union of intent is **full production surface** |

### Dual AGREE (checklist *contract*, not product PASS)

| Auditor | Statement | Date |
|---------|-------------|------|
| **Grok** | This master checklist + Codex independent list together define the **only** acceptable handover contract for FULL dogfood_ready. No critical/major-only shortcut. | 2026-08-09 |
| **Codex Sol** | Independent checklist issued after full pack corpus read; handover requires that list closed (PASS/evidence or owner DEFER) **and** agreement with Grok master union rule. | 2026-08-09 |

**Merge log:**

| Date | Item | Resolution |
|------|------|------------|
| 2026-08-09 | Initial LOCK | Both checklists issued from same pack/initiative corpus. Product verification not started (SR still mid Phase 8/9). **Owner handover forbidden** until §14 filled after post-build verification against **union**. |
| 2026-08-09 | Scope alignment | Both include: souls S-THEME…S-DOCS, BC01–15, E1–E12, 50 sections, security, FE↔BE, E2E, Lumen, CLI, Airtable, CF, onboarding, clean-room. Grok uniquely expands **per-inventory-ID** table (108); Codex expands **PH-X-*** cross-cuts — **both required**. |

---

## 14. Sign-off (handover forbidden until complete)

| Role | Statement | Signature | Date |
|------|-----------|-----------|------|
| Grok | All checklist rows PASS or OWNER_SIGNED_DEFER; evidence reviewed | | |
| Codex Sol | Independent re-audit AGREE — no open production gaps for dogfood_ready | | |
| Owner | Accepts DEFER rows (if any) and receives handover | | |

**Handover package:**

- [ ] Final tip SHA + GitHub private remote updated  
- [ ] This checklist with evidence paths filled  
- [ ] Soul demos / e2e report / CF evidence (or signed DEFER)  
- [ ] Phase 9 docs + HTML portal  
- [ ] Dual AGREE above  

---

## 15. Appendix — section order (canonical)

```
0.1 0.2 0.3 0.4 0.5 1.1 1.2 1.3 1.4 1.5 1.6 2.1 2.2 2.3 2.4 2.5
3.1 3.2 3.3 3.4 3.5 3.6 4.1 4.2 4.3 4.4 5.1 5.2 5.3 5.4
6.1 6.2 6.3 6.4 7.1 7.2 7.3 7.4 8.1 8.2 8.3 8.4 8.5 8.6
9.1 9.2 9.3 9.4 9.5 9.6
```

## 16. Appendix — pack directory map

- `0.1` → `spo-0.1-programme-contract`
- `0.2` → `spo-0.2-lumen-design-lock`
- `0.3` → `spo-0.3-browser-e2e-inventory-lock`
- `0.4` → `spo-0.4-domain-command-map`
- `0.5` → `spo-0.5-docs-onboarding-outline`
- `1.1` → `spo-1.1-monorepo-gates`
- `1.2` → `spo-1.2-worker-health`
- `1.3` → `spo-1.3-d1-baseline`
- `1.4` → `spo-1.4-lumen-shell`
- `1.5` → `spo-1.5-playwright-inventory-harness`
- `1.6` → `spo-1.6-foundation-e2e-proof`
- `2.1` → `spo-2.1-session-auth`
- `2.2` → `spo-2.2-roles-guards`
- `2.3` → `spo-2.3-event-settings`
- `2.4` → `spo-2.4-design-kit`
- `2.5` → `spo-2.5-auth-settings-e2e`
- `3.1` → `spo-3.1-form-builder-api`
- `3.2` → `spo-3.2-form-builder-ui`
- `3.3` → `spo-3.3-public-cfp`
- `3.4` → `spo-3.4-evaluation`
- `3.5` → `spo-3.5-decisions`
- `3.6` → `spo-3.6-cfp-eval-e2e`
- `4.1` → `spo-4.1-portal-api`
- `4.2` → `spo-4.2-r2-uploads`
- `4.3` → `spo-4.3-portal-ui`
- `4.4` → `spo-4.4-portal-e2e`
- `5.1` → `spo-5.1-email-templates`
- `5.2` → `spo-5.2-send-ics`
- `5.3` → `spo-5.3-comms-ui`
- `5.4` → `spo-5.4-comms-e2e`
- `6.1` → `spo-6.1-schedule-conflicts`
- `6.2` → `spo-6.2-schedule-ui`
- `6.3` → `spo-6.3-readiness-dashboard`
- `6.4` → `spo-6.4-schedule-dash-e2e`
- `7.1` → `spo-7.1-api-keys`
- `7.2` → `spo-7.2-cli`
- `7.3` → `spo-7.3-airtable-projection`
- `7.4` → `spo-7.4-cli-airtable-e2e`
- `8.1` → `spo-8.1-inventory-completeness`
- `8.2` → `spo-8.2-full-playwright-suite`
- `8.3` → `spo-8.3-security-hardening`
- `8.4` → `spo-8.4-demo-seed`
- `8.5` → `spo-8.5-e2e-keystone-report`
- `8.6` → `spo-8.6-cloudflare-dogfood-deploy`
- `9.1` → `spo-9.1-docs-ia`
- `9.2` → `spo-9.2-human-onboarding`
- `9.3` → `spo-9.3-agent-setup`
- `9.4` → `spo-9.4-deep-docs`
- `9.5` → `spo-9.5-html-reports`
- `9.6` → `spo-9.6-onboarding-proof`

---

*— LOCKED 2026-08-09. Amendments require owner approval (constitution Article IV style) and dual auditor re-AGREE.*
