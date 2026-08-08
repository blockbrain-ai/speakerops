# Deepen-plan advisory — critique of PACK_DEPTH_GAP_ANALYSIS.md

**Auditor:** Claude (independent planning auditor, read-only)
**Date:** 2026-08-08
**Scope reviewed:** `initiative/PACK_DEPTH_GAP_ANALYSIS.md` (full), `initiative/00_CONSTITUTION.md`, `initiative/BROWSER_E2E_INVENTORY.md` (header + sections A–B), prior advisories `initiative/audits/PACK_ADVISORY-claude.md` and `PACK_ADVISORY-codex.md`.
**Access note:** `nood-factory/plans/runs/speakerops/` is not present in this workspace, so pack `spo-3.2` could not be spot-checked locally. The gap analysis's per-pack claims are consistent with both prior advisories' independent reads, so I treat them as established and confine this critique to the plan itself.
**Constraints honored:** no soul tests removed or diluted; this advisory does **not** authorize execute, sync, build, or deploy; it does not rewrite packs.

---

## Verdict: **REVISE_PLAN**

The diagnosis is accurate and honest — "structural readiness ≠ semantic readiness" and the bulk-generation root cause match what both prior audits found, the defect classes D1–D12 are real, and the Wave A "contracts first, then packs consume them" spine is exactly the right shape. The non-goals section is a genuinely good guard against the opposite failure (essay packs).

It is nevertheless not yet the plan to run, for one structural reason: **the plan's own exit gate (Wave E → "ADEQUATE, zero MUST_FIX on sample") is unreachable as scoped.** Codex's INADEQUATE rested on ten MUST_FIX items; Waves A–F address roughly half of them (template prose, I16, classification risk flags, phase indexes). The other half — source lock/snapshot, unowned inventory journeys and the missing S-CF deploy section, cross-phase sequencing defects, and the runner handoff manifest — are not pack-*depth* problems, so a plan scoped purely to "deepen every pack" cannot close them, and a re-audit that honors the prior advisories must re-raise them. The plan needs either those workstreams added or an explicit owner-visible statement that they are a parallel track with their own gate. Second-order: Wave F re-runs the same validator that already passed the bad packs, and the rubric is itself a countable checklist a generator can stamp — the plan must not be certifiable by the instrument its own §1 proved insufficient.

None of this requires rethinking the waves. It requires adding missing work and hardening two gates. The revision should be small.

---

## MUST_FIX (on the plan)

### MF-1 — Add a Wave A.0: lock and freeze the governing contract before deepening against it
Codex MF-1 stands unaddressed: the constitution is still `DRAFT → pending owner LOCK`, and the inventory has drifted (Phase 8 index says ~95, Codex counted 108 unique rows, inventory prose says ~115+). Wave B proposes rewriting 50 packs against a moving target — the exact drift mechanism that produced today's mismatch, replayed at 10× the authoring cost. Before any pack is touched: obtain the owner LOCK (or an explicit owner note that deepening proceeds against the draft at owner's risk), reconcile the inventory to one exact row count, and freeze/hash the constitution + inventory + livability matrix + build checklist as the snapshot every deepened pack cites. Otherwise every "explicit inventory ID" written in Wave B is a reference into quicksand.

### MF-2 — Wave A must produce an inventory-ID ownership table, and the plan must handle journeys no existing pack can own
Rubric item "Inventory IDs listed explicitly if UI" fixes D7 pack-by-pack, but nothing in the plan guarantees the **union** covers the inventory. Both prior advisories found orphans (M04/M05/M07 rubric-edit, task-templates, rooms/tracks; Codex adds N01–N04 admin-speaker and O01–O06 settings rows with no owning section). Deepening 50 existing packs cannot assign an owner to a journey none of them claims. Wave A must emit `INVENTORY_OWNERSHIP.md` (every inventory ID → exactly one section), and the plan must state what happens when the table has a hole: author a new section pack, extend an existing section's scope, or record an owner DEFER. The same applies to the largest known hole — **S-CF has no delivery section** (Claude MF-1, Codex MF-3). Authoring one new deploy-proof pack is planning work, squarely in scope for a planning deepen, and currently in no wave.

