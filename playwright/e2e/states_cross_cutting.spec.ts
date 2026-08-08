/**
 * Section 8.2 — Cross-cutting empty / error / loading / console-clean (S-E2E-RUN).
 *
 * - @inv:L01 e2e/states/empty-sub
 * - @inv:L02 e2e/states/error
 * - @inv:L03 e2e/states/loading
 * - @inv:L04 e2e/states/console-clean
 *
 * Product gaps closed on admin submissions list (empty CTA, error state, skeleton).
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

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

async function fetchDevLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<{ token: string; userId: string }> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    link: { token: string; userId?: string } | null;
  };
  expect(body.link?.token).toBeTruthy();
  return { token: body.link!.token, userId: body.link!.userId ?? "" };
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

function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
}

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<string> {
  await requestMagicLink(request, email, "admin");
  const link = await fetchDevLink(request, email);
  const sessionValue = await exchangeForCookie(request, link.token);
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
  return sessionValue;
}

async function ensureEvent(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await request.post("/api/events", {
    headers: sessionHeaders(session),
    data: {
      name,
      timezone: "UTC",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

async function bindEvent(
  page: import("@playwright/test").Page,
  eventId: string,
  path = "/admin/submissions",
) {
  await page.goto(path);
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  await page.evaluate((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  await page.goto(path);
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = page.getByTestId("event-context");
  if (
    await switcher
      .evaluate((el) => el.tagName === "SELECT")
      .catch(() => false)
  ) {
    await switcher.selectOption(eventId).catch(() => undefined);
  }
}

test("@inv:L01 e2e/states/empty-sub empty submissions list shows CTA", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now().toString(36);
  const email = `e2e-l01-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, email);
  const event = await ensureEvent(request, session, `L01 Empty ${run}`);

  await bindEvent(page, event.id);

  await expect(page.getByTestId("page-submissions")).toBeVisible({
    timeout: 15_000,
  });
  // Loading must resolve (not hang) then empty CTA appears
  await expect(page.getByTestId("submissions-empty")).toBeVisible({
    timeout: 15_000,
  });
  const cta = page.getByTestId("submissions-empty-cta");
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("data-inv", "L01");
  await expect(page.getByTestId("submissions-empty-forms-link")).toBeVisible();

  // CTA opens direct session form (same surface as E07, empty-state entry)
  await cta.click();
  await expect(page.getByTestId("submissions-direct-form")).toBeVisible({
    timeout: 5_000,
  });
});

test("@inv:L02 e2e/states/error API 500 shows error state not blank", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now().toString(36);
  const email = `e2e-l02-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, email);
  const event = await ensureEvent(request, session, `L02 Error ${run}`);

  // Force list endpoint to 500 for this event
  await page.route(`**/api/events/${event.id}/submissions**`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Internal server error (e2e L02)",
        code: "INTERNAL",
      }),
    });
  });

  await bindEvent(page, event.id);
  await expect(page.getByTestId("page-submissions")).toBeVisible({
    timeout: 15_000,
  });

  // Error state (not blank page / empty shell only)
  await expect(page.getByTestId("submissions-error-state")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("submissions-load-error")).toBeVisible();
  await expect(page.getByTestId("submissions-load-error")).toContainText(
    /error|Failed|Internal/i,
  );
  await expect(page.getByTestId("submissions-error-retry")).toBeVisible();

  // Body text proves non-blank recovery guidance
  await expect(page.getByTestId("submissions-error-state")).toContainText(
    /could not be loaded|try again|not blank/i,
  );

  // Page shell still present (not a white screen of death)
  await expect(page.getByTestId("admin-shell")).toBeVisible();
  await expect(page.getByTestId("page-submissions")).toBeVisible();
});

test("@inv:L03 e2e/states/loading loading skeleton resolves (not infinite hang)", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now().toString(36);
  const email = `e2e-l03-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, email);
  const event = await ensureEvent(request, session, `L03 Load ${run}`);

  let releaseList: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseList = resolve;
  });

  await page.route(`**/api/events/${event.id}/submissions**`, async (route) => {
    await gate;
    await route.continue();
  });

  await page.goto("/admin/submissions");
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  await page.evaluate((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, event.id);

  // Navigate so fetch starts while gate is held
  const nav = page.goto("/admin/submissions");
  // Skeleton must appear while request is in flight
  await expect(page.getByTestId("submissions-loading")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("submissions-skeleton")).toBeVisible();
  await expect(page.getByTestId("submissions-loading")).toHaveAttribute(
    "data-skeleton",
    "true",
  );
  await expect(page.getByTestId("submissions-loading")).toHaveAttribute(
    "aria-busy",
    "true",
  );

  // Release network — skeleton must clear (no infinite hang)
  releaseList!();
  await nav;
  await expect(page.getByTestId("submissions-loading")).toBeHidden({
    timeout: 15_000,
  });
  // Settles into empty (no submissions) or list — either is fine
  await expect(
    page
      .getByTestId("submissions-empty")
      .or(page.getByTestId("submissions-table")),
  ).toBeVisible({ timeout: 10_000 });
});

test("@inv:L04 e2e/states/console-clean happy paths have no uncaught console errors", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now().toString(36);
  const email = `e2e-l04-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, email);
  const event = await ensureEvent(request, session, `L04 Console ${run}`);

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

  // Happy path surfaces: health via SPA proxy, admin shell, submissions, forms, public CFP shell
  const health = await request.get("/health");
  expect(health.ok()).toBeTruthy();

  await bindEvent(page, event.id, "/admin");
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/CFP|Forms|Submissions/i).first()).toBeVisible({
    timeout: 10_000,
  });

  await page.goto("/admin/submissions");
  await expect(page.getByTestId("page-submissions")).toBeVisible({
    timeout: 15_000,
  });
  // Wait for load to settle
  await expect(page.getByTestId("submissions-loading")).toBeHidden({
    timeout: 15_000,
  });

  await page.goto("/admin/cfp");
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("page-cfp")).toBeVisible({ timeout: 10_000 });

  await page.goto(`/cfp/${event.slug}`);
  // Public CFP may be closed / empty form — must not throw
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("page-public-cfp")).toBeVisible({
    timeout: 15_000,
  });
  // Skeleton must not hang forever if it appeared
  const skeleton = page.getByTestId("public-cfp-skeleton");
  if (await skeleton.isVisible().catch(() => false)) {
    await expect(skeleton).toBeHidden({ timeout: 15_000 });
  }
  // Settled state: title, closed, or error — any is a valid happy-path landing
  await expect(page.getByTestId("public-cfp-title")).toBeVisible({
    timeout: 10_000,
  });

  expect(
    pageErrors,
    `uncaught pageerror on happy paths: ${pageErrors.join(" | ")}`,
  ).toEqual([]);
  // Filter known benign noise if any (none expected on happy paths)
  const realConsoleErrors = consoleErrors.filter(
    (t) => !/favicon\.ico|Download the React DevTools/i.test(t),
  );
  expect(
    realConsoleErrors,
    `console.error on happy paths: ${realConsoleErrors.join(" | ")}`,
  ).toEqual([]);
});
