# Full product dual-audit close-out (2026-08-12)

**Live tip after fold:** see deploy health after this commit  
**Prior tip audited:** `e0c024baf`

## Dual-auditor results

| Seat | Verdict | MUST_FIX |
|------|---------|----------|
| **Security** | **PASS_WITH_NITS** | *(empty)* |
| **Product** (initial) | **MUST_FIX** | Learn CLI lies; Q01 empty-hits false green |
| **Product** (after fold) | **PASS_WITH_NITS** | *(empty after residual Bearer templates + members list scopes)* |

Cloudflare email quota: **ignored** (owner).  
SmolForge: **deferred** (owner).

## Product MUST_FIX fold

| ID | Fix |
|----|-----|
| Learn invents `schedule list/unschedule`, `comms templates` | **CLI implements** those verbs + Learn rebuilt from source |
| Q01 false green | Assert API hits length > 0 **and** UI `find-hit-*` visible |
| CLI members:write | `members list/invite/set-role` + API scope `members:write` + bearer on invite/PATCH |
| Learn dist-only | **Source generator:** `apps/learn/src/{nav.json,content/*.json}` + `pnpm build:learn` + `check:learn-cli` |
| Schedule Learn underclaim | DnD section added in schedule guide |
| R2 report stale | Status updated to shipped |

## Security SHOULD folded (cheap)

- setMemberRole route validates role enum  
- Login `returnFrom` rejects `//` protocol-relative  
- Magic-link JSDoc aligned with A4  

Remaining security SHOULD (not blockers): isolate rate limits, upload Content-Length, virus scan residual, key entropy.

## Gates

```bash
pnpm --filter @speakerops/shared build
pnpm typecheck
pnpm test:ci   # includes search FTS harness + learn CLI parity
# e2e: Q01, Q08, schedule DnD, members CLI unit
pnpm build:learn && pnpm check:learn-cli
pnpm deploy:learn
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
```

## Residual accepted

| Item | Why accepted |
|------|----------------|
| SmolForge | Owner deferred |
| Email 200/day | Owner ignore |
| Multi-isolate rate limits | Documented SHOULD; not IDOR |
| Virus scan stub | Documented residual |
