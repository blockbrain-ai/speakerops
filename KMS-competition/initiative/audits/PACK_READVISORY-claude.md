# Pack re-advisory after full deepen pass — independent audit (Claude)

**Auditor:** Claude (independent planning auditor, read-only)
**Date:** 2026-08-08
**Scope reviewed:** `initiative/PACK_DEPTH_GAP_ANALYSIS.md` (full); all six contracts under `initiative/contracts/` (SCHEMA, COMMANDS, SCOPES, INVENTORY_OWNERSHIP, CLI_INVENTORY, TRACEABILITY); full four-file packs for spo-3.2, spo-6.2, spo-7.2, spo-7.3, spo-8.2, spo-8.6, spo-9.2, spo-9.6; skim of spo-1.1 and spo-5.2; `BROWSER_E2E_INVENTORY.md` per-ID rows for D and I; grep sweeps across all 50 packs (contract references, I16 tables, spec char counts, plan-step uniformity).
**Constraints honored:** no soul weakened; this advisory does **not** authorize execute, sync, build, or deploy.

---

## 1. Verdict

**ADEQUATE_WITH_NOTES**

The deepen pass fixed the things that made the previous pack set dangerous: there is now a real contract spine, and packs bind to it. `COMMANDS.md` is a genuine route map (44 HTTP routes, command/scope/DTO columns), `SCHEMA.md` names tables and columns with per-section ownership, `SCOPES.md` sets default-deny on the dangerous scopes, and `INVENTORY_OWNERSHIP.md` has zero wildcards — every browser ID has exactly one implementation owner and one proof owner. Combined with `BROWSER_E2E_INVENTORY.md`, whose per-ID rows are behaviorally specific (e.g. D08 "Publish version; pin version on new submission / Edit published creates new version"; I15 "Stale version conflict shows recovery UI / No silent overwrite"), a builder reading pack + inventory + contracts can implement most sections without inventing endpoints, columns, or flows. That is the bar the gap analysis set for itself, and the architecture now reaches it: **the packs are thin pointers, and the contracts carry the depth — which is a legitimate design, and the "Builder must not invent" block (contract change must ship in the same PR) makes it enforceable.**

However, the Wave E target in the gap analysis — "ADEQUATE with **zero** MUST_FIX on sample" — is **not met**. Five defects survive systematically across the sample, three of them defect classes the gap analysis itself enumerated (D5, D6, D8) and then did not close. They are bounded and mechanically fixable in one focused pass; they do not require re-architecting anything. Until they are closed, the pack layer itself (as opposed to the contract layer) is still template-stamped in the places where an auditor most needs specificity: test assertions, failure modes, and plans.

---

## 2. What the deepen genuinely fixed (credit where due)

| Prior defect | Status | Evidence |
|---|---|---|
| D2 no route/command map | **Fixed** | COMMANDS.md canonical route table; specs reference it in Source Documents |
| D3 no schema columns | **Fixed** | SCHEMA.md columns + first-writer ownership per table |
| D7 inventory wildcards | **Fixed** | Explicit ID lists in every sampled UI pack (`spo-3.2/spec.md:50`, `spo-6.2/spec.md:47`); ownership table forbids wildcards |
| D10 human-review false on high-risk | **Fixed** | All sampled high-risk packs have `requires_human_review: true` (auth-adjacent, deploy, keys, onboarding proof) |
| Thin packs by char count | **Fixed** | Minimum spec is now 4,206 chars (was <2,500 for 19 packs); floor pack is 8.2, ceiling ~5.2k |
| CF deploy unowned | **Fixed** | spo-8.6 exists, owns S-CF, has evidence-path AC and names-only secrets rule |
| Souls in stop gates | **Fixed** | Every sampled pack names its souls in both Source Documents and Stop/Reassess Gates |
| Security/rollback/perf/observability absent | **Improved** | Blocks now present in every pack (though partly boilerplate — see notes) |

---

## 3. Remaining MUST_FIX

### MUST_FIX 1 — Tests are still named without assertions (defect D5, unresolved)

