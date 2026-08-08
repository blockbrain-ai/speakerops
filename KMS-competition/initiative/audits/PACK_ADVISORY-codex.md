# SpeakerOps Section Runner pack advisory

**Audit date:** 2026-08-08  
**Scope:** Full programme, phases 0–9; 49 section packs / 209 files under `plans/runs/speakerops/`; constitution, current browser inventory, synthesis, livability/build-checklist evidence contracts, phase indexes, setup, and engineering standards.  
**Verdict:** **INADEQUATE**

The programme has the right product shape: it preserves the constitution's souls, uses the locked Cloudflare/D1/R2/React direction, keeps Airtable one-way, gives every feature phase an intended e2e keystone, and makes onboarding the final phase. The 49-node dependency graph is acyclic, and the read-only structural validator passes all 306 checks. It is nevertheless not execution-ready: most packs are generic templates rather than buildable contracts, several souls have no valid exit proof, and the final gates can pass without a deployed Cloudflare dogfood instance or the full current browser inventory.

This advisory removes no soul and authorizes no sync, build, execute, merge, or deploy.

## MUST_FIX

### 1. Lock and distribute the actual governing contract

**Evidence:** `initiative/00_CONSTITUTION.md` is still `DRAFT -> pending owner LOCK`. The current browser inventory was updated after the section packs and now contains **108** unique journey rows, while `ACTIVE-RUNS-08-FULL-BROWSER-E2E.md` still promises `~95` and the inventory itself says `~115+`. All 49 specs cite laptop-relative `KMS-competition/...` sources, but no synced Box D path or immutable snapshot is defined. No pack references `initiative/BUILD_CHECKLIST.md`.

**Failure:** a builder on Box D cannot resolve the source contract, or builds against the older 95-row inventory while later claiming the current inventory complete.

**Required correction:** obtain the owner LOCK, freeze/hash the constitution, inventory, livability matrix, and build checklist, and make that exact snapshot available at an explicit path in the synced `RUNS_DIR`. Revise 0.1 and 0.3 to fail closed on hash/version drift. Do not execute against a moving or inaccessible source set.

### 2. Replace programme-wide template prose with executable contracts

**Evidence:** every one of the 49 plans says `Paths under classification.json files as needed`; all 49 specs use a generic `tests/section/N_M.test.ts — unit/integration for section behavior`; and 44 implementation classifications grant the same near-repository-wide surface (`apps/web/**`, `apps/api/**`, `packages/**`, `tests/**`, `playwright/**`, `docs/**`, `reports/**`). Plans repeat generic instructions such as “wire domain commands + authz + audit” without naming the command, route, schema, symbol, or wiring call site. Copied failure modes such as schedule conflict and CFP rate limiting appear even in documentation packs.

**Failure:** a competent builder can satisfy the literal packs with mutually incompatible schemas, invented APIs, shallow tests, and disconnected UI/CLI/integration parts.

**Required correction:** re-author every section with exact files and symbols, request/response and command schemas, state transitions, relevant failure modes, wiring locations, migrations/rollback, named positive and adversarial tests, and one-to-one AC-to-test gates. Tighten every `classification.json.files` list to that section's real surface. Use an explicit Box D standards path such as `/data/ClawdSpeakerOpsRuns/speakerops-engineering-standards.md`, not an ambiguous relative filename.

### 3. Close the soul traceability matrix; S-CF currently has no delivery section

**Evidence:** there is no whole-programme `requirement -> section -> spec AC -> plan step -> test/gate -> rollout proof` matrix. Most product soul IDs never appear in a section spec. `02_LIVABILITY_MATRIX.md` also points to wrong owners: S-THEME names 2.3 although Design Kit is 2.4; S-AIRTABLE names 7.4 although the projector is 7.3; S-DOCS names 9.3–9.4 although HTML generation is 9.5. S-CF maps only to a scaffold and Phase 9 “deploy notes”; no run owns a real preview/private deployment, healthy dogfood URL, or deployed-environment smoke. The build checklist is not an exit input to 9.6.

**Failure:** all sections can complete while S-CF remains unbuilt and other souls are supported only by prose or misdirected evidence.

**Required correction:** add and validate the full forward/backward traceability matrix without deleting any soul. Give S-CF a dedicated authored deploy-and-live-proof section with names-only configuration, rollback, explicit operator approval boundaries, and a deterministic live-smoke contract. Make 9.6 consume all 15 build-checklist rows and refuse the `dogfood_ready` claim unless each is `DONE_WITH_EVIDENCE` or has an owner-approved amendment.

### 4. Make the browser inventory a real fail-closed gate

