# G4 Codex advisory — Phase 10–11 gap close

**Advisory role:** Codex Sol-style G1/G4 critic only  
**Date:** 2026-08-09  
**Verdict:** **REVISE**  
**Soul intact:** **YES at intent level; not yet protected by execution-ready traceability**  
**May packs proceed to owner execute-go request?** **NO**

This is a combined G1/G4 review. The constitution is a valid G1 draft, but it is not a frozen G4 input: it still says `DRAFT → seeking dual advisory lock`. The north star, FULL order, dogfood claim, anti-dilution rule, and sixteen souls are coherent and must be preserved. The current artifacts nevertheless leave routes by which a build could be declared green without proving the full owner order or the dogfood claim.

No product code, run pack, ACTIVE-RUNS index, manifest field, remote environment, or build state was changed by this review. No build/test gate or pack validator was run; validator evidence was not present in the supplied artifacts.

## MUST_FIX before an owner execute-go request

### MF-1 — Complete G1 and present a genuinely frozen G4 input

The constitution is still draft, while Article IV only makes its text authoritative “once dual-audited.” Fold accepted advisory notes into the authored artifacts, record the owner’s constitution approval, identify the frozen revision/hash, and only then perform the final G4 comparison. The second independent advisory required by the programme must also be recorded.

Do not solve this by deleting, weakening, or reclassifying any soul. Any soul change requires the existing owner-approved amendment protocol.

### MF-2 — Replace the summary livability table with exact, runnable traceability

The stated G2 rule is `soul → section → named AC → testid → e2e`, but the matrix does not meet it:

- Its Phase 10 specs point to `tests/e2e/*.spec.ts`; the repository’s configured Playwright root is `playwright/e2e/`.
- Many rows use prose such as “same + API unit,” “e2e overview,” “unit + visual capture,” “form builder regions,” or “portal home” instead of a file, named test, inventory ID, and evidence target.
- It conflates DOM `data-testid` values with inventory journey IDs. E9 proof requires explicit `@inv:<ID>` ownership.
- S-L2-SYSTEM has no browser path, and S-L2-SCORE has no screenshot route set, scorer identity/independence rule, or reproducible scoring evidence.
- S-L2-COMMS maps only to `comms-step-audience`, despite the existing trust contract and inventory J01–J10.

For all sixteen souls, name: the AC identifier and exact assertion; local/fixture test; `playwright/e2e/<file>.spec.ts`; applicable existing or new inventory IDs and `@inv` tags; dogfood proof owner; target URL class; and evidence path. A local fixture pass and a dogfood pass must be distinguishable.

### MF-3 — Close the FULL-order coverage holes outside the current soul checklist

The constitution calls its residual product list authoritative, but items 7 and 8 (schedule extra-day chrome and ABS-13 export/score sort) are only assigned broadly to 10.6. They have no BUILD_CHECKLIST rows, no exact ACs, and no evidence mapping. “If still present” and “if already partially shipped” are not closeable states unless the pack requires either a passing implementation proof or a recorded proof of absence.

Likewise, “all frontend audit gaps,” “remaining admin/settings routes,” and “no primary surface below 7.0” have no complete route-level map. Add an immutable design-gap/page-atlas coverage table that assigns every in-scope primary and remaining route, state, breakpoint, and QA_CHECKLIST requirement to a section, named AC, screenshot/e2e proof, and checklist row. Define the primary-surface denominator and the independent taste-scoring protocol before execution. Without this, an average score can mask an omitted route while the FULL checklist still turns green.

### MF-4 — Repair sampled pack 10.1 before it is executable

`spo-10.1-submissions-list-reliability` is directionally correct but not execution-ready:

