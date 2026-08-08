# Browser E2E — Playwright inventory harness

**Section:** 1.5 · **Law:** [0.3 inventory law](./governance/0.3-e2e-inventory-law.md) · **Souls:** S-E2E-INV, S-E2E-RUN  
**Canonical inventory:** [`KMS-competition/initiative/BROWSER_E2E_INVENTORY.md`](../KMS-competition/initiative/BROWSER_E2E_INVENTORY.md)

This document is the workspace stub for Playwright usage until Phase 9 expands onboarding (`docs/ONBOARDING.md`).

---

## Commands (non-interactive)

| Command | Role |
|---------|------|
| `pnpm test:e2e` | Run Playwright suite (`playwright.config.ts`) |
| `pnpm test:e2e:inventory` | Inventory lint — REQUIRED column + `@inv` coverage |
| `E2E_INVENTORY_GATE=phase8 pnpm test:e2e:inventory` | Phase 8 full gate (status PASS + tags + run report) |
| `pnpm exec tsx scripts/inventory-lint.ts` | Same as `test:e2e:inventory` (TypeScript entry) |

Gates must never hang (E5): no `--watch` on CI scripts.

---

## `@inv:A01` tagging convention

Every Playwright journey test that owns an inventory ID **must** put the tag on the `test()` title:

```ts
import { test, expect } from "@playwright/test";

test("@inv:A01 e2e/public/cfp-load public CFP loads form and brand tokens", async ({ page }) => {
  // journey body
});
```

| Rule | Detail |
|------|--------|
| Format | `@inv:` + inventory ID (letter + two digits), e.g. `@inv:A01` |
| 1:1 map | Exactly one `@inv:ID` per `test()` title — multi-tag titles fail lint |
| Anchor | Title or file path must reference inventory `test_id` (e.g. `e2e/public/cfp-load`) |
| Binding | Callee must be Playwright `test` from `@playwright/test` (`.extend()` OK) |
| Not coverage | Comments, bare strings, local no-op `test`, `test.skip` / `fixme` / `fail` |

**Example harness file:** `playwright/e2e/_harness_example.spec.ts` (documents the convention; product `@inv` owners live on real journey specs — e.g. A01 in section 3.3)

---

## Inventory lint behaviour

`scripts/inventory-lint.ts` reads the **Required** column from the canonical inventory and fails (exit **1**) when tag targets lack `@inv:ID` in tests.

| Mode | Tag targets | Allow missing OPEN |
|------|-------------|--------------------|
| Intermediate (default) | Status `IMPLEMENTED` / `PASS` / `FAIL` only | Yes (`--allow-missing-until=8.2` default) |
| Phase 8 | All non-owner-DEFER REQUIRED | No (flag OFF) |

Full anti-shrinkage, DEFER ownership checks, suite reconciliation, and Phase 8 run-report proof are implemented in `scripts/e2e-inventory-lint.mjs` (section 0.3) and invoked by the TypeScript entry.

**Do not shrink REQUIRED inventory** to green CI. Only owner **DEFER** (constitution Article 0) removes a row from the required PASS set.

---

## Layout

