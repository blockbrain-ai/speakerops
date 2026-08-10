/**
 * Section 11.4 — Submissions + evaluations Lumen 2 composition (S-L2-SUB).
 *
 * Named ACs:
 * - AC-11.4-BULK   Selection reveals sticky bulk bar with actions
 * - AC-11.4-DETAIL Detail hierarchy (not raw dump); master-detail layout
 * - AC-11.4-FILTER Filter chips drive list; active filter chips clearable
 * - AC-11.4-EVAL   Coverage table + readable progress (admin + evaluator)
 * - AC-11.4-AUTHZ  Unauth blocked; evaluator cannot see admin nav capabilities
 *
 * Inventory E01–E08 / F01–F05 remain owned by submissions_decisions /
 * eval_scoring / evaluations_progress. This file proves L2 composition.
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";
import {
  ensureEvent,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
  upsertRubric,
  selectAdminEvent,
} from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN = `e2e-l2sub-admin-${RUN}@example.com`;
const EVAL = `e2e-l2sub-eval-${RUN}@example.com`;
const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, "admin");
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await seedSessionCookie(context, baseURL, session);
  return { session, userId: link.userId };
}

async function loginAsEvaluator(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  eventId: string,
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, "evaluator", eventId);
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await seedSessionCookie(context, baseURL, session);
  return { session, userId: link.userId };
}

async function seedCfpSubmissions(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  titles: string[],
): Promise<string[]> {
  const createRes = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/forms`,
    {
      headers: sessionHeaders(session),
      data: { name: `L2 Sub form ${RUN}` },
    },
  );
  expect(createRes.status(), await createRes.text()).toBe(201);
  const created = (await createRes.json()) as { form: { id: string } };
  const formId = created.form.id;

  const draftRes = await request.put(
    `/api/forms/${encodeURIComponent(formId)}/draft`,
    {
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
          {
            fieldKey: "abstract",
            type: "textarea",
            label: "Abstract",
            required: true,
            sortOrder: 1,
          },
        ],
        rules: [],
        welcomeMd: "L2 submissions seed",
        thankYouMd: "Thanks",
        opensAt: "2020-01-01T00:00:00.000Z",
        closesAt: "2099-12-31T23:59:59.000Z",
      },
    },
  );
  expect(draftRes.status(), await draftRes.text()).toBe(200);

  const pubRes = await request.post(
    `/api/forms/${encodeURIComponent(formId)}/publish`,
    {
      headers: sessionHeaders(session),
      data: {},
    },
  );
  expect(pubRes.status(), await pubRes.text()).toBe(200);
  const published = (await pubRes.json()) as {
    formVersion: { id: string };
  };
  const formVersionId = published.formVersion.id;

  const ids: string[] = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i]!;
    const res = await request.post(`/api/public/cfp/${slug}/submissions`, {
      data: {
        formVersionId,
        title,
        answers: [
          { fieldKey: "talk_title", value: title },
          { fieldKey: "abstract", value: `Abstract for ${title}` },
        ],
        speakers: [
          {
            name: `Speaker ${i + 1}`,
            email: `l2sub-sp-${i}-${RUN}@example.com`,
            isPrimary: true,
          },
        ],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { submission: { id: string } };
    ids.push(body.submission.id);
  }
  return ids;
}

async function openSubmissions(
  page: import("@playwright/test").Page,
  eventId: string,
  baseURL: string | undefined,
) {
  await selectAdminEvent(page, baseURL, eventId, "/admin/submissions");
  await expect(page.getByTestId("page-submissions")).toBeVisible({
    timeout: 15_000,
  });
}

async function openEvaluations(
  page: import("@playwright/test").Page,
  eventId: string,
  baseURL: string | undefined,
) {
  await selectAdminEvent(page, baseURL, eventId, "/admin/evaluations");
  await expect(page.getByTestId("page-evaluations")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("11.4 submissions + evaluations lumen2", () => {
  test("AC-11.4-BULK selection reveals sticky bulk bar", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAsAdmin(request, context, baseURL, ADMIN);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Sub Bulk ${RUN}`,
      `l2-sub-bulk-${RUN}`,
    );
    const [idA, idB] = await seedCfpSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
      [`Bulk Talk A ${RUN}`, `Bulk Talk B ${RUN}`],
    );

    await openSubmissions(page, event.id, baseURL);
    await expect(page.getByTestId("page-submissions")).toHaveAttribute(
      "data-section",
      "11.4",
    );
    await expect(page.getByTestId("page-submissions")).toHaveAttribute(
      "data-layout",
      "master-detail",
    );
    await expect(page.getByTestId("submissions-page-header")).toBeVisible();
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: 15_000,
    });

    // Bulk bar hidden until selection
    await expect(page.getByTestId("submissions-table-bulk")).toHaveCount(0);

    await page.getByTestId(`submission-select-${idA}`).check();
    await page.getByTestId(`submission-select-${idB}`).check();

    const bulk = page.getByTestId("submissions-table-bulk");
    await expect(bulk).toBeVisible();
    await expect(page.getByTestId("submissions-bulk-count")).toContainText(
      "2 selected",
    );
    await expect(page.getByTestId("submissions-bulk-bar-accept")).toBeVisible();
    await expect(page.getByTestId("submissions-bulk-bar-reject")).toBeVisible();
    await expect(
      page.getByTestId("submissions-bulk-bar-waitlist"),
    ).toBeVisible();

    await page.getByTestId("submissions-bulk-bar-waitlist").click();
    await expect(page.getByTestId("submissions-bulk-preview")).toBeVisible({
      timeout: 10_000,
    });
    // Tightened for polish veto #3: preview shows display labels, not raw
    // status values ("Submitted → Waitlist").
    await expect(page.getByTestId("bulk-preview-list")).toContainText(
      "Waitlist",
    );

    await page.getByTestId("submissions-bulk-clear").click();
    await expect(page.getByTestId("submissions-table-bulk")).toHaveCount(0);
  });

  test("AC-11.4-DETAIL hierarchy + filter chips", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      `e2e-l2sub-detail-${RUN}@example.com`,
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Sub Detail ${RUN}`,
      `l2-sub-detail-${RUN}`,
    );
    const [idA] = await seedCfpSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
      [`Detail Talk ${RUN}`],
    );

    await openSubmissions(page, event.id, baseURL);
    await expect(page.getByTestId("submissions-filter-chips")).toBeVisible();
    await expect(page.getByTestId("submissions-chip-status-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("submissions-master-detail")).toBeVisible();
    await expect(page.getByTestId("submissions-detail-empty")).toBeVisible();

    await page.getByTestId(`submission-open-${idA}`).click();
    await expect(page.getByTestId("submission-detail-hierarchy")).toBeVisible();
    await expect(page.getByTestId("submission-detail-header")).toBeVisible();
    await expect(page.getByTestId("submission-detail-title")).toContainText(
      `Detail Talk ${RUN}`,
    );
    await expect(
      page.getByTestId("submission-detail-section-speakers"),
    ).toBeVisible();
    await expect(
      page.getByTestId("submission-detail-section-answers"),
    ).toBeVisible();
    await expect(page.getByTestId("submission-detail-answers")).toBeVisible();
    await expect(page.getByTestId("answer-talk_title")).toContainText(
      `Detail Talk ${RUN}`,
    );
    await expect(
      page.getByTestId("submission-detail-section-assign"),
    ).toBeVisible();
    await expect(
      page.getByTestId("submission-detail-section-decision"),
    ).toBeVisible();
    await expect(page.getByTestId("submission-decision-actions")).toBeVisible();

    // Filter chip → submitted
    await page.getByTestId("submissions-chip-status-submitted").click();
    await expect(
      page.getByTestId("submissions-chip-status-submitted"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("submissions-active-filters")).toBeVisible();
    await expect(
      page.getByTestId("submissions-active-filter-status"),
    ).toContainText("submitted");
    await expect(page.getByTestId(`submission-row-${idA}`)).toBeVisible({
      timeout: 10_000,
    });

    // Chip accepted → empty list for this event
    await page.getByTestId("submissions-chip-status-accepted").click();
    await expect(page.getByTestId("submissions-empty")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("submissions-clear-filters").click();
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("AC-11.4-EVAL coverage progress admin + evaluator queue", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      `e2e-l2sub-evaladmin-${RUN}@example.com`,
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Eval ${RUN}`,
      `l2-eval-${RUN}`,
    );
    await upsertRubric(request, admin.session, event.id);
    const [subId] = await seedCfpSubmissions(
      request,
      admin.session,
      event.id,
      event.slug,
      [`Eval Coverage Talk ${RUN}`],
    );

    // Assign evaluator
    const evalLoginPrep = await loginAsEvaluator(
      request,
      context,
      baseURL,
      EVAL,
      event.id,
    );
    // Re-seed admin cookie after evaluator login overwrote context cookie
    await seedSessionCookie(context, baseURL, admin.session);

    const assignRes = await request.post(
      `/api/submissions/${encodeURIComponent(subId)}/assign`,
      {
        headers: sessionHeaders(admin.session),
        data: { userIds: [evalLoginPrep.userId] },
      },
    );
    expect(assignRes.status(), await assignRes.text()).toBe(200);

    await openEvaluations(page, event.id, baseURL);
    await expect(page.getByTestId("page-evaluations")).toHaveAttribute(
      "data-section",
      "11.4",
    );
    await expect(page.getByTestId("page-evaluations")).toHaveAttribute(
      "data-layout",
      "coverage-table",
    );
    await expect(page.getByTestId("evaluations-page-header")).toBeVisible();
    await expect(page.getByTestId("eval-rollup-section")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("eval-coverage-summary")).toBeVisible();
    await expect(page.getByTestId("eval-coverage-progress")).toBeVisible();
    await expect(page.getByTestId("eval-coverage-progress-label")).toBeVisible();
    await expect(page.getByTestId("eval-rollup-table")).toBeVisible();
    await expect(
      page.getByTestId(`eval-rollup-row-${subId}`),
    ).toBeVisible();
    await expect(page.getByTestId(`eval-coverage-${subId}`)).toBeVisible();
    await expect(page.getByTestId(`eval-coverage-${subId}`)).toHaveAttribute(
      "data-total",
      "1",
    );
    // Pending assignment → 0% scored coverage
    await expect(page.getByTestId(`eval-coverage-${subId}`)).toHaveAttribute(
      "data-scored",
      "0",
    );

    // Evaluator low-distraction queue
    await seedSessionCookie(context, baseURL, evalLoginPrep.session);
    await page.goto(`${baseURL ?? ""}/eval`);
    await expect(page.getByTestId("evaluator-queue")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("evaluator-queue")).toHaveAttribute(
      "data-layout",
      "low-distraction",
    );
    await expect(page.getByTestId("eval-queue-progress")).toBeVisible();
    await expect(page.getByTestId("eval-queue-progress-bar")).toBeVisible();
    await expect(page.getByTestId("eval-queue-progress-label")).toContainText(
      "0 of 1",
    );
    await expect(page.getByTestId("eval-score-panel")).toBeVisible();
    await expect(page.getByTestId("eval-score-keyboard-hint")).toBeVisible();
    // F03 still: no accept controls
    await expect(page.getByTestId("submission-accept")).toHaveCount(0);
  });

  test("AC-11.4-AUTHZ unauth blocked; evaluator no admin nav", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // Unauthenticated admin submissions → login
    await page.goto(`${baseURL ?? ""}/admin/submissions`);
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.getByTestId("page-submissions")).toHaveCount(0);

    // Unauthenticated evaluations
    await page.goto(`${baseURL ?? ""}/admin/evaluations`);
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByTestId("page-evaluations")).toHaveCount(0);

    // Unauthenticated rollup API
    const rollup = await request.get("/api/events/not-a-real-event/eval/rollup");
    expect([401, 403, 404]).toContain(rollup.status());

    // Evaluator must not see admin primary nav (BareLayout, not AdminShell)
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      `e2e-l2sub-authz-admin-${RUN}@example.com`,
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Authz ${RUN}`,
      `l2-authz-${RUN}`,
    );
    await loginAsEvaluator(
      request,
      context,
      baseURL,
      `e2e-l2sub-authz-eval-${RUN}@example.com`,
      event.id,
    );
    await page.goto(`${baseURL ?? ""}/eval`);
    await expect(page.getByTestId("evaluator-queue")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.getByTestId("nav-submissions")).toHaveCount(0);
    await expect(page.getByTestId("nav-evaluations")).toHaveCount(0);
  });
});
