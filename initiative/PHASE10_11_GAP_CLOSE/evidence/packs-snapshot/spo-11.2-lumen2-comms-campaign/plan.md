# Plan 11.2 — Communications campaign workflow + scale

> Source: SpeakerOps Phase 10–11 | Standards: See speakerops-engineering-standards.md (E1-E12)
>
> Constitution: initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md

## Test & Cleanup Policy

- `pnpm typecheck` · `pnpm test:ci` · UI/keystone also `pnpm test:e2e` / `pnpm test:e2e:inventory`
- Worktree-local cleanup only

## Architecture Overview

Recompose Comms.tsx to four-step campaign flow operable at 150 speakers.

Use domain commands from COMMANDS.md / existing modules only. Wire into composition roots; no parallel app. Zero new runtime deps for UI.

## Files to Create

- `playwright/e2e/comms_lumen2.spec.ts`

## Files to Modify

- `apps/web/src/pages/Comms.tsx`
- `apps/web/src/pages/comms-utils.ts`
- `apps/web/src/styles/shell.css`

## Scope Guard

- No other section features
- No Next/RSC, OR-Tools, Temporal, dual-write Airtable, agent fleet UI, embeds, gallery CMS
- No secrets committed
- No sbek harness modifications

## Implementation Steps

- [ ] Step shell
- [ ] Audience virtualization
- [ ] Wire existing APIs
- [ ] e2e
- [ ] **Tests:** implement named tests from spec; negatives included
- [ ] **Verification:** `pnpm typecheck` && `pnpm test:ci` (and e2e if UI); update inventory if new REQUIRED controls
- [ ] Completion gate: every AC measurable green; no stubs; no TODO in shipped paths

## Completion Gate Checklist

- [ ] All AC pass with evidence
- [ ] No undefined Lumen tokens introduced
- [ ] Inventory tags updated if new UI controls
- [ ] Rollback notes still valid

## Per-AC completion (must tick)

- [ ] J01–J10 regression green (`comms_keystone.spec.ts`)
- [ ] AC-11.2-SCALE 150 audience
- [ ] AC-11.2-SEL selection/filter
- [ ] AC-11.2-SEND preview + idempotent
- [ ] AC-11.2-AUTHZ 403
- [ ] AC-11.2-UI four steps + 11.0 primitives
- [ ] `pnpm test:e2e` + `pnpm test:e2e:inventory`
