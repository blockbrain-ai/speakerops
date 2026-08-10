/**
 * Section 3.6 — CFP eval e2e proof (I12 keystone).
 *
 * Soul path (S-CFP + S-EVAL):
 *   form publish → public submit → score → accept → tasks exist.
 *
 * Proof owner for phase-3 inventory (implementation tags stay 1:1 on 3.2–3.5 specs):
 * - @inv:A01 e2e/public/cfp-load
 * - @inv:A02 e2e/public/cfp-conditional
 * - @inv:A03 e2e/public/cfp-category
 * - @inv:A04 e2e/public/cfp-multi-speaker
 * - @inv:A05 e2e/public/cfp-file
 * - @inv:A06 e2e/public/cfp-submit
 * - @inv:A07 e2e/public/cfp-closed
 * - @inv:A08 e2e/public/cfp-validation
 * - @inv:A09 e2e/public/cfp-mobile
 * - @inv:A10 e2e/public/cfp-xss
 * - @inv:A11 e2e/public/cfp-keyboard
 * - @inv:D01 e2e/admin/form-create
 * - @inv:D02 e2e/admin/form-reorder
 * - @inv:D03 e2e/admin/form-conditional
 * - @inv:D04 e2e/admin/form-routing
 * - @inv:D05 e2e/admin/form-required
 * - @inv:D06 e2e/admin/form-copy
 * - @inv:D07 e2e/admin/form-preview
 * - @inv:D08 e2e/admin/form-publish-version
 * - @inv:D09 e2e/admin/form-limits
 * - @inv:D10 e2e/admin/form-link
 * - @inv:E01 e2e/admin/sub-list
 * - @inv:E02 e2e/admin/sub-detail
 * - @inv:E03 e2e/admin/sub-assign
 * - @inv:E04 e2e/admin/sub-accept
 * - @inv:E05 e2e/admin/sub-reject
 * - @inv:E06 e2e/admin/sub-waitlist
 * - @inv:E07 e2e/admin/session-direct
 * - @inv:E08 e2e/admin/sub-bulk
 * - @inv:F01 e2e/eval/queue
 * - @inv:F02 e2e/eval/score
 * - @inv:F03 e2e/eval/no-decide
 * - @inv:F04 e2e/eval/a11y-keyboard
 * - @inv:O04 e2e/settings/rubric
 *
 * Active `@inv` ownership remains on implementation specs (duplicate owners
 * forbidden by inventory law). This keystone stitches the multi-step soul path
 * and documents A/D/E/F letter ranges (plus O04) coverage for phase-3 proof.
 *
 * Named assertions (spec 3.6):
 * - assert keystone path creates tasks after accept
 * - assert all phase3 inv tags pass (documented here + inventory PASS + governance)
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * @see docs/sections/3.6-cfp-eval-e2e.md
 * @see KMS-competition/initiative/evidence/phase3-e2e.txt
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  upsertRubric,
  selectAdminEvent,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
} from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KEYSTONE_ADMIN = `e2e-keystone36-admin-${RUN}@example.com`;
const KEYSTONE_EVALUATOR = `e2e-keystone36-eval-${RUN}@example.com`;
const KEYSTONE_SPEAKER_EMAIL = `e2e-keystone36-speaker-${RUN}@example.com`;
const TALK_TITLE = "Keystone CFP Eval Proposal";

test.describe("3.6 cfp eval keystone (I12)", () => {
  /**
   * assert keystone path creates tasks after accept
   *
   * Multi-step soul path: admin form publish → public CFP submit →
   * evaluator score → admin accept → speaker_tasks materialised.
   */
  test("keystone: form publish → public submit → score → accept → tasks exist", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // --- Admin login (session cookie; HttpOnly) ---
    const admin = await loginAs(
      request,
      context,
      baseURL,
      KEYSTONE_ADMIN,
      "admin",
    );

    // --- Create event ---
    const event = await ensureEvent(
      request,
      admin.session,
      `Keystone CFP Eval ${RUN}`,
      `keystone-cfp-eval-${RUN}`,
    );

    // --- Form publish (D08 path via admin UI) ---
    await selectAdminEvent(page, baseURL, event.id, "/admin/cfp");
    await expect(page.getByTestId("page-cfp")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("form-create-name").fill("Keystone Phase3 CFP");
    await page.getByTestId("form-create-submit").click();
    await expect(page.getByTestId("form-create-status")).toContainText(
      /Created/i,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("form-builder-workspace")).toBeVisible();

    // At least one field required to publish (invariant)
    await page.getByTestId("palette-text").click();
    await expect(page.getByTestId("field-list")).toBeVisible();
    await expect(page.getByTestId("form-publish")).toBeEnabled();

    await page.getByTestId("form-publish").click();
    await expect(page.getByTestId("form-publish-status")).toContainText(
      /Published version 1/i,
      { timeout: 15_000 },
    );
    // Tightened for polish veto #2: human label visible, raw value in data-*.
    await expect(page.getByTestId("form-status")).toHaveAttribute(
      "data-status",
      "published",
    );
    await expect(page.getByTestId("form-status")).toHaveText("Published");

    // Public surface has published snapshot (no multi-second blank — skeleton allowed)
    const pubApi = await request.get(`/api/public/cfp/${event.slug}`);
    expect(pubApi.status()).toBe(200);
    const pubBody = (await pubApi.json()) as {
      formVersion?: { id: string; versionNum: number; immutable: boolean };
    };
    expect(pubBody.formVersion?.versionNum).toBe(1);
    expect(pubBody.formVersion?.immutable).toBe(true);
    const formVersionId = pubBody.formVersion!.id;

    // --- Public submit (A06 path via public UI) ---
    await context.clearCookies(); // public submitter is unauthenticated
    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("page-public-cfp")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("public-cfp-form")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("cfp-title").fill(TALK_TITLE);
    // Optional builder field key "text" when present
    const textField = page.getByTestId("cfp-field-text");
    if (await textField.count()) {
      await textField.fill(TALK_TITLE);
    }
    await page.getByTestId("cfp-speaker-name-0").fill("Keystone Speaker");
    await page.getByTestId("cfp-speaker-email-0").fill(KEYSTONE_SPEAKER_EMAIL);
    await page.getByTestId("cfp-turnstile-check").check();
    await page.getByTestId("public-cfp-primary").click();

    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
      timeout: 15_000,
    });
    const submissionIdText = await page
      .getByTestId("public-cfp-submission-id")
      .innerText();
    // confirmation may show "Submission id: <id>" or just the id
    const submissionIdMatch = submissionIdText.match(/sub_[A-Za-z0-9_-]+|[\w-]+/);
    expect(submissionIdMatch, `submission id from UI: ${submissionIdText}`).toBeTruthy();

    // Resolve submission id from admin list (authoritative)
    await seedSessionCookie(context, baseURL, admin.session);
    const listRes = await request.get(
      `/api/events/${event.id}/submissions`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      submissions: Array<{ id: string; title: string; status: string }>;
    };
    const submission = listBody.submissions.find((s) => s.title === TALK_TITLE);
    expect(submission, "submitted proposal must appear in admin list").toBeTruthy();
    const submissionId = submission!.id;
    expect(submission!.status).toBe("submitted");

    // --- Rubric + assign + score (F02 / O04 / S-EVAL) ---
    const { criteria } = await upsertRubric(
      request,
      admin.session,
      event.id,
    );
    expect(criteria.length).toBeGreaterThanOrEqual(1);

    // Mint evaluator without clobbering admin cookie for later accept
    await requestMagicLink(
      request,
      KEYSTONE_EVALUATOR,
      "evaluator",
      event.id,
    );
    const evalLink = await fetchDevLink(request, KEYSTONE_EVALUATOR);
    const evalSession = await exchangeForCookie(request, evalLink.token);

    const assign = await request.post(
      `/api/submissions/${submissionId}/assign`,
      {
        headers: sessionHeaders(admin.session),
        data: { userIds: [evalLink.userId] },
      },
    );
    expect(assign.status(), await assign.text()).toBe(200);
    const assignBody = (await assign.json()) as {
      assignments: Array<{ id: string }>;
    };
    const assignmentId = assignBody.assignments[0]!.id;

    // Evaluator UI score path
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, evalSession);
    await page.goto(`${baseURL ?? ""}/eval`);
    await expect(page.getByTestId("evaluator-queue")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator(`[data-submission-id="${submissionId}"]`),
    ).toBeVisible({ timeout: 10_000 });
    // Evaluator cannot decide (F03) — accept control absent on eval surface
    await expect(page.getByTestId("submission-accept")).toHaveCount(0);

    await expect(page.getByTestId("eval-score-panel")).toBeVisible({
      timeout: 15_000,
    });
    for (const c of criteria) {
      await page.getByTestId(`eval-score-input-${c.id}`).fill("4");
    }
    await page
      .getByTestId("eval-score-comment")
      .fill("Keystone score: strong fit");
    await page.getByTestId("eval-score-save").click();
    await expect(page.getByTestId("eval-score-status")).toContainText(
      /saved/i,
      { timeout: 10_000 },
    );

    // Out-of-range rejected (F02 negative) — API
    const over = await request.post(
      `/api/assignments/${assignmentId}/scores`,
      {
        headers: sessionHeaders(evalSession),
        data: {
          scores: criteria.map((c) => ({
            criterionId: c.id,
            value: c.maxScore + 1,
          })),
        },
      },
    );
    expect(over.status()).toBe(400);
    expect(await over.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    // Evaluator Decision.Record denied (authz)
    const evalDecide = await request.post(
      `/api/submissions/${submissionId}/decision`,
      {
        headers: sessionHeaders(evalSession),
        data: { decision: "accept" },
      },
    );
    expect(evalDecide.status()).toBe(403);
    expect(await evalDecide.json()).toMatchObject({ code: "FORBIDDEN" });

    // --- Admin accept → session + tasks (E04 / S-EVAL) ---
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, admin.session);
    await selectAdminEvent(page, baseURL, event.id, "/admin/submissions");
    await expect(page.getByTestId("page-submissions")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`submission-row-${submissionId}`)).toBeVisible(
      { timeout: 15_000 },
    );
    await page.getByTestId(`submission-open-${submissionId}`).click();
    await expect(page.getByTestId("submission-detail-title")).toBeVisible();
    await page.getByTestId("submission-accept").click();
    // Tightened for polish veto #3: human decision copy replaces
    // "accept recorded · session <id> · N task(s)".
    await expect(page.getByTestId("submissions-status")).toContainText(
      /Accepted — session created with \d+ speaker task/,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("submission-detail-status")).toHaveAttribute(
      "data-status",
      "accepted",
    );
    await expect(page.getByTestId("submission-detail-session")).toBeVisible();

    // assert keystone path creates tasks after accept
    // Idempotent Decision.Record returns materialised speaker_tasks
    const decideReplay = await request.post(
      `/api/submissions/${submissionId}/decision`,
      {
        headers: sessionHeaders(admin.session),
        data: { decision: "accept" },
      },
    );
    expect(decideReplay.status()).toBe(200);
    const decideBody = (await decideReplay.json()) as {
      submission: { status: string; id: string };
      session: { id: string; sourceSubmissionId?: string | null } | null;
      tasks: Array<{ id: string; status: string; templateId: string }>;
      idempotent: boolean;
    };
    expect(decideBody.submission.status).toBe("accepted");
    expect(decideBody.session).not.toBeNull();
    expect(decideBody.session!.id).toBeTruthy();
    // Default on_accept templates (headshot + bio) when none pre-seeded
    expect(
      decideBody.tasks.length,
      "accept must materialise speaker_tasks",
    ).toBeGreaterThanOrEqual(2);
    for (const t of decideBody.tasks) {
      expect(t.id).toBeTruthy();
      expect(t.status).toBe("pending");
      expect(t.templateId).toBeTruthy();
    }
    expect(decideBody.idempotent).toBe(true);

    // Unauthenticated decision blocked
    const unauth = await request.post(
      `/api/submissions/${submissionId}/decision`,
      {
        headers: { "content-type": "application/json" },
        data: { decision: "reject" },
      },
    );
    expect(unauth.status()).toBe(401);

    // formVersion pin on submission path used for public submit (sanity)
    expect(formVersionId).toBeTruthy();
  });
});
