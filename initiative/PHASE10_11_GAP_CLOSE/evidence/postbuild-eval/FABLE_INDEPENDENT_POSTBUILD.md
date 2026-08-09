# Independent post-build evaluation — Claude Fable

**Role:** independent adversarial critic (Claude Fable)  
**Model:** claude-opus-4-6  
**Timestamp UTC:** 2026-08-09T17:16:00Z (first pass) · closure 2026-08-09T17:25:00Z  
**Branch tip evaluated (first pass):** `1b4a4b22c` / dogfood `0.1.0-demo+2ab9f55`  
**First-pass verdict:** **CLAIM_WITH_RESIDUALS**

## Executive summary (first pass)

All 18 constitution souls pass with live D keystone proof (19/0/0 on www.speakerops.org). Pipeline completed with phase audits APPROVE. SHA-256 of keystone JSON matches sidecar. Taste score 8.3/10 clears gate. Inventory holds at 115 REQUIRED IDs. No non-goals smuggled.

Three major residuals prevented CLAIM_PROVEN:

- **F-01**: Comms Send enqueues zero-recipient jobs server-side (UI-only block)
- **F-02**: `Cache-Control: no-store` missing from global security headers
- **F-03**: Packs-snapshot hash in frozen manifest mismatched file hash

Three minor: error observability placeholder, virus-scan platform note, unbounded list endpoints (pre-existing scale contracts use pagination/batch).

## Findings table

| id | severity | file/area | evidence | required fix |
|----|----------|-----------|----------|--------------|
| F-01 | major | comms send command | empty audience API | 400 empty audience |
| F-02 | major | SECURITY_HEADERS | only 3 routes no-store | global no-store |
| F-03 | major | frozen manifest | hash drift | re-pin hash |
| F-04 | minor | handover residuals list | mislabeled non-goals | reword |
| F-05 | minor | placeholders.tsx | dead stubs | delete unused |

## Soul matrix

All 18 D rows PASS per `SOUL_EVIDENCE_TABLE.md` + keystone report at `2ab9f55`.

## Residual gap list (first pass)

F-01, F-02, F-03 (blocking for CLAIM_PROVEN); F-04, F-05 (cleanup).

CLAIM_WITH_RESIDUALS
