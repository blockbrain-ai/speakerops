/**
 * Section 11.1 — Admin shell + Overview readiness (S-L2-SHELL).
 *
 * Inventory H01–H05 remain owned by readiness_dashboard.spec.ts (1:1 @inv law).
 * This file proves Lumen 2 shell/overview composition on top of those journeys:
 * - AC-11.1-A: primary risk + next action + metrics visible within 5s
 * - Mobile 390px nav usable
 * - Session-expired → focused recovery (login), not alert inside usable shell
 * - Negatives: unauthenticated blocked; evaluator has no admin nav
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
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
      startsAt: "2026-09-01T09:00:00.000Z",
      endsAt: "2026-09-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

async function acceptSpeaker(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  speakerEmail: string,
  speakerName: string,
  title: string,
): Promise<{ participationId: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: `CFP ${title}` },
  });
  expect(create.status()).toBe(201);
  const form = (await create.json()) as { form: { id: string } };

  const draft = await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
          required: true,
          sortOrder: 0,
        },
      ],
      rules: [],
    },
  });
  expect(draft.status()).toBe(200);

  const publish = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(session),
    data: {},
  });
  expect(publish.status()).toBe(200);
  const pub = (await publish.json()) as {
    formVersion: { id: string };
  };

  const submit = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: pub.formVersion.id,
      title,
      speakers: [
        { name: speakerName, email: speakerEmail, isPrimary: true },
      ],
      answers: [{ fieldKey: "abstract", value: "E2E abstract" }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  });
  expect(submit.status()).toBe(201);
  const sub = (await submit.json()) as { submission: { id: string } };

  const decision = await request.post(
    `/api/submissions/${sub.submission.id}/decision`,
    {
      headers: sessionHeaders(session),
      data: { decision: "accept" },
    },
  );
  expect(decision.status()).toBe(200);
  const body = (await decision.json()) as {
    participations: Array<{ id: string }>;
  };
  expect(body.participations.length).toBeGreaterThanOrEqual(1);
  return { participationId: body.participations[0]!.id };
}

/**
 * AC-11.1-A — 5-second test: primary risk + next action + metrics visible.
 * Clock starts at page.goto resolution; pass within 5000ms.
 */
test("AC-11.1-A overview attention + metrics + primary action within 5s", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-11-1-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `L2 Overview ${run}`);
  await acceptSpeaker(
    request,
    session,
    event.id,
    event.slug,
    `l2-spk-${run}@example.com`,
    "L2 Speaker",
    `L2 Talk ${run}`,
  );

  // Pre-select active event so overview loads on first paint of readiness data
  await page.addInitScript((eventId: string) => {
    localStorage.setItem("speakerops.activeEventId", eventId);
  }, event.id);

  const t0 = Date.now();
  await page.goto(`${baseURL ?? ""}/admin`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("page-readiness")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId("overview-metrics")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId("readiness-stats")).toBeVisible({
    timeout: 5_000,
  });
  // Primary risk + next action (5-second operational story)
  await expect(page.getByTestId("overview-primary-risk")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId("overview-primary-action")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId("readiness-outstanding-list")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId("overview-quick-actions")).toBeVisible({
    timeout: 5_000,
  });

  const elapsed = Date.now() - t0;
  expect(elapsed, `overview composition exceeded 5s (${elapsed}ms)`).toBeLessThanOrEqual(
    5000,
  );

  // Shell chrome: icons + account
  await expect(page.getByTestId("admin-shell")).toBeVisible();
  await expect(page.getByTestId("admin-account")).toBeVisible();
  await expect(page.getByTestId("nav-overview")).toBeVisible();
  // Icon present on overview nav
  await expect(
    page.getByTestId("nav-overview").locator("[data-icon]"),
  ).toHaveCount(1);

  // Four metrics wired to real paths
  await expect(page.getByTestId("overview-metric-submissions")).toBeVisible();
  await expect(page.getByTestId("overview-metric-evaluations")).toBeVisible();
  await expect(page.getByTestId("overview-metric-speakers")).toBeVisible();
  await expect(page.getByTestId("overview-metric-schedule")).toBeVisible();

  // Metric links hit real admin routes (not orphans)
  await page.getByTestId("overview-metric-submissions").click();
  await expect(page).toHaveURL(/\/admin\/submissions/);
});

test("11.1 mobile 390px nav drawer is usable", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-11-1-mobile-${run}@example.com`;
  await loginAsAdmin(request, context, baseURL, adminEmail);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseURL ?? ""}/admin`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  const toggle = page.getByTestId("admin-nav-toggle");
  await expect(toggle).toBeVisible();

  // Drawer closed: nav link not forced visible in layout (may still exist in DOM)
  await toggle.click();
  await expect(page.getByTestId("admin-shell")).toHaveClass(/admin-shell--nav-open/);
  await expect(page.getByTestId("nav-cfp")).toBeVisible();
  await expect(page.getByTestId("admin-help")).toBeVisible();
  await expect(page.getByTestId("admin-sign-out")).toBeVisible();

  // Navigate via drawer
  await page.getByTestId("nav-settings").click();
  await expect(page).toHaveURL(/\/admin\/settings/);
  // Drawer closes after nav
  await expect(page.getByTestId("admin-shell")).not.toHaveClass(
    /admin-shell--nav-open/,
  );
});

/**
 * Session-expired must not show as alert inside usable shell —
 * focused recovery (login redirect) instead.
 */
test("11.1 session-expired recovers via login not shell alert", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-11-1-session-${run}@example.com`;
  await loginAsAdmin(request, context, baseURL, adminEmail);

  await page.goto(`${baseURL ?? ""}/admin`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });

  // Revoke session server-side + clear browser cookie
  await request.post("/api/auth/logout");
  await context.clearCookies();

  // Re-navigate or refresh as if session died mid-use
  await page.goto(`${baseURL ?? ""}/admin`, { waitUntil: "domcontentloaded" });

  // Must land on login (RequireRole fail-closed) — not privileged shell with alert
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  await expect(page.getByTestId("readiness-load-error")).toHaveCount(0);
  // Login surface is focused recovery
  await expect(page.getByTestId("login-page")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("login-form")).toBeVisible();
});

/** must-not: unauthenticated user reads admin overview */
test("11.1 must-not unauthenticated overview (redirect)", async ({
  page,
  baseURL,
}) => {
  await page.goto(`${baseURL ?? ""}/admin`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  await expect(page.getByTestId("page-readiness")).toHaveCount(0);
});

/** must-not: evaluator sees admin navigation capabilities */
test("11.1 must-not evaluator admin nav", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const email = `e2e-11-1-eval-${run}@example.com`;
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

  await page.goto(`${baseURL ?? ""}/admin`, { waitUntil: "domcontentloaded" });
  // Forbidden or redirect — never admin rail
  await expect(page.getByTestId("nav-overview")).toHaveCount(0);
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  await expect(page.getByTestId("page-readiness")).toHaveCount(0);
});
