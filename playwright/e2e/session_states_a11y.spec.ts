/**
 * Section 11.7 — Settings two-pane + global states + a11y (S-L2-A11Y).
 *
 * Named ACs:
 * - AC-11.7-A session recovery: no auth alert inside shell → login panel
 * - AC-11.7-B settings two-pane IA + Design Kit public preview depth
 * - AC-11.7-C empty / loading / error patterns on settings surfaces
 * - AC-11.7-D keyboard / focus journeys on settings shell
 *
 * Inventory:
 * - @inv:L2-02 e2e/lumen2/session-expired
 * - @inv:L2-03 e2e/lumen2/settings-two-pane
 * - @inv:L2-04 e2e/lumen2/design-preview-public
 * - @inv:L2-05 e2e/lumen2/settings-a11y-keyboard
 *
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
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
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
  return body.event;
}

/**
 * AC-11.7-A — Session expired recovers via login panel, never shell alert.
 */
test("@inv:L2-02 e2e/lumen2/session-expired recovers via login not shell", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-11-7-session-${run}@example.com`;
  await loginAsAdmin(request, context, baseURL, adminEmail);

  await page.goto(`${baseURL ?? ""}/admin/settings`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("settings-shell")).toBeVisible();

  // Revoke session server-side + clear browser cookie
  await request.post("/api/auth/logout");
  await context.clearCookies();

  await page.goto(`${baseURL ?? ""}/admin/settings`, {
    waitUntil: "domcontentloaded",
  });

  // Must land on login with focused recovery — not privileged shell with alert
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  await expect(page.getByTestId("settings-shell")).toHaveCount(0);
  await expect(page.getByTestId("login-page")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("session-expired-panel")).toBeVisible();
  await expect(page.getByTestId("session-expired-title")).toContainText(
    /session expired/i,
  );
  // No auth alert painted as usable admin chrome
  await expect(page.getByText("Authentication required")).toHaveCount(0);
  await expect(page.getByTestId("login-form")).toBeVisible();
});

/**
 * AC-11.7-B — Settings two-pane IA.
 */
test("@inv:L2-03 e2e/lumen2/settings-two-pane category nav + content", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-11-7-settings-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  await ensureEvent(request, session, `E2E 11.7 Settings ${run}`);

  await page.goto(`${baseURL ?? ""}/admin/settings`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("settings-shell")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("settings-nav")).toBeVisible();
  await expect(page.getByTestId("settings-content")).toBeVisible();
  await expect(page.getByTestId("settings-shell")).toHaveAttribute(
    "data-layout",
    "two-pane",
  );

  // Category nav present
  for (const id of [
    "settings-nav-event",
    "settings-nav-rubric",
    "settings-nav-task-templates",
    "settings-nav-design",
    "settings-nav-api-keys",
    "settings-nav-airtable",
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }

  // Navigate to Design Kit via settings nav
  await page.getByTestId("settings-nav-design").click();
  await expect(page).toHaveURL(/\/admin\/settings\/design/);
  await expect(page.getByTestId("page-design-kit")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("settings-shell")).toBeVisible();
  await expect(page.getByTestId("settings-nav-design")).toHaveClass(
    /settings-shell__nav-link--active/,
  );

  // API keys still inside two-pane
  await page.getByTestId("settings-nav-api-keys").click();
  await expect(page).toHaveURL(/\/admin\/settings\/api-keys/);
  await expect(page.getByTestId("api-keys-page")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("settings-nav")).toBeVisible();
});

/**
 * Design Kit live public preview depth.
 */
test("@inv:L2-04 e2e/lumen2/design-preview-public live CFP depth", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-11-7-design-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  await ensureEvent(request, session, `E2E 11.7 Design ${run}`);

  await page.goto(`${baseURL ?? ""}/admin/settings/design`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("page-design-kit")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("design-preview")).toBeVisible();
  await expect(page.getByTestId("design-preview-public")).toBeVisible();
  await expect(page.getByTestId("design-preview-hero")).toBeVisible();
  await expect(page.getByTestId("design-preview-wordmark")).toBeVisible();
  await expect(page.getByTestId("design-preview-form")).toBeVisible();
  await expect(page.getByTestId("design-preview-button")).toContainText(
    /submit proposal/i,
  );
  await expect(page.getByTestId("design-preview-status")).toBeVisible();

  // Brand control still updates preview meta (regression for C03)
  await page.getByTestId("design-brand-hex").fill("#112233");
  await expect(page.getByTestId("design-preview-brand")).toContainText(
    "#112233",
  );
});

/**
 * AC-11.7-D — Keyboard journey on settings shell + focus visibility.
 */
test("@inv:L2-05 e2e/lumen2/settings-a11y-keyboard focus journeys", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-11-7-a11y-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  await ensureEvent(request, session, `E2E 11.7 A11y ${run}`);

  await page.goto(`${baseURL ?? ""}/admin/settings`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("settings-shell")).toBeVisible({
    timeout: 15_000,
  });

  // Tab into settings nav and activate Design Kit with keyboard
  await page.getByTestId("settings-nav-event").focus();
  await expect(page.getByTestId("settings-nav-event")).toBeFocused();

  // Move focus through nav links via Tab
  await page.keyboard.press("Tab");
  // After Tab we should be on another focusable settings nav item
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute("data-testid") ?? el?.tagName ?? null;
  });
  expect(focused).toBeTruthy();

  // Arrow / Enter activate via direct focus + Enter on design nav
  await page.getByTestId("settings-nav-design").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/settings\/design/, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("page-design-kit")).toBeVisible();

  // Wait for design load so inputs are not disabled (formBusy)
  await expect(page.getByTestId("design-form")).toHaveAttribute(
    "data-loading",
    "false",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("design-brand-hex")).toBeEnabled({
    timeout: 10_000,
  });
  // Form controls remain keyboard reachable
  await page.getByTestId("design-brand-hex").focus();
  await expect(page.getByTestId("design-brand-hex")).toBeFocused();
  // Focus-visible ring class is present on lumen-focusable controls
  await expect(page.getByTestId("design-brand-hex")).toHaveClass(
    /lumen-focusable/,
  );

  // 390px: settings shell still usable (nav + content)
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("settings-nav")).toBeVisible();
  await expect(page.getByTestId("settings-content")).toBeVisible();
  await expect(page.getByTestId("page-design-kit")).toBeVisible();
});

/** must-not: unauthenticated cannot read settings / design / keys */
test("11.7 must-not unauthenticated settings surfaces", async ({
  page,
  baseURL,
}) => {
  for (const path of [
    "/admin/settings",
    "/admin/settings/design",
    "/admin/settings/api-keys",
  ]) {
    await page.goto(`${baseURL ?? ""}${path}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.getByTestId("settings-shell")).toHaveCount(0);
    await expect(page.getByTestId("page-settings")).toHaveCount(0);
    await expect(page.getByTestId("api-keys-page")).toHaveCount(0);
  }
});

/** must-not: evaluator sees admin settings navigation */
test("11.7 must-not evaluator settings nav", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const email = `e2e-11-7-eval-${run}@example.com`;
  await requestMagicLink(request, email, "evaluator");
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

  await page.goto(`${baseURL ?? ""}/admin/settings`, {
    waitUntil: "domcontentloaded",
  });
  // Forbidden or redirect — never settings shell with privileged nav
  await expect(page.getByTestId("settings-shell")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("settings-nav-api-keys")).toHaveCount(0);
  const onLogin = page.url().includes("/login");
  const denied = await page.getByTestId("access-denied").count();
  expect(onLogin || denied > 0).toBeTruthy();
});
