# SpeakerOps pack deepen plan advisory — Codex

**Date:** 2026-08-08  
**Role:** Independent planning auditor  
**Scope:** `initiative/PACK_DEPTH_GAP_ANALYSIS.md` and its proposed Waves A–F/rubric only  
**Authority:** Authoring review only. This does not authorize sync, build, execute, finalize, merge, deploy, or live-environment changes.

## Verdict

**REVISE_PLAN**

The diagnosis is substantially correct. `spo-3.2-form-builder-ui/spec.md` confirms it: the goal is the wildcard `D*`; unrelated schedule-conflict and public-rate-limit boilerplate appears as failure behaviour; tests name files but no assertions; interfaces have no method/path/DTO contract; and the I16 rows aggregate unspecified “primary fields” and “files (if any).” A competent builder could satisfy that pack and still build the wrong form builder.

The proposed deepen is not yet safe to approve. It puts phase-index repair after pack rewriting, uses prose-volume thresholds as quality gates, changes all 50 packs but semantically reviews only a sample, and does not close the constitution-soul/inventory/requirement traceability graph. The 15 constitution souls and all 108 currently REQUIRED browser inventory rows remain mandatory; no soul, row, or negative path may be removed or silently deferred.

## MUST_FIX — on the plan

### MF-1 — Put standards/index work before section work

`PACK_DEPTH_GAP_ANALYSIS.md` currently schedules pack rewriting in Wave B and phase-index repair in Wave C. Reverse that dependency. Every phase index must establish the baseline, invariants, section boundaries, dependency DAG, inventory ownership, I12 keystone, rollout/rollback, and human gates before its section contracts are deepened. “Phase 0 → 9” and “API before UI” are not sufficient ordering rules; use the actual topological dependency graph, including domain/schema prerequisites.

### MF-2 — Add a closed whole-programme traceability and ownership ledger

The plan must create a machine-checkable ledger:

`requirement/invariant/soul → implementation section(s) → spec AC → plan step → named test/gate → terminal proof owner → evidence path`

For browser work, each stable inventory ID must have exactly one implementation owner and exactly one terminal proof owner; a phase keystone or Phase 8 may be the proof owner without re-owning implementation. Each soul may span several implementation sections but must have one named terminal proof. Wildcards such as `A*`, `D*`, and “full inventory” are forbidden in ownership cells. Newly discovered controls must be added without shrinking or reusing an existing inventory ID.

### MF-3 — Make Wave A a real contract gate, not a file-existence gate

The three `initiative/contracts/` files now exist, but the plan has no acceptance bar for them and ambiguously calls both `initiative/contracts/` and future product `docs/contracts/` canonical. Declare one authoring source of truth during deepen, identify later materialization as a section-owned future output, and add version/change-control rules so consumers cannot drift.

Wave A must close, at minimum:

- command/HTTP/CLI mapping: command owner, method/path, request and response DTOs, auth role/scope, state transition, error codes, idempotency/audit behaviour, and test owner;
- schema: exact table owner, column types/nullability/defaults, keys/indexes/uniques, event/tenant key, lifecycle, compatibility/migration order, and rollback;
- scopes: command-level allow/deny matrix, event-boundary behaviour, default-deny scopes, and audit actor identity.

Current examples show why this gate is needed: `COMMANDS.md` uses shorthand such as `fields[]` and supplies no routes; `SCHEMA.md` has shared/ambiguous ownership (`3.5 / 4.1`, `1.3 / cross-cutting`) and inconsistent auth/program session naming; `SCOPES.md` is a summary rather than an enforceable command matrix.

### MF-4 — Replace numeric prose quotas with executable contract closure

Character count, sentence count, bullet count, four failure modes, and six ACs are anti-template proxies. They can be met by more boilerplate—the root cause the analysis identifies. Remove them as pass/fail criteria. A pack passes only when every applicable behaviour, interface, state transition, failure path, invariant, field flow, AC, test, and rollout/rollback proof is concrete and traceable. A small governance pack may need fewer items; a soul-critical form-builder pack will need many more.

