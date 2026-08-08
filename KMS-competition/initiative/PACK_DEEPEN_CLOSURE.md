# Pack deepen closure — planning stage

**Date:** 2026-08-08  
**Status:** Deepen executed after gap analysis + plan advisories

---

## Why packs were not competition-grade (investigation)

1. **Bulk template generation** to satisfy structural validator (files, DAG, Standards line) without product contracts.  
2. **Goals as slugs** (`inventory D*`) not behaviors.  
3. **No command/schema registry** — builders would invent routes/columns.  
4. **No inventory ownership** — wildcards; orphans (speakers, settings).  
5. **Weak ACs/tests** — 3–4 generic checkboxes; fake test filenames.  
6. **Missing I16** on field-collecting UI.  
7. **Phase indexes mid-programme thin** relative to 0/8/9.  
8. **Validator false green** — structural PASS ≠ semantic readiness (Codex INADEQUATE).

---

## What we did (no execute)

| Step | Result |
|------|--------|
| Gap analysis | `PACK_DEPTH_GAP_ANALYSIS.md` |
| Plan auditors | Claude **REVISE_PLAN**, Codex **REVISE_PLAN** — folded |
| Wave A contracts | SCHEMA, COMMANDS (+HTTP map), SCOPES, INVENTORY_OWNERSHIP, CLI_INVENTORY, TRACEABILITY |
| Deepen all 50 packs | Specs ~150+ lines avg, ≥8 ACs, inventory lists, interfaces, failure modes, builder-must-not, plans expanded |
| CF ownership | Section **8.6** |
| REQUIRED inventory | Column on all journey rows; 108 IDs |
| Phase index rules | Phases 2–7 got core rules / gates / rollback |
| Semantic lint | `scripts-semantic-lint.py` (AC≥6, high-risk human review) |
| Structural validate | **PASS 312 checks** |

---

## Plan advisory MUST_FIX → disposition

| Item | Disposition |
|------|-------------|
| Freeze constitution/inventory before deepen | Inventory ownership frozen in contracts; constitution still owner LOCK pending — **documented** |
| Inventory ownership table | **Done** `INVENTORY_OWNERSHIP.md` |
| S-CF section | **Done** 8.6 |
| Semantic lint beyond structural | **Done** scripts-semantic-lint.py (extend further as needed) |
| Pack-type profiles | Applied: gov/impl/docs/keystone content differs; docs packs have doc tests not fake 409-only |
| Contracts canonical path | **Done** `initiative/contracts/` authority note in COMMANDS |
| Closure table prior audits | This file + TRACEABILITY |
| Index before packs order | Indexes enriched; packs already rewritten against contracts (reconciled) |
| Full re-review all packs | Re-advisory sample+keystones in PACK_READVISORY-*; residual notes folded if MUST_FIX |
| CLI inventory | **Done** CLI_INVENTORY.md |
| Livability mislabels | **Fixed** |

---

## Metrics after deepen

| Metric | Before | After |
|--------|--------|-------|
| Thin (chars&lt;2500 or AC&lt;5) | 19–45 | **0** (bar chars&lt;4000 or AC&lt;6) |
| Min AC count | 2–4 | **≥8** |
| Avg spec size | ~1–4KB | **~4.6KB+ / ~150 lines** |
| Contract files | 0 | **6** |
| Inventory ownership | none | **108 IDs mapped** |
| Validator | PASS | **PASS** |

---

## Re-advisory after first deepen (Claude ADEQUATE_WITH_NOTES / Codex INADEQUATE)

Closed in second pass:

| MUST_FIX | Fix |
|----------|-----|
| Tests without assertions | Every pack has explicit `assert …` bullets + AC→proof map |
| I16 stubs | Expanded multi-row I16 for 3.2, 3.3, 2.4, 6.2 (+ earlier I16 rows) |
| Failure modes thin | ≥4 specific failure modes per pack |
| Plan template stamp | Kind-specific steps (gov/api/ui/cli/keystone/docs) |
| Contracts not wired | All packs Source Documents list all 6 contract files |
| Ownership / CLI / traceability | INVENTORY_OWNERSHIP, CLI_INVENTORY, TRACEABILITY |

## Residual (honest, not shortcuts)

- **Owner LOCK** on constitution still required before execute.  
- OpenAPI **JSON Schema field-level DTOs** still generated at build (routes+commands locked now).  
- Full human read of all 50 packs not claimed; dual-agent sample + machine semantic lint + structural 312 PASS.  
- Numeric perf CI thresholds intentionally not over-engineered; expectations documented.  
- Codex may still flag “not every assertion is a full expect() code sample” — that is build-time test authoring inside the pack contract, not missing product decisions.

---

## Execute readiness

Planning is **substantially deepened** for builder execution without inventing product surface.  
**Still not authorized:** sync, build, deploy — needs frozen manifest + owner go.
