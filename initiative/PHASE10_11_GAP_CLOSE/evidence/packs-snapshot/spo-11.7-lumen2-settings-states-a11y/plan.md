# Plan 11.7 — Settings surfaces + global states + a11y

> Source: SpeakerOps Phase 10–11 | Standards: See speakerops-engineering-standards.md (E1-E12)
>
> Constitution: initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md

## Test & Cleanup Policy

- `pnpm typecheck` · `pnpm test:ci` · UI/keystone also `pnpm test:e2e` / `pnpm test:e2e:inventory`
- Worktree-local cleanup only

## Architecture Overview

Settings/DesignKit/ApiKeys polish + cross-cutting state components + a11y gates.

Use domain commands from COMMANDS.md / existing modules only. Wire into composition roots; no parallel app. Zero new runtime deps for UI.

## Files to Create

- `playwright/e2e/session_states_a11y.spec.ts`
- `docs/audits/LUMEN2_QA_EVIDENCE.md`

## Files to Modify

- `apps/web/src/pages/EventSettings.tsx`
- `apps/web/src/pages/DesignKit.tsx`
- `apps/web/src/pages/ApiKeys.tsx`
- `apps/web/src/pages/Login.tsx`
- `apps/web/src/components/ui/**`

## Scope Guard

- No other section features
- No Next/RSC, OR-Tools, Temporal, dual-write Airtable, agent fleet UI, embeds, gallery CMS
- No secrets committed
- No sbek harness modifications

## Implementation Steps

- [ ] Settings shell
- [ ] State components
- [ ] A11y pass
- [ ] Evidence doc
- [ ] **Tests:** implement named tests from spec; negatives included
- [ ] **Verification:** `pnpm typecheck` && `pnpm test:ci` (and e2e if UI); update inventory if new REQUIRED controls
- [ ] Completion gate: every AC measurable green; no stubs; no TODO in shipped paths

## Completion Gate Checklist

- [ ] All AC pass with evidence
- [ ] No undefined Lumen tokens introduced
- [ ] Inventory tags updated if new UI controls
- [ ] Rollback notes still valid
