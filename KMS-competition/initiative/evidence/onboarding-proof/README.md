# Onboarding proof keystone — evidence bundle (section 9.6)

**Section:** 9.6 Onboarding proof keystone  
**Workspace:** speakerops-build  
**Date (UTC):** 2026-08-09T01:14:25Z  
**Git SHA (at authoring):** 2a7719c  
**Claim surface:** S-ONB-HUMAN · S-ONB-AGENT · S-DOCS · S-CF (consume)  
**BUILD_CHECKLIST:** BC13 · BC14 · BC15 (plus BC10 S-CF prerequisite)

> Bounded evidence for programme onboarding exit. **No infinite simulation.**  
> Clean-room dry-runs follow only published docs (no tribal steps).  
> Secret **values** never appear here — env **names** and redaction only (E10).

---

## Bundle inventory (complete when every row present)

| File | Role |
|------|------|
| **README.md** (this file) | Evidence **checklist** + BC13–15 DONE paths schema + CF gate |
| [human-dry-run.txt](./human-dry-run.txt) | **BC13** / **S-ONB-HUMAN** dry-run log |
| [agent-dry-run.txt](./agent-dry-run.txt) | **BC14** / **S-ONB-AGENT** dry-run log |
| [linkcheck.txt](./linkcheck.txt) | **linkcheck 0** broken internal links (docs tree + README) |
| [docs-reports.txt](./docs-reports.txt) | **BC15** / **S-DOCS** reports portal existence proof |
| [cf-status.txt](./cf-status.txt) | **S-CF** / BC10 evidence pointer **or** DEFER row |

Checker (non-interactive):

```bash
pnpm check:onboarding-proof
# equivalent:
pnpm exec tsx scripts/check-onboarding-proof.ts
```

Exit codes: **0** complete + claim-safe · **1** incomplete / schema / linkcheck · **2** claim without CF evidence or DEFER.

---

## BC13–15 DONE paths (schema)

Each row must be `DONE_WITH_EVIDENCE` (or `OWNER_AMEND` with recorded owner note). Paths are relative to workspace root unless noted.

| BC | Soul | Status | Source path(s) | Evidence path (this bundle) | done_when |
|----|------|--------|----------------|------------------------------|-----------|
| **BC13** | **S-ONB-HUMAN** | **DONE_WITH_EVIDENCE** | `docs/ONBOARDING.md` · `reports/onboarding.html` | `initiative/evidence/onboarding-proof/human-dry-run.txt` | Onboarding doc walkthrough — zero → migrate → seed → first-login notes → demo path checkpoints; no tribal steps; timed bounds |
| **BC14** | **S-ONB-AGENT** | **DONE_WITH_EVIDENCE** | `docs/AGENT_SETUP.md` · `docs/CLI.md` · OpenAPI `GET /openapi.json` | `initiative/evidence/onboarding-proof/agent-dry-run.txt` | Agent setup path — scoped key model · readiness · design publish · deny-scope proof · redacted transcript |
| **BC15** | **S-DOCS** | **DONE_WITH_EVIDENCE** | `reports/index.html` · `reports/*.html` · `docs/**` tree | `initiative/evidence/onboarding-proof/docs-reports.txt` · `linkcheck.txt` | HTML reports + coherent tree; portal links report set; **linkcheck 0** |

Canonical checklist table also lives in `KMS-competition/initiative/BUILD_CHECKLIST.md` (updated by this section).

### Path schema rules (machine-checked)

1. Checklist file **exists** at `KMS-competition/initiative/evidence/onboarding-proof/README.md` (this file).
2. Table header contains columns: `BC`, `Soul`, `Status`, `Source path`, `Evidence path` (or `Evidence path (this bundle)`).
3. Rows **BC13**, **BC14**, **BC15** each appear with soul refs **S-ONB-HUMAN**, **S-ONB-AGENT**, **S-DOCS**.
4. Each BC row status is `DONE_WITH_EVIDENCE` or `OWNER_AMEND`.
5. Evidence path files named in the table exist under this directory.
6. Source paths named for each BC exist at workspace root (`docs/ONBOARDING.md`, `docs/AGENT_SETUP.md`, `reports/index.html`, …).

---

