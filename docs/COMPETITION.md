# Competition brief mapping

> **Soul:** **S-DOCS** · **Owner prose:** section **9.4** · **IA:** [9.1](./sections/9.1-docs-ia.md)  
> **Synthesis:** [SYNTHESIS-BEST-FOOT-FORWARD.md](../KMS-competition/research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md)  
> **Constitution:** [00_CONSTITUTION.md](../KMS-competition/initiative/00_CONSTITUTION.md) · programme [0.1](./governance/0.1-programme-contract.md)

## Purpose

Judge-facing map of brief features **1–6** to SpeakerOps delivery, plus explicit **non-goals** and the honest coverage matrix (§3: six brief areas implemented end-to-end, three not built) so reviewers do not expect Sessionboard CRM, in-product agent fleets, OR-Tools, Next/RSC, Postgres dual-stack, or Airtable dual-write.

SpeakerOps is a **clean-room Program OS** for AI Engineer program ops — not a Sessionboard clone or marketing suite.

---

## 1. Product one-liner

A calm, fast, open-source **Program OS** that takes an event from conditional CFP through human evaluation, speaker onboarding, templated comms/calendar, conflict-safe scheduling, and a live readiness dashboard — deployed on **Cloudflare**, with support for an optional **one-way** Airtable projection (paused on the hosted demo — no keys configured), operated by humans **and** agents via **CLI + scoped keys**.

Exit claim: **`dogfood_ready`** — Cloudflare dogfood deploy + full browser E2E green + onboarding docs (human + agent).

---

## 2. Brief features 1–6 → delivery

Each row is a judged workflow. Production bar is “operate a multi-day tech conference cohort (~100–150 speakers),” not screenshot theatre.

| # | Brief workflow | SpeakerOps delivery | Primary souls | Phase / proof |
|---|----------------|---------------------|---------------|---------------|
| **1** | **CFP form builder + public submit** | Conditional form builder, versioned publish, public CFP, Turnstile, multi-speaker, open/close | S-CFP, S-THEME | 3.x · keystone 3.6 · A*/D* inventory |
| **2** | **Speaker portal** | Magic link → portal home, tasks, bio/headshot/slides (R2 when configured; the hosted demo stores file bytes as durable D1 `file_blobs` rows because R2 is not bound), multi-speaker sessions | S-PORTAL | 4.x · keystone 4.4 · G* |
| **3** | **Comms + calendar** | Templates, merge fields, preview-required, **idempotent** send, delivery log, **ICS UID/SEQUENCE** | S-COMMS | 5.x · keystone 5.4 · J* |
| **4** | **Evaluation & scoring** | Assignments, rubric, scores, comments, **human** accept/reject/waitlist + audit | S-EVAL | 3.4–3.5 · F*/E* · (AI multi-round **struck**) |
| **5** | **Schedule studio** | Drag-drop + keyboard, rooms/tracks, multi-view, **instant conflict explain**, draft safety | S-SCHED | 6.x · keystone 6.4 · I* · (**no OR-Tools**) |
| **6** | **Readiness dashboard** | Outstanding/overdue/blocked tasks, drill-down, live after portal complete | S-READY | 6.3 · H* / readiness |

### Platform MUST (invisible but production-hard)

| Capability | Where |
|------------|--------|
| Roles enforced server-side | [SECURITY.md](./SECURITY.md) · E2 |
| Typed domain commands (Zod) + E4 | [COMMANDS.md](../KMS-competition/initiative/contracts/COMMANDS.md) · E4 |
| D1 SoR + files (R2 when configured; hosted demo uses durable D1 `file_blobs` rows — no R2 binding) | [ARCHITECTURE.md](./ARCHITECTURE.md) · E1 |
| Outbox + Queues | E7 · [OPERATIONS.md](./OPERATIONS.md) |
| CSP + secure cookies | E10 · [SECURITY.md](./SECURITY.md) |
| Playwright inventory E2E | [E2E.md](./E2E.md) · S-E2E-INV / S-E2E-RUN |
| Seeded demo + dogfood deploy | 8.4 · 8.6 · S-CF |
| CLI + scoped API keys | 7.1–7.2 · S-CLI · [CLI.md](./CLI.md) |
| One-way Airtable projection | 7.3 · S-AIRTABLE · [AIRTABLE.md](./AIRTABLE.md) |
| Onboarding docs | Phase 9 · S-ONB-HUMAN / S-ONB-AGENT / S-DOCS |

