/**
 * Post-11.9 depth Wave 1A — evaluation knobs (S-EVAL depth).
 *
 * F10: evaluator abstains with a reason via the queue modal → assignment
 *      leaves the pending flow; admin rollup counts the abstention distinctly,
 *      shows the reason, and the aggregate is unchanged by the abstention.
 * F11: round deadline renders in the queue banner; setting a past deadline in
 *      Rubric settings locks scoring server-side (fresh API 409) and the queue
 *      shows an honest closed state.
 * F12: Admin evaluations insights — completion bar, Top 10 by aggregate
 *      (linked to submission detail), and the divergence (spread) list.
 *
 * Inventory: @inv:F10 @inv:F11 @inv:F12 (one per test).
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). New critical spec → retries 0.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  upsertRubric,
  selectAdminEvent,
  seedSessionCookie,
  sessionHeaders,
} from "./helpers/cfp-eval-seed";

test.describe.configure({ retries: 0 });

/** Publish a minimal CFP form; returns the published version id. */
async function publishCfp(
  request: APIRequestContext,
  session: string,
  eventId: string,
): Promise<string> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: "Depth Eval CFP" },
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
  const pub = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(session),
  });
  expect(pub.status()).toBe(200);
  const published = (await pub.json()) as { formVersion: { id: string } };
  return published.formVersion.id;
}

async function submitProposal(
  request: APIRequestContext,
  slug: string,
  versionId: string,
  title: string,
): Promise<string> {
  const res = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: versionId,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [
        {
          name: `Speaker ${title}`,
          email: `speaker-${title.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}@example.com`,
        },
      ],
      turnstileToken: "XXXX.DUMMY.TOKEN",
    },
  });
  expect(res.status(), `Submission.Create ${res.status()}`).toBe(201);
  const body = (await res.json()) as { submission: { id: string } };
  return body.submission.id;
}

async function assignEvaluators(
  request: APIRequestContext,
  session: string,
  submissionId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const res = await request.post(`/api/submissions/${submissionId}/assign`, {
    headers: sessionHeaders(session),
    data: { userIds },
  });
  expect(res.status(), `assign ${res.status()}`).toBe(200);
  const body = (await res.json()) as {
    assignments: Array<{ id: string; evaluatorUserId: string }>;
  };
  return new Map(body.assignments.map((a) => [a.evaluatorUserId, a.id]));
}

async function scoreAssignment(
  request: APIRequestContext,
  session: string,
  assignmentId: string,
  criterionIds: string[],
  value: number,
): Promise<void> {
  const res = await request.post(`/api/assignments/${assignmentId}/scores`, {
    headers: sessionHeaders(session),
    data: {
      scores: criterionIds.map((criterionId) => ({ criterionId, value })),
    },
  });
  expect(res.status(), `score ${res.status()}`).toBe(200);
}

