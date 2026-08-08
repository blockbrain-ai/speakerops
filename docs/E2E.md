# Browser E2E — Playwright inventory harness

**Section:** 1.5 · **Law:** [0.3 inventory law](./governance/0.3-e2e-inventory-law.md) · **Souls:** S-E2E-INV, S-E2E-RUN  
**Canonical inventory:** [`KMS-competition/initiative/BROWSER_E2E_INVENTORY.md`](../KMS-competition/initiative/BROWSER_E2E_INVENTORY.md)

This document is the workspace stub for Playwright usage until Phase 9 expands onboarding (`docs/ONBOARDING.md`).

---

## Commands (non-interactive)

| Command | Role |
|---------|------|
| `pnpm test:e2e` | Run Playwright suite (`playwright.config.ts`); refreshes coverage HTML |
| `pnpm test:e2e:inventory` | Inventory lint — REQUIRED `@inv` coverage **+** admin primary discovery crawl (8.1) |
| `E2E_INVENTORY_GATE=phase8 pnpm test:e2e:inventory` | Phase 8 full gate (status PASS + tags + run report) |
| `pnpm docs:e2e-report` | Section **8.5** — build offline `reports/e2e-coverage.html` (inventory + results) |
| `pnpm exec tsx scripts/inventory-lint.ts` | Same as `test:e2e:inventory` (TypeScript entry) |
| `E2E_INVENTORY_SKIP_CRAWL=1` | Debug: skip admin crawl (tags only) |

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

`scripts/inventory-lint.ts` reads the **Required** column from the canonical inventory and fails (exit **1**) when tag targets lack `@inv:ID` in tests. From section **8.1** it also runs the **admin primary discovery crawl** against `scripts/ui-crawl-allowlist.json` (pure chrome + `controlMap`) and fails on unmapped primary controls.

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
| `playwright/e2e/schedule_dash_keystone.spec.ts` | Section **6.4** I12 keystone (schedule → readiness → speakers → L05) |
| `playwright/e2e/api_keys.spec.ts` | Section **7.1** `@inv:K01`–`K04` API keys UI |
| `playwright/e2e/airtable_status.spec.ts` | Section **7.3** `@inv:O06` Airtable status |
| `playwright/e2e/phase7_keystone.spec.ts` | Section **7.4** I12 keystone (K* → CLI07 deny → airtable pause) |
| `playwright/e2e/states_cross_cutting.spec.ts` | Section **8.2** L01–L04 empty/error/loading/console-clean |
| `playwright/e2e/phase8_full_suite_keystone.spec.ts` | Section **8.2** full-suite soul path keystone |
| `scripts/e2e-api-server.mjs` | Local Hono `/health` for e2e (no wrangler) |
| `scripts/inventory-lint.ts` | Inventory lint CLI (1.5) + admin discovery crawl (8.1) |
| `scripts/ui-crawl-allowlist.json` | Crawl chrome allowlist + primary controlMap (8.1) |
| `scripts/e2e-inventory-lint.mjs` | Full inventory law engine (section 0.3) |
| `docs/sections/8.1-inventory-completeness.md` | Completeness audit notes (S-E2E-INV) |
| `docs/sections/8.2-full-playwright-suite.md` | Full suite notes (S-E2E-RUN) |
| `scripts/e2e-inventory-required-baseline.json` | Anti-shrinkage baseline (108 IDs) |
| `playwright-report/` | Raw HTML report (8.2 / local run) |
| `reports/playwright/` | HTML report mirror (CI) |
| `reports/playwright-run.json` | JSON run report (`E2E_PLAYWRIGHT_RUN_REPORT`) |
| `reports/e2e-coverage.html` | Section **8.5** Lumen keystone: inventory + results (offline) |
| `scripts/build-e2e-report.ts` | Builder for `pnpm docs:e2e-report` / post-`test:e2e` refresh |
| `reports/e2e-report-path.txt` | Report path manifest after `pnpm test:e2e` |
| `KMS-competition/initiative/evidence/phase1.txt` | Phase 1 keystone evidence (1.6) |
| `KMS-competition/initiative/evidence/phase2-e2e.txt` | Phase 2 keystone evidence (2.5) |
| `KMS-competition/initiative/evidence/phase3-e2e.txt` | Phase 3 keystone evidence (3.6) |
| `KMS-competition/initiative/evidence/phase4-e2e.txt` | Phase 4 keystone evidence (4.4) |
| `KMS-competition/initiative/evidence/phase5-e2e.txt` | Phase 5 keystone evidence (5.4) |
| `KMS-competition/initiative/evidence/phase6-e2e.txt` | Phase 6 keystone evidence (6.4) |
| `KMS-competition/initiative/evidence/phase7-e2e.txt` | Phase 7 keystone evidence (7.4) |
| `KMS-competition/initiative/evidence/e2e-full.txt` | Phase 8 full suite evidence (8.2) |

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

## Phase 8

### 8.1 — Inventory completeness audit (landed)

