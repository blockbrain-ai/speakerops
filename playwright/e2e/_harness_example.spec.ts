/**
 * Section 1.5 — Playwright inventory harness example.
 *
 * Documents the `@inv:ID` tagging convention (S-E2E-INV):
 *   test("@inv:A01 e2e/public/cfp-load …", async ({ page }) => { … })
 *
 * Product journey A01 (public CFP load + brand tokens) is fully owned by
 * section 3.3. This file proves the harness wires Playwright + inventory tags.
 * When 3.3 lands the real A01 journey, replace this body (keep 1:1 map —
 * do not leave two active `@inv:A01` owners).
 *
 * @see docs/E2E.md
 * @see docs/governance/0.3-e2e-inventory-law.md
 * @see KMS-competition/initiative/BROWSER_E2E_INVENTORY.md
 */
import { test, expect } from "@playwright/test";

test(
  "@inv:A01 e2e/public/cfp-load harness documents @inv tagging convention",
  async ({ page }) => {
    // Browser smoke for the harness itself (no product CFP form yet).
    await page.goto("about:blank");
    const ready = await page.evaluate(() => document.readyState);
    expect(ready).toBe("complete");
    // Convention lock: inventory IDs are letter + two digits.
    expect("A01").toMatch(/^[A-Z]\d{2}$/);
  },
);