test.describe("Wave 1A — evaluation depth", () => {
  test("@inv:F10 e2e/eval/abstain queue abstain with reason; rollup counts distinctly; aggregate unchanged", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const stamp = Date.now();
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f10-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Abstain Event ${stamp}`,
    );
    const versionId = await publishCfp(request, admin.session, event.id);
    const submissionId = await submitProposal(
      request,
      event.slug,
      versionId,
      `Abstain Talk ${stamp}`,
    );
    const rubric = await upsertRubric(request, admin.session, event.id);
    const criterionIds = rubric.criteria.map((c) => c.id);

    // Two evaluators; B scores 4 so the aggregate has a known value.
    const evalA = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f10-eval-a-${stamp}@example.com`,
      "evaluator",
      event.id,
    );
    const evalB = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f10-eval-b-${stamp}@example.com`,
      "evaluator",
      event.id,
    );
    const byUser = await assignEvaluators(request, admin.session, submissionId, [
      evalA.userId,
      evalB.userId,
    ]);
    const assignmentA = byUser.get(evalA.userId)!;
    await scoreAssignment(
      request,
      evalB.session,
      byUser.get(evalB.userId)!,
      criterionIds,
      4,
    );

    // Evaluator A abstains through the real queue modal.
    await seedSessionCookie(context, baseURL, evalA.session);
    await page.goto("/eval");
    const queueItem = page.getByTestId(`eval-queue-item-${assignmentA}`);
    await expect(queueItem).toBeVisible({ timeout: 15_000 });
    await queueItem.click();
    await expect(page.getByTestId("eval-abstain-open")).toBeEnabled();
    await page.getByTestId("eval-abstain-open").click();
    await expect(page.getByTestId("eval-abstain-modal")).toBeVisible();
    await page
      .getByTestId("eval-abstain-reason")
      .fill("Conflict of interest — we worked together.");
    await page.getByTestId("eval-abstain-confirm").click();
    await expect(page.getByTestId("eval-score-status")).toContainText(
      /abstained/i,
      { timeout: 10_000 },
    );

    // Gone from the pending flow: item shows Abstained + pending filter hides it.
    await expect(queueItem).toContainText("Abstained");
    await expect(queueItem).toHaveAttribute("data-complete", "1");
    await page.getByTestId("eval-queue-filter").selectOption("pending");
    await expect(queueItem).toHaveCount(0);

    // Second abstain rejected server-side (fresh API, 409).
    const again = await request.post(
      `/api/me/eval-assignments/${assignmentA}/abstain`,
      {
        headers: sessionHeaders(evalA.session),
        data: { reason: "again" },
      },
    );
    expect(again.status(), "second abstain must 409").toBe(409);

    // Admin rollup: abstention counted distinctly; reason visible; aggregate = 4.
    await seedSessionCookie(context, baseURL, admin.session);
    await selectAdminEvent(page, baseURL, event.id, "/admin/evaluations");
    await expect(page.getByTestId("eval-coverage-abstained")).toContainText(
      /1 review abstained/i,
      { timeout: 15_000 },
    );
    await expect(
      page.getByTestId(`eval-aggregate-score-${submissionId}`),
    ).toHaveText("4.00");
    await page.getByTestId(`eval-reviews-toggle-${submissionId}`).click();
    await expect(
      page.getByTestId(`eval-review-abstain-reason-${assignmentA}`),
    ).toContainText("Conflict of interest — we worked together.");
  });

  test("@inv:F11 e2e/eval/round-close deadline renders; past deadline locks scoring (409) + closed banner", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const stamp = Date.now();
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f11-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Round Close Event ${stamp}`,
    );
    const versionId = await publishCfp(request, admin.session, event.id);
    const submissionId = await submitProposal(
      request,
      event.slug,
      versionId,
      `Close Talk ${stamp}`,
    );
    // Rubric with a FUTURE deadline + instructions (API seed; UI edits below).
    const rubricRes = await request.put(
      `/api/events/${event.id}/eval/rubric`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          name: "Deadline rubric",
          criteria: [{ name: "Overall", maxScore: 5, weight: 1 }],
          closesAt: "2030-06-01T12:00:00.000Z",
          instructionsMd: "Please score before the deadline.",
        },
      },
    );
    expect(rubricRes.status()).toBe(200);
    const rubric = (await rubricRes.json()) as {
      round: { id: string };
      criteria: Array<{ id: string }>;
    };

    const evaluator = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f11-eval-${stamp}@example.com`,
      "evaluator",
      event.id,
    );
    const byUser = await assignEvaluators(
      request,
      admin.session,
      submissionId,
      [evaluator.userId],
    );
    const assignmentId = byUser.get(evaluator.userId)!;

    // Future deadline renders in the queue banner (open state).
    await seedSessionCookie(context, baseURL, evaluator.session);
    await page.goto("/eval");
    const strip = page.getByTestId("eval-round-strip");
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toHaveAttribute("data-round-closed", "0");
    await expect(page.getByTestId("eval-round-strip-deadline")).toContainText(
      "2030",
    );
    await expect(
      page.getByTestId("eval-round-strip-instructions"),
    ).toContainText("Please score before the deadline.");

    // Admin moves the deadline into the past through Rubric settings UI.
    await seedSessionCookie(context, baseURL, admin.session);
    await selectAdminEvent(page, baseURL, event.id, "/admin/cfp");
    await page.goto("/admin/settings/rubric");
    await expect(page.getByTestId("rubric-form")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("rubric-closes-at")).toHaveValue(/2030/);
    await page.getByTestId("rubric-closes-at").fill("2020-01-01T00:00");
    await page.getByTestId("rubric-save").click();
    await expect(page.getByTestId("rubric-status")).toContainText(
      /rubric saved/i,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("rubric-closed-note")).toBeVisible();

    // Server-side: fresh API score is rejected with 409 + human copy.
    const late = await request.post(`/api/assignments/${assignmentId}/scores`, {
      headers: sessionHeaders(evaluator.session),
      data: { scores: [{ criterionId: rubric.criteria[0]!.id, value: 3 }] },
    });
    expect(late.status(), "score after close must 409").toBe(409);
    const lateBody = (await late.json()) as { error: string };
    expect(lateBody.error.toLowerCase()).toContain("closed");
    const lateAbstain = await request.post(
      `/api/me/eval-assignments/${assignmentId}/abstain`,
      { headers: sessionHeaders(evaluator.session), data: {} },
    );
    expect(lateAbstain.status(), "abstain after close must 409").toBe(409);

    // Queue shows the closed state and locks the panel.
    await seedSessionCookie(context, baseURL, evaluator.session);
    await page.goto("/eval");
    await expect(page.getByTestId("eval-round-strip")).toHaveAttribute(
      "data-round-closed",
      "1",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("eval-round-strip-closed")).toContainText(
      /closed/i,
    );
    await page.getByTestId(`eval-queue-item-${assignmentId}`).click();
    await expect(page.getByTestId("eval-score-round-closed")).toBeVisible();
    await expect(page.getByTestId("eval-score-save")).toBeDisabled();
    await expect(page.getByTestId("eval-abstain-open")).toBeDisabled();
  });

  test("@inv:F12 e2e/eval/insights top-10 ordering + divergence spread from seeded varied scores", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const stamp = Date.now();
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f12-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Insights Event ${stamp}`,
    );
    const versionId = await publishCfp(request, admin.session, event.id);
    const subTop = await submitProposal(
      request,
      event.slug,
      versionId,
      `Consensus Hit ${stamp}`,
    );
    const subSplit = await submitProposal(
      request,
      event.slug,
      versionId,
      `Divisive Talk ${stamp}`,
    );
    const subLow = await submitProposal(
      request,
      event.slug,
      versionId,
      `Quiet Entry ${stamp}`,
    );
    const rubric = await upsertRubric(request, admin.session, event.id);
    const criteria = rubric.criteria.map((c) => c.id);

    const evalA = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f12-eval-a-${stamp}@example.com`,
      "evaluator",
      event.id,
    );
    const evalB = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f12-eval-b-${stamp}@example.com`,
      "evaluator",
      event.id,
    );

    // Varied scores (rubric criteria max 5): top ≈4.5 both agree; split 1 vs 5
    // (spread 4); low 2 both agree (spread 0 → excluded from divergence).
    const plan: Array<[string, number, number]> = [
      [subTop, 4.5, 4.5],
      [subSplit, 1, 5],
      [subLow, 2, 2],
    ];
    for (const [submissionId, aScore, bScore] of plan) {
      const byUser = await assignEvaluators(
        request,
        admin.session,
        submissionId,
        [evalA.userId, evalB.userId],
      );
      for (const [who, value] of [
        [evalA, aScore],
        [evalB, bScore],
      ] as const) {
        const res = await request.post(
          `/api/assignments/${byUser.get(who.userId)!}/scores`,
          {
            headers: sessionHeaders(who.session),
            data: {
              scores: criteria.map((criterionId) => ({
                criterionId,
                value,
              })),
            },
          },
        );
        expect(res.status()).toBe(200);
      }
    }

    // Admin insights: completion bar, top-10 ordering, divergence list.
    await seedSessionCookie(context, baseURL, admin.session);
    await selectAdminEvent(page, baseURL, event.id, "/admin/evaluations");
    await expect(page.getByTestId("eval-insights")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("eval-coverage-progress")).toHaveAttribute(
      "data-pct",
      "100",
    );

    // Top 10 ordered: consensus (4.5) → split (3.0) → low (2.0).
    await expect(page.getByTestId("eval-insights-top-1")).toHaveAttribute(
      "data-submission-id",
      subTop,
    );
    await expect(page.getByTestId("eval-insights-top-2")).toHaveAttribute(
      "data-submission-id",
      subSplit,
    );
    await expect(page.getByTestId("eval-insights-top-3")).toHaveAttribute(
      "data-submission-id",
      subLow,
    );
    await expect(page.getByTestId("eval-insights-top-1")).toContainText(
      "4.50",
    );

    // Divergence list: the seeded divisive submission leads with spread 4.
    await expect(
      page.getByTestId("eval-insights-divergence-1"),
    ).toHaveAttribute("data-submission-id", subSplit);
    await expect(
      page.getByTestId("eval-insights-divergence-1"),
    ).toHaveAttribute("data-spread", "4.00");
    // Zero-spread rows are excluded from the divergence list.
    await expect(
      page.locator(
        `[data-testid^="eval-insights-divergence-"][data-submission-id="${subLow}"]`,
      ),
    ).toHaveCount(0);

    // Top entries link to the submission detail.
    await expect(
      page.getByTestId(`eval-insights-top-link-${subTop}`),
    ).toHaveAttribute(
      "href",
      `/admin/submissions?submissionId=${subTop}`,
    );
  });
});