| Path | Role |
|------|------|
| `playwright.config.ts` | Playwright project config (Chromium) |
| `playwright/e2e/**/*.spec.ts` | Browser tests with `@inv` tags |
| `playwright/e2e/foundation_smoke.spec.ts` | Section **1.6** I12 keystone (health + shell) |
| `playwright/e2e/auth_magic_link.spec.ts` | Section **2.1** `@inv:B01`–`B03` magic-link auth |
| `playwright/e2e/auth_role_guards.spec.ts` | Section **2.2** `@inv:B04`–`B06` role guards |
| `playwright/e2e/event_settings.spec.ts` | Section **2.3** `@inv:C01`/`C02`/`C07`/`C11`/`O01`–`O03` |
| `playwright/e2e/design_kit.spec.ts` | Section **2.4** `@inv:C03`–`C06`/`C08`–`C10` Design Kit |
| `playwright/e2e/auth_settings_keystone.spec.ts` | Section **2.5** I12 keystone (login → design publish → public brand) |
| `playwright/e2e/form_builder.spec.ts` | Section **3.2** `@inv:D01`–`D10` form builder admin UI |
| `playwright/e2e/public_cfp.spec.ts` | Section **3.3** `@inv:A01`–`A11` public CFP |
| `playwright/e2e/eval_scoring.spec.ts` | Section **3.4** `@inv:F01`–`F04` / `O04` evaluator scoring |
| `playwright/e2e/submissions_decisions.spec.ts` | Section **3.5** `@inv:E01`–`E08` submissions & decisions |
| `playwright/e2e/cfp_eval_keystone.spec.ts` | Section **3.6** I12 keystone (form publish → submit → score → accept → tasks) |
| `playwright/e2e/helpers/cfp-eval-seed.ts` | Section **3.6** seed helpers for keystone |
| `playwright/e2e/portal_api_tasks.spec.ts` | Section **4.1** `@inv:O05` / `N01`–`N04` portal API + admin speakers |
| `playwright/e2e/portal_ui.spec.ts` | Section **4.3** `@inv:G01`–`G08` speaker portal UI |
| `playwright/e2e/portal_keystone.spec.ts` | Section **4.4** I12 keystone (seed accept → portal green) |
| `playwright/e2e/comms_template.spec.ts` | Section **5.1** `@inv:J01` template editor |
| `playwright/e2e/comms_admin.spec.ts` | Section **5.3** `@inv:J02`–`J10` comms admin trust-before-send |
| `playwright/e2e/comms_keystone.spec.ts` | Section **5.4** I12 keystone (template → preview → send → ICS → authz) |
| `scripts/e2e-api-server.mjs` | Local Hono `/health` for e2e (no wrangler) |
| `scripts/inventory-lint.ts` | Inventory lint CLI (section 1.5) |
| `scripts/e2e-inventory-lint.mjs` | Full inventory law engine (section 0.3) |
| `scripts/e2e-inventory-required-baseline.json` | Anti-shrinkage baseline (108 IDs) |
| `reports/playwright/` | HTML report (CI) |
| `KMS-competition/initiative/evidence/phase1.txt` | Phase 1 keystone evidence (1.6) |
| `KMS-competition/initiative/evidence/phase2-e2e.txt` | Phase 2 keystone evidence (2.5) |
| `KMS-competition/initiative/evidence/phase3-e2e.txt` | Phase 3 keystone evidence (3.6) |
| `KMS-competition/initiative/evidence/phase4-e2e.txt` | Phase 4 keystone evidence (4.4) |
| `KMS-competition/initiative/evidence/phase5-e2e.txt` | Phase 5 keystone evidence (5.4) |

---

## Local setup

```bash
pnpm install
pnpm exec playwright install chromium   # once per machine / CI image
pnpm test:e2e:inventory                 # must exit 0
pnpm test:e2e                           # harness + future journeys
```

Env **names** only (E10) — never commit secret values:

| Name | Purpose |
|------|---------|
| `E2E_BASE_URL` | Override base URL (default `http://127.0.0.1:5173`) |
| `E2E_WEB_PORT` | Vite port for optional webServer |
| `E2E_API_PORT` | Local Hono API port for e2e health (default `8787`) |
| `E2E_WEB_SERVER=1` | Enable Playwright webServer (API + Vite). Set by `pnpm test:e2e` by default |
| `E2E_WEB_SERVER=0` | Opt out of auto webServer (external servers already up) |
| `E2E_INVENTORY_GATE=phase8` | Full inventory gate |
| `E2E_PLAYWRIGHT_RUN_REPORT` | Path to JSON run report (Phase 8) |
| `CI` | Enables forbidOnly, single worker, HTML reporter |

---

## Phase 8 (not this section)

- Every non-DEFER REQUIRED row status `PASS`
- `@inv` on Playwright-bound tests for all of them
- Actual run report with **passed, non-skipped** results
- Discovery crawl of admin primary actions
- Report artifact: `reports/e2e-coverage.html` (Phase 9 consumers)

Section **1.5** only scaffolds the harness and inventory lint entry — it does not claim `dogfood_ready` or full REQUIRED green.

Section **1.6** adds foundation smoke (`foundation_smoke.spec.ts`): health 200 + Lumen admin shell (CFP / Forms) without `pageerror`. Evidence: `KMS-competition/initiative/evidence/phase1.txt`.

Section **2.5** adds the phase-2 I12 keystone (`auth_settings_keystone.spec.ts`): login → set design → publish → public brand; role guards. Inventory B01–B06 / C01–C11 status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase2-e2e.txt`.

Section **3.6** adds the phase-3 I12 keystone (`cfp_eval_keystone.spec.ts`): form publish → public submit → score → accept → tasks exist. Inventory A01–A11 / D01–D10 / E01–E08 / F01–F04 (O04) status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase3-e2e.txt`.

Section **4.4** adds the phase-4 I12 keystone (`portal_keystone.spec.ts`): seed accept → speaker portal green (G01–G08). Inventory G01–G08 / O05 status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase4-e2e.txt`.

Section **5.4** adds the phase-5 I12 keystone (`comms_keystone.spec.ts`): template → segment → preview-required → send idempotent → delivery log → ICS SEQUENCE → authz. Inventory J01–J10 status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase5-e2e.txt`.

---

## Related

- Law: [`docs/governance/0.3-e2e-inventory-law.md`](./governance/0.3-e2e-inventory-law.md)
- Section notes: [`docs/sections/1.5-playwright-inventory-harness.md`](./sections/1.5-playwright-inventory-harness.md)
- Ownership: `KMS-competition/initiative/contracts/INVENTORY_OWNERSHIP.md`
