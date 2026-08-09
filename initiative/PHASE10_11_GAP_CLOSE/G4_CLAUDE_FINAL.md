# G4 Claude FINAL advisory — Phase 10–11 gap close

**Advisory role:** Claude independent advisory critic (G4 FINAL) — critic only
**Model:** Claude Fable 5
**Date:** 2026-08-09
**Prior verdicts:** REVISE (R1), REVISE (R2)
**This verdict:** **ADOPT_WITH_NOTES**
**Soul intact:** **YES** — all 18 soul IDs present, enumerated, and uncut; nothing below narrows a soul
**Execute:** **YES** — conditional on folding pre-kick notes N-1..N-4 below (mechanical, same-day; no fourth advisory pass required). N-5..N-7 fold during build/preflight.

No product code, pack, index, manifest, or environment was modified. This advisory file is the only authored output. No build gate was run.

---

## 0. What this round actually verified

Read this round: both SKILL.md files (intent-to-build, add-section-runner), constitution v1.1, livability v2, BUILD_CHECKLIST (BC-01..BC-20), draft + FROZEN execution manifests, G3_VALIDATION.md, validate-run-pack.log, SECTION_ORDER.proposed.txt, ADVERSARIAL_SELF.md, both ACTIVE-RUNS snapshot indexes, both prior R2 advisories and the synthesis, and the three assigned snapshot packs in full (task/spec/plan/classification): **spo-10.3**, **spo-11.0** (fresh sample, never previously audited), **spo-11.9** — plus targeted re-reads of spo-10.1 and spo-11.2 (the Codex R2 samples) to audit their repair.

Independent repo verification: `BROWSER_E2E_INVENTORY.md` ID families (E01, L05, F01, A06, A07, A16, I03, H01/H05, L02–L05 all confirmed real and correctly cited; A17/F05/L2-01 confirmed **free** — no collision), `.gitignore` content, laptop-path sweep across all 17 snapshot specs.

**Honest limitations (unchanged from R2, same sandbox):** `shasum` and all `git` commands were permission-blocked this session, so I could not re-compute the two `.SHA256` manifests, confirm the tracked/untracked status of `initiative/PHASE10_11_GAP_CLOSE/`, or count the dirty tree myself. Codex R2 verified both checksum manifests; the FROZEN manifest pins both hash-of-manifest values and declares the tree DIRTY (153 entries) at `f2f4d985`. I proceed on that recorded evidence.

---

## 1. R2 MUST_FIX closure audit — the blocking set is closed

| Item | R2 status | FINAL finding |
|---|---|---|
| **MF-R2-1** classification.json stale `tests/e2e/*` paths | blocking | **CLOSED.** 10.3 now lists `playwright/e2e/public_cfp_submit_demo.spec.ts`; 11.9 lists `playwright/e2e/phase11_handover_keystone.spec.ts`. Both previously-defective samples repaired; consistent with a sweep. |
| **MF-R2-2** one soul count (16 vs 18) | blocking | **CLOSED.** Constitution Article II enumerates the authoritative 18-ID set; 11.9 success metric now reads "All 18 constitution soul IDs (S-SUB-LIST through S-DOGFOOD including S-SCHED-CHROME and S-EVAL-EXPORT) evidence". The keystone can no longer undercount. |
| **MF-R2-3** `SMOKE_BASE_URL` self-contradiction in 11.9 | blocking | **CLOSED.** In-scope bullet now reads "against `https://www.speakerops.org` (binding; no alternate smoke URL for S-DOGFOOD)", matching the spec's binding addendum and the constitution. |
| **MF-R2-4** wrong inventory families in livability | blocking | **CLOSED.** Independently re-verified against the inventory: S-SUB-LIST→E01+L05 (correct rows), S-EVAL-UI→F01, schedule→I03/I01–I16, shell→H01–H05, states→L02–L04, CFP→A06/A07/A01–A16, comms→J01–J10. New IDs renamed A17/F05/L2-01 — the O-prefix collision is gone and all three slots are free. |
| **Codex #1** owner-approved constitution, 18-soul enumeration | blocking | **PARTIAL.** Soul enumeration done. Constitution header still says `LOCKED-CANDIDATE … awaiting owner constitution ok`; owner authorization is recorded only in the FROZEN manifest ("kick box after dual auditor ADEQUATE", 2026-08-09). Bookkeeping gap, not substance — see N-2. |
| **Codex #2** exact livability | blocking | **LARGELY CLOSED.** IDs exact, F/D owners per row, AC ids named. Residuals: the 5-second clock start is still "networkidle **or spinner hidden**" (circular against a spinner-gone pass condition — flagged by both advisors twice, unchanged), and rows still lack per-soul evidence destinations. See N-3. |
| **Codex #3** repair 10.1/11.2 in specs **and** plans | blocking | **CLOSED.** 10.1: AC-10.1-A..E (incl. pagination-contract AC-E and cross-event negative), plan owns `BROWSER_E2E_INVENTORY.md`, names `list.test.ts` + the snake_case e2e file, and has a per-AC tick block incl. E01+L05 regression + inventory gate. 11.2: AC-11.2-SCALE/SEL/SEND/AUTHZ/UI named; plan has per-AC ticks incl. J01–J10 regression and `test:e2e:inventory`. AC-11.2-Jxx remains a wildcard row, but it is anchored to the deterministic inventory-lint gate over exact rows J01–J10, which is an acceptable mechanism. |
| **Codex #4** singular remote-readable design authority | blocking | **PARTIAL — the largest surviving defect.** The checksummed snapshot exists in-repo at `initiative/…/evidence/design-pack-snapshot/` and 10.1 carries a "Builder-readable design authority" addendum pointing at it. But **all 17 snapshot specs still cite the laptop path** `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/`, as do the ACTIVE-RUNS-11 header and constitution Article VIII. Only 10.1 — a Phase 10 pack that barely needs the design pack — got the addendum; 11.0–11.8, which live or die by `AGENT_IMPLEMENTATION_SPEC.md`, did not. See N-1. |
| **Codex #5** freeze-ready manifest | blocking | **LARGELY CLOSED.** FROZEN manifest now pins branch, SHA, both snapshot hashes, host, RUNS_DIR, ENV_FILE, section range, SECTION_ORDER delta, model/audit pins, gates, dogfood URL, side effects, and declares the dirty tree (153 entries) with the box-baseline rationale. Residuals: no inventory/exclusion list for the 153 entries, no pinned base revision for `/data/speakerops-build`, no pinned box destination + digest check for the design snapshot, evidence destinations only in the draft. See N-4/N-5. |
| **Codex #6** reproducible G3 evidence | blocking | **PARTIAL.** `SECTION_ORDER.proposed.txt` now exists in evidence (prior corpus 0.1–9.6 + the 17 new sections — the R2 "referenced file missing" defect is cured). Still missing: preserved `/tmp/phase10-11-manifest.json`, validator revision, exit status, hash binding; and the snapshot corpus still cannot validate standalone (deps 1.4/3.3/3.5/8.4/8.6 absent — Codex's FAIL repro stands as a snapshot property, though the operative validation context is the full RUNS_DIR, where G3 reports green). See N-6. Additionally: **`.gitignore` line 30 (`*.log`) excludes `evidence/validate-run-pack.log` from git** — the only G3 execution evidence will silently not travel with the repo. See N-7. |

