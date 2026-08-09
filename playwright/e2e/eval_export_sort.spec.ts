/**
 * Section 10.6 — Eval export/sort (S-EVAL-EXPORT / AC-10.6-B).
 *
 * - @inv:F05 e2e/eval/export
 *
 * Named ACs:
 * - AC-10.6-B: Sort by aggregate score; Export CSV of scores/status for event
 * - Negative: evaluator cannot export (403)
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  sessionHeaders,
  ensureEvent,
} from "./helpers/cfp-eval-seed.js";

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

async function publishCfp(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  run: string,
): Promise<string> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: `Export CFP ${run}` },
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
  return published.formVersion.id;
}

async function submitTalk(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
  formVersionId: string,
  title: string,
  email: string,
): Promise<string> {
  const submit = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [
        {
          name: "Export Speaker",
          email,
          isPrimary: true,
        },
      ],
      turnstileToken: "XXXX.DUMMY.TOKEN",
    },
  });
  expect(submit.status(), await submit.text()).toBe(201);
  const body = (await submit.json()) as { submission: { id: string } };
  return body.submission.id;
}

test.describe("10.6 eval export/sort", () => {
  test("AC-10.6-B @inv:F05 e2e/eval/export sort + CSV download", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = `export-${Date.now()}`;
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `admin-${run}@example.com`,
      "admin",
    );
    const event = await ensureEvent(request, admin.session, `Export ${run}`);
    const evaluator = await loginAs(
      request,
      context,
      baseURL,
      `eval-${run}@example.com`,
      "evaluator",
      event.id,
    );

    const rubric = await request.put(`/api/events/${event.id}/eval/rubric`, {
      headers: sessionHeaders(admin.session),
      data: {
        criteria: [{ name: "Quality", maxScore: 10, weight: 1 }],
      },
    });
    expect(rubric.status()).toBe(200);
    const rubricBody = (await rubric.json()) as {
      criteria: { id: string }[];
    };
    const criterionId = rubricBody.criteria[0]!.id;

    const formVersionId = await publishCfp(
      request,
      admin.session,
      event.id,
      run,
    );
    const lowId = await submitTalk(
      request,
      event.slug,
      formVersionId,
      "Low Export Talk",
      `low-${run}@example.com`,
    );
    const highId = await submitTalk(
      request,
      event.slug,
      formVersionId,
      "High Export Talk",
      `high-${run}@example.com`,
    );

    for (const [submissionId, value] of [
      [lowId, 3],
      [highId, 9],
    ] as const) {
      const assign = await request.post(
        `/api/submissions/${submissionId}/assign`,
        {
          headers: sessionHeaders(admin.session),
          data: { userIds: [evaluator.userId] },
        },
      );
      expect(assign.status()).toBe(200);
      const assignBody = (await assign.json()) as {
        assignments: { id: string }[];
      };
      const score = await request.post(
        `/api/assignments/${assignBody.assignments[0]!.id}/scores`,
        {
          headers: sessionHeaders(evaluator.session),
          data: {
            scores: [{ criterionId, value }],
          },
        },
      );
      expect(score.status()).toBe(200);
    }

    // Restore admin browser session (evaluator login replaced cookie).
    await loginAs(
      request,
      context,
      baseURL,
      `admin-${run}@example.com`,
      "admin",
    );
    await selectEvent(page, event.id);

    await expect(page.getByTestId("page-evaluations")).toBeVisible();
    await expect(page.getByTestId("eval-rollup-table")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("eval-sort-select")).toBeVisible();
    await expect(page.getByTestId("eval-export-csv")).toBeVisible();

    // Default score_desc: high row before low in DOM order
    const rowOrder = await page
      .locator("[data-testid^=eval-rollup-row-]")
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-testid") ?? ""),
      );
    const highIdx = rowOrder.indexOf(`eval-rollup-row-${highId}`);
    const lowIdx = rowOrder.indexOf(`eval-rollup-row-${lowId}`);
    expect(highIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeGreaterThanOrEqual(0);
    expect(highIdx).toBeLessThan(lowIdx);

    await page.getByTestId("eval-sort-select").selectOption("score_asc");
    await expect(page.getByTestId("eval-rollup-table")).toHaveAttribute(
      "data-sort",
      "score_asc",
    );
    const ascOrder = await page
      .locator("[data-testid^=eval-rollup-row-]")
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-testid") ?? ""),
      );
    expect(ascOrder.indexOf(`eval-rollup-row-${lowId}`)).toBeLessThan(
      ascOrder.indexOf(`eval-rollup-row-${highId}`),
    );

    // Export via real network path (button → GET /eval/export).
    // Browser may consume the body for download — assert status/type here,
    // then re-fetch CSV with session credentials for content checks.
    const exportWait = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/events/${event.id}/eval/export`) &&
        r.request().method() === "GET",
    );
    await page.getByTestId("eval-export-csv").click();
    const exportRes = await exportWait;
    expect(exportRes.status()).toBe(200);
    const ct = exportRes.headers()["content-type"] ?? "";
    expect(ct).toMatch(/text\/csv/);

    // Content proof on the same domain path (admin session on request fixture).
    const adminAgain = await loginAs(
      request,
      context,
      baseURL,
      `admin-${run}@example.com`,
      "admin",
    );
    const csvRes = await request.get(
      `/api/events/${event.id}/eval/export?sort=score_asc`,
      {
        headers: {
          cookie: `speakerops_session=${adminAgain.session}`,
          accept: "text/csv",
        },
      },
    );
    expect(csvRes.status()).toBe(200);
    const csv = await csvRes.text();
    expect(csv).toContain("aggregateScore");
    expect(csv).toContain(highId);
    expect(csv).toContain(lowId);
    // score_asc: low before high in file order
    expect(csv.indexOf(lowId)).toBeLessThan(csv.indexOf(highId));
  });

  test("negative: evaluator cannot export scores (403)", async ({
    request,
    context,
    baseURL,
  }) => {
    const run = `export-neg-${Date.now()}`;
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `admin-${run}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Export Neg ${run}`,
    );
    const evaluator = await loginAs(
      request,
      context,
      baseURL,
      `eval-${run}@example.com`,
      "evaluator",
      event.id,
    );

    const evalExport = await request.get(
      `/api/events/${event.id}/eval/export`,
      {
        headers: {
          cookie: `speakerops_session=${evaluator.session}`,
          accept: "text/csv",
        },
      },
    );
    expect(evalExport.status()).toBe(403);
  });
});
