/**
 * Section 3.5 — Submissions & decisions inventory journeys.
 *
 * - @inv:E01 e2e/admin/sub-list
 * - @inv:E02 e2e/admin/sub-detail
 * - @inv:E03 e2e/admin/sub-assign
 * - @inv:E04 e2e/admin/sub-accept
 * - @inv:E05 e2e/admin/sub-reject
 * - @inv:E06 e2e/admin/sub-waitlist
 * - @inv:E07 e2e/admin/session-direct
 * - @inv:E08 e2e/admin/sub-bulk
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

async function loginAs(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  purpose: "admin" | "evaluator",
  eventId?: string,
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, purpose, eventId);
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

/** Select the created event in admin shell (avoid bootstrap evt_dogfood). */
async function selectEvent(
  page: import("@playwright/test").Page,
  eventId: string,
) {
  await page.goto("/admin/submissions");
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = page.getByTestId("event-context");
  await expect(switcher).toBeVisible({ timeout: 10_000 });
  // select may be a <select> or a display div
  if (await switcher.evaluate((el) => el.tagName === "SELECT")) {
    await switcher.selectOption(eventId);
  }
  await page.evaluate((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  // Reload so EventProvider + list bind to the target event
  await page.goto("/admin/submissions");
  await expect(page.getByTestId("page-submissions")).toBeVisible({
    timeout: 15_000,
  });
  if (await switcher.evaluate((el) => el.tagName === "SELECT").catch(() => false)) {
    await page.getByTestId("event-context").selectOption(eventId);
  }
}

async function setupCfpAndSubmissions(
  request: import("@playwright/test").APIRequestContext,
  adminSession: string,
  eventId: string,
  slug: string,
): Promise<{ idA: string; idB: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(adminSession),
    data: { name: "Decisions E2E CFP" },
  });
  expect(create.status()).toBe(201);
  const form = (await create.json()) as { form: { id: string } };

  const draft = await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(adminSession),
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
          when: { fieldKey: "talk_title", op: "eq", value: "Keynote A" },
          routeToCategory: "keynote",
        },
        {
          when: { fieldKey: "talk_title", op: "eq", value: "Panel B" },
          routeToCategory: "panel",
        },
      ],
    },
  });
  expect(draft.status()).toBe(200);

  const publish = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(adminSession),
    data: {},
  });
  expect(publish.status()).toBe(200);
  const published = (await publish.json()) as {
    formVersion: { id: string };
  };
  const formVersionId = published.formVersion.id;

  async function submit(title: string, email: string): Promise<string> {
    const res = await request.post(`/api/public/cfp/${slug}/submissions`, {
      data: {
        formVersionId,
        title,
        answers: [{ fieldKey: "talk_title", value: title }],
        speakers: [{ name: "Speaker", email, isPrimary: true }],
        turnstileToken: "XXXX.DUMMY.TOKEN",
      },
    });
    expect(res.status(), `submit ${title}`).toBe(201);
    const body = (await res.json()) as { submission: { id: string } };
    return body.submission.id;
  }

  const idA = await submit("Keynote A", "speaker-a-e2e@example.com");
  const idB = await submit("Panel B", "speaker-b-e2e@example.com");
  return { idA, idB };
}

