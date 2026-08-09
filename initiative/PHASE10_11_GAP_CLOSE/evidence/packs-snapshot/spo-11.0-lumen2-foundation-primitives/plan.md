# Plan 11.0 — Lumen 2 tokens + shared primitives

> Source: SpeakerOps Phase 10–11 | Standards: See speakerops-engineering-standards.md (E1-E12)
>
> Constitution: initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md

## Test & Cleanup Policy

- `pnpm typecheck` · `pnpm test:ci` · UI/keystone also `pnpm test:e2e` / `pnpm test:e2e:inventory`
- Worktree-local cleanup only

## Architecture Overview

Extend lumen.css + components/ui/* with Lumen 2 primitives and state anatomy.

Use domain commands from COMMANDS.md / existing modules only. Wire into composition roots; no parallel app. Zero new runtime deps for UI.

## Files to Create

- `playwright/e2e/lumen2_state_sheet.spec.ts`
- `apps/web/src/components/ui/**`

- `apps/web/src/components/ui/**`
- `apps/web/src/styles/components.css`

## Files to Modify

- `apps/web/src/styles/lumen.css`
- `apps/web/src/styles/shell.css`
- `apps/web/package.json`

## Scope Guard

- No other section features
- No Next/RSC, OR-Tools, Temporal, dual-write Airtable, agent fleet UI, embeds, gallery CMS
- No secrets committed
- No sbek harness modifications

## Implementation Steps

- [ ] Map pack tokens into lumen.css
- [ ] Build Icon + primitives
- [ ] State sheet
- [ ] Lint tokens
- [ ] Tests
- [ ] **Tests:** implement named tests from spec; negatives included
- [ ] **Verification:** `pnpm typecheck` && `pnpm test:ci` (and e2e if UI); update inventory if new REQUIRED controls
- [ ] Completion gate: every AC measurable green; no stubs; no TODO in shipped paths

## Completion Gate Checklist

- [ ] All AC pass with evidence
- [ ] No undefined Lumen tokens introduced
- [ ] Inventory tags updated if new UI controls
- [ ] Rollback notes still valid

## Per-AC completion
- [ ] AC-11.0-A primitives
- [ ] AC-11.0-B tokens
- [ ] AC-11.0-C l2-state-sheet
- [ ] AC-11.0-D @inv:L2-01 e2e
- [ ] AC-11.0-E lockfile