**Evidence:** the current inventory has 108 unique IDs and 108 unique `test_id` values, all `OPEN`; there is no `REQUIRED` column or status even though the gate refers to “REQUIRED” rows. Phase 1.5 proposes a hard inventory lint with only initial smoke tags, which conflicts with treating all non-DEFER rows as immediately required. Phase packs use coarse files such as `3_2.spec.ts` and wildcard claims like `D*`, not the declared `test_id` anchors. Phase 8 still targets the old A–M/~95 set and does not own new N/O journeys. `SETUP.md` says full CI “should” contain e2e/inventory lint. Finally, 8.2 runs the suite before 8.3 security changes and 8.4 UI/seed changes; 8.5 does not require a full rerun on the final SHA.

**Failure:** a tag-only or stale subset can pass; security/seed changes can regress UI after the “full” run; the report can claim complete coverage while N/O and newly added controls are untested.

**Required correction:** define machine-checkable lifecycle semantics. Before Phase 8, lint shipped/`IMPLEMENTED` controls; at the final gate, require every non-owner-`DEFER` row to be `PASS`. Assert exact ID/test-id uniqueness, a runnable test for every ID, required negative paths, no skipped/focused tests, and evidence for status changes. Assign all 108 current IDs to sections. Make the discovery crawl mandatory as already stated in the latest inventory. Make 8.5 rerun inventory lint plus the entire Playwright suite on the post-8.3/post-8.4 final SHA and generate the report only from that run. Configure this as an authoritative full-CI gate, not a suggestion.

### 5. Repair cross-phase bag-of-parts and newly orphaned UI

**Evidence:** 5.2 calls schedule a “soft dependency,” and 5.4 claims all J* PASS before Phase 6 builds scheduling. J06 needs a placed session; new J10 needs a reschedule with stable UID and incremented SEQUENCE. New N01–N04 admin speaker journeys and O01–O06 settings journeys have no explicit section ownership in the packs. In particular, admin speaker list/detail, rubric editing, task-template editing, and Airtable status are not concrete deliverables. Phase 8.4's role switcher is introduced after the full-suite section and is not a constitution soul or inventory-owned product feature.

**Failure:** Phase 5 cannot truthfully prove its ICS flows, and the final product can contain missing settings/speaker surfaces or an unsafe production auth-bypass control.

**Required correction:** publish an explicit inventory-ID ownership table and add the missing UI/API contracts. Move the scheduled/rescheduled ICS proof after Phase 6 or add a post-schedule cross-phase keystone with hard dependencies. Constrain the role switcher to a compile-time/test-only harness that is impossible in the dogfood deployment, or remove that non-soul product surface; then rerun the full inventory.

### 6. Specify the complete CLI and API-key contract

**Evidence:** 7.2 says only `speakerops CLI --json same domain commands`. Its dependencies omit several interfaces it must administer, including portal/tasks/uploads, comms, and readiness. It contains no command/scope matrix, signatures, JSON schemas, stable exit codes, preview/dry-run behavior, or OpenAPI parity proof. 7.1 does not contract the hash scheme, prefix/one-time reveal, expiry, revocation behavior, optional event binding, last-use/audit behavior, or exact scope-denial cases. 7.4's proof is generic.

**Failure:** the CLI can ship as a narrow or parallel admin path and still satisfy the pack, leaving S-CLI incomplete or bypassing the domain command/authz/audit boundary.

**Required correction:** enumerate events, CFP metadata, submissions/decisions, speakers/tasks, schedule placement, design publish, uploads, readiness/reporting, and comms draft/preview, with exact endpoint/domain-command reuse, required scopes, inputs, JSON outputs, exit codes, idempotency/preview rules, and `key_id` audit assertions. Prove readiness JSON and design publish with an allowed key, schedule placement denied without `schedule:write`, and OpenAPI/CLI/SPA parity from the same registry.

### 7. Specify Airtable as an operable projection, not a named component

**Evidence:** 7.3 says only “Outbox projector one-way Airtable”; it depends on the DB baseline and email outbox but not on the later domain mutation producers it projects. It defines no table/field mapping, internal-ID/upsert keys, event coverage, retry/backoff, poison/dead-letter behavior, replay/idempotency, lag state, redaction, or status API. 7.4 does not prove same-value projection, outage isolation, catch-up after resume, or no write-back. O06 is now required but unowned.

**Failure:** a best-effort dual-write, lossy mirror, or permanently stuck queue can satisfy the words while S-AIRTABLE fails.

**Required correction:** contract the projection schema and source events, internal IDs and idempotent upserts, queue/outbox state machine, lag/status endpoint and O06 UI, replay procedure, credentials by name only, and fail-open request-path behavior. The e2e must mutate through the real domain command, observe the same values in Airtable, pause Airtable while product writes still succeed, then resume and drain exactly once. Explicitly prove Airtable never becomes SoR and never writes back.

### 8. Rebuild Phase 9 around reproducible onboarding evidence

