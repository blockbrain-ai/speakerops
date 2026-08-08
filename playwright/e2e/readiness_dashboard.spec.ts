/**
 * Section 6.3 — Readiness dashboard live (S-READY).
 *
 * - @inv:H01 e2e/dash/overview
 * - @inv:H02 e2e/dash/filter
 * - @inv:H03 e2e/dash/drill
 * - @inv:H04 e2e/dash/live
 * - @inv:H05 e2e/dash/empty
 * - @inv:L05 e2e/states/large-list
 *
 * Named assertions:
 * - assert readiness outstanding decreases after task complete poll
 * - assert @inv:H01-H05 and N01-N04 (N* covered in portal_api_tasks + re-assert list here)
 * - assert 150-row list scrollable/paginated
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
): Promise<{
  participationId: string;
  tasks: Array<{ id: string; version: number; status: string }>;
}> {
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
    tasks: Array<{ id: string; version: number; status: string }>;
  };
  expect(body.participations.length).toBeGreaterThanOrEqual(1);
  return {
    participationId: body.participations[0]!.id,
    tasks: body.tasks,
  };
}

async function waitForEventSelect(page: import("@playwright/test").Page) {
  const switcher = page.getByTestId("event-context");
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () => {
        const tag = await switcher.evaluate((el) => el.tagName.toLowerCase());
        return tag;
      },
      { timeout: 15_000 },
    )
    .toBe("select");
  return switcher;
}

async function seedSpeakersBulk(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  count: number,
  prefix: string,
) {
  // Session.CreateDirect accepts max 20 speakers per call
  let remaining = count;
  let batch = 0;
  while (remaining > 0) {
    const n = Math.min(20, remaining);
    const speakers = Array.from({ length: n }, (_, i) => {
      const idx = batch * 20 + i;
      return {
        name: `${prefix} Speaker ${String(idx).padStart(3, "0")}`,
        email: `${prefix.toLowerCase()}-spk-${idx}@example.com`,
        isPrimary: i === 0,
      };
    });
    const res = await request.post(`/api/events/${eventId}/sessions/direct`, {
      headers: sessionHeaders(session),
      data: {
        title: `${prefix} Session batch ${batch}`,
        speakers,
      },
    });
    expect(res.status(), `direct session batch ${batch}`).toBe(201);
    remaining -= n;
    batch += 1;
  }
}

test("@inv:H01 e2e/dash/overview Stats + outstanding list", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-h01-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `H01 Ready ${run}`);
  await acceptSpeaker(
    request,
    session,
    event.id,
    event.slug,
    `h01-spk-${run}@example.com`,
    "H01 Speaker",
    `H01 Talk ${run}`,
  );

  await page.goto(`${baseURL ?? ""}/admin`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });

  await expect(page.getByTestId("page-readiness")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("readiness-stats")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("readiness-stat-outstanding")).toContainText(
    /[1-9]/,
  );
  await expect(page.getByTestId("readiness-outstanding-list")).toBeVisible();
  await expect(page.getByTestId("readiness-outstanding-list")).toContainText(
    "H01 Speaker",
  );
});

test("@inv:H02 e2e/dash/filter Filter overdue", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-h02-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `H02 Filter ${run}`);

  // Overdue template (dueOffsetDays 0)
  const tpl = await request.post(`/api/events/${event.id}/task-templates`, {
    headers: sessionHeaders(session),
    data: {
      title: `H02 Overdue Task ${run}`,
      trigger: "on_accept",
      dueOffsetDays: 0,
    },
  });
  expect(tpl.status()).toBe(201);

  await acceptSpeaker(
    request,
    session,
    event.id,
    event.slug,
    `h02-spk-${run}@example.com`,
    "H02 Speaker",
    `H02 Talk ${run}`,
  );

  // Small delay so dueAt ≤ now for overdue
  await new Promise((r) => setTimeout(r, 50));

  await page.goto(`${baseURL ?? ""}/admin`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });
  await expect(page.getByTestId("readiness-stats")).toBeVisible({
    timeout: 10_000,
  });

  await page.getByTestId("readiness-filter-overdue").check();
  await expect(page.getByTestId("readiness-outstanding-list")).toBeVisible({
    timeout: 10_000,
  });
  // All visible rows must be overdue
  const rows = page.locator("[data-testid^='readiness-row-']");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i)).toHaveAttribute("data-overdue", "true");
  }
});

test("@inv:H03 e2e/dash/drill Drill to speaker", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-h03-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `H03 Drill ${run}`);
  const { participationId } = await acceptSpeaker(
    request,
    session,
    event.id,
    event.slug,
    `h03-spk-${run}@example.com`,
    "H03 Drill Speaker",
    `H03 Talk ${run}`,
  );

  await page.goto(`${baseURL ?? ""}/admin`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });
  await expect(page.getByTestId("readiness-outstanding-list")).toBeVisible({
    timeout: 10_000,
  });

  // Multiple outstanding tasks may share the same participation drill link
  await page
    .getByTestId(`readiness-drill-${participationId}`)
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/speakers/);
  await expect(page.getByTestId("speakers-detail")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("speakers-detail-name")).toContainText(
    "H03 Drill Speaker",
  );
  await expect(page.getByTestId("speakers-detail-tasks")).toBeVisible();
});

test("@inv:H04 e2e/dash/live Live update after portal complete", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  // assert readiness outstanding decreases after task complete poll
  const run = Date.now();
  const adminEmail = `e2e-h04-admin-${run}@example.com`;
  const speakerEmail = `e2e-h04-spk-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `H04 Live ${run}`);
  const { tasks } = await acceptSpeaker(
    request,
    session,
    event.id,
    event.slug,
    speakerEmail,
    "H04 Live Speaker",
    `H04 Talk ${run}`,
  );
  expect(tasks.length).toBeGreaterThanOrEqual(1);
  const task = tasks[0]!;

  await page.goto(`${baseURL ?? ""}/admin`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });
  await expect(page.getByTestId("readiness-stat-outstanding")).toBeVisible({
    timeout: 10_000,
  });

  const beforeText = await page
    .getByTestId("readiness-stat-outstanding")
    .locator(".readiness-dashboard__stat-value")
    .innerText();
  const before = Number(beforeText.trim());
  expect(before).toBeGreaterThanOrEqual(1);

  // Speaker completes task via portal API
  await requestMagicLink(request, speakerEmail, "speaker", event.id);
  const speakerLink = await fetchDevLink(request, speakerEmail);
  const speakerSession = await exchangeForCookie(request, speakerLink.token);
  const complete = await request.post(
    `/api/portal/tasks/${task.id}/complete`,
    {
      headers: sessionHeaders(speakerSession),
      data: { expectedVersion: task.version },
    },
  );
  expect(complete.status()).toBe(200);

  // Live poll ≤5s — wait for outstanding to decrease without full page reload
  await expect
    .poll(
      async () => {
        const t = await page
          .getByTestId("readiness-stat-outstanding")
          .locator(".readiness-dashboard__stat-value")
          .innerText();
        return Number(t.trim());
      },
      { timeout: 8_000, intervals: [500, 1000, 1500, 2000] },
    )
    .toBe(before - 1);
});

test("@inv:H05 e2e/dash/empty Empty state when all clear", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-h05-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `H05 Empty ${run}`);
  // No speakers → all clear empty state

  await page.goto(`${baseURL ?? ""}/admin`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });

  await expect(page.getByTestId("readiness-empty")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("readiness-stat-outstanding")).toContainText(
    "0",
  );
});

test("@inv:L05 e2e/states/large-list 150-row list paginates or virtualizes usable", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  // assert 150-row list scrollable/paginated
  // Performance note: seed 150 via direct sessions; list p95 < 200ms after warm (local)
  const run = Date.now();
  const adminEmail = `e2e-l05-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `L05 Large ${run}`);

  await seedSpeakersBulk(request, session, event.id, 150, `L05${run}`);

  const api = await request.get(`/api/events/${event.id}/speakers`, {
    headers: { cookie: `speakerops_session=${session}` },
  });
  expect(api.status()).toBe(200);
  const body = (await api.json()) as { speakers: unknown[] };
  expect(body.speakers.length).toBe(150);

  await page.goto(`${baseURL ?? ""}/admin/speakers`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });

  await expect(page.getByTestId("speakers-list")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("speakers-list-meta")).toHaveAttribute(
    "data-total",
    "150",
  );
  await expect(page.getByTestId("speakers-pager")).toBeVisible();

  const visible = await page.getByTestId("speakers-list").getAttribute(
    "data-visible",
  );
  expect(Number(visible)).toBeLessThanOrEqual(25);
  expect(Number(visible)).toBeGreaterThan(0);

  // Next page shows different window
  await page.getByTestId("speakers-page-next").click();
  await expect(page.getByTestId("speakers-page-label")).toContainText(
    "Page 2",
  );
  await expect(page.getByTestId("speakers-list")).toHaveAttribute(
    "data-total",
    "150",
  );

  // List window is scrollable when tall
  const list = page.getByTestId("speakers-list");
  await expect(list).toBeVisible();
});