### MF-3 — Wave F must run a *new* instrument, not the one that already passed
"`validate-run-pack.sh` PASS; optional second structural pass" certifies nothing — §1 of the gap analysis itself records that this validator passed 312 checks on packs now judged not competition-grade. Wave F must extend the validator (or add a semantic lint) with machine checks derived from the rubric, at minimum: zero wildcard inventory references (`D*`/`I*` as literal strings), every cited inventory ID resolves to a row in the frozen inventory, every ID in the ownership table owned by exactly one section, I16 table present when the pack's classification flags field collection, AC count ≥ 6, per-pack `classification.json` files narrowed from the universal glob, and route/command names in specs resolving to entries in `COMMANDS.md`. Without this, "Wave F PASS" is the same green light that lied last time.

### MF-4 — The rubric needs pack-type profiles, or it re-creates defect D9 in reverse
The rubric mandates an Interfaces section, ≥ 4 failure modes, and named tests **unconditionally**. Applied to the Phase 9 docs packs, this forces exactly the boilerplate D9 condemns: a docs pack will grow a fake routes section and a meaningless `9_N.test.ts` to check the boxes. Define profiles — at minimum **API/domain**, **UI**, **proof/keystone**, and **docs** — with per-profile required items (docs: link-check command, report build success, evidence-path assertions, clean-room walkthrough contract for 9.6 per Claude MF-5 / Codex MF-8; keystones: evidence artifact paths and the exact soul language they prove). The conditional items already present ("if schema touch", "if UI") show the plan knows how to do this; finish the job.

### MF-5 — Declare the contracts' canonical path and authority rule
Wave A hedges: "in product repo path as planned; for now under initiative/contracts/". Two unresolved questions will corrupt Wave B if left open: (a) **where do packs point?** — packs execute on Box D, and Codex MF-1 already showed laptop-relative paths don't resolve there; pick the synced path now and have packs cite it, with `initiative/contracts/` as the authoring location that syncs verbatim; (b) **who wins on conflict?** — state explicitly that `COMMANDS.md`/`SCHEMA.md`/`SCOPES.md` are canonical and packs cite entries by stable ID, so 50 independent rewrites cannot re-diverge (the D2/D3 mechanism). Add a bidirectional check to MF-3's lint: every registry entry consumed by ≥ 1 pack, every pack route present in the registry.

### MF-6 — Wave E's gate must include a closure table for the prior advisories' MUST_FIX items
A random sample of 8 + keystones + Phase 9 can come back ADEQUATE while Codex MF-1 (lock), MF-3 (S-CF), MF-5 (sequencing), and MF-10 (handoff manifest) remain open — because none of those live inside a pack the sample would read. Wave E's definition of done must include a table: each prior MUST_FIX (Claude MF-1–5, Codex 1–10) → the wave/step that closed it → evidence path, with re-auditors confirming closure explicitly. Also stratify the sample (at least one pack per phase, all high-risk classifications) rather than uniform random — 8 uniform draws from 50 can miss entire phases.

### MF-7 — Reorder Wave C before (or interleaved with) Wave B
As sequenced, all 50 packs are deepened first (Wave B), then the Phase 2–7 indexes gain their missing invariants, critical paths, and rollback rules (Wave C). Any invariant added in Wave C that should constrain a pack arrives after that pack was rewritten — guaranteeing a reconciliation pass the plan doesn't budget. Per phase: upgrade the index, then deepen that phase's packs against it. This also naturally absorbs the cross-phase sequencing repairs Codex MF-5 raised (5.4 claiming J* PASS before Phase 6 exists; J06/J10 needing placed sessions; 8.5 requiring a full rerun on the final SHA), which currently appear in no wave — Wave C is their home.

---

## SHOULD

