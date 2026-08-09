# Plan 10.1 — Admin submissions list reliability at scale

> Source: SpeakerOps Phase 10–11 | Standards: See speakerops-engineering-standards.md (E1-E12)
>
> Constitution: initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md

## Test & Cleanup Policy

- `pnpm typecheck` · `pnpm test:ci` · UI/keystone also `pnpm test:e2e` / `pnpm test:e2e:inventory`
- Worktree-local cleanup only

## Architecture Overview

Fix admin submissions list so dogfood events load a real table within 5s (S-SUB-LIST).

Use domain commands from COMMANDS.md / existing modules only. Wire into composition roots; no parallel app. Zero new runtime deps for UI.

## Files to Create

- `playwright/e2e/submissions_list_reliability.spec.ts`
- `apps/api/src/modules/decisions/list.test.ts`

## Files to Modify

- `apps/api/src/modules/decisions/**`
- `apps/web/src/pages/Submissions.tsx`
- `packages/shared/**`
- `KMS-competition/initiative/BROWSER_E2E_INVENTORY.md`

## Scope Guard

- No other section features
- No Next/RSC, OR-Tools, Temporal, dual-write Airtable, agent fleet UI, embeds, gallery CMS
- No secrets committed
- No sbek harness modifications

## Implementation Steps

- [ ] Reproduce Loading hang with 150-row fixture
- [ ] Fix schema mismatch or payload size root cause
- [ ] Add pagination or safe windowing if needed
- [ ] SPA: clear loading/error/empty states
- [ ] e2e + unit
- [ ] **Tests:** implement named tests from spec; negatives included
- [ ] **Verification:** `pnpm typecheck` && `pnpm test:ci` (and e2e if UI); update inventory if new REQUIRED controls
- [ ] Completion gate: every AC measurable green; no stubs; no TODO in shipped paths

## Completion Gate Checklist

- [ ] All AC pass with evidence
- [ ] No undefined Lumen tokens introduced
- [ ] Inventory tags updated if new UI controls
- [ ] Rollback notes still valid

## Per-AC completion (must tick)

- [ ] AC-10.1-A timing + ≥150 fixture rows
- [ ] AC-10.1-B error recovery
- [ ] AC-10.1-C unauth negative
- [ ] AC-10.1-D cross-event negative
- [ ] AC-10.1-E pagination contract if used
- [ ] @inv E01 + L05 still PASS (regression)
- [ ] `pnpm test:e2e:inventory` green