**Evidence:** the Phase 9 index has a promising outline, but 9.1–9.5 specs reduce it to one-line goals and generic tests. 9.2 does not contract runtimes/prerequisites, local versus Cloudflare paths, D1/R2/Queues/DO creation, migrations, seed, email/Turnstile configuration, first-admin bootstrap, private deploy verification, cleanup, or a time budget. 9.3 leaves scoped-key bootstrap circular and names no exact CLI journey. 9.4 does not assign `docs/FIELD_FLOW.md` and compresses seven distinct critical documents into one vague AC. 9.5 does not enumerate report inputs/outputs or offline links, deterministic generation, accessibility, render/visual QA, or stale-content checks. The phase index allows 9.6 to use a “documented simulation,” which cannot prove a new operator can stand up the claimed environment.

**Failure:** polished prose and HTML can pass while commands are wrong, first login is impossible, the agent cannot bootstrap safely, or no clean Cloudflare setup has ever worked.

**Required correction:** make 9.2–9.5 enumerate every required artifact and exact verification. Define the human/admin secret-injection and key-bootstrap boundary. In 9.6, run two clean-room walkthroughs—human onboarding and agent/CLI onboarding—against a fresh environment, not a simulation; record actor, start/end time, commands/checkpoints, redacted evidence paths, deployed URL health, first login, demo path, CLI readiness/design actions, deny-scope proof, full browser report, report-link check, and cleanup/rollback. Require a clean reader who did not author the docs, or an explicit owner waiver.

### 9. Repair I16 identity continuity

**Evidence:** only five specs contain I16 tables. Those tables use generic rows such as “Primary form/profile fields” and “Files (if any),” omit transforms and fallback-when-absent, and do not enumerate every field or every consumer. Event settings, form/domain schemas, evaluation, decisions, portal APIs, schedule/readiness, CLI, Airtable, and onboarding configuration have no closed field flow.

**Failure:** category, timezone, person/speaker identity, task template, design token, schedule placement, email recipient, file metadata, or internal ID can diverge between UI, D1, CLI, outbox, Airtable, and reports without any test failing.

**Required correction:** add phase-level per-field tables with `source of truth -> transforms -> every consumer -> fallback -> same-value proof`. Replace generic rows with concrete fields and values. The keystones must assert the identical sentinel value at every listed consumer and the declared fallback when absent.

### 10. Make the Section Runner handoff and risk metadata authoritative

**Evidence:** `SETUP.md` gives only builder and phase-auditor choices, not all planner/plan-auditor/builder/section-auditor/phase-auditor/integrator roles or an explicit independent-final-auditor lock. No `.env.speakerops` names-only authoring manifest, absolute `RUNS_DIR`, full-CI gate, or live-smoke phase policy is present. Full browser CI and live smoke are optional/“should.” Phase indexes 2–7 omit required baseline, invariants, gate strategy, rollback/human boundaries, model decision, and critical-path detail. Specs 8.2, 8.3, and 9.6 say `critical` while their classifications say `high`; 27 high/critical classifications set `requires_human_review:false`, including auth, API-key, security, and onboarding work.

**Failure:** the runner can stop after unit tests, use unintended model fallbacks, miss independent final review, or proceed through high-risk boundaries without the intended pause.

**Required correction:** author the exact names-only `.env.speakerops` handoff with absolute Box D paths, complete role/model pins, section audit policy, independent Codex final audit, non-convergence fail, and exact unit/full-CI/live-smoke commands and phases. Repair every phase index and classification mismatch; mark security/auth/deploy/onboarding high-risk sections for human review and retain separate explicit owner approval before any live action. Re-run structural validation and an independent security/operations review after repairs.

## SHOULD

1. **Rebalance section boundaries.** Sections such as 3.3, 6.2, 8.2, and 9.4 each cover too many risk seams for a single generic build/audit unit. Split where migrations, security, UI wiring, or external systems need independent rollback; avoid adding more headline-only sections.
2. **Add measurable performance gates.** The 150-person seed and L05 exist, but no p95/load budget protects the constitution's “fast and calm” promise. Set realistic list, interaction, and queue-drain thresholds.
3. **Complete open-source handoff.** The synthesis promises open source, but the programme does not own license, contribution, supported-runtime, release/version, or upgrade/migration guidance.
4. **Require visual QA for Lumen and reports.** Add fixed-viewport screenshots/render checks, contrast/accessibility checks, and human review for the public CFP, schedule, portal, comms preview, and generated HTML portal.

## NIT

1. Replace wildcard labels such as `A*`, `B*`, and `J*` with exact stable inventory IDs in indexes, specs, and evidence reports.
2. Remove repetitive `dogfood_ready` marketing tails from every `task.md`; tasks should describe the atomic deliverable without implying the programme claim is already proven.
3. Use exact current inventory totals rather than `~95` or `~115+`; the audited inventory contains 108 canonical journey rows.

## Final determination

The phase architecture is directionally sound, and no soul should be removed. The packs require semantic re-authoring and gate repair before they can be proposed for execution. **No execute is authorized by this advisory.**

— **Codex**, independent Section Runner pack auditor
