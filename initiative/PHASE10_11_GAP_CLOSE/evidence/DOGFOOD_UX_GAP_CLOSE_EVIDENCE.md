# Dogfood UX gap-close — evidence

**Date (UTC):** 2026-08-10  
**Branch tip (this close):** see git after commit (tip `bf4cb4941`)  
**Binding URL:** https://www.speakerops.org  

## Before (owner walk / live repro)

| Surface | Measurement |
|---------|-------------|
| `GET /api/events/evt_dogfood/readiness` | **~47s**, ~93KB, 290 outstanding rows (N+1 person enrich) |
| Overview SPA | Stuck on “Loading readiness…” |
| Schedule list session titles | Looked like links; no day focus |
| Evaluations rows | No submission deep-link |
| Console | CSP blocked `static.cloudflareinsights.com/beacon.min.js` |

## After (live dogfood post-deploy)

| Check | Result |
|-------|--------|
| `GET /health` | 200 `{"ok":true,"version":"0.1.0-demo+bf4cb4941"}` (deploy SHA; final tip may bump) |
| Readiness timing (3 samples, admin session) | **784ms / 714ms / 686ms** (p95 ≪ 8s DoD) |
| Payload | `outstandingTasks=290`, `outstanding.length=50`, `outstandingTotal=290`, `outstandingListCap=50`, `outstandingTruncated=true`, `totalSpeakers=150` |
| Response size | ~16KB (was ~93KB) |
| CSP meta + `/health` header | includes `static.cloudflareinsights.com` + `cloudflareinsights.com` |
| Event window | `starts_at=2026-09-15…` `ends_at=2026-09-17…` (not inverted) |

## Code / test proof

| Artifact | Result |
|----------|--------|
| `pnpm typecheck` | pass |
| `vitest` readiness + security | pass (incl. list cap + CSP insights assertions) |
| `playwright/e2e/dogfood_full_workflow.spec.ts` | **1 passed** — admin Overview ≤8s, submissions, eval deep-link, schedule list→day, speakers/comms/settings, evaluator queue, speaker portal; no pageerror |

## Fixes landed

1. **Readiness:** batch `listPersonsByIds`; cap outstanding list at 50; return truncation metadata; SPA 8s AbortController + truncated banner  
2. **Schedule:** list/conflict selection sets focused day + day view  
3. **Evaluations:** rollup title → `/admin/submissions?submissionId=`  
4. **CSP:** allow Cloudflare Web Analytics beacon hosts  
5. **E2E:** multi-role workflow suite (no inventory `@inv` ownership change)

## Deploy

```bash
# Mac local secrets path
set -a; source ~/.config/speakerops/secrets.env; set +a
unset SPEAKEROPS_D1_DATABASE_ID   # optional; dogfood D1 id already in wrangler.toml
DOGFOOD_SKIP_WEB_BUILD=0 bash scripts/deploy-dogfood.sh
```

Smoke: health 200 · readiness p95 < 8s · CSP insights allowed.

## Definition of done

- [x] Overview readiness on dogfood within 8s p95 (~0.7s measured)
- [x] Schedule list session click focuses day placement
- [x] Evaluations row reaches submission detail path
- [x] CSP no longer blocks CF insights beacon
- [x] Multi-role dogfood workflow suite PASS, no pageerror
- [x] Committed + pushed to `origin/section-runner/speakerops`