- Machine-check REQUIRED ↔ `@inv` for status-owned IDs (intermediate) / all non-DEFER (phase8)
- Admin primary discovery crawl with documented allowlist (`scripts/ui-crawl-allowlist.json`)
- Named negatives: missing REQUIRED tag fails lint; unmapped primary button fixture fails crawl
- Section notes: [`docs/sections/8.1-inventory-completeness.md`](./sections/8.1-inventory-completeness.md)

### 8.2 — Full Playwright suite (landed)

- Every non-DEFER REQUIRED row status `PASS` (incl. L01–L04)
- `@inv` on Playwright-bound tests for all of them
- Actual run report with **passed, non-skipped** results (`reports/playwright-run.json`)
- Raw HTML: `playwright-report/`
- Path manifest: `reports/e2e-report-path.txt` (written by `scripts/e2e-run.mjs`)
- Cross-cutting: `playwright/e2e/states_cross_cutting.spec.ts` · keystone `phase8_full_suite_keystone.spec.ts`
- Evidence: `KMS-competition/initiative/evidence/e2e-full.txt`
- Section notes: [`docs/sections/8.2-full-playwright-suite.md`](./sections/8.2-full-playwright-suite.md)
- Phase 8 gate: `E2E_INVENTORY_GATE=phase8 E2E_PLAYWRIGHT_RUN_REPORT=reports/playwright-run.json pnpm test:e2e:inventory`

### 8.5 — E2E keystone HTML report (landed)

- Offline Lumen HTML: `reports/e2e-coverage.html` (inventory + Playwright results)
- Builder: `scripts/build-e2e-report.ts` · interface: `pnpm docs:e2e-report`
- PASS/FAIL per REQUIRED id (e.g. **A01**); footer with **generated timestamp** + Git SHA
- Refreshed automatically after `pnpm test:e2e` via `scripts/e2e-run.mjs`
- Evidence: `KMS-competition/initiative/evidence/e2e-coverage.txt`
- Section notes: [`docs/sections/8.5-e2e-keystone-report.md`](./sections/8.5-e2e-keystone-report.md)

Section **1.5** only scaffolds the harness and inventory lint entry — it does not claim `dogfood_ready` or full REQUIRED green.

Section **1.6** adds foundation smoke (`foundation_smoke.spec.ts`): health 200 + Lumen admin shell (CFP / Forms) without `pageerror`. Evidence: `KMS-competition/initiative/evidence/phase1.txt`.

Section **2.5** adds the phase-2 I12 keystone (`auth_settings_keystone.spec.ts`): login → set design → publish → public brand; role guards. Inventory B01–B06 / C01–C11 status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase2-e2e.txt`.

Section **3.6** adds the phase-3 I12 keystone (`cfp_eval_keystone.spec.ts`): form publish → public submit → score → accept → tasks exist. Inventory A01–A11 / D01–D10 / E01–E08 / F01–F04 (O04) status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase3-e2e.txt`.

Section **4.4** adds the phase-4 I12 keystone (`portal_keystone.spec.ts`): seed accept → speaker portal green (G01–G08). Inventory G01–G08 / O05 status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase4-e2e.txt`.

Section **5.4** adds the phase-5 I12 keystone (`comms_keystone.spec.ts`): template → segment → preview-required → send idempotent → delivery log → ICS SEQUENCE → authz. Inventory J01–J10 status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase5-e2e.txt`.

Section **6.4** adds the phase-6 I12 keystone (`schedule_dash_keystone.spec.ts`): schedule → readiness → speakers → L05. Inventory I01–I16 / H01–H05 / N01–N04 / L05 status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase6-e2e.txt`.

Section **7.4** adds the phase-7 I12 keystone (`phase7_keystone.spec.ts`): K* keys → CLI07 deny → airtable pause. Inventory K01–K04 / O06 status **PASS**. Evidence: `KMS-competition/initiative/evidence/phase7-e2e.txt`.

Section **8.1** hardens inventory completeness (S-E2E-INV): tags + admin primary crawl. Evidence / notes: `docs/sections/8.1-inventory-completeness.md`.

Section **8.2** runs the full Playwright suite (S-E2E-RUN): all REQUIRED **PASS**, L01–L04 state journeys, run report artifact. Evidence: `KMS-competition/initiative/evidence/e2e-full.txt`.

Section **8.5** emits the offline keystone coverage HTML for S-E2E-RUN evidence (`pnpm docs:e2e-report` → `reports/e2e-coverage.html`). Evidence: `KMS-competition/initiative/evidence/e2e-coverage.txt`.

Section **8.6** owns **S-CF** dogfood deploy (`scripts/deploy-dogfood.sh`, `docs/OPERATIONS.md`, BC10 evidence). Optional remote Playwright: set `SMOKE_BASE_URL` and run `playwright/e2e/cf_dogfood_smoke.spec.ts` (skips when unset; no `@inv`).

---

## Related

- Law: [`docs/governance/0.3-e2e-inventory-law.md`](./governance/0.3-e2e-inventory-law.md)
- Section notes: [`docs/sections/1.5-playwright-inventory-harness.md`](./sections/1.5-playwright-inventory-harness.md)
- Ownership: `KMS-competition/initiative/contracts/INVENTORY_OWNERSHIP.md`
