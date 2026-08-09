# Plan 10.3 — Public CFP DEMO captcha + closed window proof

> Source: SpeakerOps Phase 10–11 | Standards: See speakerops-engineering-standards.md (E1-E12)
>
> Constitution: initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md

## Test & Cleanup Policy

- `pnpm typecheck` · `pnpm test:ci` · UI/keystone also `pnpm test:e2e` / `pnpm test:e2e:inventory`
- Worktree-local cleanup only

## Architecture Overview

Prove DEMO Turnstile path and closed-window enforcement on public CFP for dogfood.

Use domain commands from COMMANDS.md / existing modules only. Wire into composition roots; no parallel app. Zero new runtime deps for UI.

## Files to Create

- `playwright/e2e/public_cfp_submit_demo.spec.ts`

## Files to Modify

- `apps/api/src/modules/publicCfp/**`
- `apps/web/src/pages/PublicCfp.tsx`
- `docs/DEMO_HOST.md`
- `apps/api/src/env.ts`

## Scope Guard

- No other section features
- No Next/RSC, OR-Tools, Temporal, dual-write Airtable, agent fleet UI, embeds, gallery CMS
- No secrets committed
- No sbek harness modifications

## Implementation Steps

- [ ] Verify DEMO_MODE env wiring on worker
- [ ] Harden verifyTurnstile demo path
- [ ] Closed UI + server reject e2e
- [ ] Docs names-only
- [ ] **Tests:** implement named tests from spec; negatives included
- [ ] **Verification:** `pnpm typecheck` && `pnpm test:ci` (and e2e if UI); update inventory if new REQUIRED controls
- [ ] Completion gate: every AC measurable green; no stubs; no TODO in shipped paths

## Completion Gate Checklist

- [ ] All AC pass with evidence
- [ ] No undefined Lumen tokens introduced
- [ ] Inventory tags updated if new UI controls
- [ ] Rollback notes still valid
