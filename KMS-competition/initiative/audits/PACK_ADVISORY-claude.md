# Section Runner Pack Advisory — SpeakerOps full programme (phases 0–9)

**Auditor:** Claude (independent pack auditor, read-only)
**Date:** 2026-08-08
**Scope reviewed:** `initiative/00_CONSTITUTION.md`, `initiative/BROWSER_E2E_INVENTORY.md`, `initiative/02_LIVABILITY_MATRIX.md`, `initiative/BUILD_CHECKLIST.md`, `research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md`, all ten `ACTIVE-RUNS-0*.md` phase indexes, `speakerops-engineering-standards.md` (E1–E12), `SETUP.md`, `SECTION_ORDER.proposed.txt`, and pack contents (task/spec/plan/classification) for all six `spo-9.*` packs plus spot-reads of `spo-0.4`, `spo-0.5`, `spo-3.2`, `spo-6.2`, `spo-7.2`, `spo-7.3`, `spo-8.1`, `spo-8.2`, `spo-8.5`.
**Constraints honored:** no soul tests removed or diluted; this advisory does **not** authorize execute.

---

## Verdict: **ADEQUATE_WITH_NOTES**

The programme's governance skeleton is genuinely strong — arguably the strongest artifact set here. The constitution's 15 soul tests, the predeclared ~95-row browser inventory with anti-shrinkage law, the livability matrix mapping every soul to sections, the BUILD_CHECKLIST end-check, E1–E12 standards, and phase indexes with per-phase integration keystones (X.last e2e proof) together form a coherent gate lattice from intent to exit. Phase 0 pre-declaring the Phase 9 doc tree (0.5) is exactly the right move to prevent a rushed final phase.

The weakness is one level down: the **pack layer is a template stamped 49 times**. Nearly all section-specific contract content lives in the phase indexes and the inventory, not in the packs a builder actually executes against. That is survivable because the inventory + livability matrix act as the safety net, but several soul-critical sections currently have one-sentence contracts, and two genuine ownership holes exist (Cloudflare deploy proof; REQUIRED-set definition). Fix the MUST_FIX items below at authoring level and the programme is execution-ready.

---

## MUST_FIX

### MF-1 — S-CF / Cloudflare deploy has no owning section
The claimed completion state is `dogfood_ready` = "Cloudflare private deploy + full browser E2E green + onboarding docs." E2E and docs have owning keystones (8.2/8.5, 9.6). The **deploy itself does not**:
- Livability maps S-CF to "1.x scaffold + deploy notes 9.x" — Phase 1 only scaffolds wrangler config ("names only"); Phase 9.2 only *documents* deploy steps.
- BUILD_CHECKLIST BC10 ("CF dogfood URL healthy — smoke URL note") has no section whose AC produces that evidence.
- `SETUP.md` says "Live smoke optional when CF credentials provided" — *optional* directly contradicts a claim whose first clause is a live deploy.
- 9.6's dry-run allows "clean env **(or documented simulation)**", so even the final keystone can close without anything ever having run on Cloudflare.

