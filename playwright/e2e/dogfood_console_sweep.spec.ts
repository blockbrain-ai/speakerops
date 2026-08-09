/**
 * Dogfood console / pageerror sweep (postbuild verification).
 *
 * Visits primary admin + public surfaces on the binding dogfood URL and fails
 * on uncaught pageerror or browser console.error (after filtering known noise).
 *
 * Run:
 *   DOGFOOD_KEYSTONE=1 E2E_BASE_URL=https://www.speakerops.org E2E_WEB_SERVER=0 \
 *     scripts/with-secrets.sh pnpm exec playwright test \
 *     playwright/e2e/dogfood_console_sweep.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import {
  DOGFOOD_ORIGIN,
  loginDogfoodRole,
} from "./helpers/dogfood-session.js";

const BASE =
  process.env.E2E_BASE_URL?.replace(/\/$/, "") ||
  process.env.SMOKE_BASE_URL?.replace(/\/$/, "") ||
  DOGFOOD_ORIGIN;

function url(path: string): string {
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

const NOISE = [
  /favicon\.ico/i,
  /Failed to load resource: the server responded with a status of 4\d\d/i,
  /net::ERR_/i,
  /ResizeObserver loop/i,
];

function isNoise(text: string): boolean {
  return NOISE.some((re) => re.test(text));
}

async function attachCollectors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (!isNoise(t)) consoleErrors.push(t);
    }
  });
  return { pageErrors, consoleErrors };
}

test.describe("dogfood console/pageerror sweep", () => {
  test("public + admin primary routes load without pageerror/console.error", async ({
    page,
    context,
  }) => {
    test.skip(
      process.env.DOGFOOD_KEYSTONE !== "1" &&
        !/speakerops\.org/i.test(process.env.E2E_BASE_URL || ""),
      "Set DOGFOOD_KEYSTONE=1 or E2E_BASE_URL=https://www.speakerops.org",
    );
    test.setTimeout(180_000);
    const { pageErrors, consoleErrors } = await attachCollectors(page);

    // Public surfaces (no session)
    for (const path of ["/login", "/cfp"]) {
      await page.goto(url(path), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(500);
    }

    // Health JSON (also SPA may hit /health)
    const health = await page.request.get(url("/health"));
    expect(health.status()).toBe(200);
    const body = (await health.json()) as { ok?: boolean; version?: string };
    expect(body.ok).toBe(true);
    expect(String(body.version || "")).toMatch(/0\.1\.0-demo\+/);

    await loginDogfoodRole(context, "admin", BASE);

    const adminPaths = [
      "/admin",
      "/admin/submissions",
      "/admin/evaluations",
      "/admin/comms",
      "/admin/schedule",
      "/admin/speakers",
      "/admin/cfp",
      "/admin/settings",
      "/admin/settings/design",
    ];
    for (const path of adminPaths) {
      await page.goto(url(path), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(800);
    }

    expect(
      pageErrors,
      `pageerror on dogfood routes:\n${pageErrors.join("\n")}`,
    ).toEqual([]);
    expect(
      consoleErrors,
      `console.error on dogfood routes:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });
});
