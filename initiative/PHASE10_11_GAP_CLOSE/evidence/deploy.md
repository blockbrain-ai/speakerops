# Section 11.9 — Dogfood deploy evidence (S-DOGFOOD)

| Field | Value |
|-------|-------|
| **Status** | DONE_WITH_EVIDENCE |
| **Timestamp (UTC)** | 2026-08-12T06:30:39Z |
| **Git SHA (short)** | `01c45b0d0` |
| **Git SHA (full)** | `01c45b0d0c623d2a14b8b15783f83f26c2511e40` |
| **App version** | `0.1.0-demo+01c45b0d0` |
| **Worker name** | `speakerops-demo` |
| **Wrangler env** | `dogfood` |
| **Binding URL** | https://www.speakerops.org |
| **GET /health** | 200 |
| **Health body** | {"ok":true,"version":"0.1.0-demo+01c45b0d0"} |
| **Smoke base (recorded)** | https://www.speakerops.org |

## Claim

S-DOGFOOD: deploy healthy at **https://www.speakerops.org** only; revision + timestamp recorded;
keystone e2e non-skipped for all **18** constitution soul IDs (see `SOUL_EVIDENCE_TABLE.md`).

## Reproduce

```bash
scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
# Health-only:
SMOKE_BASE_URL=https://www.speakerops.org DOGFOOD_SKIP_DEPLOY=1 \
  scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
```

## Notes

Live dogfood smoke succeeded. S-CF / S-DOGFOOD / BC10 / BC-16 health 200 recorded.
Deploy revision: 01c45b0d0 · APP_VERSION: 0.1.0-demo+01c45b0d0
Binding URL: https://www.speakerops.org
Next: scripts/with-secrets.sh pnpm test:e2e:phase11-keystone

## Related evidence

| Artifact | Path |
|----------|------|
| BC10 / S-CF | `KMS-competition/initiative/evidence/cf-dogfood.txt` |
| Soul table | `initiative/PHASE10_11_GAP_CLOSE/evidence/SOUL_EVIDENCE_TABLE.md` |
| Keystone | `playwright/e2e/phase11_handover_keystone.spec.ts` |
| Handover | `initiative/PHASE10_11_GAP_CLOSE/evidence/PRODUCTION_HANDOVER_WAVE.md` |

Secrets: never commit CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID values (E10).
