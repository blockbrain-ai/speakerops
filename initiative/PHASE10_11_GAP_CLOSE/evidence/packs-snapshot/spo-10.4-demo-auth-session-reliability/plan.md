# Plan 10.4 — DEMO persona session reliability

> Source: SpeakerOps Phase 10–11 | Standards: See speakerops-engineering-standards.md (E1-E12)
>
> Constitution: initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md

## Test & Cleanup Policy

- `pnpm typecheck` · `pnpm test:ci` · UI/keystone also `pnpm test:e2e` / `pnpm test:e2e:inventory`
- Worktree-local cleanup only

## Architecture Overview

Stable session cookies for three roles on dogfood (S-AUTH-ROLES).

Use domain commands from COMMANDS.md / existing modules only. Wire into composition roots; no parallel app. Zero new runtime deps for UI.

## Files to Create

- `playwright/e2e/auth_roles_dogfood.spec.ts`

## Files to Modify

- `apps/api/src/modules/auth/**`
- `apps/web/src/pages/Login.tsx`
- `apps/web/src/auth/**`
- `docs/OPERATIONS.md`

## Scope Guard

- No other section features
- No Next/RSC, OR-Tools, Temporal, dual-write Airtable, agent fleet UI, embeds, gallery CMS
- No secrets committed
- No sbek harness modifications

## Implementation Steps

- [ ] Audit cookie attributes
- [ ] Fix session restore gaps
- [ ] Honest login copy
- [ ] e2e three roles
- [ ] **Tests:** implement named tests from spec; negatives included
- [ ] **Verification:** `pnpm typecheck` && `pnpm test:ci` (and e2e if UI); update inventory if new REQUIRED controls
- [ ] Completion gate: every AC measurable green; no stubs; no TODO in shipped paths

## Completion Gate Checklist

- [ ] All AC pass with evidence
- [ ] No undefined Lumen tokens introduced
- [ ] Inventory tags updated if new UI controls
- [ ] Rollback notes still valid
