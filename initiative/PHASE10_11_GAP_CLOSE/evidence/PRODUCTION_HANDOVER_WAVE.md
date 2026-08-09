# Production handover wave appendix — Phase 10–11 (section 11.9)

**Wave:** Product reliability (Phase 10) + Lumen 2 parity (Phase 11)  
**Exit claim:** **`dogfood_ready`**  
**Binding dogfood URL:** https://www.speakerops.org  
**Date (UTC):** 2026-08-09  
**Section:** 11.9 · `spo-11.9-lumen2-dogfood-handover-keystone`

This appendix closes the Phase 10–11 FULL wave for owner G7. It does **not** authorize production multi-tenant cutover or AIE live-event migration.

---

## 1. What shipped this wave

| Track | Sections | Outcome |
|-------|----------|---------|
| Product reliability | 10.1–10.7 | Submissions scale, eval rollup, DEMO CFP, closed window, role sessions, draft save, schedule chrome, eval export — F at 10.7, **D at 11.9** |
| Lumen 2 parity | 11.0–11.8 | Tokens/primitives, shell/overview, comms campaign, CFP builder+public, submissions, schedule studio, portal, settings/a11y, taste ≥8.0 |
| Dogfood + handover | **11.9** | Deploy to www.speakerops.org · 18-soul D keystone · soul table · this brief |

---

## 2. Dogfood deploy (S-DOGFOOD)

| Field | Value |
|-------|-------|
| URL | **https://www.speakerops.org** |
| Worker | `speakerops-demo` |
| Wrangler env | `dogfood` (`wrangler.toml`) |
| SPA | Workers Assets from `apps/web/dist` |
| D1 | `speakerops-demo` |
| DEMO | `DEMO_MODE=1` + host allowlist (www.speakerops.org, …) |
| Health | **200** · version `0.1.0-demo+…` |
| Evidence | `evidence/deploy.md` · BC10 `KMS-competition/initiative/evidence/cf-dogfood.txt` |

### Operator deploy

```bash
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
# Health-only re-smoke:
SMOKE_BASE_URL=https://www.speakerops.org DOGFOOD_SKIP_DEPLOY=1 \
  scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
```

Env **names** only: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (values via secrets.env / with-secrets).

---

## 3. Soul proof summary

All **18** constitution soul IDs D-proven non-skipped against www.speakerops.org:

`S-SUB-LIST` · `S-EVAL-UI` · `S-CFP-SUBMIT` · `S-CFP-CLOSED` · `S-AUTH-ROLES` · `S-CFP-DRAFT` · `S-SCHED-CHROME` · `S-EVAL-EXPORT` · `S-L2-SYSTEM` · `S-L2-SHELL` · `S-L2-COMMS` · `S-L2-CFP` · `S-L2-SUB` · `S-L2-SCHED` · `S-L2-PORTAL` · `S-L2-A11Y` · `S-L2-SCORE` · `S-DOGFOOD`

Full matrix: **`evidence/SOUL_EVIDENCE_TABLE.md`**.

Keystone: `playwright/e2e/phase11_handover_keystone.spec.ts`  
Run: `scripts/with-secrets.sh pnpm test:e2e:phase11-keystone`  
Report hash: `evidence/phase11-keystone-run.SHA256`

Taste score: **8.3 / 10** (`docs/audits/LUMEN2_TASTE_SCORE.md`) · screenshots `docs/audits/visual-lumen2/`.

---

## 4. Handover checklist (wave)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Dogfood health 200 on www.speakerops.org | **PASS** | `deploy.md` |
| 2 | Deploy revision recorded | **PASS** | `deploy.md` |
| 3 | All 18 souls D keystone green | **PASS** | `SOUL_EVIDENCE_TABLE.md` · keystone report |
| 4 | Inventory anti-shrinkage | **PASS** | `pnpm test:e2e:inventory` |
| 5 | No new runtime UI packages | **PASS** | package.json (zero unapproved deps) |
| 6 | Secrets not in git | **PASS** | E10 names-only |
| 7 | Rollback path documented | **PASS** | §5 below |
| 8 | Phase 9 onboarding docs still valid | **PASS** | `docs/ONBOARDING.md` · `docs/OPERATIONS.md` |
| 9 | Adversarial must-not (unauth / closed CFP) | **PASS** | keystone negatives |

---

## 5. Rollback / containment

1. **Code:** revert section 11.9 (and prior section) commits on the workspace branch.  
2. **Dogfood Worker:** redeploy previous worker version via Cloudflare dashboard or prior git SHA:
   ```bash
   git checkout <prior-sha>
   scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
   ```
3. **Data:** D1 Time Travel for mistaken writes (see `docs/OPERATIONS.md`).  
4. **Auth:** demo session mints are short-lived; disable any temporary ops flags; secrets remain out of band.  
5. **Containment:** feature remains behind Worker authz; public CFP DEMO token is host-allowlisted only.

---

## 6. Known residuals (non-blocking for dogfood_ready)

- R2 not enabled on dogfood account → FILES binding omitted; design logo bytes use isolate fallback.  
- Settings secondary surfaces remain functional but less deep restyle than primary six.  
- Production multi-tenant cutover **out of scope**.  
- sbek harness scores are **not** product souls (H/C classification).

---

## 7. Owner next steps (post-G7)

1. Review `SOUL_EVIDENCE_TABLE.md` + live walk of www.speakerops.org.  
2. Sign G7 if all rows PASS.  
3. Optional: enable R2 + `FILES` binding when account permits.  
4. Optional: production cutover is a **separate** authority (not this wave).

---

## 8. Related paths

| Artifact | Path |
|----------|------|
| Constitution | `initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md` |
| BUILD_CHECKLIST | `initiative/PHASE10_11_GAP_CLOSE/BUILD_CHECKLIST.md` |
| Deploy evidence | `initiative/PHASE10_11_GAP_CLOSE/evidence/deploy.md` |
| Soul table | `initiative/PHASE10_11_GAP_CLOSE/evidence/SOUL_EVIDENCE_TABLE.md` |
| Master handover (programme) | `KMS-competition/initiative/PRODUCTION_HANDOVER_CHECKLIST.md` |
| Operations | `docs/OPERATIONS.md` |
| Design pack (box) | `initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/` |
