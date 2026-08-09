/**
 * Section 10.2 — Admin evaluations progress UI (S-EVAL-UI).
 *
 * Named ACs:
 * - AC-10.2-A: /admin/evaluations loads without "Response validation failed";
 *   progress UI visible or honest empty (no-rubric / no-submissions).
 * - Negative: unauthenticated cannot read rollup (401).
 * - Negative: evaluator cannot read admin rollup (403).
 *
 * Does not re-own @inv:F01 (evaluator queue) — admin progress surface only.
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

async function selectEvent(
  page: import("@playwright/test").Page,
  eventId: string,
  path = "/admin/evaluations",
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

async function publishAndSubmit(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  title: string,
  run: string,
): Promise<string> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: `Eval Progress CFP ${run}` },
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

  const submit = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: published.formVersion.id,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [
        {
          name: "Progress Speaker",
          email: `progress-${run}@example.com`,
          isPrimary: true,
        },
      ],
      turnstileToken: "XXXX.DUMMY.TOKEN",
    },
  });
  expect(submit.status()).toBe(201);
  const body = (await submit.json()) as { submission: { id: string } };
  return body.submission.id;
}

test.describe("10.2 evaluations progress UI", () => {
  test("AC-10.2-A: admin evaluations loads progress without Response validation failed", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = Date.now().toString(36);
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-10-2-a-${run}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `10.2 Progress ${run}`,
    );

    // API contract first: empty (no rubric) is honest 200, never validation failed
    const emptyApi = await request.get(
      `/api/events/${event.id}/eval/rollup`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(emptyApi.status()).toBe(200);
    const emptyBody = (await emptyApi.json()) as {
      round: unknown;
      criteria: unknown[];
      submissions: unknown[];
      error?: string;
    };
    expect(emptyBody.error).toBeUndefined();
    expect(JSON.stringify(emptyBody).toLowerCase()).not.toContain(
      "response validation failed",
    );
    expect(emptyBody.round).toBeNull();
    expect(emptyBody.submissions).toEqual([]);

    await selectEvent(page, event.id, "/admin/evaluations");
    await expect(page.getByTestId("page-evaluations")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("eval-rollup-loading")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("eval-rollup-error")).toHaveCount(0);
    await expect(page.getByTestId("eval-rollup-section")).toBeVisible();
    // Honest empty: no rubric configured
    await expect(page.getByTestId("eval-rollup-no-rubric")).toBeVisible();

    // Upsert rubric + submission + score → progress table shows aggregate
    const rubric = await request.put(
      `/api/events/${event.id}/eval/rubric`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          name: "Progress rubric",
          criteria: [
            { name: "Relevance", maxScore: 5, weight: 1 },
            { name: "Delivery", maxScore: 5, weight: 1 },
          ],
        },
      },
    );
    expect(rubric.status()).toBe(200);
    const rubricBody = (await rubric.json()) as {
      criteria: Array<{ id: string }>;
    };

    const evaluator = await loginAs(
      request,
      context,
      baseURL,
      `e2e-10-2-eval-${run}@example.com`,
      "evaluator",
      event.id,
    );

    const submissionId = await publishAndSubmit(
      request,
      admin.session,
      event.id,
      event.slug,
      `Progress Talk ${run}`,
      run,
    );

    const assign = await request.post(
      `/api/submissions/${submissionId}/assign`,
      {
        headers: sessionHeaders(admin.session),
        data: { userIds: [evaluator.userId] },
      },
    );
    expect(assign.status()).toBe(200);
    const assignBody = (await assign.json()) as {
      assignments: Array<{ id: string }>;
    };

    const score = await request.post(
      `/api/assignments/${assignBody.assignments[0]!.id}/scores`,
      {
        headers: sessionHeaders(evaluator.session),
        data: {
          scores: rubricBody.criteria.map((c) => ({
            criterionId: c.id,
            value: 4,
          })),
        },
      },
    );
    expect(score.status()).toBe(200);

    const rollupApi = await request.get(
      `/api/events/${event.id}/eval/rollup`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(rollupApi.status()).toBe(200);
    const rollupJson = await rollupApi.json();
    expect(JSON.stringify(rollupJson).toLowerCase()).not.toContain(
      "response validation failed",
    );
    const rollup = rollupJson as {
      round: { id: string } | null;
      submissions: Array<{
        submissionId: string;
        aggregateScore: number | null;
      }>;
    };
    expect(rollup.round).not.toBeNull();
    const row = rollup.submissions.find(
      (s) => s.submissionId === submissionId,
    );
    expect(row).toBeTruthy();
    expect(row!.aggregateScore).toBe(4);

    // SPA: re-select event and prove table + no validation error
    await context.clearCookies();
    await context.addCookies([
      {
        name: "speakerops_session",
        value: admin.session,
        url: baseURL ?? "http://127.0.0.1:5173",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    await selectEvent(page, event.id, "/admin/evaluations");
    await expect(page.getByTestId("page-evaluations")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("eval-rollup-error")).toHaveCount(0);
    await expect(page.getByTestId("eval-rollup-section")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("eval-rollup-table")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId(`eval-rollup-row-${submissionId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`eval-aggregate-score-${submissionId}`),
    ).toContainText("4.00");
  });

  test("AC-10.2 negative: unauthenticated rollup is 401", async ({
    request,
  }) => {
    const res = await request.get("/api/events/evt_x/eval/rollup");
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("UNAUTHORIZED");
    expect(JSON.stringify(body).toLowerCase()).not.toContain(
      "response validation failed",
    );
  });

  test("AC-10.2 negative: evaluator cannot read admin rollup (403)", async ({
    request,
    context,
    baseURL,
  }) => {
    const run = Date.now().toString(36);
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-10-2-authz-admin-${run}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `10.2 Authz ${run}`,
    );
    const evaluator = await loginAs(
      request,
      context,
      baseURL,
      `e2e-10-2-authz-eval-${run}@example.com`,
      "evaluator",
      event.id,
    );
    const res = await request.get(
      `/api/events/${event.id}/eval/rollup`,
      { headers: sessionHeaders(evaluator.session) },
    );
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("FORBIDDEN");
  });
});