The current success metric `AC < 5 = 0` also contradicts the rubric’s `AC ≥ 6`. Replace both with `100% of ACs are observable and mapped 1:1 to named proof`.

### MF-5 — Reassess section atomicity; do not freeze “50” as an architecture constraint

All current packs must be assessed, but the deepen may discover that a section cannot be built and audited atomically. `spo-3.2`, for example, nominally owns create, reorder, conditionals, routing, required fields, copy, preview, versioned publish, limits, and link handling. The plan must permit a justified split or boundary correction, with phase-index/DAG/classification/traceability updates, while preserving every soul and inventory row. “Rewrite all 50” must not mean “retain all 50 boundaries regardless of evidence.”

### MF-6 — Update each pack as one consistent unit

Do not postpone classification repair until after specs/plans. For each section, deepen `task.md`, `spec.md`, `plan.md`, and `classification.json` together, then validate their agreement on dependencies, files, risk, wave, scope, and human review. Future paths must be labelled as outputs owned by a prior/current section; only paths/symbols that actually exist may be described as current anchors.

Risk and authority must be explicit. `requires_human_review` is metadata unless classification enforcement is enabled, and it is not the auto-merge switch. The plan must define the risk policy, set human review for auth, keys, secrets/files, migrations, public/deploy, destructive, and other high-risk boundaries, record whether classification enforcement is a prerequisite, and separately preserve manual finalize/merge/deploy approval. This is a planning requirement, not authorization to change any environment.

### MF-7 — Review every changed pack, not a random sample

Changing all packs and independently reviewing eight cannot support a whole-pack adequacy claim. Require:

1. a clean-read self-review of every changed artifact;
2. an independent, context-isolated adversarial review covering every pack, which may be organized into phase cohorts;
3. explicit finding records with severity, artifact/location, violated invariant, concrete failure scenario, and required correction;
4. repair, deterministic re-validation, and re-review until no blocker or major remains.

Sampling may be an additional calibration check only. All keystones and all high-risk packs need individual attention. Auth, keys, security, migration, public/deploy, credentials/files, and live-external-system work also needs a separate security/operations critic or an explicit recorded human waiver. `ADEQUATE_WITH_NOTES` is not a closure rule unless every note is severity-classified and no blocker/major is open.

### MF-8 — Move validation into every wave and make the final pass mandatory

Do not wait until Wave F. Validate after each pack, after each phase cohort, after every accepted review repair, and once from a clean final read. Pin the validator/version used and retain its report. Add whole-programme checks the structural pack validator cannot infer: soul closure, exact inventory-ID ownership, command/schema single ownership, AC→proof closure, I16 completeness, classification/file alignment, keystone real-path coverage, and unresolved-review count. The final structural pass is mandatory, not optional; a green structural validator never overrides an open semantic finding.

## Required deepen of Waves A–F

### Wave A — Baseline, authority, and contract spine

- Freeze an exact source manifest and defect ledger for every current pack; replace `~`, `≈`, and unrecorded “312 checks” with reproducible evidence.
- Record the 15 souls, 108 current REQUIRED inventory IDs, current pack set, all cross-cutting invariants, and every requirement in the traceability ledger.
- Reconcile and complete `COMMANDS.md`, `SCHEMA.md`, and `SCOPES.md` to the contract bar in MF-3; identify one authoritative planning location.
- Add exact per-phase field-flow masters with a defined rule for projecting relevant rows into each pack without duplication/drift.
- Record the five model roles, verified model availability, provider independence/fallback, deterministic gates, and human-approval boundaries before authoring begins.
- **Exit:** no ambiguous contract owner; no orphan soul/inventory requirement; baseline and rubric are frozen and reviewable.

### Wave B — Phase indexes, boundaries, and DAG

