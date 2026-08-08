# SpeakerOps pack re-advisory — Codex

**Date:** 2026-08-08  
**Role:** Independent Section Runner pack auditor  
**Scope:** Contract spine plus full reads of `spo-3.2`, `spo-6.2`, `spo-7.2`, `spo-7.3`, `spo-8.2`, `spo-8.6`, `spo-9.2`, and `spo-9.6`; calibration reads of `spo-1.1` and `spo-5.2`; relevant standards, phase indexes, setup, inventory, constitution, and build-checklist seams.  
**Authority:** Authoring review only. This does **not** authorize sync, build, execute, finalize, merge, deploy, credential use, or live-environment changes.

## Verdict

**INADEQUATE**

The deepen pass added useful scaffolding: 50 packs now exist, high-risk sample classifications request human review, exact browser ownership and CLI inventories exist, an 8.6 Cloudflare section exists, and all ten audited packs pass the structural validator. They are still not competition/production-grade planning contracts. The sampled specs remain headline expansions over a shared template; the plans do not tell a builder what to implement at file/symbol/control-flow level; canonical contracts still require invention; and the browser, deploy, and onboarding terminal proofs can approve stale, simulated, or incomplete evidence.

## MUST_FIX

### MF-1 — Freeze and complete the governing contract spine

**Evidence:**

- `initiative/00_CONSTITUTION.md:3` remains `DRAFT → pending owner LOCK`, while `initiative/contracts/SCHEMA.md:3` calls its schema sketch `LOCK for pack deepen`. There is no single frozen/versioned source manifest consumed by the packs.
- `initiative/contracts/COMMANDS.md:20,29,32,40–42,48,58,65–67` uses placeholders such as `…`, `fields[]`, `rules[]`, `speakers[]`, `criteria[]`, `scores[]`, `patch`, `segment`, and `previewId / draftId` without DTO shapes, transitions, error codes, idempotency rules, audit ownership, or test ownership. Routes at lines 112, 114, and 120 are not mapped to named commands; commands such as `Auth.CreateInvite` and `Comms.IcsForPlacement` have no HTTP mapping.
- `initiative/contracts/SCHEMA.md:19–24,52–56,67–68,86–96` retains shared/ambiguous ownership, ellipses, and column-name sketches without the D1 types, nullability, defaults, foreign keys, indexes, lifecycle, compatibility order, or rollback needed to stop incompatible migrations.
- `initiative/contracts/SCOPES.md` is a summary, not a command-level allow/deny and event-boundary matrix.
- `initiative/contracts/TRACEABILITY.md` stops at soul → section → terminal proof. It has no spec AC, plan step, named test/gate, rollout proof, or negative-path rows, and still uses wildcard section notation at lines 21–24.
- None of the 50 specs references `CLI_INVENTORY.md`, `INVENTORY_OWNERSHIP.md`, or `TRACEABILITY.md`; even `spo-7.2-cli` does not consume the canonical CLI inventory.

**Failure scenario:** Two competent builders can satisfy the cited contracts while choosing incompatible DTOs, indexes, scope behaviour, preview identity, or outbox semantics. Later UI, CLI, Airtable, and proof sections then agree with their own implementations but not with each other.

**Required correction:** Obtain the owner constitution lock and freeze a resolvable source/version manifest. Complete the command, route, DTO, schema, scope, ownership, lifecycle, error, audit, idempotency, migration, and rollback contracts. Close traceability as `requirement/invariant → section → spec AC → plan step → named test/gate → rollout/evidence proof`, including required negative paths. Make each consuming pack cite the exact relevant contract rows/IDs and fail on drift.

### MF-2 — Replace the programme-wide template stamp with executable per-section contracts

**Evidence:**

- All 50 plans repeat `Composition routers/middleware to register module` and `Implement commands/handlers with Zod + authz + audit + idempotency where required` without naming the router, handler, command, DTO, call site, or symbol.
- All 50 specs repeat an unrelated admin-list p95 paragraph and an `All new HTTP handlers...` AC, including the monorepo-only `spo-1.1` and documentation/proof packs `spo-9.2` and `spo-9.6`.
- Forty-five classifications grant both `apps/web/**` and `apps/api/**`; sampled packs also grant `packages/**`, `tests/**`, `playwright/**`, `docs/**`, and `reports/**` even when their plans create one document or one focused module.
- Sampled tests usually name only a file or command, not scenarios and assertions: `spo-3.2/spec.md:103–105`, `spo-6.2/spec.md:99–101`, `spo-8.2/spec.md:95–97`, `spo-9.2/spec.md:99–101`, and `spo-9.6/spec.md:98–100`.
- Sampled `Section Gates` cover only the first bespoke ACs and omit the remaining ACs. For example, `spo-3.2/spec.md:93–100` has eight criteria while `spo-3.2/plan.md:61–64` maps four; the same orphan pattern appears in `spo-6.2`, `spo-7.2`, `spo-7.3`, `spo-8.2`, `spo-8.6`, `spo-9.2`, and `spo-9.6`.
- I16 exists in only 16 of 50 specs. Where sampled, it is incomplete: `spo-3.2/spec.md:106–110` traces only `label`; `spo-5.2/spec.md:105–109` traces only recipient email; `spo-6.2` has no I16 table despite schedule placement and view-state flow.

