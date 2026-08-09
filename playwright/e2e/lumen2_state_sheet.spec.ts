/**
 * Section 11.0 — Lumen 2 state sheet (S-L2-SYSTEM).
 *
 * - @inv:L2-01 e2e/lumen2/state-sheet
 *
 * Proves AC-11.0-C/D: state sheet route reviewable with data-testid=l2-state-sheet;
 * primitives visible; admin-guarded.
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "e2e-l2-state-sheet-admin@example.com";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
) {
  const res = await request.post("/api/auth/magic-link", {
    data: { email, purpose },
  });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
}

async function fetchDevToken(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok(), `dev outbox status ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { link: { token: string } | null };
  expect(body.link?.token, "dev outbox must capture token").toBeTruthy();
  return body.link!.token;
}

async function exchangeForCookie(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<string> {
  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  return match![1]!;
}

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<void> {
  await requestMagicLink(request, email, "admin");
  const token = await fetchDevToken(request, email);
  const sessionValue = await exchangeForCookie(request, token);
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sessionValue,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

test("@inv:L2-01 e2e/lumen2/state-sheet primitives + state anatomy reviewable", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await loginAsAdmin(request, context, baseURL, ADMIN_EMAIL);

  await page.goto("/admin/settings/l2-state-sheet", {
    waitUntil: "domcontentloaded",
  });

  const sheet = page.getByTestId("l2-state-sheet");
  await expect(sheet).toBeVisible();

  // Section anchors for each primitive family
  await expect(page.getByTestId("l2-sheet-buttons")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-fields")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-badges")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-cards")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-alerts")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-modal")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-table")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-empty")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-skeleton")).toBeVisible();
  await expect(page.getByTestId("l2-sheet-icons")).toBeVisible();

  // Button state anatomy present in DOM
  await expect(sheet.locator(".l2-btn--primary").first()).toBeVisible();
  await expect(sheet.locator(".l2-btn.is-pending").first()).toBeVisible();
  await expect(sheet.locator(".l2-btn.is-disabled").first()).toBeVisible();

  // Field error state
  await expect(sheet.locator(".l2-field.is-error").first()).toBeVisible();

  // Badge + empty + skeleton
  await expect(sheet.locator(".l2-badge--success").first()).toBeVisible();
  await expect(page.getByTestId("l2-state-sheet-empty")).toBeVisible();
  await expect(page.getByTestId("l2-skeleton-title")).toBeVisible();

  // Modal open/close
  await page.getByTestId("l2-state-sheet-open-modal").click();
  const modal = page.getByTestId("l2-state-sheet-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute("role", "dialog");
  await page.getByTestId("l2-state-sheet-modal-close").click();
  await expect(modal).toHaveCount(0);

  // Token smoke copy asserts no parallel l2 SoT messaging surface
  await expect(page.getByTestId("l2-sheet-tokens")).toContainText(
    "--lumen-brand",
  );
});

test("L2 state sheet unauthenticated users cannot read admin sheet", async ({
  page,
}) => {
  // must-not: unauthenticated privileged surface
  await page.goto("/admin/settings/l2-state-sheet", {
    waitUntil: "domcontentloaded",
  });
  // RequireRole redirects to login or shows guard — sheet must not be usable
  await expect(page.getByTestId("l2-state-sheet")).toHaveCount(0);
});
