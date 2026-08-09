# G4 Claude re-advisory R2 — Phase 10–11 gap close

**Advisory role:** Claude independent advisory critic (G4) — critic only
**Model:** Claude Fable 5
**Date:** 2026-08-09
**Prior verdict:** REVISE (G4_CLAUDE_ADVISORY.md, MF-1..MF-8)
**This verdict:** **REVISE**
**Soul intact:** **YES** — all soul IDs present and strengthened (6b/6c added); no finding below narrows a soul
**May owner freeze request proceed?** **NO**

No product code, pack, index, manifest, or environment was modified. This advisory file is the only authored output. No build gate was run.

---

## 0. Scope achieved this round (and remaining limitations)

Unlike R1, the pack snapshot is now readable from the initiative path. I **actually read** the assigned samples this round: `spo-10.3-public-cfp-captcha-closed` and `spo-11.9-lumen2-dogfood-handover-keystone` (spec, plan, task, classification for both), both ACTIVE-RUNS snapshot indexes, constitution v1.1, livability v2, BUILD_CHECKLIST, manifest v1.1, G3_VALIDATION.md, validate-run-pack.log, and the prior Codex/Claude advisories. The second advisory seat is no longer empty.

Independent repo verification performed: `BROWSER_E2E_INVENTORY.md` ID families, `playwright/e2e/` file listing, `turnstile.ts` current code, worktree state, and existence checks on referenced evidence artifacts.

**Honest limitations:** (a) hash tooling (`shasum`/scripting) was blocked in this session's sandbox, so I could not re-verify the two `.SHA256` manifests myself — Codex R2 reports both self-verify and I have no contrary evidence; (b) the `validate-run-pack.sh` validator lives on the control plane outside my read boundary, so I could not re-run G3 validation — but see MF-8 residual below for what I *could* verify about that evidence.

---

## 1. Prior MF-1..MF-8 closure audit