- The Source Concept is truncated to `S-SUB-`.
- It repeats the nonexistent `tests/e2e/*` root.
- Its traceability is only “Success metrics / Named tests above,” with no named AC IDs or exact test names.
- “Dogfood-shaped fixtures” and “seeded event” do not prove the soul’s actual dogfood event, 150+ row shape, or five-second bound.
- “Paginate or window if required” does not state the compatible response/pagination contract, filter semantics, stable ordering, or the SPA/API migration rule; a builder could fix the spinner by silently truncating or breaking filters.
- Its generic negative-test block includes unrelated CFP and mutation checks while failing to identify the exact section-owned list-read authz/cross-event/error-recovery assertions.

The corrected pack must distinguish diagnosis from acceptance, preserve E4 list shape and E2 event scoping, define stable pagination/windowing if used, include a 150+ deterministic fixture, name positive and negative tests, update inventory ownership, and state where the real dogfood timing proof occurs.

### MF-5 — Repair sampled pack 11.2 so a visual recompose cannot dilute comms safety

`spo-11.2-lumen2-comms-campaign` reduces a high-risk send workflow to four labels, audience virtualization, and “existing send still works.” That is insufficient. SpeakerOps already binds trust-before-send through exact audience count, rendered recipient bodies, missing merge fields, preview invalidation on edits, send-before-preview blocking, idempotent send, delivery log, scope/authz, and ICS behavior (inventory J01–J10). Those behaviors must survive the recompose.

The pack needs named ACs and regression proof for that contract plus the new 150-recipient search/filter/page-or-virtualization behavior. It must define selection semantics across filtering/paging, review-state invalidation, send confirmation/double-submit behavior, loading/empty/error/session-expired states, keyboard/focus behavior, 390px handling where applicable, and use of the 11.0 primitives/Lumen tokens. The plan must list the actual Playwright root and the inventory file among owned files; UI e2e and inventory lint must be unconditional, not “if UI.” Generic negatives unrelated to comms should be replaced by section-owned `comms:send`/event/authz/idempotency negatives.

### MF-6 — Make the Lumen 2 authority immutable and readable on the build host

The constitution and both sampled packs depend on `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/` and an unqualified `SPEAKEROPS_DESIGN_AUDIT.md`. The execution target is `made-pilot`; the manifest does not establish that these sources exist there. A builder that cannot read the binding design pack can only improvise, which creates a direct token-only/soul-dilution risk.

Place or sync a read-only snapshot into a builder-readable source-of-truth location, enumerate the binding files (including AGENT_IMPLEMENTATION_SPEC, QA_CHECKLIST, page atlas, handover brief, and audit), and pin hashes in the frozen manifest/evidence. Packs must reference that remote-readable location.

### MF-7 — Make dogfood proof and DEMO security unambiguous

S-DOGFOOD currently permits “dogfood or documented SMOKE_BASE_URL,” while the claimed state is specifically `dogfood_ready` at `www.speakerops.org`. A generic or local smoke URL must not satisfy this soul. Require the final keystone and the applicable user-observable souls against the named dogfood deployment, with deployed revision, timestamp, URL, non-skipped result, and report/hash provenance.

Resolve the Phase 10 sequencing contradiction as well: 10.7 is described as the product keystone, but the manifest only names a dogfood deploy in 11.9. Either authorize and specify a Phase 10 checkpoint deploy before live 10.7 proof, or label 10.7 as local integration and assign all live Phase 10 soul proof to 11.9. Do not claim live proof against an older deployment.

The DEMO_MODE captcha path must be constrained to the intended dogfood host/event or explicit allowlist, fail closed elsewhere, and have a negative test. S-AUTH-ROLES must prove real minted/session-backed role landings; a documentation-only path cannot pass the soul.

### MF-8 — Rebuild the draft manifest around a frozen snapshot and a later fresh go

The current owner phrase says “Freeze and execute,” which combines G5a and G5b. The owner must review an already frozen manifest and then give fresh authorization for that exact manifest. Before requesting that go, the manifest must pin:

