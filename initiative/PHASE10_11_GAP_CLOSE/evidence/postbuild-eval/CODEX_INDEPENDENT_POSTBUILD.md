# Independent post-build evaluation — Codex (gpt-5.6-sol xhigh)

**Role:** independent adversarial critic (not pipeline phase auditor)  
**Model:** gpt-5.6-sol · reasoning xhigh  
**Timestamp UTC:** 2026-08-09T17:11:00Z (first pass) · closure 2026-08-09T17:25:00Z  
**Branch tip evaluated (first pass):** `1b4a4b22c` / dogfood `0.1.0-demo+2ab9f55`  
**First-pass verdict:** **CLAIM_FAIL** (report write blocked by read-only sandbox; findings stand)  
**Closure verdict after residual fix commit:** see `SYNTHESIS_POSTBUILD.md`

## Executive summary (first pass)

Pipeline completed 10.1–11.9 with Phase 10 APPROVE (2 iters) and Phase 11 APPROVE (5 iters). Inventory 115/115 REQUIRED with crawl green. Keystone JSON hash matched sidecar; 19 expected / 0 unexpected / 0 skipped. Live health returned `0.1.0-demo+2ab9f55`.

Claim blockers found:

1. **Server-side zero-recipient send** — UI blocked empty audience; `sendComms` still enqueued empty jobs.
2. **Cache-Control no-store** not global — only draft/eval/public-cfp routes set it; sensitive API responses could be intermediate-cached.
3. **Frozen pack hash mismatch** — manifest listed pre-G4-fold hash `4b9b8893…` vs current `packs-snapshot.SHA256` file hash `21c3cb86…`.
4. **Dead page stubs** still exported from `placeholders.tsx` (not routed, but greppable residual narrative).
5. **Handover “known residuals”** wording conflicted with FULL / no-residuals completion contract (mostly non-goals, mislabeled).

Inventory anti-shrinkage held. Non-goals (embeds/gallery CMS/AI placer/full CRM) not smuggled.

## Findings (first pass)

| id | severity | area | evidence | required fix |
|----|----------|------|----------|--------------|
| C-01 | major | `apps/api/src/modules/comms/commands.ts` sendComms | empty preview → enqueue | reject recipientCount 0 with 400 |
| C-02 | major | `packages/shared/src/security.ts` SECURITY_HEADERS | no Cache-Control | add `no-store` globally |
| C-03 | major | `03_EXECUTION_MANIFEST_FROZEN.md` | hash `4b9b…` ≠ file | update to `21c3cb86…` + historical note |
| C-04 | minor | `apps/web/src/routes/placeholders.tsx` | dead PageStub product pages | remove unused stubs; keep BareLayout/NotFound |
| C-05 | minor | handover / LUMEN2 QA wording | “residuals” for non-goals | reclassify as out-of-scope notes |

## Soul matrix spot-check

Pipeline keystone D matrix (18 souls + must-not + meta) passed at deploy rev `2ab9f55`. Independent re-run of live keystone deferred to residual-fix redeploy.

## Residual gap list (first pass)

- C-01 … C-05 above.

## Stubs / agent-incomplete

First pass: dead stubs exported; empty-send API hole; evidence wording. Not an agent-incomplete pipeline exit (pipeline APPROVED), but **dogfood_ready** not honestly CLAIM_PROVEN until C-01–C-03 closed.

CLAIM_FAIL
