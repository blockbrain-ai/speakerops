# Finish-line plan — SpeakerOps (synthesis + execution)

**Live tip at start of finish wave:** `a3a08244b`  
**Owner mandate:** complete full plan, no shortcuts; auditor-agreed e2e including browser + console; fix Find, light N1/N2, Speakers readiness crowding, Assign evaluators UX; every page/menu vs Lumen standard.

## Independent audit status

| Seat | Status |
|------|--------|
| Codex Sol xhigh | Running → `finish-line-codex-verdict.txt` |
| Grok (coordinator) | In-progress code + live inspection |
| Synthesis | This document; update after Codex lands |

## Confirmed defects (pre-Codex)

1. **Find e2e gap** — no dedicated browser inventory for ⌘K (F5 closeout residual). Lazy reindex exists but UX had no manual rebuild; empty-event messaging weak.
2. **Speakers readiness column** — full dimension labels in table cells → wrap/crowd. **Fix:** compact `n/5` + letter dots (A/C/P/T/S), full labels aria/title only.
3. **Assign evaluators** — bare checkbox list without card spacing/scroll. **Fix:** card container, scrollable list, hover/focus rows, clearer actions row.
4. **Portal forms / Resources / File requests** — functional CRUD but thin empty states and unclear CX. **Fix:** purpose copy + starter seed/prefill CTAs.
5. **Plan residuals** — N5 Accelevents (creds), Learn C2.5 source+build, social links, sandboxed HTML embeds, golden baton depth.

## Execution waves (no shortcuts)

### Wave A — UX + Find (this commit series)
- [x] Speakers readiness compact
- [x] Assign evaluator layout CSS
- [x] Find rebuild index + empty/event messaging
- [x] Portal forms / resources empty CX
- [ ] Find Playwright e2e + console error capture
- [ ] Gates: typecheck, test:ci, CI=1 e2e, phase8
- [ ] Deploy dogfood

### Wave B — Codex fold
- Absorb MUST_FIX from finish-line Codex
- Re-run e2e including Find
- Re-audit if MUST_FIX was non-trivial

### Wave C — Surface completeness
- Nav leaf walk: every admin item opens a premium page (not stub wall)
- Portal surfaces for published resources/forms (speaker-visible)
- Demo seed snippets for N1/N2/N3 in `pnpm seed` if feasible

### Wave D — Docs / Learn / submission package
- C2.5 Learn accuracy pass or explicit residual + judge note
- SUBMISSION_READINESS final
- Publication-transition note for public repo

## Gates (built-in every wave)

```bash
pnpm --filter @speakerops/shared build
pnpm typecheck
pnpm test:ci
CI=1 pnpm test:e2e
E2E_INVENTORY_GATE=phase8 pnpm test:e2e:inventory
# Deploy only when gates green
VITE_ROLE_SWITCHER=1 scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
```

## E2E agreement (proposed with auditors)

| Area | Spec | Console |
|------|------|---------|
| Find | open palette, reindex, query, no error state on valid session | no pageerror |
| Speakers | readiness cell shows score testid; not full label pile | clean |
| Assign | picker visible with option list when evaluators exist | clean |
| Nav leaves | each primary nav testid routes to page testid | clean |
| Golden baton | continuity + operator surfaces | clean |

## Done when

- Live SHA has Wave A–C (or B–C if A already live)
- Codex finish-line verdict PASS or PASS_WITH_NITS only
- Find works for judge with event selected + reindex
- Speakers/assign visual issues resolved
- N1/N2 CX documented and seeded path obvious
- Known residual list only external/creds items
EOF
