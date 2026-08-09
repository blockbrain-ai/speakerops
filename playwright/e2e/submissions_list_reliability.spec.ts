/**
 * Section 10.1 — Admin submissions list reliability at scale (S-SUB-LIST).
 *
 * Named ACs:
 * - AC-10.1-A: Fixture ≥150 submissions: SPA shows ≥1 row; loading hidden ≤5000ms
 * - AC-10.1-B: API failure shows recovery; spinner does not persist
 * - AC-10.1-C: Unauthenticated list → 401/redirect (must-not leak rows)
 * - AC-10.1-D: Cross-event scoping (covered in unit; SPA binds to active event)
 * - AC-10.1-E: Pagination contract; filters server-side; SPA keeps filters
 *
 * Regression: does not re-own @inv:E01 / L02 / L05 (those stay in
 * submissions_decisions + states_cross_cutting + readiness_dashboard).
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

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
  expect(body.link?.userId).toBeTruthy();
  return { token: body.link!.token, userId: body.link!.userId! };
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
): Promise<{ session: string; userId: string }> {
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
  return { session: sessionValue, userId: link.userId };
}

function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
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
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { event: { id: string; slug: string } };
  return { id: body.event.id, slug: body.event.slug };
}

async function selectEvent(
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

/**
 * Publish CFP + seed `count` submissions (dogfood-shaped ≥150).
 * Relies on e2e-api-server permissive rate limiter.
 */
async function seedSubmissionsBulk(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  count: number,
  run: string,
): Promise<{ formVersionId: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: `Reliability CFP ${run}` },
  });
  expect(create.status()).toBe(201);
  const form = (await create.json()) as { form: { id: string } };

  const draft = await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "talk_title",
          type: "text",
          label: "Talk title",
          required: true,
          sortOrder: 0,
        },
      ],
      rules: [
        {
          when: { fieldKey: "talk_title", op: "eq", value: "Keynote seed" },
          routeToCategory: "keynote",
        },
      ],
    },
  });
  expect(draft.status()).toBe(200);

  const publish = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(session),
    data: {},
  });
  expect(publish.status()).toBe(200);
  const published = (await publish.json()) as {
    formVersion: { id: string };
  };
  const formVersionId = published.formVersion.id;

  // Batch sequential posts (rate limiter raised in e2e-api-server for 10.1)
  for (let i = 0; i < count; i++) {
    const title =
      i === 0 ? "Keynote seed" : `Talk ${String(i).padStart(3, "0")} ${run}`;
    const res = await request.post(`/api/public/cfp/${slug}/submissions`, {
      data: {
        formVersionId,
        title,
        answers: [{ fieldKey: "talk_title", value: title }],
        speakers: [
          {
            name: `Speaker ${i}`,
            email: `s${i}-${run}@example.com`,
            isPrimary: true,
          },
        ],
        turnstileToken: "XXXX.DUMMY.TOKEN",
      },
    });
    expect(res.status(), `submit #${i}`).toBe(201);
  }

  return { formVersionId };
}