The gap analysis's own impact line for D5 was "Green CI, broken product." It stands. Sampled Tests sections are bare file names:

- `spo-3.2/spec.md:105` — `playwright/e2e/form_builder.spec.ts` (nothing else, for a 10-inventory-ID high-risk UI section)
- `spo-6.2/spec.md:101` — `playwright/e2e/schedule_studio.spec.ts` (16 IDs, the hero surface)
- `spo-5.2` — `send_idempotent.test.ts`, `ics_uid.test.ts`: names gesture at intent but assert nothing (same-job-returned? UID stable across resend? SEQUENCE bumps on reschedule?)
- `spo-7.3` — `airtable_pause.test.ts` with no statement of what "pause survival" must observe (outbox drains after resume? no request-path write? projection_records upsert by internal id?)
- `spo-8.6`, `spo-9.2`, `spo-9.6` — one trivially-passable test each (`deploy_script_parses`, `onboarding_has_steps`, `onboarding_proof_bundle`)

Compounding this, every pack's first stop gate is "Do not APPROVE if any AC lacks a named test" — but no pack maps ACs to tests, so the gate is unenforceable as written. Rubric item 7 ("ACs ≥6, each mapped to a test") fails on every sampled pack.

**Fix:** one line per named test stating what it asserts (the exemplar exists in-repo: `CLI_INVENTORY.md` has an Assert column; `spo-1.1/spec.md:105` does it in-line), plus an AC→test mapping — a parenthetical test name per AC is enough. Priority order: keystones (3.6, 4.4, 5.4, 6.4, 7.4, 8.2, 9.6), then high-risk implementation packs.

### MUST_FIX 2 — I16 field-flow tables are one-row stubs (defect D6, half-resolved)

16 of 50 packs now have an I16 table — but the sampled ones are vacuous. The rubric says "I16 for every field collected or transformed":

- `spo-3.2/spec.md:106-110` — one row (`label`) for a form builder whose in-scope list itself names ~10 field properties (type, required, options, conditions, routing rules, welcome/thank-you copy, limits)
- `spo-5.2` — one row (`recipient email`) for a section that materializes recipients, bodies, ICS UID/SEQUENCE, delivery events
- `spo-7.3` — one row (`internal_id`) for the projection that exists precisely to prevent field drift into Airtable
- `spo-6.2` — no table at all, though it transforms placement fields (session, room, starts/ends, version) across five views plus reload

A one-row I16 is worse than none: it lets the "100% field-collecting packs have I16" metric read green while the drift-prevention mechanism the deepen prioritized does no work.

**Fix:** complete the tables for the field-heavy packs (3.2, 3.3, 4.1, 4.3, 5.1, 5.2, 7.3 at minimum). Row-per-field, or an explicit coverage statement (e.g. "all form_fields properties flow via Form.UpdateDraftFields → form_versions.snapshot_json → public render; proof D07+A01") where enumerating is genuinely redundant with SCHEMA.md.

### MUST_FIX 3 — Failure modes are below the rubric floor in every sampled pack

Rubric: ≥4 specific failure modes. Sampled counts: 8.2 **zero**, 9.2 **zero**, 9.6 **zero**, 3.2 one, 6.2 one, 8.6 one, 7.2 two, 7.3 two, 1.1 two, 5.2 three. The zero-count packs are the two programme keystones and the human-onboarding soul carrier — exactly where failure handling matters most (8.2: flaky-test policy, seed drift, ID-with-no-test-found, console-error triage; 9.6: dry-run fails partway, linkcheck regressions, CF evidence unavailable → DEFER path mechanics; 8.6: health non-200 post-deploy, partial deploy of api-but-not-web).

