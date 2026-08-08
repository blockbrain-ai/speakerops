# Pack depth gap analysis — why packs were not competition-grade

**Date:** 2026-08-08  
**Author:** Grok (planning stage — no shortcuts)  
**Scope:** All 50 `spo-*` packs under `nood-factory/plans/runs/speakerops/`

---

## 1. Investigation method

| Check | Result |
|-------|--------|
| Structural validator | PASS 312 checks (files, DAG, Standards line, placeholders) |
| Spec char length | 19 packs &lt; 2500 chars or &lt; 5 ACs at last audit; “deepened” keystones still short vs collab exemplars |
| Goal specificity | Most goals = one-line slug text (“Admin form builder UI inventory D*”) not product contracts |
| Interfaces / schemas | Generic “Zod + domain commands” — almost no concrete routes, DTOs, or table columns |
| Named tests | Pattern `tests/section/X.test.ts` without assertion list |
| I16 field-flow | Only ~6 packs; UI without I16 ≈ 22 |
| Inventory binding | Wildcards `D*` / `I*` instead of stable IDs A01… |
| Plan steps | Copy-paste “implement files listed” — not file-path-specific |
| Phase indexes 2–7 | Lighter than Phase 0/8/9 (missing critical path detail, rollback, human gates) |
| Codex pack advisory | **INADEQUATE** — template stamp; contracts live in indexes not packs |
| Claude pack advisory | ADEQUATE_WITH_NOTES — CF unowned (fixed 8.6), REQUIRED undefined (fixed), thin soul-critical packs |

**Root cause:** Packs were **bulk-generated** to satisfy the structural validator and programme skeleton quickly. Structural readiness ≠ semantic readiness. Planning-stage shortcuts produce builder guesswork and REVISE loops later.

---

## 2. What “competition / production grade” means here

A pack is grade-ready when a builder who **has not** read the chat can implement without inventing:

1. **Exact files** to create/modify (paths + responsibility)  
2. **Exact HTTP/CLI/command signatures** and DTO fields  
3. **Exact D1 tables/columns** or migration names when schema changes  
4. **Every inventory ID** owned by the section (no bare wildcards)  
5. **Named tests with assertions** (happy + negative + authz)  
6. **I16** for every field collected or transformed  
7. **Measurable ACs** (≥6, each mapped to a test)  
8. **Stop gates** that protect constitution souls  
9. **Security/tenant invariants** specific to the surface  
10. **Rollback / failure** behavior  

Exemplar bar: collab `col-1.1` (~100 lines real contract) and advisory `adv-1.6` keystone — not word count for its own sake, but **executable clarity**.

---

## 3. Defect classes (all packs)

| ID | Defect | Impact if not fixed |
|----|--------|---------------------|
| D1 | Template goals (“inventory D*”) | Wrong/missing form features |
| D2 | No route/command map | Orphan UI or invent endpoints |
| D3 | No schema columns | Inconsistent Person/Speaker model |
| D4 | Weak ACs (3–4 generic) | Auditor cannot fail clearly |
| D5 | Fake test names without assertions | Green CI, broken product |
| D6 | Missing I16 | FE/BE/Airtable/CLI value drift |
| D7 | Inventory wildcards | Incomplete browser coverage |
| D8 | Plans not file-specific | Scope creep / missed wiring |
| D9 | Docs packs with API failure-mode boilerplate | Nonsense gates on Phase 9 |
| D10 | Human-review false on high-risk | Security sections auto-merge culture |
| D11 | Performance never specified | Slow clone of Sessionboard |
| D12 | Phase indexes thin mid-programme | Lost invariants between phases |

---

## 4. Deepen plan (proposed)

### Wave A — Contract spine (do first)
1. Author **canonical command registry** + **schema sketch** docs consumed by all packs:  
   `docs/contracts/COMMANDS.md`, `docs/contracts/SCHEMA.md`, `docs/contracts/SCOPES.md` (in product repo path as planned; for now under initiative/contracts/)  
2. Author **per-phase field-flow master** tables  
3. Set pack quality rubric checklist (below) as definition of done for deepen

### Wave B — Deepen every pack (no exceptions)
For each of 50 sections, rewrite `spec.md` + `plan.md` (+ `task.md` if needed) to meet rubric.  
Order: Phase 0 → 1 → … → 9 (dependency order).  
Priority within phase: APIs before UI before e2e keystones.

### Wave C — Phase indexes
Upgrade ACTIVE-RUNS-02..07 to Phase 0/8/9 richness: baseline, rules, critical path, rollback, human gates, exact inventory ownership.

### Wave D — Classification hygiene
- Align risk `high` with `requires_human_review: true` for auth, keys, security, deploy, onboarding proof  
- Exact inventory IDs in notes  

### Wave E — Auditor re-review
Codex + Claude re-audit **random sample of 8 packs + all keystones + Phase 9**.  
Target: **ADEQUATE** with zero MUST_FIX on sample; remaining notes folded.

### Wave F — Re-validate
`validate-run-pack.sh` PASS; optional second structural pass.

### Explicit non-goals of deepen (avoid over-engineering)
- Not inventing OR-Tools, agent fleets, multi-region  
- Not writing product application code  
- Not execute/sync/deploy  
- Not 50-page novels per pack — **contracts, not essays**

---

## 5. Pack quality rubric (definition of done)

Every pack MUST have:

- [ ] Goal ≥ 2 sentences, product outcome + who benefits  
- [ ] In-scope bullets ≥ 6 concrete behaviors  
- [ ] Out-of-scope ≥ 3 named exclusions  
- [ ] Hard deps table accurate  
- [ ] **Interfaces** section with routes/commands/CLI signatures  
- [ ] **Data** section if schema touch (tables/columns)  
- [ ] Failure modes ≥ 4 **specific**  
- [ ] ACs ≥ 6, each testable  
- [ ] Tests named with **what they assert**  
- [ ] Inventory IDs listed explicitly if UI  
- [ ] I16 table if collects/transforms fields  
- [ ] Security block if auth/files/keys/public  
- [ ] Plan: Files to Create/Modify with real paths  
- [ ] Plan steps checkbox, non-generic  
- [ ] Stop gates reference constitution souls where relevant  

---

## 6. Success criteria for this planning deepen

| Metric | Target |
|--------|--------|
| Thin packs (chars&lt;2500 or AC&lt;5) | **0** |
| UI packs with explicit inv IDs | **100%** |
| Field-collecting packs with I16 | **100%** |
| Keystones with evidence paths | **100%** |
| Validator | PASS |
| Auditor re-review sample | ADEQUATE / ADEQUATE_WITH_NOTES only (no INADEQUATE) |

---

## 7. Ask for auditors

Critique this gap analysis + plan.  
Verdict: APPROVE_PLAN | APPROVE_WITH_NOTES | REVISE_PLAN.  
MUST_FIX on the **plan** itself. Do not remove constitution souls. Do not authorize execute.