| Prior item | Status | R2 finding |
|---|---|---|
| **MF-1 — readable snapshot + re-run spot-check** | **CLOSED** (tooling caveat) | Snapshot exists at the pinned initiative path with SHA256 manifests; both assigned packs read and spot-checked this round (§2). Caveat: this session could not independently re-compute the hashes (sandbox); Codex R2 verified them. |
| **MF-2 — livability traceability to real harness** | **RESIDUAL** | The root fix landed: `playwright/e2e/` snake_case, AC ids, exist?/new columns, F/D classes, 5s protocol, taste protocol. But the **inventory citations are wrong or vague**, independently verified against `BROWSER_E2E_INVENTORY.md`: S-SUB-LIST cites `O01/O02` which are **Settings** rows (event name/dates/tz, rooms CRUD) — the existing submissions-list row is **E01** and the 150-row list row is **L05**; S-EVAL-UI cites `F02/F03` which are **evaluator scoring** actions, not the admin evaluations progress page; both schedule rows cite `L*`, but **L is the states family** (empty/error/loading) — schedule is **I01–I16**; wildcards `H*`, `O*`, `form/public inv`, `portal inv`, `same file` remain. Proposed new-ID prefixes `O-SUB-LIST`/`O-EVAL-UI`/`O-EVAL-EXPORT` collide with the existing **O = Settings** family. A builder trusting this matrix would guard the wrong rows against shrinkage. Also concur Codex: the 5s clock start "networkidle **or spinner hidden**" is circular against a pass condition of "spinner not visible" — one non-circular start must be chosen. |
| **MF-3 — residual items 7/8 closeable** | **PARTIAL** | BC-17/BC-18 exist, souls 6b (S-SCHED-CHROME) and 6c (S-EVAL-EXPORT) are in the constitution, 10.6 owns them in the matrix — the checklist hole is closed. But it **re-opens at the keystone**: constitution Article II now enumerates **18 soul IDs** (1–6, 6b, 6c, 7–16) while the 11.9 spec's success metric still says "**All 16 souls** evidence". 11.9 can green while omitting exactly the two souls this fix added. One count, stated in both places. |
| **MF-4 — inventory gate in binding set** | **LARGELY CLOSED** | `pnpm test:e2e:inventory` is now in the manifest's non-discretionary gate table ("required for all 11.x and 10.x UI"), BC-19 exists, and the 11.9 spec addendum names it. Residual sliver: neither names the Phase 8 full-strictness mode (`E2E_INVENTORY_GATE=phase8`) for the keystone or states why not — intermediate mode does not require status PASS. Downgraded to a fold-at-next-revision note, not blocking on its own. |
| **MF-5 — Phase 10 dogfood contradiction** | **CLOSED, with one new self-contradiction** | The F/D proof-class split is correctly threaded through constitution Article II, livability v2, and manifest proof sequencing (F at 10.7, D at 11.9, Phase 10 re-proof after 11.2/11.4 recomposes). However the 11.9 spec contradicts **itself**: "Items In Scope" says run keystone e2e "**against SMOKE_BASE_URL**" while the constitution (S-DOGFOOD: "www.speakerops.org **only** (not arbitrary SMOKE_BASE_URL)") and the spec's own bottom addendum bind the URL. A builder reading the in-scope bullet literally can satisfy it against any base URL. Delete or rewrite the bullet. |
| **MF-6 — freeze mechanics** | **MECHANICS CLOSED; OBJECT NOT FREEZE-READY** | Freeze and execute-go are now correctly separated with distinct owner phrases; the pin table exists; dirty-tree handling is at least contemplated ("clean \| dirty+exclude list"). But the object cannot yet be presented: the worktree still has **153 modified/untracked entries** at `f2f4d985` with **no declared inventory or exclusion list**, so no SHA the owner pins identifies the source; the manifest's own pinned-paths table uses `…/02_LIVABILITY_MATRIX.md`-style ellipsis paths where it demands canonical absolute paths; `/data/speakerops-build` is still "verify preflight". |
| **MF-7 — DEMO captcha fail-closed + named negatives** | **LARGELY CLOSED at contract level** | Constitution soul 3 now includes "DEMO token fail-closed outside allowlisted demo host/event"; 10.3 spec carries **AC-10.3-C** (demoMode false rejects `TURNSTILE_DEV_PASS_TOKEN`, unit) and **AC-10.3-D** (DEMO token rejected on non-allowlisted hosts); matrix has the S-CFP-CLOSED-NEG row. Verified in code: `turnstile.ts:65` still accepts the dev token on bare `demoMode === true` with no host/event predicate — that is fine *only because* the 10.3 pack now owns building it (`apps/api/src/env.ts` + `docs/DEMO_HOST.md` in files-to-modify support it). Residual sliver: the allowlist predicate is absent from the spec's "Items In Scope" bullets and its "Tests that prove these" still lists generic names ("Unit: turnstile demoMode") rather than the AC-C/AC-D negatives — tighten so the ACs and the build steps can't drift apart. |
| **MF-8 — G1 completion + G3 validator evidence** | **RESIDUAL** | Constitution is still `LOCKED-CANDIDATE` awaiting owner ok — acceptable *process state* while dual re-advisory runs, but it cannot be the frozen G4 input until owner approval and a pinned revision are recorded. The G3 evidence remains non-probative: `validate-run-pack.log` has per-pack PASS lines but **no validator revision, no exit status, no binding to the snapshot hashes**; the `/tmp/phase10-11-manifest.json` it depends on is not preserved; and `G3_VALIDATION.md` cites `SECTION_ORDER.proposed.txt`, which — independently verified — **does not exist anywhere in this repo**. Codex R2 additionally re-ran the validator over the snapshot and got FAIL (14 dependency checks; prior 1.x–8.x corpus absent); I could not re-run it, but the missing referenced artifact alone means the evidence does not reproduce from the initiative. |

---

## 2. Spot-check results — spo-10.3 and spo-11.9 (assigned samples, now actually read)

**spo-10.3 (public CFP captcha + closed):** The strongest pack element is the Named ACs table — AC-A/B/C/D cover the demo-accept, closed-window UI+API, production fail-closed, and host-allowlist negatives, matching the constitution soul wording. Plan owns the right files (`publicCfp/**`, `PublicCfp.tsx`, `env.ts`, `docs/DEMO_HOST.md`) and creates `playwright/e2e/public_cfp_submit_demo.spec.ts` at the correct root. Defects:

1. **`classification.json` still lists `tests/e2e/public-cfp-submit-demo.spec.ts`** — the pre-fold wrong root and wrong naming convention, contradicting the pack's own plan. Whatever consumes classification file lists gets the stale path.
2. Traceability table is still the generic "Success metrics / Named tests above" — no AC→named-test mapping, so AC-10.3-C/D have no owned test names.
3. "Items In Scope" predates the ACs: it never mentions the host/event allowlist predicate that AC-10.3-D requires.
4. Source Documents still cite the laptop design-pack path (`~/Documents/ChatGPT/...`) instead of the pinned initiative snapshot (concur Codex MF-6 residual).

**spo-11.9 (dogfood + handover keystone):** The binding addendum (URL `https://www.speakerops.org` only, deploy revision + report hash, Phase 10 D re-proof, inventory gate) is exactly what R1 asked for. Defects:

