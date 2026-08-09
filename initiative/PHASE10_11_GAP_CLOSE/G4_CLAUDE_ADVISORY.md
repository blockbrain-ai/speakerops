# G4 Claude advisory — Phase 10–11 gap close

**Advisory role:** Claude independent advisory critic (G1/G4) — critic only
**Model:** Claude Fable 5
**Date:** 2026-08-09
**Verdict:** **REVISE**
**Soul intact:** **YES** — sixteen souls are coherent, well-guarded, and none of the required fixes narrows them
**May packs proceed to owner execute-go request?** **NO**

No product code, pack, index, manifest, or environment was modified by this review. No build gate was run.

---

## 0. Advisory scope actually achieved (material limitation)

I was tasked to read ACTIVE-RUNS-10 and ACTIVE-RUNS-11 and spot-check packs **spo-10.3** and **spo-11.9**. Those artifacts live under `~/Documents/nood-factory/plans/runs/speakerops/`, which is **outside this session's permitted read boundary**. Read, `cat`, and `find` were all blocked by the working-directory policy; the block is absolute in this non-interactive session.

Consequently:

- This advisory covers the constitution, product brief, livability matrix, execution manifest, adversarial self-review, BUILD_CHECKLIST, the Codex advisory, and **independent verification against the product repo itself**.
- It does **not** attest to the content, existence, or quality of spo-10.3, spo-11.9, or either ACTIVE-RUNS index. The pack-diversity intent (Codex sampled 10.1/11.2; Claude assigned 10.3/11.9) was sound but **could not be delivered**.
- An independent advisory that cannot open the packs it was asked to sample cannot honestly co-sign an execute-go. This alone forces **NO** on proceed, independent of every finding below.

**Remedy (MF-1):** place a read-only snapshot of the packs and ACTIVE-RUNS indexes under `initiative/PHASE10_11_GAP_CLOSE/evidence/packs-snapshot/` (or grant the advisory session read access), pin hashes, and re-run this spot-check before requesting owner go.

---

## 1. What is genuinely good (do not lose in revision)

- **The soul set is right.** Souls 1–6 target real operator/submitter breakage; souls 7–16 force composition + states + scale + a11y + independent taste score, which is exactly the lesson from the Lumen v1 token-only failure (Article VII). No soul is a vanity metric.
- **The P/S/H/C/D classification is the strongest anti-dilution device in the document set.** It correctly refuses to build product for harness scores and refuses struck features even when sbek penalized their absence.
- **The overlap rule (fix behaviour in 10, recompose presentation in 11, never design over broken APIs) is correct engineering order** and is backed by the 11.0→10.7 dependency.
- **The adversarial self-review is honest** — notably admitting the 10.1 root cause is not yet reproduced and that the taste score is human judgment. Keep that candour; it is worth more than a confident lie.
- **Explicit non-actions until owner go** in the manifest are the right shape for a side-effecting execution.

---

## 2. Independent repo verification (facts, checked this session)

| Claim in artifacts | Repo reality | Status |
|---|---|---|
| Livability e2e paths `tests/e2e/*.spec.ts` | No `tests/e2e/` exists. `playwright.config.ts:31` → `testDir: "./playwright/e2e"`; convention is snake_case (`public_cfp.spec.ts`, `comms_keystone.spec.ts`) | **Matrix paths are wrong** (independently confirms Codex MF-2) |
| Matrix testids | Exist today: `page-submissions`, `submissions-loading`, `public-cfp-submit`, `public-cfp-closed`, `page-evaluations`, `page-readiness`. Do **not** exist: `comms-step-audience`, `cfp-draft-save`, `l2-state-sheet` | Matrix conflates current DOM anchors with to-be-built ones, and never cites a single `@inv` ID |
| S-L2-COMMS mapping | `BROWSER_E2E_INVENTORY.md` rows **J01–J10** are REQUIRED/PASS (trust-before-send, ICS UID/SEQUENCE, etc.) | The 11.2 recompose is the highest anti-shrinkage risk in the programme; matrix maps the soul to one nonexistent testid (confirms Codex MF-5) |
| Manifest "pin at freeze (`git rev-parse HEAD`)" | Worktree has **153 modified/untracked entries** at HEAD `f2f4d985` | SHA alone cannot identify the source to be synced (confirms Codex MF-8) |
| DEMO captcha path | `apps/api/src/modules/publicCfp/turnstile.ts:65` accepts `TURNSTILE_DEV_PASS_TOKEN` whenever `demoMode === true`; `wrangler.toml` demo env sets `DEMO_MODE="1"`, `DEMO_ALLOWLIST_ENABLED="1"` | Mechanism exists; **fail-closed proof does not** — no named negative test that non-demo/production config rejects the dev token (confirms Codex MF-7, sharpened) |
| Keystone sequencing | Brief: 10.7 = product e2e keystone. Manifest side effects: dogfood deploy **only in 11.9**. Souls 1–6 are worded "on dogfood" | Contradiction is real and unresolved (confirms Codex MF-7) |
| Gate commands | Manifest: "GATE_TYPECHECK_CMD + GATE_TEST_CMD (+ e2e for UI sections)". CLAUDE.md E5 defines **four** non-interactive gates including `pnpm test:e2e:inventory` | **Inventory lint is missing from the manifest gate set** — new finding, see MF-4 |