---

## 3. Full brief coverage — the honest 9-row matrix

The brief names nine primary feature areas. Six are implemented end-to-end; three are not built, each with the extension point that exists today. We prioritized making the core CFP→readiness loop production-hard over breadth — the judgment call was fewer surfaces, each one correct, tested, and operable.

| # | Brief feature | Status | Where / extension point |
|---|---------------|--------|--------------------------|
| 1 | CFP forms (conditional logic, category routing) | **Implemented** | §2 row 1 |
| 2 | Speaker portal | **Implemented** | §2 row 2 |
| 3 | Templated comms + calendar invites | **Implemented** — templates, preview-required idempotent send, delivery log, ICS UID/SEQUENCE, speaker portal `.ics` download. Hosted demo email sends via Cloudflare Email (no attachments); the Resend adapter ships for attachment delivery when configured | §2 row 3 · [portal ICS](../KMS-competition/initiative/contracts/COMMANDS.md) |
| 4 | Evaluation & scoring (human) | **Implemented** — proposal panel, rubric, peer reviews, deliberation, bulk decisions | §2 row 4 |
| 5 | Drag-drop schedule + conflict detection (5 views) | **Implemented** | §2 row 5 |
| 6 | Real-time readiness dashboard | **Implemented** | §2 row 6 |
| 7 | Accelevents one-way integration | **In build** (constitution Amendment A1, 2026-08-11) — outbox projector on the proven Airtable pattern: idempotent one-way upserts, retries, tombstones, replay; never dual-write | [AIRTABLE.md](./AIRTABLE.md) |
| 8 | Portal resources/wiki + HTML embeds | **In build** (Amendment A1) — versioned rich-content pages with sandboxed, allowlisted embeds (separate CSP; never in the SPA origin) | — |
| 9 | Embeddable mobile-friendly gallery/schedule | **In build** (Amendment A1) — Speaker Gallery, Schedule Itinerary, Sessions, Speakers, Agenda as public pages + styled-HTML embeds with device preview & copy-code, from a versioned published-programme read model | — |
| — | AI-assisted multi-round review (brief: optional) | **Not built** (human single-round evaluation is complete; scoped API keys + CLI give an agent everything needed to draft reviews externally) | [CLI.md](./CLI.md) |

### Deliberate scope exclusions (product judgment, not brief items)

- Full **Sessionboard CRM / Marketing / CMS / media** suite  
- **Ticketing**, travel booking, expo floorplans, badge printing, payments, attendee app  
- **In-product multi-agent fleet** / MCP product theatre / agent control-plane UI  

### Stack & architecture (forbidden substitutions)

- **OR-Tools** / CP-SAT auto-scheduler (human drag-drop + conflict detection only)  
- **Temporal** (or similar workflow engine as default platform)  
- **Next.js / RSC** as default frontend  
- **Postgres + D1 dual-stack** (or any second SoR)  
- **Airtable dual-write** / bidirectional sync / Airtable-as-database  
- Multi-region HA as Phase 0–9 requirement  
- Freeform custom CSS/HTML/JS theming (Lumen tokens only)  
- Parallel god-mode CLI that bypasses domain commands  
- Production cutover of AIE’s live events (dogfood deploy only unless owner amends claim)  

### Process non-goals

- Changing soul tests without constitution **Amendment** + owner approval  
- Shrinking `BROWSER_E2E_INVENTORY.md` REQUIRED rows to pass CI  
- Secrets or secret values in git (env **names** only)  

---