1. **"All 16 souls evidence"** vs 18 constitution soul IDs (§1 MF-3) — the keystone's own success metric permits omitting 6b/6c.
2. **"against SMOKE_BASE_URL"** in Items In Scope contradicts the addendum and the constitution (§1 MF-5).
3. **`classification.json` again lists `tests/e2e/phase11-handover-keystone.spec.ts`** — same stale-root defect as 10.3; both sampled packs carry it, so it is likely systematic across all 17.
4. Plan steps ("Deploy / Keystone e2e / Evidence table") never name the Phase 10 soul **D re-proof** as a step, though the addendum requires it — the step list and the addendum should agree.
5. Source Documents: same laptop design-pack citation.

Both packs' generic security must-not blocks (admin submissions read, speaker cross-mutation) are boilerplate rather than section-fit, but each does include at least one genuinely owned negative (closed-CFP 4xx in 10.3), so I rate this a SHOULD, not blocking.

---

## 3. New MUST_FIX (R2)

- **MF-R2-1 — Sweep `classification.json` across all 17 packs** for stale `tests/e2e/*-kebab.spec.ts` paths; align with each plan's `playwright/e2e/*_snake.spec.ts`. Verified present in both sampled packs; assume systemic until proven otherwise.
- **MF-R2-2 — One soul count.** Enumerate the authoritative soul-ID set (18) in the constitution and make 11.9's success metric, SOUL_EVIDENCE_TABLE requirement, and G7 exit reference that enumeration, not a number that can drift.
- **MF-R2-3 — Remove `SMOKE_BASE_URL` from 11.9's in-scope text**; the addendum's binding URL is correct and must be the only statement.
- **MF-R2-4 — Correct livability inventory families** (E01/L05 for submissions; I01–I16 for schedule; evaluations page row distinct from F02/F03) and rename proposed new IDs out of the O-prefix collision. This is the builder's shrinkage-guard map; it must not point at the wrong rows.

Plus the residuals from §1: MF-2 (remaining wildcards + circular clock), MF-3 (16/18), MF-6 (declared worktree inventory before freeze; canonical paths in the manifest), MF-8 (owner approval + reproducible G3 evidence: preserved manifest, validator revision, exit status, hash binding, the missing `SECTION_ORDER.proposed.txt`, and a dependency corpus or declared validated baseline so the snapshot validates green standalone).

---

## 4. What closed well (keep)

The fold was substantive, not cosmetic: the F/D proof split, the binding dogfood URL, BC-17..BC-20, the inventory and lockfile gates, the freeze/execute authority split with distinct owner phrases, the ADEQUATE vocabulary unification, the 5s and taste-score protocols, the readable pack/design snapshots with hash manifests, and AC-10.3-C/D fail-closed negatives. All seven of my R1 SHOULD items were addressed at least partially. This is convergent revision, and the remaining burden is smaller than R1's.

---

## 5. Soul-dilution check

All 18 soul IDs intact; the fold **added** souls (6b/6c) rather than trimming. No finding above removes, weakens, or reclassifies a soul; every MUST_FIX again strengthens traceability, proof identity, or freeze integrity. Standing prohibitions re-affirmed: no fixture-only `dogfood_ready`; no comms recompose that drops J01–J10; no averaging away an unreviewed primary surface; no token reskin as composition; no invented DEFER rows while order is FULL.

---

## 6. Concurrence with G4 Codex R2

Independent convergence again: I separately verified Codex's livability inventory-family errors (O01/O02 vs E01, L* vs I*), the 16-vs-18 soul count, the laptop-bound design authority in indexes and sampled specs, the missing `SECTION_ORDER.proposed.txt`, and the still-dirty worktree. I accept on Codex's evidence (my samples differ): the 10.1/11.2 pack-level residuals and the validator FAIL reproduction over the snapshot corpus. My additive findings are the systematic stale `classification.json` paths and the 11.9 SMOKE_BASE_URL self-contradiction. Nothing in the Codex R2 list conflicts with my reading.

---

## Advisory conclusion

**Final verdict: REVISE** — a materially better object than R1, with a fold that took both advisories seriously, but the execution contract still contains wrong inventory pointers, a soul count the keystone can undercount, systematically stale classification paths, a design authority that is not yet singular, non-reproducible G3 evidence, and a source tree that no SHA can currently identify.

**May owner freeze request proceed: NO.** Return for a third advisory pass after: the classification sweep (MF-R2-1), soul-set enumeration (MF-R2-2), the 11.9 text fix (MF-R2-3), livability inventory corrections (MF-R2-4), a declared clean-or-inventoried worktree, singular snapshot-cited design authority, and reproducible G3 evidence. These are mechanical, well-bounded fixes — the third pass should be short. Execute-go remains a separate, later authorization and is not assessed here.
