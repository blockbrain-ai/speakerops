/**
 * Playwright config — section 1.5 inventory harness + 1.6 foundation smoke.
 *
 * Test root: playwright/e2e (testMatch: *.spec.ts)
 * Inventory law: every REQUIRED journey maps 1:1 via @inv:ID tags
 * (see docs/E2E.md, docs/governance/0.3-e2e-inventory-law.md).
 *
 * Full REQUIRED suite green is Phase 8 (S-E2E-RUN). This config is the
 * non-interactive CI entry for pnpm test:e2e.
 *
 * Local baseURL: http://127.0.0.1:5173 (override via E2E_BASE_URL).
 * When E2E_WEB_SERVER=1 (default for `pnpm test:e2e`), starts:
 *   1. Local Hono API on E2E_API_PORT (8787) — health composition root
 *   2. Vite SPA on E2E_WEB_PORT (5173) — Lumen shell + /health proxy
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_WEB_PORT || 5173);
const API_PORT = Number(process.env.E2E_API_PORT || 8787);
const BASE_URL =
  process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;

/**
 * Start Vite + local API for product / foundation journeys when E2E_WEB_SERVER=1.
 * Default off so inventory `--list` stays fast; `pnpm test:e2e` (e2e-run.mjs)
 * sets E2E_WEB_SERVER=1 for foundation smoke (section 1.6).
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
        webServer: [
          {
            command: "node scripts/e2e-api-server.mjs",
            url: `http://127.0.0.1:${API_PORT}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            stdout: "pipe" as const,
            stderr: "pipe" as const,
          },
          {
            command:
              "pnpm --filter @speakerops/web exec vite --host 127.0.0.1 --port " +
              PORT,
            url: BASE_URL,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            stdout: "pipe" as const,
            stderr: "pipe" as const,
          },
        ],
      }
    : {}),
});