---

## 3. MUST_FIX (blocking owner execute-go request)

### MF-1 — Make the advisory inputs actually reviewable, then re-run the spot-check
Snapshot packs `spo-10.*`/`spo-11.*` and both ACTIVE-RUNS indexes into a location readable by both advisory critics (e.g. `initiative/PHASE10_11_GAP_CLOSE/evidence/packs-snapshot/`), pin hashes, and re-run the Claude spot-check on 10.3 and 11.9. Until a second independent critic has actually read sampled packs, the "dual advisory" gate has one seat empty. This also directly serves Codex MF-6: if the advisory session can't read the design authority and packs, the remote builder likely can't either.

### MF-2 — Correct livability traceability to the real harness (concur Codex MF-2, verified)
Every row must cite: the real Playwright root (`playwright/e2e/`, snake_case), an exact spec file and test name, the owning `@inv:<ID>` (existing or newly added in the same PR per E9), the evidence path, and whether the proof is fixture or dogfood. Explicitly mark which testids exist today versus which sections must create them — a builder reading the current matrix cannot tell repair from greenfield.

### MF-3 — Close the checklist holes for residual items 7 and 8 (concur Codex MF-3, verified)
The constitution declares its residual P/S list authoritative, yet schedule extra-day chrome and ABS-13 export/sort have no soul, no livability row, and no BC row — BUILD_CHECKLIST can turn fully green with them unproven. Add BC-17/BC-18 requiring either a passing fix proof or a recorded proof-of-absence. "If still present" is not a closeable state.

### MF-4 — Put `test:e2e:inventory` (anti-shrinkage) into the binding gate set — **new**
The manifest's "(+ e2e for UI sections)" omits the inventory lint entirely. Phase 11 rewrites every surface that owns REQUIRED/PASS inventory rows; the anti-shrinkage law (`docs/governance/0.3-e2e-inventory-law.md`) is the only mechanical defence against a recompose silently orphaning J01–J10-class coverage. Inventory lint must be unconditional for every 11.x section, and the keystone 11.9 gate should name the Phase 8-style full check (`E2E_INVENTORY_GATE=phase8`) or state why not.

### MF-5 — Resolve the Phase 10 dogfood-proof contradiction (concur Codex MF-7, verified)
Either authorize a Phase 10 checkpoint deploy so 10.7 proves souls 1–6 live, or re-word souls 1–6 proofs as local/fixture at 10.7 with mandatory dogfood re-proof at 11.9 (including regression of Phase 10 souls after the Phase 11 recompose). The current text lets a builder claim "on dogfood" against a deployment that does not yet contain the fixes.

### MF-6 — Freeze mechanics: clean tree, split freeze from go (concur Codex MF-8, verified)
153 dirty/untracked entries mean `git rev-parse HEAD` does not identify the source. Require: commit or explicitly exclude the working-tree delta; pin SHA of the actual synced state; then present the frozen manifest and obtain a **separate, fresh** owner go for that exact object. The current single phrase "Freeze and execute" collapses two authorities into one.