**Fix:** assign the deploy + CF smoke proof to a concrete section (extend 9.6's ACs, or add a small 9.x "dogfood deploy proof" section gated on owner-provided credentials), or have the owner record an explicit DEFER row in the constitution. Do not leave BC10 orphaned.

### MF-2 — "REQUIRED" gate set is undefined in the inventory
The inventory gate reads "CI fails if a row is `REQUIRED` and not `PASS`", and packs 1.5/8.1 build lint against "REQUIRED ids" — but **no row carries a REQUIRED marker** and no legend defines the REQUIRED set. The constitution's browser law ("every row PASS or owner DEFER") implies REQUIRED = all rows, but the artifact the lint is built from is ambiguous. A literal-minded builder can implement an inventory lint whose REQUIRED set is empty and go green.

**Fix:** add one line to the inventory legend: "All rows are REQUIRED unless status is owner `DEFER`," and align the 1.5/8.1 spec language to it.

### MF-3 — Soul-critical sections have one-sentence contracts
Spec/plan bodies are ~95% shared boilerplate; the section-specific content is the Goal line plus a few conditional AC bullets. For most sections the phase index + inventory compensate, but for these the gap is dangerous:
- **spo-6.2 (schedule UI):** entire contract is "DnD five views I*." — the hardest UI in the programme (drag-drop, keyboard alternative I09, undo I10, conflict-explain I07/I08, tray, tz) reduced to a wildcard.
- **spo-7.2 (CLI):** "speakerops CLI --json same domain commands." No AC for scope-deny (the core of S-CLI), `--json`/exit codes/dry-run, key-attributed audit, or OpenAPI generation. `architecture/REPORT-cli-agentic-admin.md` is not in its source-docs list (every pack lists the same six generic docs).
- **spo-7.3 (Airtable):** no AC for "app survives Airtable paused; outbox lags; never request-path" — the exact S-AIRTABLE behaviors.

**Fix:** for at minimum 3.2, 5.2, 6.2, 7.1–7.3, and 8.2, enumerate the owning inventory ID ranges and paste the relevant constitution soul language into §7 ACs, and add the relevant architecture report to Source Documents. Builders execute packs, not phase indexes; the contract must live where the builder looks.

### MF-4 — Template contamination in Phase 9 docs packs
The 9.1–9.4 specs (docs-only, `ui=False`) carry failure modes for "Schedule conflict → 409", "Rate limit public CFP → 429", Zod-on-writes, D1 migration/rollback sections, and a placeholder test `tests/section/9_N.test.ts — unit/integration for section behavior`. This is noise that (a) misleads a builder into inventing API surface for a docs task, and (b) self-satisfies the "no AC without a named test" gate with a meaningless placeholder — what does a unit test of ONBOARDING.md assert? Also note the rendered-template bug in every plan: "Keystone multi-step path if keystone=False".

**Fix:** re-generate the docs packs with docs-appropriate gates — markdown link-check (the "no dead ends" AC needs a named check), `pnpm docs:reports` build success, checklist-evidence assertions for 9.6 — and strip the API/migration boilerplate. Fix the `keystone=False` conditional rendering.

### MF-5 — 9.6's "documented simulation" escape hatch is unbounded
S-ONB-HUMAN's whole point is that a **stranger** can go zero → running without tribal knowledge. "Clean env (or documented simulation)" lets the author who wrote the docs walk them on their own configured machine and call it proven. **Fix:** define the minimum acceptable evidence in 9.6's spec — fresh worktree/clean profile at minimum, fresh Cloudflare resources if credentials exist, and the recorded timed checklist per S-ONB-HUMAN's "under documented time" clause — or require explicit owner sign-off that simulation suffices.

---

## SHOULD

1. **Assign owners to settings-matrix orphans.** M04 (eval rubric edit, `e2e/admin/rubric-edit`) and M05 (task templates on accept, `e2e/admin/task-templates`) reference test ids no section's goal claims; M07 rooms/tracks is only a "seed API" in 2.3 with no edit UI owner. The livability note "M01–M10 covered by C/D/J/K/admin sections" is too vague to gate on. Left unassigned, these surface as defects at 8.1 with no budget.
2. **Give the CLI a coverage inventory.** The browser inventory rule 4 says "CLI has separate suite" but nothing predeclares that suite. S-CLI/BC08 gate on "cli test report" with no enumerated command list. The 0.4 FE/CLI parity table is the natural source — derive a CLI coverage checklist from it and make 7.4 gate on it, mirroring the browser-inventory pattern.
3. **Performance has no test anywhere.** The synthesis names speed a differentiator ("customer mocks Sessionboard slowness twice"; "p95 interactions feel native") yet no soul, standard, inventory row, or AC encodes any perf bar. This advisory cannot add souls — but recommend the owner consider an amendment, or at minimum an E-standard plus a Phase 8.3/8.5 perf smoke (e.g. no primary interaction > N ms in the demo path under seed data).
4. **`docs/FIELD_FLOW.md` is in the required Phase 9 tree but in no section's goal** — 9.4's document list omits it. Assign it (9.4 is the natural home) or it ships as a stub.
5. **Section audit is off with the thinnest specs in the estate.** Phase-level Codex audit reviews 4–6 sections at once against contracts that are mostly boilerplate. Consider enabling section audit for the keystones and high-risk sections (3.2, 6.2, 7.2, 8.2, 9.6), or record the owner's explicit acceptance of the risk.
6. **`classification.json` `files` globs are identical and maximal in every pack** (docs sections are licensed to touch `apps/api/**`). Narrow per section so the scope guard is real rather than decorative.
7. **Record synthesis SHOULD-tier deferrals as owner DEFER rows** (CSV/Sessionize import, hosted public schedule page). They are correctly absent from packs, but the constitution's forbidden-exit clause plus an empty DEFER table invites an exit-gate argument later. One owner pass over the DEFER table now is cheap.

---

## NIT

- Livability matrix mislabels: S-AIRTABLE cites section 7.4 (the projector is 7.3; 7.4 is the proof); S-DOCS cites "9.3–9.4 HTML reports" (reports are 9.5).
- Inventory B06: surface says "`/speakers` admin write" but journey says "cannot mutate schedule" — description/surface mismatch.
- Open-source is part of the pitch ("owned by the customer forever") but no section mentions a LICENSE file; cheap to add to 9.1.
- Inventory total says "~95"; the column sum is exactly 95 — drop the tilde so the lint has a checkable number.

---

## Focus-area summaries

**(1) Phase 9 onboarding completeness — good at index level, holes at proof level.** ACTIVE-RUNS-09 is the best-written phase index in the set: full doc tree, per-section content, timed checklist, agent prompt block, keystone dry-run. The holes are MF-1 (deploy never happens), MF-5 (simulation escape hatch), MF-4 (docs packs carry API boilerplate and placeholder tests), and FIELD_FLOW ownership.

**(2) Browser E2E inventory gating — structurally excellent, one definitional hole.** Predeclared 95 journeys with negatives, per-phase cluster proofs (2.5/3.6/4.4/5.4/6.4/7.4), a completeness audit (8.1) before the full run (8.2), anti-shrinkage law, and a discovery-crawl hardening option. MF-2 (REQUIRED undefined) is the one crack in an otherwise sound gate; M-row orphans (SHOULD-1) are the coverage risk.

**(3) Missing souls — none removed; one candidate absent.** The 15 souls cover all six judged workflows, agentic admin, Airtable, CF, E2E, and onboarding. The only defensible missing soul is performance (SHOULD-3), which the synthesis itself elevates to differentiator status. Owner's call via amendment; not a blocker.

**(4) Bag-of-parts — the programme's main structural risk.** The phases are not a bag of parts: every multi-component phase ends in an integration keystone, 1.6/8.2/9.6 stitch cross-phase, and the livability matrix binds souls to sections. The *packs*, however, are near-identical stampings where the connective tissue lives outside the artifact the builder executes (MF-3). The demo-path ("Monday path") from the synthesis is also never named as a single scripted journey until 8.4 — worth an explicit keystone AC that the full theme→CFP→score→accept→portal→dashboard→schedule→comms path runs as one Playwright scenario, not just as separate cluster suites.

**(5) CLI + Airtable — right architecture, thinnest contracts.** Phase 7 ordering (keys → CLI → projector → proof) is correct; E7/E8 encode one-way projection, hashed keys, default-deny high-risk scopes. But 7.2/7.3 are the least-specified soul-critical packs in the programme (MF-3) and the CLI has no coverage inventory analogue (SHOULD-2).

**(6) Over/under scope — well-judged.** No scope creep into struck items; non-goals consistently propagated into every pack's Out of Scope. 49 sections is heavy but matches the owner's FULL / production-hard order; nothing here is the over-engineering the synthesis warns against (no OR-Tools, Temporal, agent fleet, meta-config). Under-scope is limited to the items above: deploy proof, perf bar, M-row orphans, CLI coverage.

---

## Closing

Verdict **ADEQUATE_WITH_NOTES**: the gate lattice will catch most of what the thin packs let through, but only if MF-1 and MF-2 are fixed — those two are holes in the lattice itself, not the packs. All findings are authoring-level; none require touching souls or shrinking the inventory. Execute authorization remains with the owner; nothing in this advisory grants it.

*Signed — **Claude***
