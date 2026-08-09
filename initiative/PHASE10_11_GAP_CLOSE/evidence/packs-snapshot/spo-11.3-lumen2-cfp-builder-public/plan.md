# Plan 11.3 — CFP builder + public CFP Lumen 2

> Source: SpeakerOps Phase 10–11 | Standards: See speakerops-engineering-standards.md (E1-E12)
>
> Constitution: initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md

## Test & Cleanup Policy

- `pnpm typecheck` · `pnpm test:ci` · UI/keystone also `pnpm test:e2e` / `pnpm test:e2e:inventory`
- Worktree-local cleanup only

## Architecture Overview

Recompose FormBuilder + PublicCfp to Lumen 2 compositions without losing form logic.

Use domain commands from COMMANDS.md / existing modules only. Wire into composition roots; no parallel app. Zero new runtime deps for UI.

## Files to Create

- `playwright/e2e/cfp_lumen2.spec.ts`

## Files to Modify

- `apps/web/src/pages/FormBuilder.tsx`
- `apps/web/src/pages/PublicCfp.tsx`
- `apps/web/src/components/forms/**`

## Scope Guard

- No other section features
- No Next/RSC, OR-Tools, Temporal, dual-write Airtable, agent fleet UI, embeds, gallery CMS
- No secrets committed
- No sbek harness modifications

## Implementation Steps

- [ ] Builder layout
- [ ] Public polish
- [ ] e2e
- [ ] **Tests:** implement named tests from spec; negatives included
- [ ] **Verification:** `pnpm typecheck` && `pnpm test:ci` (and e2e if UI); update inventory if new REQUIRED controls
- [ ] Completion gate: every AC measurable green; no stubs; no TODO in shipped paths

## Completion Gate Checklist

- [ ] All AC pass with evidence
- [ ] No undefined Lumen tokens introduced
- [ ] Inventory tags updated if new UI controls
- [ ] Rollback notes still valid