## 4. What we kept from synthesis (production hard)

| Keep | Why |
|------|-----|
| Clean-room IA / design / code | No Sessionboard trade dress or private APIs |
| **Person ≠ Speaker** | Durable identity vs event participation |
| **Submission ≠ Session** | Application vs program slot |
| Exception-first readiness | Who is blocking, not endless grids |
| Preview → approve → idempotent send | Comms integrity |
| Deterministic conflict rules + audit | Not LLM-owned timers |
| Human authority on accept/reject | AI multi-round struck |
| Performance as a feature | Admin p95 target; no multi-second blank CFP |
| CLI over same domain commands | Software 3.0 surface without agent fleet UI |

Source: [SYNTHESIS-BEST-FOOT-FORWARD.md](../KMS-competition/research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md).

---

## 5. Soul → artifact map (judge index)

| Soul | Intent | Primary proof |
|------|--------|---------------|
| S-THEME | Design Kit brand | C* inventory · design publish |
| S-CFP | Form + public submit | A* · 3.6 keystone |
| S-EVAL | Score + accept + audit | F*/E* · 3.6 |
| S-PORTAL | Tasks + files | G* · 4.4 |
| S-COMMS | Preview/send + ICS | J* · 5.4 |
| S-SCHED | Place + conflicts | I* · 6.4 |
| S-READY | Readiness dashboard | H* · 6.3/6.4 |
| S-CLI | Scoped CLI | CLI inventory · 7.2/7.4 |
| S-AIRTABLE | One-way projection | O06 · 7.3 |
| S-CF | Cloudflare dogfood | BC10 · 8.6 · [OPERATIONS.md](./OPERATIONS.md) |
| S-E2E-INV / S-E2E-RUN | Inventory + full run | [E2E.md](./E2E.md) · 8.1–8.5 |
| S-ONB-HUMAN | Human onboarding | [ONBOARDING.md](./ONBOARDING.md) · 9.2 / 9.6 |
| S-ONB-AGENT | Agent onboarding | [AGENT_SETUP.md](./AGENT_SETUP.md) · 9.3 / 9.6 |
| S-DOCS | Coherent docs + HTML | this tree · 9.1–9.5 · 9.6 |

Full soul text: constitution Article II only. Traceability: [TRACEABILITY.md](../KMS-competition/initiative/contracts/TRACEABILITY.md).

---

## 6. Clean-room boundary

| Allowed | Forbidden |
|---------|-----------|
| Original IA, Lumen design, schema, APIs | Sessionboard trade dress, logos, private APIs |
| Public customer needs (brief, walkthrough) | Scraped proprietary UI as product law |
| Compatible *jobs* (CFP, eval, schedule, portal) | Full CRM/Marketing/CMS/media suite clone |
| Independent domain model | Dual-write into Sessionboard |

If unsure whether a surface is clean-room-safe: **stop** and treat as out of scope until governance amends.

---

## 7. Demo path for judges (pointer)

- Live demo entry: open `/judge` on <https://www.speakerops.org>, pick a role, and enter (no access code). README → “Judges — start here”
- Human timed path: [ONBOARDING.md](./ONBOARDING.md)
- Agent path: [AGENT_SETUP.md](./AGENT_SETUP.md)
- Demo seed: [8.4-demo-seed.md](./sections/8.4-demo-seed.md)
- Dogfood URL: [OPERATIONS.md](./OPERATIONS.md)
- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 8. Related

| Doc | Role |
|-----|------|
| [BUILD_CHECKLIST.md](../KMS-competition/initiative/BUILD_CHECKLIST.md) | BC01–BC15 closure |
| [BROWSER_E2E_INVENTORY.md](../KMS-competition/initiative/BROWSER_E2E_INVENTORY.md) | REQUIRED journeys |
| [FIELD_FLOW.md](./FIELD_FLOW.md) | I16 forms → portal |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common failures |
| Section note | [9.4-deep-docs.md](./sections/9.4-deep-docs.md) |