---

## 2. Fresh-sample findings — spo-11.0 (new this round)

**FN-1 (the one real new defect): S-L2-SYSTEM's fixture proof is unowned by the pack that owes it.** Livability row S-L2-SYSTEM promises AC-11.0-A, new testid `l2-state-sheet`, new inventory ID `L2-01`, and `playwright/e2e/lumen2_state_sheet.spec.ts`, F-proof at 11.0. The 11.0 spec has **no Named ACs table at all** (the only sampled pack without one), names none of those four artifacts, does not own the inventory file, its plan creates no Playwright file, and its test list calls the state-sheet capture "**optional**" — directly contradicting soul 9's "state sheet reviewable". A builder can green 11.0's own completion gate while producing none of the promised S-L2-SYSTEM evidence. The 11.9 keystone (all-18-IDs) catches the hole, but at the very end of a 17-section run, with no owner for the missing artifact. This is exactly the defect class the fold repaired in 10.1/10.3/11.2/11.9 — 11.0 was simply missed. → N-4.

**spo-10.3 residual slivers (non-blocking):** traceability table still the generic "Success metrics / Named tests above" with no AC→named-test mapping for AC-10.3-C/D; "Items In Scope" still omits the host/event allowlist predicate that AC-10.3-D requires (the ACs themselves are correct and binding, and `turnstile.test.ts` is named in livability). **spo-11.9 residual sliver:** plan steps still say "Deploy / Keystone e2e / Evidence table" without naming the Phase 10 D re-proof step the binding addendum requires.

---

## 3. Notes to fold (ADOPT_WITH_NOTES — the notes)

**Pre-kick (blocking before `section-runner build` starts):**

