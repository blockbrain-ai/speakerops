/**
 * Section 1.5 — Playwright inventory harness example.
 *
 * Documents the `@inv:ID` tagging convention (S-E2E-INV):
 *   test("@inv:A01 e2e/public/cfp-load public CFP loads form and brand tokens", …)
 *
 * Product journey A01 (public CFP load + brand tokens) is fully owned by
 * section 3.3. This file only proves Playwright harness wiring — it must
 * NOT register an active `@inv:A01` test (that would be counterfeit inventory
 * coverage and a duplicate owner when 3.3 lands the real journey).
 *
 * @see docs/E2E.md
 * @see docs/governance/0.3-e2e-inventory-law.md
 * @see KMS-competition/initiative/BROWSER_E2E_INVENTORY.md
 */
import { test, expect } from "@playwright/test";

/**
 * Harness wiring smoke only — no inventory ownership claim.
 * Real A01 body: section 3.3 (`e2e/public/cfp-load`).
 */
test("harness: Playwright wiring smoke (no inventory ownership claim)", async ({
  page,
}) => {
  await page.goto("about:blank");
  const ready = await page.evaluate(() => document.readyState);
  expect(ready).toBe("complete");
  // Convention lock: inventory IDs are letter + two digits (e.g. A01).
  expect("A01").toMatch(/^[A-Z]\d{2}$/);
});
