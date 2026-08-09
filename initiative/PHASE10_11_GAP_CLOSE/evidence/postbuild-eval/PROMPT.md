# Independent post-build adversarial evaluation — SpeakerOps Phase 10+11

You are an **independent adversarial critic**, not the pipeline builder or the pipeline phase auditor.
Your job: evaluate whether the **delivered product** at tip of branch `section-runner/speakerops` fully closes the Phase 10 product-reliability + Phase 11 Lumen 2 FE parity programme with **no stubs, no residuals**, and whether the claim **`dogfood_ready`** is honestly earned.

## Binding sources (read these; do not invent requirements)
- `initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md` (LOCKED v1.2; 18 souls; non-goals)
- `initiative/PHASE10_11_GAP_CLOSE/01_LIVABILITY.md` (if present)
- `initiative/PHASE10_11_GAP_CLOSE/BUILD_CHECKLIST.md`
- `initiative/PHASE10_11_GAP_CLOSE/03_EXECUTION_MANIFEST_FROZEN.md`
- Packs under `initiative/PHASE10_11_GAP_CLOSE/evidence/packs-snapshot/` (or nood-factory runs if present)
- Evidence: `initiative/PHASE10_11_GAP_CLOSE/evidence/deploy.md`, `SOUL_EVIDENCE_TABLE.md`, `phase11-keystone-run.json` + `.SHA256`, `phase10-keystone.md`, `pipeline-result-run-complete.json`, `AUTONOMOUS_RUN.md`
- Product code: `apps/`, `playwright/e2e/`, `docs/`

## Live binding URL
- https://www.speakerops.org — GET /health must be 200 and version must match deploy evidence (`0.1.0-demo+2ab9f55` lineage).

## Evaluation protocol
1. Verify pipeline claims: Phase 10 APPROVE, Phase 11 APPROVE, sections 10.1–11.9 completed, tip evidence coherent.
2. Spot-check **product code** against ACs for high-risk areas (comms empty audience, idempotency, DEMO_MODE error leak, draft/eval guards, Turnstile DEMO, pagination, CFP closed, formVersion, CSV formula injection, Cache-Control).
3. Verify **18 souls** all have named D keystone tests and report shows 19 expected / 0 unexpected / 0 skipped; hash matches SHA256 file.
4. Inventory anti-shrinkage: confirm inventory scripts/tests still assert 115 REQUIRED IDs (run if feasible).
5. Non-goals: confirm no embeds/gallery CMS/AI placer/full CRM was smuggled in as a requirement fail.
6. Hunt **stubs/TODOs/placeholder routes/disabled tests** that would make dogfood_ready dishonest.
7. Check live health endpoint.

## Output (write exactly to the assigned outfile path)
Write a markdown report with:
- Verdict: **CLAIM_PROVEN** | **CLAIM_WITH_RESIDUALS** | **CLAIM_FAIL**
- Executive summary (≤12 lines)
- Findings table: id | severity (critical/major/minor/note) | file/area | evidence | required fix
- Soul matrix spot-check (pass/fail/uncertain per soul if sampled)
- Residual gap list (empty only if CLAIM_PROVEN)
- Explicit statement on stubs/residuals/agent-incomplete exit
- Sign-off model + timestamp UTC

Be adversarial. Prefer concrete file:line / commit / hash evidence. Do not rubber-stamp pipeline APPROVE.
