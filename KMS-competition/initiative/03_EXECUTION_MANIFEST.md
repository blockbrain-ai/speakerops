# Execution manifest — SpeakerOps (DRAFT — unfrozen)

**Status:** DRAFT — not authorized to execute  
**Date:** 2026-08-08  
**Claimed completion state on success:** `dogfood_ready`

---

## Programme identity

| Field | Value |
|-------|-------|
| Product | SpeakerOps (Kill My SaaS / Sessionboard Program) |
| Initiative | `/Users/qualitycontrol/Documents/KMS-competition/initiative/` |
| Control-plane packs | `/Users/qualitycontrol/Documents/nood-factory/plans/runs/speakerops/` |
| Product workspace (to create on execute) | TBD box path e.g. `/data/speakerops-build` (owner confirms) |
| Remote host | `made-pilot` (Section Runner SaaS) |
| Proposed RUNS_DIR | `/data/ClawdSpeakerOpsRuns` or owner-chosen absolute path |
| RUN_DIR_PREFIX | `spo` |
| ENV group | `.env.speakerops` (to author names-only at execute prep) |

## Section range

**Proposed SECTION_ORDER:** see `plans/runs/speakerops/SECTION_ORDER.proposed.txt` (50 sections: 0.1–9.6 + 8.6).

Phases:
0 Governance → 1 Foundation → 2 Auth/Design → 3 CFP/Eval → 4 Portal → 5 Comms → 6 Schedule/Dash → 7 CLI/Airtable → 8 Full browser E2E + CF dogfood → **9 Onboarding & docs (FINAL)**

## Model roles (estate default)

| Role | Provider | Model |
|------|----------|-------|
| BUILD_PROVIDER | grok | grok-4.5 |
| SECTION_AUDIT_ENABLED | false | — |
| PHASE_AUDIT_ENABLED | true | — |
| FINAL_AUDIT_PROVIDER | codex | gpt-5.6-sol xhigh |
| AUDIT_PROVIDER | codex | gpt-5.6-sol (explicit) |
| MAX_FINAL_AUDIT_ITERATIONS | 8 | |
| REQUIRE_INDEPENDENT_FINAL_AUDITOR | true | |

## Gates (post-1.1)

| Gate | Command |
|------|---------|
| Typecheck | `pnpm typecheck` |
| Unit/integration | `pnpm test:ci` |
| Browser E2E | `pnpm test:e2e` |
| Inventory lint | `pnpm test:e2e:inventory` |
| Docs reports | `pnpm docs:reports` (Phase 9) |
| Full CI | typecheck + test:ci + test:e2e + inventory |

## Credentials channel (names only — values never in git)

| Name | Purpose |
|------|---------|
| Cloudflare account / wrangler auth | S-CF dogfood deploy (8.6) |
| `AIRTABLE_API_KEY` / base id | Projection (optional until configured) |
| `RESEND_API_KEY` or email provider | Comms sandbox/live |
| Turnstile site/secret | Public CFP |
| `XAI_API_KEY` / subscription | Builder on box |
| Codex auth | Phase auditor |

Owner provides secrets via approved inject path at **live/execute** time — not in this manifest.

## Side effects if executed

- Creates product repo workspace and commits on feature branch (not main unless allowed)
- May deploy private CF preview (8.6) when credentials present
- May create Airtable base projection tables when configured
- Does **not** merge to main, push public, or production-cutover AIE without separate go

## Rollback

- Revert SECTION_ORDER append
- Restore env backup
- Delete CF preview if created
- Product branch reset to baseline SHA

## Adversarial status before go

| Review | Verdict | Folded? |
|--------|---------|---------|
| Design Claude | AGREE_WITH_NOTES | YES → Lumen + inventory |
| Design Codex | REVISE | YES → contrast, IA, schedule, inventory |
| Pack Claude | ADEQUATE_WITH_NOTES | Partial → 8.6 CF, REQUIRED, deepen keystones |
| Pack Codex | INADEQUATE (thin templates) | Partial → critical specs deepened; **remaining thin packs need wave-2 deepen before or during early execute** |

**Honest gate:** Structural validator **PASS (312 checks)**. Semantic density still uneven; keystones and final phase strengthened. Owner may:
1. Authorize **execute from 0.1** with acceptance that mid-phase REVISE loops will deepen remaining templates, or  
2. Request **wave-2 pack deepen** for all UI sections before kick.

## Owner go checklist

- [ ] Lock constitution (change Status to LOCKED)
- [ ] Confirm workspace path + RUNS_DIR + .env.speakerops group
- [ ] Choose: execute now vs deepen packs first
- [ ] Confirm CF credentials available for 8.6
- [ ] Explicit: “go execute manifest SpeakerOps dated …”

---

**NOT authorized:** sync, SECTION_ORDER mutate, build kick, deploy — until frozen go.