- **N-1 — Design authority must resolve on the box.** Sweep the 17 specs' Source Documents (and ACTIVE-RUNS-11 header + constitution Article VIII) to cite the repo-relative snapshot `initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/` (10.1's addendum is the model), **or** at minimum: pin an exact box path for the design snapshot in the manifest and make preflight verify its SHA256 digest there before kick. A made-pilot builder must never face a `/Users/qualitycontrol/Documents/ChatGPT/...` citation as its only design authority — that is how Lumen v1 failed and how S-L2-SCORE fails after a full expensive run.
- **N-2 — Record owner constitution ok.** Flip `LOCKED-CANDIDATE` to `LOCKED` with the owner-approval date in the constitution header (the manifest's execute authorization implies it; the G4 input document should state it).
- **N-3 — Fix the 5-second clock.** One non-circular start: clock starts at `page.goto()` resolution (navigation commit); pass = testid visible AND spinner absent AND ≥1 row, all within 5000ms of that start. Delete "or spinner hidden" from the Start cell. Third time both advisors have flagged this; it is a one-line edit.
- **N-4 — Repair spo-11.0** to match its livability row: Named ACs table (AC-11.0-A), `playwright/e2e/lumen2_state_sheet.spec.ts` in Files to Create + classification, `l2-state-sheet` testid + `L2-01` inventory row ownership (add `KMS-competition/initiative/BROWSER_E2E_INVENTORY.md` to Files to Modify), and delete the word "optional" from the state-sheet test. Refresh `packs-snapshot.SHA256` and the manifest's pinned hash after the edit.

**During preflight / build (non-blocking for kick, binding before their gates):**

- **N-5 — Pin the box baseline.** At preflight, record the `/data/speakerops-build` revision (or the sync command + resulting revision) in evidence; add the 153-entry dirty inventory (or `git stash`/commit the initiative dir) so the freeze SHA plus a declared delta identifies the source. Committing `initiative/PHASE10_11_GAP_CLOSE/` (it is **not** gitignored) is the cleanest cure and also makes the snapshots box-readable via the repo.
- **N-6 — Make G3 evidence reproducible.** Copy the validator manifest out of `/tmp` into `evidence/`, record validator revision + exit status, and add one sentence to G3_VALIDATION.md declaring the validated corpus ("full RUNS_DIR incl. 0.1–9.6; snapshot alone will not validate standalone by design").
- **N-7 — Rescue the log from `.gitignore`.** `*.log` swallows `evidence/validate-run-pack.log`. Either `git add -f` it, rename to `.txt`, or add `!initiative/PHASE10_11_GAP_CLOSE/evidence/*.log` — otherwise the only G3 execution record never enters history. (Same trap will eat 11.9's deploy logs if they land as `*.log` under evidence — name them accordingly.)

Folding N-1..N-4 is hours of mechanical editing plus one snapshot re-hash. None requires re-authoring judgment, none touches a soul, and none in my view requires a fourth advisory round — the constitution's own G4 line ("ADOPT_WITH_NOTES fully folded") covers this exact case.

---

## 4. Why ADOPT_WITH_NOTES and not REVISE

Every item both advisors marked blocking in R2 is either verifiably closed (classification sweep, 18-soul enumeration, SMOKE_BASE_URL, inventory families, 10.1/11.2 pack repair, freeze mechanics, SECTION_ORDER evidence) or reduced to a bounded mechanical edit with a deterministic backstop. The remaining risk profile is qualitatively different from R1/R2: no surviving defect lets a builder *silently* satisfy the programme while missing a soul — the 18-ID keystone enumeration, the inventory anti-shrinkage gate (BC-19), the lockfile gate (BC-20), per-AC plan ticks, and an independent Codex xhigh phase audit with 8 iterations close the silent-pass routes the earlier rounds were guarding against. What remains (N-1..N-7) is failure-*visible* risk: wasted build cycles, weak evidence provenance, and one pack (11.0) whose hole the keystone would catch late. Blocking a third time over hours of mechanical edits would be REVISE-thrash, which the governing skill explicitly warns against.

And why not clean ADEQUATE: N-1 and N-4 are real contract defects in the frozen object itself, not taste. An ADEQUATE that waves a laptop-only design authority and an AC-less foundation pack onto the box would be the rubber stamp this process exists to prevent.

---

## 5. Soul-dilution check

All 18 soul IDs intact and now enumerated in both the constitution and the 11.9 keystone. The fold's history is additive (souls 6b/6c added under advisory pressure, never trimmed). No note above removes, weakens, reclassifies, or defers a soul; N-4 *restores* a soul's promised proof. Standing prohibitions re-affirmed: no fixture-only `dogfood_ready` (S-DOGFOOD binds `https://www.speakerops.org` with deploy revision + report hash); no comms recompose dropping J01–J10; no averaging away a sub-7.0 primary surface; no token reskin as composition; DEFER remains empty while order is FULL.

---

## 6. Concurrence

I re-verified Codex R2's inventory-family, soul-count, laptop-authority, and SECTION_ORDER findings against the R3 fold: the first two are closed, the third survives in all 17 specs (N-1), the fourth is cured. My additive FINAL findings are FN-1 (11.0 unowned S-L2-SYSTEM proof) and N-7 (gitignored validation log). If the Codex FINAL seat lands ADEQUATE or ADOPT_WITH_NOTES, nothing in this advisory conflicts with proceeding under the constitution's G4 rule once the notes are folded.

---

## Final verdict

**ADOPT_WITH_NOTES.**
**Execute: YES** — after N-1..N-4 are folded into the artifacts (with the packs-snapshot hash refreshed and the manifest's pinned hash updated to match), with N-5..N-7 executed at preflight/during build. If the owner or orchestrator declines to fold N-1 or N-4, treat this verdict as REVISE — those two are the load-bearing notes.

Execute-go mechanics remain governed by the FROZEN manifest: dual-gate satisfied only when the second advisory seat also returns ADEQUATE/ADOPT_WITH_NOTES; kick is `10.1 → 11.9` on made-pilot `.env.speakerops`; push/merge/production remain separately authorized as pinned.