**Failure scenario:** A builder can implement a superficially complete screen, command, document, or worker, add a shallow test file, and pass every literal plan checkbox while leaving controls unwired, fields divergent, negatives unproved, and acceptance criteria orphaned.

**Required correction:** Re-author all four files of every affected pack as one unit. Specs must pin exact inputs, outputs, DTOs, state transitions, failure/security behaviour, field flows, and assertion-level positive/negative tests. Plans must name exact paths, symbols/signatures, wiring call sites, ordered migrations/rollback, and one verification gate per AC. Classifications must bound the real change surface. Remove irrelevant boilerplate rather than satisfying numeric length/AC quotas. Split any section that cannot remain an atomic build/audit unit at this depth.

### MF-3 — Close the sampled UI, CLI, comms, and Airtable interfaces rather than delegating them to headings

**Evidence:**

- `spo-3.2/spec.md:65–74` says only `UI → Form.* APIs`; its ten inventory journeys are not expanded into controls, exact requests/responses, loading/error/empty states, publish/version behaviour, or assertion-level browser proofs. Its sole failure mode is at lines 80–82.
- `spo-6.2/spec.md:61–78` says only `UI→Schedule.*`, leaves data empty, and specifies one failure. It does not contract DnD/keyboard/undo state, stale-version recovery, conflict payloads, timezone transformation, or same-placement identity across all five views and reload.
- `spo-7.2/spec.md:34–64` mentions only a subset of the 12 canonical CLI rows. It supplies no option grammar, request/JSON schema, stderr contract, dry-run/idempotency behaviour, complete exit-code matrix, OpenAPI parity rule, or per-command scope/audit assertions. Its hard dependencies omit producers required by `CLI02`, `CLI08`, `CLI09`, and related commands.
- `spo-7.3/spec.md:34–79` does not define projected entity/event topics, Airtable table/field mapping, outbox state machine, version/upsert rules, replay, poison handling, lag DTO, redaction, or catch-up limits. O06 is owned here, but `spo-7.3/plan.md:18–28` creates no web status surface.
- `spo-5.2/spec.md:57–109` does not pin the preview snapshot/invalidation contract, idempotency request-hash conflict, message/delivery state transitions, ICS `METHOD`/UID/SEQUENCE/cancel lifecycle, retry terminal state, or same-value flow beyond recipient email.

**Failure scenario:** The form preview can disagree with the published form; schedule views can display different placements; the CLI can bypass or omit canonical commands; Airtable can lose or duplicate updates; and a reschedule can emit a new UID rather than incrementing SEQUENCE—all while the named files and headline ACs pass.

**Required correction:** Bind every owned inventory/CLI ID to an exact interface and assertion. Add complete per-field I16 rows and fallback tests. For Airtable and comms, define the durable state machines, mappings, replay/idempotency behaviour, outage isolation, and terminal error evidence. Correct dependencies and plan file/symbol ownership so every consumer is built after its producer.

### MF-4 — Repair phase indexes and make the control-plane handoff authoritative

**Evidence:**

- `ACTIVE-RUNS-03`, `05`, `06`, and `07` remain short headline lists. They omit the required verified baseline, explicit non-goals, section table with task type/wave/dependencies/boundary reason, cross-cutting field-flow ownership, rollout/live gates, model-role decision, and exact human approval points. Across all ten phase indexes there is no model-role or final-audit decision.
- `SETUP.md:17–25` names only builder/section-audit/phase-audit settings, not the full planner, plan-auditor, builder, section-auditor, phase-auditor, and integrator decisions with independence/fallback.
- `SETUP.md:31–32` makes full CI a “should” and live smoke optional, while line 40 says live smoke is mandatory for S-CF.
- `SETUP.md:13–15` omits section 8.6 from its proposed order, while `SECTION_ORDER.proposed.txt` includes all 50 sections including 8.6.

**Failure scenario:** The control plane can be configured from the stale setup order and never run the section that owns S-CF; it can also finish on unit tests without authoritative full-browser/live gates or use unintended model fallbacks.

**Required correction:** Deepen every phase index to the programme contract and reconcile it with the section artifacts. Publish one canonical 50-section order and one names-only handoff with all model roles, exact verified model IDs, independent final audit, non-convergence fail, absolute run paths, authoritative typecheck/test/full-CI/live-smoke commands, classifications, and separate human approval before any deploy/finalize/merge. Validation must fail if setup, order, indexes, and classifications diverge.

### MF-5 — Make the final browser proof run the exact inventory on the final product SHA

**Evidence:**