### MF-7 — DEMO captcha must fail closed, with a named negative test (concur Codex MF-7, sharpened with code evidence)
`turnstile.ts` accepts the dev pass token on `demoMode === true` with no host/event constraint visible at that layer. The 10.3 pack must own: the config predicate that scopes DEMO acceptance to the intended dogfood host/event (or explicit allowlist), a negative test proving production-mode rejection of `TURNSTILE_DEV_PASS_TOKEN`, and an `@inv` row for the closed-window server reject (S-CFP-CLOSED currently rides on "same + API unit" — not a named proof).

### MF-8 — G1 completion and G3 validator evidence (concur Codex MF-1/MF-9)
The constitution is still `DRAFT → seeking dual advisory lock`; Article IV makes only dual-audited text authoritative. Fold accepted notes, record owner approval and the frozen revision, and attach green `validate-run-pack` evidence for all 10.x/11.x packs with hashes. Neither advisory has seen validator output.

---

## 4. SHOULD (non-blocking, fold during revision)

1. **Align verdict vocabulary** — constitution Article V says dual "ADEQUATE", manifest says dual "AGREE". One rule, one word.
2. **Name the ACTIVE-RUNS files consistently** — tasking says `ACTIVE-RUNS-10`/`-11`; manifest says `ACTIVE-RUNS-10-PRODUCT-RELIABILITY.md`/`ACTIVE-RUNS-11-LUMEN2-PARITY.md`. Canonical absolute paths at freeze.
3. **Define the S-SUB-LIST 5-second protocol** — start event, seeded row count (150+ deterministic), network profile, retry/caching rules.
4. **Add a lockfile-diff gate for zero-new-runtime-deps** — baseline `package.json`/`pnpm-lock.yaml` hash comparison per section, not reviewer memory.
5. **Map S-L2-COMMS to the full preserved contract** — enumerate J01–J10 as regression-required in the 11.2 pack, plus the new scale/selection semantics.
6. **Taste-score protocol before execution** — scorer identity, independence rule, primary-surface denominator, screenshot route set, so ≥8.0 is reproducible rather than negotiable.
7. **Keep the adversarial-self honesty pattern** — the "root cause not yet repro'd" admission in 10.1 should become a formal `DIAGNOSE-FIRST` step type in packs, not a footnote.

---

## 5. Soul-dilution check

- All sixteen souls remain intact and correctly worded. **Nothing above removes, weakens, or reclassifies a soul.** Every MUST_FIX strengthens traceability, proof, or safety around them.
- Standing prohibitions I co-sign with Codex: no fixture/local smoke satisfying `dogfood_ready`; no four-visible-tabs comms proof that drops trust-before-send/idempotency/authz/150-scale; no averaging away an unreviewed primary surface; no token reskin standing in for composition + states + a11y + responsive; no invented DEFER rows while order is FULL.
- The correct repair direction throughout is **more proof, not less soul**.

---

## 6. Concurrence with G4 Codex advisory

I independently verified Codex MF-2 (wrong e2e root), MF-3 (residual items 7/8 uncovered), MF-7 (both the sequencing contradiction and the DEMO captcha exposure, now with code-level evidence), and MF-8 (worktree state defeats SHA pinning) against the repository. I concur with MF-1, MF-4, MF-5, MF-6, MF-9 as stated; MF-4 and MF-5 (pack repairs for 10.1/11.2) I accept on Codex's evidence since my own pack samples were inaccessible (see §0). My MF-4 (inventory-lint gate omission) is additive to the Codex list.

The two advisories converge from independent paths: this is not a rubber-stamp REVISE.

---

## Advisory conclusion

The programme's soul and classification discipline are strong — this is a well-conceived gap-close, and the revision burden is traceability, freeze mechanics, and proof rigour, not redesign. But the packs the second advisor was assigned to sample were unreadable, the livability matrix points at a test root that does not exist, the anti-shrinkage gate is missing from the manifest, the FULL checklist has two silent holes, and the freeze object is not identifiable in the current worktree state.

**Final verdict: REVISE.**
**May proceed to owner execute-go request: NO** — return after MF-1..MF-8 are folded, packs validate green, the snapshot is readable to both advisors, and both advisories re-run against the frozen inputs.