test.describe("10.1 submissions list reliability", () => {
  test("AC-10.1-A fixture ≥150: page-submissions + ≥1 row; loading gone ≤5s", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = Date.now().toString(36);
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      `e2e-10-1-a-${run}@example.com`,
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `10.1 Scale ${run}`,
    );
    await seedSubmissionsBulk(
      request,
      admin.session,
      event.id,
      event.slug,
      150,
      run,
    );

    // Prove API page contract before SPA (total 150, window ≤25)
    const api = await request.get(
      `/api/events/${event.id}/submissions?limit=25&offset=0`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(api.status()).toBe(200);
    const apiBody = (await api.json()) as {
      submissions: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    expect(apiBody.total).toBe(150);
    expect(apiBody.submissions.length).toBeGreaterThanOrEqual(1);
    expect(apiBody.submissions.length).toBeLessThanOrEqual(25);
    expect(apiBody.limit).toBe(25);

    // Bind event, then start 5s protocol clock at goto navigation commit
    await page.goto("/admin/submissions");
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await page.evaluate((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);

    const start = Date.now();
    await page.goto("/admin/submissions");
    // Navigation commit ≈ response received for document
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("page-submissions")).toBeVisible({
      timeout: 5_000,
    });

    // Select event if switcher present (may re-fetch)
    const switcher = page.getByTestId("event-context");
    if (
      await switcher
        .evaluate((el) => el.tagName === "SELECT")
        .catch(() => false)
    ) {
      await switcher.selectOption(event.id).catch(() => undefined);
    }

    // Loading must clear and ≥1 data row within 5000ms of clock start
    await expect(page.getByTestId("submissions-loading")).toBeHidden({
      timeout: Math.max(500, 5_000 - (Date.now() - start)),
    });
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: Math.max(500, 5_000 - (Date.now() - start)),
    });
    const rows = page.locator("[data-testid^='submission-row-']");
    await expect(rows.first()).toBeVisible({
      timeout: Math.max(500, 5_000 - (Date.now() - start)),
    });
    expect(Date.now() - start).toBeLessThanOrEqual(5_000);

    await expect(page.getByTestId("submissions-list-meta")).toHaveAttribute(
      "data-total",
      "150",
    );
    const visible = await page
      .getByTestId("submissions-table")
      .getAttribute("data-visible");
    expect(Number(visible)).toBeGreaterThan(0);
    expect(Number(visible)).toBeLessThanOrEqual(25);

    // Pager present for 150 / 25
    await expect(page.getByTestId("submissions-pager")).toBeVisible();
  });

  test("AC-10.1-B API failure shows recovery; spinner does not persist", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = Date.now().toString(36);
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      `e2e-10-1-b-${run}@example.com`,
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `10.1 Error ${run}`,
    );

    await page.route(`**/api/events/${event.id}/submissions**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Internal server error (e2e AC-10.1-B)",
          code: "INTERNAL",
        }),
      });
    });

    await selectEvent(page, event.id);
    await expect(page.getByTestId("page-submissions")).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByTestId("submissions-loading")).toBeHidden({
      timeout: 10_000,
    });
    await expect(page.getByTestId("submissions-error-state")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("submissions-load-error")).toContainText(
      /error|Failed|Internal/i,
    );
    await expect(page.getByTestId("submissions-error-retry")).toBeVisible();
    // No data leak of privileged rows
    await expect(page.getByTestId("submissions-table")).toHaveCount(0);
  });

  test("AC-10.1-C unauthenticated list → 401 (must-not leak rows)", async ({
    request,
    browser,
    baseURL,
  }) => {
    // Seed as admin on a fresh request context with auth
    const adminCtx = await browser.newContext();
    const adminReq = adminCtx.request;
    const run = Date.now().toString(36);
    await requestMagicLink(adminReq, `e2e-10-1-c-admin-${run}@example.com`);
    const link = await fetchDevLink(
      adminReq,
      `e2e-10-1-c-admin-${run}@example.com`,
    );
    const session = await exchangeForCookie(adminReq, link.token);
    const event = await ensureEvent(
      adminReq,
      session,
      `10.1 Unauth ${run}`,
    );
    await seedSubmissionsBulk(
      adminReq,
      session,
      event.id,
      event.slug,
      3,
      run,
    );
    await adminCtx.close();

    // Unauthenticated API
    const res = await request.get(`/api/events/${event.id}/submissions`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).not.toHaveProperty("submissions");
    expect(JSON.stringify(body)).not.toMatch(/Talk|Keynote seed/i);

    // Unauthenticated SPA — no privileged rows
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${baseURL ?? ""}/admin/submissions`);
    // Should redirect to login or show auth gate — never table rows
    await page.waitForTimeout(1_500);
    const tableCount = await page.getByTestId("submissions-table").count();
    expect(tableCount).toBe(0);
    const rowCount = await page.locator("[data-testid^='submission-row-']").count();
    expect(rowCount).toBe(0);
    await page.close();
  });

  test("AC-10.1-E pagination keeps filters server-side", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = Date.now().toString(36);
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      `e2e-10-1-e-${run}@example.com`,
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `10.1 Pager ${run}`,
    );
    // 30 rows → 2 pages at page size 25; one keynote for filter
    await seedSubmissionsBulk(
      request,
      admin.session,
      event.id,
      event.slug,
      30,
      run,
    );

    await selectEvent(page, event.id);
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("submissions-list-meta")).toHaveAttribute(
      "data-total",
      "30",
    );
    await expect(page.getByTestId("submissions-pager")).toBeVisible();

    // Page 2
    await page.getByTestId("submissions-page-next").click();
    await expect(page.getByTestId("submissions-page-label")).toContainText(
      "Page 2",
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("submissions-list-meta")).toHaveAttribute(
      "data-total",
      "30",
    );

    // Apply status filter — resets to page 1, server-side
    await page.getByTestId("submissions-filter-status").selectOption("submitted");
    await expect(page.getByTestId("submissions-loading")).toBeHidden({
      timeout: 10_000,
    });
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: 10_000,
    });
    // All visible rows submitted
    const badges = page.locator("[data-testid^='submission-status-badge-']");
    const n = await badges.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(badges.nth(i)).toHaveText("submitted");
    }

    // Category filter (keynote from first seed title)
    await page.getByTestId("submissions-filter-status").selectOption("");
    await page
      .getByTestId("submissions-filter-category")
      .selectOption("keynote")
      .catch(async () => {
        // If category options not yet populated, wait for meta reload
        await expect(page.getByTestId("submissions-list-meta")).toBeVisible();
        await page
          .getByTestId("submissions-filter-category")
          .selectOption("keynote");
      });
    await expect(page.getByTestId("submissions-loading")).toBeHidden({
      timeout: 10_000,
    });
    const meta = page.getByTestId("submissions-list-meta");
    const total = await meta.getAttribute("data-total");
    expect(Number(total)).toBeGreaterThanOrEqual(1);
    expect(Number(total)).toBeLessThan(30);
  });

  test("AC-10.1-D cross-event: active event A does not show event B rows", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = Date.now().toString(36);
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      `e2e-10-1-d-${run}@example.com`,
    );
    const eventA = await ensureEvent(
      request,
      admin.session,
      `10.1 EventA ${run}`,
    );
    const eventB = await ensureEvent(
      request,
      admin.session,
      `10.1 EventB ${run}`,
    );
    await seedSubmissionsBulk(
      request,
      admin.session,
      eventA.id,
      eventA.slug,
      3,
      `${run}a`,
    );
    await seedSubmissionsBulk(
      request,
      admin.session,
      eventB.id,
      eventB.slug,
      3,
      `${run}b`,
    );

    // List B API must not include A ids
    const listB = await request.get(`/api/events/${eventB.id}/submissions`, {
      headers: sessionHeaders(admin.session),
    });
    const bodyB = (await listB.json()) as {
      submissions: Array<{ id: string; eventId: string; title: string }>;
    };
    expect(bodyB.submissions.every((s) => s.eventId === eventB.id)).toBe(true);
    expect(bodyB.submissions.some((s) => s.title.includes(`${run}a`))).toBe(
      false,
    );

    await selectEvent(page, eventA.id);
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: 15_000,
    });
    // Event A table shows A titles only
    await expect(page.getByText(`${run}a`).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(`${run}b`)).toHaveCount(0);
  });
});
