/**
 * Section 8.3 — Security hardening browser proofs.
 *
 * - CSP header present on HTML document (Vite server headers)
 * - Review anchors for XSS inventory A10 / C09 (full journeys remain in
 *   public_cfp.spec.ts and design_kit.spec.ts)
 *
 * Not a new inventory ID — documents security surface for dogfood.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("CSP header present on HTML document", async ({ page, baseURL }) => {
  const response = await page.goto(baseURL ?? "/");
  expect(response).toBeTruthy();
  expect(response!.ok() || response!.status() === 304).toBeTruthy();

  const headers = response!.headers();
  const csp =
    headers["content-security-policy"] ??
    headers["Content-Security-Policy"] ??
    "";

  // Prefer response header (Vite server.headers). Meta is defense-in-depth.
  if (csp) {
    expect(csp).toMatch(/default-src\s+'self'/);
    expect(csp).toMatch(/object-src\s+'none'/);
  } else {
    // Fallback: document meta CSP must still be present (static host without headers)
    const meta = await page.locator(
      'meta[http-equiv="Content-Security-Policy"]',
    );
    await expect(meta).toHaveCount(1);
    const content = (await meta.getAttribute("content")) ?? "";
    expect(content).toMatch(/default-src\s+'self'/);
  }

  // Meta always present in index.html
  const metaContent =
    (await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content")) ?? "";
  expect(metaContent.length).toBeGreaterThan(10);
});

test("security inventory A10/C09 tags exist in suite sources", async () => {
  // Lightweight non-browser inventory anchor so 8.3 e2e file documents ownership
  const a10 = readFileSync(
    join(root, "playwright/e2e/public_cfp.spec.ts"),
    "utf8",
  );
  const c09 = readFileSync(
    join(root, "playwright/e2e/design_kit.spec.ts"),
    "utf8",
  );
  expect(a10).toContain("@inv:A10");
  expect(c09).toContain("@inv:C09");
});