- product source revision, remote product path, branch, and clean/declared worktree state; the inspected local worktree currently contains extensive modified and untracked files, so `HEAD` alone would not identify the intended source;
- exact pack/index/design-authority source paths plus hashes and sync destination;
- exact section range and SECTION_ORDER before/after values;
- explicit environment settings required by the estate contract, including builder provider/model, `SECTION_AUDIT_ENABLED=false`, `AUDIT_PROVIDER=codex`, Codex model/effort, `MAX_FINAL_AUDIT_ITERATIONS=8`, `FINAL_AUDIT_ON_NONCONVERGE=fail`, and `REQUIRE_INDEPENDENT_FINAL_AUDITOR=true`;
- exact non-interactive E5 commands (`typecheck`, `test:ci`, `test:e2e`, `test:e2e:inventory`) and the Phase 11 visual/QA gates; “+ e2e for UI sections” is too discretionary for an all-UI phase;
- mid-build constitution checkpoints, including the resolved Phase 10 dogfood/local proof point and regression of Phase 10 souls after Phase 11;
- preflight checks for host identity, expected base revision, backup paths, runner lock/no competing process, capacity, and approved credentials channel;
- evidence destinations for commands, timestamps, exits, logs, `result.json`, reports, deployed revision, and hashes;
- rollback/service recovery for the actual dogfood side effects, not only a generic git revert.

Dogfood deployment is an explicit side effect of this proposed execution and must appear in the frozen authorization text. Push, merge, production cutover, and live third-party credentials remain separate authorities.

### MF-9 — Supply G3 validation and consistency evidence

No validator result was included or referenced. Before G4 can pass, provide green `validate-run-pack` evidence for every 10.x/11.x pack, with the validated pack hashes/revision, and show that the ACTIVE-RUNS order, pack dependencies, manifest SECTION_ORDER, and livability ownership agree. Re-run the independent advisory after the material revisions above; a chat-only acknowledgement is not sufficient.

## SHOULD notes

1. Align gate vocabulary. The constitution asks for dual `ADEQUATE`, while the manifest asks for dual `AGREE`; use one verdict-to-gate rule.
2. Resolve the Phase 11 ordering prose. The index says 11.2 depends on 11.1 but also says 11.2–11.6 may partially parallel after 11.0. State the actual dependency DAG reflected by the packs and SECTION_ORDER.
3. Define the five-second submissions measurement: start event, seeded row count, browser/network profile, timeout assertion, and whether retries/cached navigation count.
4. Add an explicit dependency-diff gate for the zero-new-runtime-dependencies promise (`package.json`/lockfile baseline), rather than relying on reviewer memory.
5. Remove mechanical boilerplate from packs when it is not section-owned. Broad unrelated must-not lists obscure the real risks and make “all negatives included” unverifiable.
6. Record the exact existing inventory journeys reused by each Phase 11 recompose, then add only genuinely new inventory rows. Recomposition must not orphan or silently rename current `@inv` coverage.
7. In the manifest, replace `~` and alternatives such as “or owner-declared” with canonical absolute values at freeze time.

## Soul-dilution prohibition

The revisions above must not be closed by:

- removing or weakening any of S-SUB-LIST through S-DOGFOOD;
- changing `FULL` to a residual-based exit or inventing DEFER rows without owner amendment;
- accepting fixture/local smoke as `dogfood_ready`;
- treating four visible comms tabs as proof while dropping trust-before-send, idempotency, authz, or 150-recipient operability;
- averaging away an unreviewed primary surface;
- substituting a token reskin for the required compositions, states, accessibility, and responsive behavior.

The right repair is stronger traceability and proof, not narrower soul.

## Advisory conclusion

The programme has a credible north star and a substantially intact product soul. It does **not** yet have a frozen, remotely consumable, validator-backed, execution-safe contract. The two sampled packs demonstrate a recurring shallow-template risk, and the current manifest cannot be the object of informed owner authorization.

**Final verdict: REVISE.**  
**Owner execute-go request: NO — return after MUST_FIX items are folded, packs validate green, the constitution and inputs are frozen, and the revised G4 advisory passes.**