1. **Add a per-pack conformance record to Wave B.** "Rewrite all 50" has no intermediate acceptance step; Wave E then rediscovers rubric misses one audit round late. Have the author tick the (profile-appropriate) rubric per pack into a single conformance table as each pack is finished, so Wave E verifies evidence instead of re-deriving it, and so partial progress is visible if the deepen is interrupted.
2. **Disposition D11 (performance) explicitly.** The defect table lists it; no wave, rubric line, or success metric touches it, so the plan orphans its own defect class. Minimum viable: a rubric line "perf budget stated where the surface is latency-sensitive (schedule DnD, list views, queue drain)" plus routing the question of a perf *soul* to the owner as an amendment decision — both prior advisories flagged this independently.
3. **Fold Codex MF-10 (SETUP.md / `.env.speakerops` handoff, role and model pins, full-CI and live-smoke policy) into Wave D or a new wave.** Wave D covers classification risk flags but not the runner handoff — and the 8.2/8.3/9.6 `critical`-vs-`high` mismatches Codex found sit exactly at the Wave D boundary. Cheap to include, expensive to re-audit around.
4. **Add classification `files` narrowing to Wave D explicitly.** Both advisories flagged the universal maximal glob (docs packs licensed to touch `apps/api/**`). MF-3's lint checks it; Wave D should be the step that does it.
5. **Derive a CLI coverage inventory in Wave A** (from the 0.4 parity table), mirroring the browser-inventory pattern, so the deepened 7.1/7.2/7.4 packs have a predeclared command/scope matrix to bind to — otherwise the Wave B rewrite of 7.2 invents its own list ad hoc (Codex MF-6, Claude SHOULD-2).
6. **Have the owner pass the DEFER table once during Wave A.0.** The constitution's forbidden-exit clause plus an empty DEFER table is a standing trap; the synthesis's known deferrals (CSV import, hosted schedule page) and any inventory rows the owner won't fund should be recorded while attention is on the contract, not at exit-gate time.
7. **Fix the livability-matrix mislabels during Wave A** (S-THEME → 2.4, S-AIRTABLE → 7.3, S-DOCS → 9.5). Wave B packs will cite the matrix; deepening against wrong owners propagates the error 50 times.

## NIT

- Pack count: the gap analysis says 50; Codex counted 49 sections / 209 files. Reconcile to an exact number — the plan's "no exceptions" claim needs a checkable denominator.
- §6 metric "Thin packs (chars < 2500 or AC < 5) = 0" reuses the proxy that the original packs were generated to beat. Keep it as a floor, but the real success criteria are the MF-3 lint outcomes and MF-6 closure table; consider promoting those into §6 and demoting char count to a footnote.
- "Exemplar bar: collab `col-1.1`" — give Wave B authors the resolved path to the exemplar packs; an exemplar the author can't open is a vibe, not a bar.
- Wave A's "per-phase field-flow master tables" should name their output paths (e.g. `initiative/contracts/FIELD_FLOW-phase-N.md`) so MF-3's lint and the Phase 9 `docs/FIELD_FLOW.md` assignment (Claude SHOULD-4) can reference them.

## Missing deepen work (summary of items in no current wave)

1. Owner LOCK + frozen/hashed source snapshot + inventory row-count reconciliation (MF-1).
2. Inventory-ID ownership table and resolution of orphan journeys M04/M05/M07, N01–N04, O01–O06 (MF-2).
3. Authoring the S-CF deploy-proof section (or owner DEFER) — the largest single soul-traceability hole (MF-2).
4. Cross-phase sequencing repair: ICS proofs vs Phase 6 ordering, 8.5 full rerun on final SHA (MF-7).
5. Validator/lint extension so Wave F certifies semantic depth, not structure (MF-3).
6. Runner handoff manifest, role/model pins, CI/live-smoke policy (SHOULD-3).
7. CLI coverage inventory (SHOULD-5).
8. Performance disposition (SHOULD-2).
9. DEFER-table owner pass and livability mislabel fixes (SHOULD-6/7).

---

The waves and rubric are the right skeleton; every item above slots into them without changing their shape. Revise, then this auditor expects the resubmission to be approvable quickly.

No souls removed. No execute authorized.

— **Claude**, independent planning auditor