## S-CF / BC10 gate (claim without CF is rejected)

Programme exit and `CLAIM_PROVEN` **must not** rest on BC13–15 alone while **S-CF** remains unproven.

| Field | Value |
|-------|--------|
| Soul | **S-CF** |
| BUILD_CHECKLIST | **BC10** |
| Required | CF dogfood evidence file **or** explicit **DEFER** / **OWNER_AMEND** row |
| Evidence (this programme) | `KMS-competition/initiative/evidence/cf-dogfood.txt` → **DONE_WITH_EVIDENCE** |
| Bundle pointer | [cf-status.txt](./cf-status.txt) |

**Reject rule:** any claim text matching `CLAIM_PROVEN` / `programme_exit=true` / `dogfood_ready` **without** either:

1. readable `cf-dogfood.txt` containing `DONE_WITH_EVIDENCE` (or health 200 + redaction rules), **or**
2. an explicit **DEFER** / **OWNER_AMEND** row for **S-CF** / **BC10** in this checklist or `cf-status.txt`

…is **rejected** by `scripts/check-onboarding-proof.ts` (exit **2**).

Current programme stance: **CF evidence present** (not DEFER). See [cf-status.txt](./cf-status.txt).

---

## No tribal steps (binding)

Dry-run logs prove operators and agents used **only**:

- `docs/ONBOARDING.md` (human)
- `docs/AGENT_SETUP.md` + `docs/CLI.md` + OpenAPI + CLI `--help` (agent)
- Linked deep docs (`OPERATIONS`, `SECRETS`, `E2E`, …) when the primary doc points there
- Workspace gates: `pnpm typecheck`, `pnpm test:ci`, `pnpm docs:reports`, `pnpm check:onboarding-proof`

Forbidden as proof: “ask the last engineer”, private wikis, undocumented env hacks, inventing endpoints or seed IDs not in docs.

---

## Linkcheck 0

| Metric | Value |
|--------|--------|
| Scope | `README.md` + all `docs/**/*.md` internal markdown links |
| Broken internal links | **0** |
| Evidence | [linkcheck.txt](./linkcheck.txt) |
| Regenerator | `pnpm check:onboarding-proof` (writes/validates) |

---

## Reports exist (S-DOCS)

| Path | Required |
|------|----------|
| `reports/index.html` | **yes** (portal) |
| `reports/onboarding.html` | yes |
| `reports/agent-setup.html` | yes |
| `reports/architecture.html` | yes |
| `reports/cli-reference.html` | yes |
| `reports/design-lumen.html` | yes |
| `reports/e2e-coverage.html` | yes (8.5 / 9.5) |

Detail: [docs-reports.txt](./docs-reports.txt). Generate: `pnpm docs:reports`.

---

## Bounds of this proof (not infinite simulation)

| Bound | Choice |
|-------|--------|
| Mode | **Documented bounded dry-run** against this workspace + published docs (0.5 outline permits simulation with explicit bounds) |
| Human path | Checkpoints for ONBOARDING steps 1–15; local gates executed; live Cloudflare deploy **not** re-run (BC10 already DONE_WITH_EVIDENCE) |
| Agent path | CLI help + deny-scope contract from docs; readiness/design publish command shapes recorded; full Worker session uses out-of-band key inject (no secret values logged) |
| Duration | Human local zero→demo target **&lt;90m** (ONBOARDING); this keystone records checkpoints, not a wall-clock stopwatch |
| Independence | Evidence is machine-checkable (files + checker); no author-only memory |

---

## Security (E10)

- No API keys, magic-link tokens, JWTs, or `CLOUDFLARE_*` **values**
- Redaction markers: `[REDACTED_KEY]`, `***`, `[REDACTED_ACCOUNT_ID]`
- Env **names** only: `SPEAKEROPS_API_KEY`, `CLOUDFLARE_API_TOKEN`, `SMOKE_BASE_URL`, …

---

## Reproduce

```bash
pnpm typecheck
pnpm test:ci
pnpm docs:reports
pnpm check:onboarding-proof
```

Section note: `docs/sections/9.6-onboarding-proof.md`  
Named tests: `tests/9.6-onboarding-proof.test.ts` · `tests/governance/9.6-onboarding-proof.test.mjs`
