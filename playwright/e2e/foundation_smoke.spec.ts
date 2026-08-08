/**
 * Section 1.6 — Foundation e2e proof (I12 keystone).
 *
 * Proves phase-1 integration:
 * - GET /health → 200 `{ ok: true, version }` (via SPA origin proxy or direct)
 * - SPA admin shell loads Lumen chrome (sidebar includes CFP / Forms)
 * - No uncaught pageerror events
 * - No browser console.error messages (shell must not leave the console red)
 *
 * Section 2.2: admin shell is behind RequireRole — foundation smoke bootstraps
 * an admin session via magic-link + cookie so chrome assertions remain valid.
 *
 * Inventory note: product journey IDs (A01, L04, …) stay owned by their
 * feature sections / Phase 8 proof. This file is the foundation smoke
 * keystone (`smoke load shell`) — not a product journey PASS claim.
 *
 * Named assertions (spec 1.6):
 * - assert page.goto baseURL shows text matching /CFP|Forms/i
 * - assert no pageerror event
 * - assert no console.error messages
 * - assert /health fetch ok
 *
 * @see docs/sections/1.6-foundation-e2e-proof.md
 * @see docs/E2E.md
 */
import { test, expect } from "@playwright/test";

const FOUNDATION_ADMIN_EMAIL = "e2e-foundation-admin@example.com";

test.describe("1.6 foundation smoke (I12 keystone)", () => {
  /**
   * Single multi-step e2e covering foundation integration (health + shell).
   * Requires E2E_WEB_SERVER=1 (set by `pnpm test:e2e` / e2e-run.mjs).
   */
  test("foundation: health 200 + shell CFP chrome without pageerror or console.error", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // --- collect pageerror + console.error for full journey ---
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // --- assert /health fetch ok (baseURL → Vite proxy → local API) ---
    const healthRes = await request.get("/health");
    expect(
      healthRes.ok(),
      `GET /health expected ok, got ${healthRes.status()}`,
    ).toBeTruthy();
    const healthBody: unknown = await healthRes.json();
    expect(healthBody).toMatchObject({ ok: true });
    expect(healthBody).toEqual(
      expect.objectContaining({
        ok: true,
        version: expect.any(String),
      }),
    );
    const version = (healthBody as { version: string }).version;
    expect(version.length).toBeGreaterThan(0);

    // --- bootstrap admin session (2.2 RequireRole on /admin) ---
    const ml = await request.post("/api/auth/magic-link", {
      data: { email: FOUNDATION_ADMIN_EMAIL, purpose: "admin" },
    });
    expect(ml.ok()).toBeTruthy();
    const outbox = await request.get(
      `/api/auth/dev/outbox?email=${encodeURIComponent(FOUNDATION_ADMIN_EMAIL)}`,
    );
    expect(outbox.ok()).toBeTruthy();
    const outBody = (await outbox.json()) as { link: { token: string } | null };
    expect(outBody.link?.token).toBeTruthy();
    const exchange = await request.post("/api/auth/exchange", {
      data: { token: outBody.link!.token },
    });
    expect(exchange.status()).toBe(200);
    const setCookie = exchange.headers()["set-cookie"] ?? "";
    const match = setCookie.match(/speakerops_session=([^;]+)/);
    expect(match).toBeTruthy();
    await context.addCookies([
      {
        name: "speakerops_session",
        value: match![1]!,
        url: baseURL ?? "http://127.0.0.1:5173",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    // --- assert page.goto baseURL shows text matching /CFP|Forms/i ---
    await page.goto(baseURL ?? "/");
    await expect(page.getByTestId("app-root")).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("admin-sidebar")).toBeVisible();

    // Sidebar Lumen IA includes CFP / Forms (section 1.4 chrome)
    await expect(page.getByTestId("nav-cfp")).toBeVisible();
    await expect(page.getByTestId("admin-sidebar")).toContainText(/CFP|Forms/i);
    await expect(page.getByTestId("nav-cfp")).toHaveText(/CFP\s*\/\s*Forms/i);

    // Lumen shell chrome present (not a blank root)
    await expect(page.getByTestId("admin-page-title")).toBeVisible();
    await expect(page.getByTestId("admin-nav")).toBeVisible();

    // --- assert no pageerror and no console.error ---
    expect(
      pageErrors,
      `uncaught pageerror events: ${pageErrors.join(" | ")}`,
    ).toEqual([]);
    expect(
      consoleErrors,
      `browser console.error messages: ${consoleErrors.join(" | ")}`,
    ).toEqual([]);
  });
});
