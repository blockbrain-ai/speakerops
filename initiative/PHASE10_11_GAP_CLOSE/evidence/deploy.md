# Section 11.9 — Dogfood deploy evidence (S-DOGFOOD)

| Field | Value |
|-------|-------|
| **Status** | DONE_WITH_EVIDENCE |
| **Timestamp (UTC)** | 2026-08-10T04:41:19Z |
| **Git SHA (short)** | `2f2697565` |
| **Git SHA (full)** | `2f2697565adcc28276a6963c22ca9cb94d1e626d` |
| **App version** | `0.1.0-demo+2f2697565` |
| **Worker name** | `speakerops-demo` |
| **Wrangler env** | `dogfood` |
| **Binding URL** | https://www.speakerops.org |
| **GET /health** | 200 |
| **Health body** | {"ok":true,"version":"0.1.0-demo+2f2697565"} |
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
Deploy revision: 2f2697565 · APP_VERSION: 0.1.0-demo+2f2697565
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