- The machine-read inventory contains 108 REQUIRED IDs, but `ACTIVE-RUNS-08:18` still says A–M and omits the N/O areas; the inventory prose itself says `~115+` rather than a generated exact count.
- `spo-8.2/spec.md:34–97` uses `all REQUIRED PASS`, leaves interfaces and failure modes blank, and names only `pnpm test:e2e full` with no proof that this is a real non-watch command or that it asserts every exact ID, required negative, no skips/focus, discovery crawl, network health, console health, and evidence status transition.
- 8.2 runs before 8.3 security and 8.4 seed/UI changes. Although 8.5 depends on those sections, `spo-8.5/spec.md:83–97` only builds a report and does not require a fresh inventory lint plus full Playwright run on the post-8.4 SHA. Its plan says e2e is merely “as applicable.”
- The constitution has no owner DEFER rows (`initiative/00_CONSTITUTION.md:18–24`), so no pack may infer one to satisfy `PASS or ... DEFER` wording.

**Failure scenario:** 8.2 passes an old subset; 8.3 or 8.4 regresses UI; 8.5 renders the stale result; N/O or negative journeys remain unrun; the programme still claims S-E2E-INV/S-E2E-RUN.

**Required correction:** Generate the exact required-ID manifest from the frozen inventory. Make the terminal post-8.4 keystone rerun inventory lint, mandatory discovery crawl, and the complete real Playwright suite on one recorded SHA; forbid skipped/focused tests; require every positive and required negative, zero unexpected network/console errors, and per-ID evidence. Generate the report only from that run. Only a recorded owner amendment may create DEFER.

### MF-6 — Rebuild deploy and onboarding as fail-closed live/clean-room proofs with explicit authority

**Evidence:**

- `spo-8.6/spec.md:59–99` defines only “deploy script exit 0 when creds present,” one missing-credential failure, and a parser test. It does not define names-only prerequisites, preflight, exact deployment/smoke result contract, failure classes, previous-version capture, D1-safe rollback, evidence schema/redaction, or an explicit owner-go checkpoint. `spo-8.6/plan.md:37–65` never performs or proves the live deploy and uses generic git-revert verification.
- Section 8.6 is absent from `SETUP.md`'s order, and neither 9.1 nor 9.6 depends on 8.6. `initiative/contracts/TRACEABILITY.md` nevertheless claims 9.6 proves S-CF.
- `spo-9.2/spec.md:34–101` lists onboarding nouns but no exact supported runtime, resource creation/configuration commands, first-admin bootstrap, local-versus-Cloudflare route, verification/cleanup checkpoints, failure recovery, or executable doc assertions. Its failure-mode block is empty and it retains irrelevant HTTP/audit boilerplate.
- `ACTIVE-RUNS-09:66–67` allows a “documented simulation.” `spo-9.6/spec.md:34–100` accepts human/agent “logs,” `CF evidence or DEFER`, and only BC13–15. It does not require the build checklist's all-15-row end-check, including BC10 Cloudflare, nor define a fresh environment, independent clean reader, start/end time, exact checkpoints, deny-scope proof, redacted evidence, or cleanup/rollback.

**Failure scenario:** A parser test, prose simulation, pre-existing environment, or manually supplied health note can satisfy the packs while a new operator cannot provision/login, an agent cannot bootstrap/use the CLI, the app was never deployed from this SHA, or BC01–BC12 remain open.

**Required correction:** Keep deployment behind a separate explicit owner go; the authored pack grants no live authority. Contract names-only configuration, fail-closed preflight, deploy/live-smoke outcomes, redacted evidence, previous-version/data-safe rollback, and human approval. Add 8.6 as a hard dependency of the programme exit. Replace simulation with two bounded clean-room walkthroughs—human and agent/CLI—against a fresh documented environment by an independent reader/agent or an explicit owner waiver. Require every BC01–BC15 row to be `DONE_WITH_EVIDENCE` or a recorded owner amendment before any completion claim.

### MF-7 — Replace quota validation with semantic closure and review every repaired pack

**Evidence:** All ten sampled packs pass `validate-run-pack.sh` (18/18 each), and `scripts-semantic-lint.py` reports PASS. The semantic lint checks AC count, Standards presence, high-risk human-review metadata, and inventory references; it does not check DTO completeness, test assertions, AC→gate closure, exact file/symbol steps, I16 completeness, stale indexes/order, contract drift, live authority, or real terminal proof. The copy-stamped defects above therefore pass exactly as authored.

**Failure scenario:** A future deepen can again add boilerplate until counters turn green and declare all packs production-grade without closing any semantic defect.

**Required correction:** Extend deterministic programme checks for every machine-verifiable invariant and retain a per-pack defect/closure record. Then cold-read all repaired artifacts, independently adversarially review every pack (phase cohorts are acceptable), and add a separate security/operations review for auth, keys, uploads, migrations, external integrations, Cloudflare deploy, and onboarding proof. Revalidate and re-review until no blocker or major remains. A structural or quota PASS must never override an open semantic finding.

No constitution soul or REQUIRED inventory journey is removed or deferred by this advisory.

— **Codex**, Independent Section Runner Pack Auditor
