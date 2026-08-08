/**
 * Playwright config — section 1.5 inventory harness.
 *
 * Test root: playwright/e2e (testMatch: *.spec.ts)
 * Inventory law: every REQUIRED journey maps 1:1 via @inv:ID tags
 * (see docs/E2E.md, docs/governance/0.3-e2e-inventory-law.md).
 *
 * Full REQUIRED suite green is Phase 8 (S-E2E-RUN). This config is the
 * non-interactive CI entry for pnpm test:e2e.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_WEB_PORT || 5173);
const BASE_URL =
  process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;

/**
 * Start Vite for product journeys when E2E_WEB_SERVER=1.
 * Default off so harness / inventory `--list` stays fast; feature sections
 * that need the SPA set E2E_WEB_SERVER=1 (or document in section notes).
 */
const startWebServer = process.env.E2E_WEB_SERVER === "1";

export default defineConfig({
  testDir: "./playwright/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "reports/playwright" }]]
    : [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(startWebServer
    ? {
        webServer: {
          command:
            "pnpm --filter @speakerops/web exec vite --host 127.0.0.1 --port " +
            PORT,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        },
      }
    : {}),
});