- Review all Phase 0–9 indexes; materially deepen 2–7 rather than assuming 0/1/8/9 remain sufficient.
- For every phase: verified baseline, outcome/non-goals, ordered sections with boundary rationale, exact dependencies, cross-cutting invariants, field-flow ownership, inventory ownership, critical-path DAG, I12 keystone, rollback/containment, live/full-CI gates, and human approvals.
- Audit section atomicity and adjust boundaries only when needed; update all downstream references without losing scope.
- **Exit:** acyclic topological programme; every section has a reason; every multi-component phase has a real integration proof owner.

### Wave C — Per-pack semantic deepen

- Process packs in topological phase cohorts, not a blanket API/UI sequence.
- Update all four artifacts together. Ground current anchors in real paths/symbols; identify prior-section outputs as future dependencies.
- Make specs observable and plans file/symbol/control-flow specific; name exact tests and assertions, negatives/adversarial cases, gates, rollback, and stop conditions.
- Apply the conditional rubric below; do not paste irrelevant API boilerplate into governance/docs packs.
- Validate and cold-read each pack before moving to a dependent pack.
- **Exit:** every pack meets every applicable rubric row and has no internal spec/plan/classification contradiction.

### Wave D — Cross-pack closure and hygiene

- Recompute dependency, wave, risk, review, and file-scope metadata across the final section set.
- Close the global traceability ledger; detect duplicate/unowned commands, routes, migrations, schema fields, inventory IDs, tests, and evidence paths.
- Prove every I16 master row is represented in its owning/consuming packs with fallback and same-value tests.
- Add measurable performance budgets to performance-sensitive surfaces and preserve accessibility, empty/loading/error, correlation/redaction, compatibility, and rollback requirements.
- Check each phase keystone drives the real frontend↔backend/domain/store path and rejects mock-only proof.
- **Exit:** zero cross-pack conflict, orphan, wildcard owner, or unproved applicable invariant.

### Wave E — Independent adversarial closure

- Pass A: 100% clean-read self-review.
- Pass B: independent review covers 100% of changed packs, with different-provider/context independence and the neutral finding format.
- Add the specialized security/operations review or recorded human waiver for high-risk surfaces.
- Repair accepted blocker/major findings in the artifacts, revalidate, and re-review to explicit closure.
- **Exit:** zero open blocker/major; every disputed finding has source evidence; minors have recorded rationale.

### Wave F — Final deterministic proof and authoring handoff

- Run the pinned pack validator across every pack and manifest, plus the global traceability/inventory/I16/classification checks, from the final materialized files.
- Produce a final report with per-pack rubric status, review verdict, validator evidence, and remaining justified minors.
- Recheck that all 15 souls and all REQUIRED inventory rows remain present and mapped; no owner DEFER is inferred.
- Handoff may list future execution prerequisites and explicit human gates, but must state that no sync, run, finalize, merge, deploy, or live change has been authorized.
- **Exit:** deepen is authoring-complete and ready for a separate owner decision; it is not execution authorization.

## Revised pack quality rubric

Numerical minimums are removed. Every applicable row is fail-closed.

### Universal — every pack

- [ ] `task.md` is one bounded deliverable and beneficiary in a plain paragraph; no slug/wildcard proxy.
- [ ] Source documents and current-state anchors use exact inspectable paths/symbols; planned paths name their owning section.
- [ ] Goal, in-scope, out-of-scope, hard dependencies, and non-goals agree across all four artifacts.
- [ ] Observable inputs, outputs, state transitions, failure behaviour, and invariants are complete for the section’s actual surface.
- [ ] Every AC is objectively pass/fail and maps to a named test or deterministic gate; no “goal met” or “standards apply” tautology.
- [ ] Every named test gives its exact file, scenario/input, assertions, and negative/adversarial behaviour; proof is not mock-only.
- [ ] Stop/reassess conditions protect every relevant constitution soul and fail closed on missing proof.
- [ ] Compatibility, containment/rollback, observability/correlation, and privacy/redaction are explicit where applicable.
- [ ] `plan.md` carries the exact Standards line, real Files-to-Create/Modify with symbols/responsibilities, wiring/control flow, scope guard, ordered steps, Tests step, Verification step, and one Section Gate per AC.
- [ ] `classification.json` matches dependencies, wave, risk, human-review need, and exact change surface; broad globs require a justified bounded reason.