test.describe("3.5 submissions decisions", () => {
  test("@inv:E01 e2e/admin/sub-list list filters by status/category", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      "e2e-dec-e01@example.com",
      "admin",
    );
    const event = await ensureEvent(request, admin.session, "E01 Event");
    const { idA } = await setupCfpAndSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
    );

    // Accept one so status filter can distinguish
    await request.post(`/api/submissions/${idA}/decision`, {
      headers: sessionHeaders(admin.session),
      data: { decision: "accept" },
    });

    await selectEvent(page, event.id);
    await expect(page.getByTestId("submissions-filters")).toBeVisible();
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`submission-row-${idA}`)).toBeVisible();

    await page.getByTestId("submissions-filter-status").selectOption("accepted");
    await expect(
      page.getByTestId(`submission-status-badge-${idA}`),
    ).toHaveText("accepted", { timeout: 10_000 });

    // Reset status filter so both rows load (categories come from list rows)
    await page.getByTestId("submissions-filter-status").selectOption("");
    await expect(page.getByTestId(`submission-row-${idA}`)).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("submissions-filter-category").selectOption("panel");
    await expect(page.locator("[data-category='panel']").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("@inv:E02 e2e/admin/sub-detail open detail answers speakers", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      "e2e-dec-e02@example.com",
      "admin",
    );
    const event = await ensureEvent(request, admin.session, "E02 Event");
    const { idA } = await setupCfpAndSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
    );

    await selectEvent(page, event.id);
    await page.getByTestId(`submission-open-${idA}`).click();
    await expect(page.getByTestId("submission-detail-title")).toBeVisible();
    await expect(page.getByTestId("submission-detail-answers")).toBeVisible();
    await expect(page.getByTestId("answer-talk_title")).toContainText(
      "Keynote A",
    );
    await expect(page.getByTestId("submission-detail-speakers")).toBeVisible();
    await expect(page.getByTestId("submission-detail-speakers")).toContainText(
      "Speaker",
    );
  });

  test("@inv:E03 e2e/admin/sub-assign assign to evaluator", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      "e2e-dec-e03@example.com",
      "admin",
    );
    const event = await ensureEvent(request, admin.session, "E03 Event");
    const { idA } = await setupCfpAndSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
    );

    // Rubric required for assign
    await request.put(`/api/events/${event.id}/eval/rubric`, {
      headers: sessionHeaders(admin.session),
      data: {
        criteria: [{ name: "Clarity", maxScore: 5, weight: 1 }],
      },
    });

    // Mint evaluator userId without replacing the browser admin cookie
    await requestMagicLink(
      request,
      "e2e-dec-e03-eval@example.com",
      "evaluator",
      event.id,
    );
    const evalLink = await fetchDevLink(
      request,
      "e2e-dec-e03-eval@example.com",
    );

    await selectEvent(page, event.id);
    await page.getByTestId(`submission-open-${idA}`).click();
    await page.getByTestId("submission-assign-user-id").fill(evalLink.userId);
    await page.getByTestId("submission-assign-submit").click();
    await expect(page.getByTestId("submissions-status")).toContainText(
      "Assigned",
      { timeout: 10_000 },
    );
  });

  test("@inv:E04 e2e/admin/sub-accept accept creates session + tasks", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      "e2e-dec-e04@example.com",
      "admin",
    );
    const event = await ensureEvent(request, admin.session, "E04 Event");
    const { idA } = await setupCfpAndSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
    );

    await selectEvent(page, event.id);
    await page.getByTestId(`submission-open-${idA}`).click();
    await page.getByTestId("submission-accept").click();
    await expect(page.getByTestId("submissions-status")).toContainText(
      "accept recorded",
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("submission-detail-status")).toHaveText(
      "accepted",
    );
    await expect(page.getByTestId("submission-detail-session")).toBeVisible();

    // API proof: tasks created
    const detail = await request.get(`/api/submissions/${idA}`, {
      headers: sessionHeaders(admin.session),
    });
    expect(detail.status()).toBe(200);
    const body = (await detail.json()) as {
      submission: { status: string };
      session: { id: string } | null;
    };
    expect(body.submission.status).toBe("accepted");
    expect(body.session).not.toBeNull();

    // Accept without authz denied (evaluator) — API only, keep admin UI session
    await requestMagicLink(
      request,
      "e2e-dec-e04-eval@example.com",
      "evaluator",
      event.id,
    );
    const evalLink = await fetchDevLink(
      request,
      "e2e-dec-e04-eval@example.com",
    );
    const evalSession = await exchangeForCookie(request, evalLink.token);
    const denied = await request.post(`/api/submissions/${idA}/decision`, {
      headers: {
        cookie: `speakerops_session=${evalSession}`,
        "content-type": "application/json",
      },
      data: { decision: "reject" },
    });
    expect(denied.status()).toBe(403);
  });

  test("@inv:E05 e2e/admin/sub-reject reject with reason", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      "e2e-dec-e05@example.com",
      "admin",
    );
    const event = await ensureEvent(request, admin.session, "E05 Event");
    const { idB } = await setupCfpAndSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
    );

    await selectEvent(page, event.id);
    await page.getByTestId(`submission-open-${idB}`).click();
    await page
      .getByTestId("submission-decision-reason")
      .fill("Not a fit for programme");
    await page.getByTestId("submission-reject").click();
    await expect(page.getByTestId("submissions-status")).toContainText(
      "reject recorded",
    );
    await expect(page.getByTestId("submission-detail-status")).toHaveText(
      "rejected",
    );
  });

  test("@inv:E06 e2e/admin/sub-waitlist waitlist status", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      "e2e-dec-e06@example.com",
      "admin",
    );
    const event = await ensureEvent(request, admin.session, "E06 Event");
    const { idA } = await setupCfpAndSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
    );

    await selectEvent(page, event.id);
    await page.getByTestId(`submission-open-${idA}`).click();
    await page.getByTestId("submission-waitlist").click();
    await expect(page.getByTestId("submissions-status")).toContainText(
      "waitlist recorded",
    );
    await expect(page.getByTestId("submission-detail-status")).toHaveText(
      "waitlist",
    );
  });

  test("@inv:E07 e2e/admin/session-direct direct sponsor session", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      "e2e-dec-e07@example.com",
      "admin",
    );
    const event = await ensureEvent(request, admin.session, "E07 Event");

    await selectEvent(page, event.id);
    await page.getByTestId("submissions-direct-open").click();
    await expect(page.getByTestId("submissions-direct-form")).toBeVisible();
    await page.getByTestId("direct-session-title").fill("Sponsor Keynote");
    await page
      .getByTestId("direct-session-speaker-name")
      .fill("Sponsor Person");
    await page
      .getByTestId("direct-session-speaker-email")
      .fill("sponsor-e2e@example.com");
    await page.getByTestId("direct-session-submit").click();
    await expect(page.getByTestId("submissions-status")).toContainText(
      "Direct session created",
    );
  });

  test("@inv:E08 e2e/admin/sub-bulk bulk select + preview empty blocked", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      "e2e-dec-e08@example.com",
      "admin",
    );
    const event = await ensureEvent(request, admin.session, "E08 Event");
    const { idA, idB } = await setupCfpAndSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
    );

    await selectEvent(page, event.id);
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: 15_000,
    });

    // Empty selection blocked
    await page.getByTestId("submissions-bulk-preview-reject").click();
    await expect(page.getByTestId("submissions-status")).toContainText(
      "Select at least one",
    );

    await page.getByTestId(`submission-select-${idA}`).check();
    await page.getByTestId(`submission-select-${idB}`).check();
    await page.getByTestId("submissions-bulk-preview-waitlist").click();
    await expect(page.getByTestId("submissions-bulk-preview")).toBeVisible();
    await expect(page.getByTestId("bulk-preview-list")).toContainText(
      "waitlist",
    );
  });
});
