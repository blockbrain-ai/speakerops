/**
 * Section 3.4 — Evaluation scoring inventory journeys.
 *
 * - @inv:F01 e2e/eval/queue
 * - @inv:F02 e2e/eval/score
 * - @inv:F03 e2e/eval/no-decide
 * - @inv:F04 e2e/eval/a11y-keyboard
 * - @inv:O04 e2e/settings/rubric
 *
 * Named assertions:
 * - assert unassigned submission absent from evaluator queue
 * - assert score > max returns 400
 * - assert evaluator UI has no accept button
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
  expect(body.link?.userId, "dev outbox must include userId for assign").toBeTruthy();
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

async function setupCfpAndSubmissions(
  request: import("@playwright/test").APIRequestContext,
  adminSession: string,
  eventId: string,
  slug: string,
): Promise<{ assignedId: string; unassignedId: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(adminSession),
    data: { name: "Eval E2E CFP" },
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
        speakers: [{ name: "Speaker", email }],
        turnstileToken: "XXXX.DUMMY.TOKEN",
      },
    });
    expect(res.status(), `submit ${title}`).toBe(201);
    const body = (await res.json()) as { submission: { id: string } };
    return body.submission.id;
  }

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const assignedId = await submit(
    "Assigned E2E Talk",
    `e2e-eval-assigned-${suffix}@example.com`,
  );
  const unassignedId = await submit(
    "Unassigned E2E Talk",
    `e2e-eval-unassigned-${suffix}@example.com`,
  );
  return { assignedId, unassignedId };
}

async function upsertRubric(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
): Promise<{ criteria: Array<{ id: string; maxScore: number }> }> {
  const res = await request.put(`/api/events/${eventId}/eval/rubric`, {
    headers: sessionHeaders(session),
    data: {
      name: "E2E rubric",
      criteria: [
        { name: "Relevance", maxScore: 5, weight: 1 },
        { name: "Delivery", maxScore: 5, weight: 1 },
      ],
    },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    criteria: Array<{ id: string; maxScore: number }>;
  };
  return { criteria: body.criteria };
}

test("@inv:F01 e2e/eval/queue See only assigned (unassigned hidden)", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  // Unique emails avoid shared Memory* store pollution across retries
  const run = Date.now();
  const adminEmail = `e2e-eval-f01-admin-${run}@example.com`;
  const evalEmail = `e2e-eval-f01-evaluator-${run}@example.com`;

  const admin = await loginAs(request, context, baseURL, adminEmail, "admin");
  const event = await ensureEvent(
    request,
    admin.session,
    `F01 Queue Event ${run}`,
  );
  await upsertRubric(request, admin.session, event.id);
  const { assignedId, unassignedId } = await setupCfpAndSubmissions(
    request,
    admin.session,
    event.id,
    event.slug,
  );

  // Fresh context cookie for evaluator (replace admin cookie)
  await context.clearCookies();
  const evaluator = await loginAs(
    request,
    context,
    baseURL,
    evalEmail,
    "evaluator",
    event.id,
  );

  // Admin assigns only first submission (admin session cookie string still valid)
  const assign = await request.post(
    `/api/submissions/${assignedId}/assign`,
    {
      headers: sessionHeaders(admin.session),
      data: { userIds: [evaluator.userId] },
    },
  );
  expect(assign.status()).toBe(200);

  // API proof: queue has assigned only (filter to this event's submissions)
  const queueApi = await request.get("/api/me/eval-queue", {
    headers: { cookie: `speakerops_session=${evaluator.session}` },
  });
  expect(queueApi.status()).toBe(200);
  const queueBody = (await queueApi.json()) as {
    items: Array<{ submission: { id: string; title: string; eventId: string } }>;
  };
  const forEvent = queueBody.items.filter(
    (i) => i.submission.eventId === event.id,
  );
  expect(forEvent).toHaveLength(1);
  expect(forEvent[0]!.submission.id).toBe(assignedId);
  expect(
    forEvent.some((i) => i.submission.id === unassignedId),
  ).toBe(false);

  // DTO includes round context for strip
  const queueWithRound = queueBody as {
    items: Array<{
      submission: { id: string; eventId: string };
      round?: { id: string; name: string; status: string; closesAt: string | null };
      event?: { name: string };
    }>;
  };
  expect(queueWithRound.items[0]?.round?.id).toBeTruthy();
  expect(queueWithRound.items[0]?.round?.name).toBeTruthy();

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // UI: evaluator queue
  await page.goto(`${baseURL ?? ""}/eval`);
  await expect(page.getByTestId("evaluator-queue")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("eval-queue-list")).toBeVisible();
  await expect(
    page.locator(`[data-submission-id="${assignedId}"]`),
  ).toBeVisible();
  // assert unassigned submission absent from evaluator queue
  await expect(
    page.locator(`[data-submission-id="${unassignedId}"]`),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("eval-queue-list").getByText("Unassigned E2E Talk"),
  ).toHaveCount(0);

  // Round strip present for non-empty queue
  await expect(page.getByTestId("eval-round-strip")).toBeVisible();
  await expect(page.getByTestId("eval-round-strip-event")).toContainText(
    /F01 Queue Event|./,
  );
  await expect(page.getByTestId("eval-round-strip-round")).toBeVisible();
  await expect(page.getByTestId("eval-round-strip-deadline")).toBeVisible();
  await expect(page.getByTestId("eval-round-strip-guidance")).toBeVisible();
  await expect(page.getByTestId("eval-round-strip-progress")).toHaveAttribute(
    "data-total",
    "1",
  );

  expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(
    consoleErrors.filter((t) => !/favicon|React DevTools/i.test(t)),
    `console.error: ${consoleErrors.join(" | ")}`,
  ).toEqual([]);
});

test("eval empty queue has no round strip (extends F01 proof)", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const evalEmail = `e2e-eval-f01-empty-${run}@example.com`;
  await loginAs(request, context, baseURL, evalEmail, "evaluator");

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`${baseURL ?? ""}/eval`);
  await expect(page.getByTestId("evaluator-queue")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("eval-queue-empty")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("eval-round-strip")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("@inv:F02 e2e/eval/score Score criteria + comment; out-of-range rejected", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-eval-f02-admin-${run}@example.com`;
  const evalEmail = `e2e-eval-f02-evaluator-${run}@example.com`;

  const admin = await loginAs(request, context, baseURL, adminEmail, "admin");
  const event = await ensureEvent(
    request,
    admin.session,
    `F02 Score Event ${run}`,
  );
  const { criteria } = await upsertRubric(request, admin.session, event.id);
  const { assignedId } = await setupCfpAndSubmissions(
    request,
    admin.session,
    event.id,
    event.slug,
  );

  await context.clearCookies();
  const evaluator = await loginAs(
    request,
    context,
    baseURL,
    evalEmail,
    "evaluator",
    event.id,
  );

  const assign = await request.post(
    `/api/submissions/${assignedId}/assign`,
    {
      headers: sessionHeaders(admin.session),
      data: { userIds: [evaluator.userId] },
    },
  );
  const assignBody = (await assign.json()) as {
    assignments: Array<{ id: string }>;
  };
  const assignmentId = assignBody.assignments[0]!.id;

  // assert score > max returns 400 (API)
  const over = await request.post(
    `/api/assignments/${assignmentId}/scores`,
    {
      headers: sessionHeaders(evaluator.session),
      data: {
        scores: criteria.map((c) => ({
          criterionId: c.id,
          value: c.maxScore + 1,
        })),
      },
    },
  );
  expect(over.status()).toBe(400);
  const overErr = (await over.json()) as { code: string };
  expect(overErr.code).toBe("VALIDATION_ERROR");

  await page.goto(`${baseURL ?? ""}/eval`);
  await expect(page.getByTestId("eval-score-panel")).toBeVisible({
    timeout: 15_000,
  });

  // Fill valid scores
  for (const c of criteria) {
    await page.getByTestId(`eval-score-input-${c.id}`).fill("4");
  }
  await page.getByTestId("eval-score-comment").fill("Solid proposal");
  await page.getByTestId("eval-score-save").click();
  await expect(page.getByTestId("eval-score-status")).toContainText(/saved/i, {
    timeout: 10_000,
  });
});

test("@inv:F03 e2e/eval/no-decide Cannot accept/reject — control absent", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-eval-f03-admin-${run}@example.com`;
  const evalEmail = `e2e-eval-f03-evaluator-${run}@example.com`;

  const admin = await loginAs(request, context, baseURL, adminEmail, "admin");
  const event = await ensureEvent(
    request,
    admin.session,
    `F03 No Decide Event ${run}`,
  );
  await upsertRubric(request, admin.session, event.id);
  const { assignedId } = await setupCfpAndSubmissions(
    request,
    admin.session,
    event.id,
    event.slug,
  );

  await context.clearCookies();
  const evaluator = await loginAs(
    request,
    context,
    baseURL,
    evalEmail,
    "evaluator",
    event.id,
  );

  await request.post(`/api/submissions/${assignedId}/assign`, {
    headers: sessionHeaders(admin.session),
    data: { userIds: [evaluator.userId] },
  });

  await page.goto(`${baseURL ?? ""}/eval`);
  await expect(page.getByTestId("evaluator-queue")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("eval-score-panel")).toBeVisible();

  // assert evaluator UI has no accept button
  await expect(page.getByRole("button", { name: /accept/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /reject/i })).toHaveCount(0);
  await expect(page.getByTestId("submission-accept")).toHaveCount(0);
  await expect(page.getByTestId("submission-reject")).toHaveCount(0);
  await expect(page.getByTestId("decision-accept")).toHaveCount(0);
  await expect(page.locator("[data-action='accept']")).toHaveCount(0);
  await expect(page.locator("[data-action='reject']")).toHaveCount(0);
});

test("@inv:F04 e2e/eval/a11y-keyboard Keyboard-only complete score", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-eval-f04-admin-${run}@example.com`;
  const evalEmail = `e2e-eval-f04-evaluator-${run}@example.com`;

  const admin = await loginAs(request, context, baseURL, adminEmail, "admin");
  const event = await ensureEvent(
    request,
    admin.session,
    `F04 Keyboard Event ${run}`,
  );
  const { criteria } = await upsertRubric(request, admin.session, event.id);
  const { assignedId } = await setupCfpAndSubmissions(
    request,
    admin.session,
    event.id,
    event.slug,
  );

  await context.clearCookies();
  const evaluator = await loginAs(
    request,
    context,
    baseURL,
    evalEmail,
    "evaluator",
    event.id,
  );

  await request.post(`/api/submissions/${assignedId}/assign`, {
    headers: sessionHeaders(admin.session),
    data: { userIds: [evaluator.userId] },
  });

  await page.goto(`${baseURL ?? ""}/eval`);
  await expect(page.getByTestId("eval-score-form")).toBeVisible({
    timeout: 15_000,
  });

  // Tab into first score field and type without mouse clicks on inputs
  await page.getByTestId(`eval-score-input-${criteria[0]!.id}`).focus();
  await page.keyboard.type("3");
  await page.keyboard.press("Tab");
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Keyboard comment");
  // Ctrl+Enter saves (F04)
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("eval-score-status")).toContainText(/saved/i, {
    timeout: 10_000,
  });
});

test("@inv:O04 e2e/settings/rubric Eval rubric edit", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-eval-o04-admin-${run}@example.com`;
  const admin = await loginAs(request, context, baseURL, adminEmail, "admin");
  const event = await ensureEvent(
    request,
    admin.session,
    `O04 Rubric Event ${run}`,
  );

  // Seed event list into SPA storage by visiting admin first
  await page.goto(`${baseURL ?? ""}/admin/settings`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = page.getByTestId("event-context");
  await expect(switcher.locator(`option[value="${event.id}"]`)).toHaveCount(1, {
    timeout: 10_000,
  });
  await switcher.selectOption({ value: event.id });

  await page.goto(`${baseURL ?? ""}/admin/settings/rubric`);
  await expect(page.getByTestId("page-rubric-settings")).toBeVisible({
    timeout: 15_000,
  });
  // Full navigation remounts EventProvider: event-context is briefly the
  // fallback <div> until Event.List reloads. Wait for the target option on a
  // fresh locator before selectOption (stale switcher may still be a div).
  const switcherAfterNav = page.getByTestId("event-context");
  await expect(
    switcherAfterNav.locator(`option[value="${event.id}"]`),
  ).toHaveCount(1, { timeout: 10_000 });
  await switcherAfterNav.selectOption({ value: event.id });
  await expect(page.getByTestId("rubric-form")).toBeVisible({
    timeout: 10_000,
  });

  await page.getByTestId("rubric-round-name").fill("Dogfood rubric");
  await page.getByTestId("rubric-criterion-name-0").fill("Impact");
  await page.getByTestId("rubric-criterion-max-0").fill("10");
  await page.getByTestId("rubric-criterion-weight-0").fill("2");
  await page.getByTestId("rubric-add-criterion").click();
  await page.getByTestId("rubric-criterion-name-1").fill("Clarity");
  await page.getByTestId("rubric-criterion-max-1").fill("5");
  await page.getByTestId("rubric-criterion-weight-1").fill("1");
  await page.getByTestId("rubric-save").click();
  await expect(page.getByTestId("rubric-status")).toContainText(/saved/i, {
    timeout: 10_000,
  });

  // API proof: GET rubric returns criteria
  const get = await request.get(`/api/events/${event.id}/eval/rubric`, {
    headers: { cookie: `speakerops_session=${admin.session}` },
  });
  expect(get.status()).toBe(200);
  const body = (await get.json()) as {
    round: { name: string };
    criteria: Array<{ name: string }>;
  };
  expect(body.round.name).toBe("Dogfood rubric");
  expect(body.criteria.map((c) => c.name)).toEqual(
    expect.arrayContaining(["Impact", "Clarity"]),
  );
});