### Conditional — when the surface applies

- [ ] **Interface:** exact command plus HTTP method/path and/or CLI signature; request/response/event DTOs; auth role/scope; errors; idempotency; audit actor; owner and consumer.
- [ ] **Schema/migration:** exact tables/columns/types/nullability/defaults/keys/indexes, event/tenant key, migration owner/order, compatibility, backfill/idempotency, and rollback.
- [ ] **UI:** explicit inventory IDs and controls; real backend wiring; Lumen/a11y; keyboard/focus/labels; loading/empty/error states; expected network calls; zero uncaught-console-error assertion; named browser proof owner.
- [ ] **I16:** one row per collected or derived field with source of truth, transforms, every downstream consumer, fallback when absent, and same-value proof to every consumer. Aggregates such as “primary fields” and “if any” fail.
- [ ] **Security/high risk:** event/tenant isolation, role/scope denies, secrets channel, uploads/XSS/CSP, replay/idempotency, destructive-operation rules, audit, and explicit human gate.
- [ ] **Performance-sensitive:** stated workload and measurable budget for latency/query/page/batch behaviour, with a named deterministic or browser test.
- [ ] **Integration/keystone:** one real user journey wires actual components and persistence; validates required negative paths, console/network health, identity continuity, and evidence artifact location.
- [ ] **Governance/docs/onboarding:** artifact-specific, human-verifiable acceptance and link/procedure consistency; no invented API/schema/failure boilerplate. Setup proof starts from a clean documented state and records its time/result without exposing secrets.
- [ ] **Deploy/live external:** prerequisites, names-only configuration, preflight, failure classification, rollback, evidence, and a separate explicit human go. The pack itself grants no authority.

### Rubric hard failures

- wildcard inventory ownership; placeholder or invented anchors; generic test filenames without assertions; grouped I16 fields; orphan UI action or endpoint; orphan AC/test/section; mock-only keystone; future path claimed as current; contradictory dependency/file/risk metadata; secret values; or any implied execute/merge/deploy authority.

## SHOULD

- Pilot the rubric on one representative vertical slice—`spo-3.1`, `spo-3.2`, and `spo-3.6`—then calibrate the rubric before applying it programme-wide. This is a quality calibration, not a scope reduction.
- Prioritize soul-critical and high-risk packs within the topological order, but do not let priority bypass dependencies.
- Keep a per-pack defect ledger (`open → repaired → validated → independently closed`) so “50 done” is evidence, not a narrative claim.
- Record why each accepted contract change does not dilute a soul and which downstream packs were rechecked.

## NIT

- Replace “human-review false … auto-merge culture” with precise classification/finalize semantics.
- Replace approximate counts (`~6`, `≈22`) and “random sample” with a reproducible manifest and selection seed if sampling remains for calibration.
- Replace “optional second structural pass” with “mandatory final clean pass.”
- State the exact validator path/version and invocation rather than the unqualified `validate-run-pack.sh` name.
- Use one verdict vocabulary for closure; do not mix `ADEQUATE`, `INADEQUATE`, and unclassified “notes.”

## Missing deepen work

- A source-to-pack-to-proof traceability artifact for every constitution soul and inventory negative path.
- Contract authority/versioning and drift detection between initiative planning contracts and eventual product docs/OpenAPI/CLI help.
- Current-anchor versus future-output provenance for a greenfield cumulative build.
- Section-boundary/atomicity review and a controlled resectioning procedure.
- Model-role independence and deterministic gate decisions in the phase indexes/handoff.
- Performance budgets, accessibility states, real network/console assertions, and migration/backfill compatibility.
- A specialized security/operations review gate for credentials, auth, keys, uploads, migrations, Cloudflare dogfood deploy, and other live/external seams.

No constitution soul has been removed or deferred by this advisory.

— **Codex**, Independent Planning Auditor
