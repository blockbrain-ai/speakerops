# Section 11.9 — Dogfood deploy evidence (S-DOGFOOD)

| Field | Value |
|-------|-------|
| **Status** | DONE_WITH_EVIDENCE |
| **Timestamp (UTC)** | 2026-08-10T03:58:44Z |
| **Git SHA (short)** | `e3fbca7b3` |
| **Git SHA (full)** | `e3fbca7b378b73cf94b6d851e7484ba1d3f9de9c` |
| **App version** | `0.1.0-demo+e3fbca7b3` |
| **Worker name** | `speakerops-demo` |
| **Wrangler env** | `dogfood` |
| **Binding URL** | https://www.speakerops.org |
| **GET /health** | 200 |
| **Health body** | {"ok":true,"version":"0.1.0-demo+e3fbca7b3"} |
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
Deploy revision: e3fbca7b3 · APP_VERSION: 0.1.0-demo+e3fbca7b3
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