**Fix:** raise every high-risk pack and both keystones to ≥4 surface-specific failure modes. The existing ones (e.g. 7.3's "Missing creds: mutations still 200, outbox pending") show the authors know how to write them — this is a coverage pass, not a capability gap.

### MUST_FIX 4 — plan.md is still a template stamp (defect D8, unresolved; D9 leaks into plans)

The Implementation Steps block is byte-identical across every sampled plan except the dependency list and commit slug — verified by diff. Consequences:

- The docs pack `spo-9.2` gets "Migrations if Data section non-empty", "Lumen components; inventory @inv tags", and "Playwright for inventory IDs" as its steps — defect D9 (nonsense gates on Phase 9) reproduced at the plan layer.
- Files to Create still uses wildcards where the rubric demands "real paths + responsibility": `apps/web/src/components/forms/*` (3.2), `apps/web/src/pages/schedule/*` (6.2), `packages/cli/src/**` (7.2).
- Files to Modify is the same four boilerplate lines in all sampled plans.
- Nothing in `spo-6.2/plan.md` acknowledges the actual planning decisions of the hero surface: five views' shared state, undo mechanism (client stack vs. inverse Schedule.Move), DnD approach, conflict-toast recovery flow.

**Fix:** for high-risk/L-effort packs, replace wildcard globs with named files plus a one-line responsibility each, and add 3–6 section-specific steps between the template's Step 2 and Step 4. Template steps are acceptable for low-risk packs; they are not acceptable for 3.2, 6.2, 7.2, 7.3, 5.2, 8.2, 8.6, 9.6.

### MUST_FIX 5 — Three of the six Wave-A contracts are wired to nothing

Grep across all 50 packs: **zero** references to `CLI_INVENTORY.md`, `INVENTORY_OWNERSHIP.md`, or `TRACEABILITY.md`. The standard Source Documents block cites only SCHEMA/COMMANDS/SCOPES + BROWSER_E2E_INVENTORY. Concretely:

- `spo-7.2` (CLI) does not cite `CLI_INVENTORY.md` — the only document containing its scope-deny and exit-code assertions (CLI01–CLI12, each with an Assert column). Its own Tests section is three bare file names; the assert-rich contract that would fix MUST_FIX 1 for this pack already exists and is simply not referenced.
- `spo-8.2` and the phase keystones do not cite `INVENTORY_OWNERSHIP.md`, the document defining which proofs they own (including the J06/J10 sequencing note that only that file records).
- `TRACEABILITY.md` says evidence paths are filled at execute, but no pack names it, so no builder or auditor is instructed to fill it.

**Fix:** add the relevant contract(s) to Source Documents in 7.2, 7.4, 8.1, 8.2, 8.5, and all phase keystones; make 7.2's Tests section point at CLI01–CLI12 as its assertion list.

---

## 4. Notes (non-blocking, fold at will)

- Goals in spec.md remain one-line slugs ("Schedule Studio hero UX I01–I16."); task.md appends only a generic sentence. Rubric item 1 technically fails, but with the inventory rows carrying behavior this is now cosmetic rather than dangerous.
- Boilerplate mis-tailoring: CLI/ops/docs packs carry admin-list p95 and public-CFP performance text verbatim; docs packs carry Zod/audit-event ACs. Harmless but signals the stamp; trim during the MUST_FIX 4 pass.
- Out-of-scope has <3 named exclusions in 8.2 and 9.2 (rubric item 3).
- `spo-8.2`'s inventory line "Owns inventory IDs: all REQUIRED PASS" is a sentence where the parser expects IDs; acceptable only because INVENTORY_OWNERSHIP.md enumerates the proof ownership — one more reason to wire that file in (MUST_FIX 5).
- The 4.2–4.5k char floor is met everywhere, but roughly two-thirds of each spec is shared template. Do not let the char metric stand in for depth again; the rubric checklist, applied per-pack, is the only meaningful gate.

---

## 5. Bottom line

The contract spine is competition-grade; the pack layer is one focused pass away. The five MUST_FIXes are mechanical, mostly concentrated in ~10 high-risk packs plus a Source Documents edit, and none touches architecture, souls, or scope. Close them, then a final sample re-check (the same 8 + keystones) should land ADEQUATE clean.

Do **not** proceed to execute on this advisory.

— Claude
