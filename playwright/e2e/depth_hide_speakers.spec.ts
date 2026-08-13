/**
 * Post-11.9 depth Wave 1B — hide speaker roster from evaluators (S-EVAL depth).
 *
 * F13: RubricSettings toggle "Hide speaker identities from evaluators" →
 *      the evaluator proposal network response AND the fully rendered DOM
 *      contain none of the seeded name/email/company tokens; toggle OFF shows
 *      the roster again; the admin submission detail stays complete.
 *
 * Anonymization law: seeded distinctive tokens asserted absent from BOTH the
 * /proposal response body and the rendered evaluator DOM (never CSS hiding).
 *
 * Inventory: @inv:F13 (one test).
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). New critical spec → retries 0.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  selectAdminEvent,
  seedSessionCookie,
  sessionHeaders,
} from "./helpers/cfp-eval-seed";

test.describe.configure({ retries: 0 });

test.describe("Wave 1B — hide speaker identities", () => {
  test("@inv:F13 e2e/eval/hide-speakers roster absent from proposal API + DOM when hidden; admin detail complete", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const stamp = Date.now();
    // Distinctive identity tokens that must never leak to the evaluator.
    // The roster name carries a company marker so name + email + company are
    // all seeded through the fields that exist pre-accept (people rows).
    const COMPANY_TOKEN = `QuillWorks-${stamp}`;
    const SPEAKER_NAME = `Zephyrine Quill of ${COMPANY_TOKEN}`;
    const SPEAKER_EMAIL = `zephyrine-${stamp}@hidden-example.com`;

    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f13-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Hide Roster ${stamp}`,
    );

    // Seed a published CFP + one submission via API (prerequisites only).
    const formRes = await request.post(`/api/events/${event.id}/forms`, {
      headers: sessionHeaders(admin.session),
      data: { name: "Hide roster CFP" },
    });
    expect(formRes.status()).toBe(201);
    const formId = ((await formRes.json()) as { form: { id: string } }).form.id;
    const draftRes = await request.put(`/api/forms/${formId}/draft`, {
      headers: sessionHeaders(admin.session),
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
      },
    });
    expect(draftRes.status()).toBe(200);
    const pubRes = await request.post(`/api/forms/${formId}/publish`, {
      headers: sessionHeaders(admin.session),
      data: {},
    });
    expect(pubRes.status()).toBe(200);
    const versionId = ((await pubRes.json()) as {
      formVersion: { id: string };
    }).formVersion.id;

    const subRes = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        data: {
          formVersionId: versionId,
          title: "Anonymous-friendly proposal",
          answers: [
            {
              fieldKey: "abstract",
              value: "A rigorous talk about observability.",
            },
          ],
          speakers: [{ name: SPEAKER_NAME, email: SPEAKER_EMAIL }],
          turnstileToken: "XXXX.DUMMY.TOKEN",
        },
      },
    );
    expect(subRes.status()).toBe(201);
    const submissionId = ((await subRes.json()) as {
      submission: { id: string };
    }).submission.id;

    // Admin flips the toggle ON through the real RubricSettings UI.
    await selectAdminEvent(page, baseURL, event.id, "/admin/settings/rubric");
    await expect(page.getByTestId("rubric-edit-section")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("rubric-edit-section")).toHaveAttribute(
      "data-ready",
      "true",
    );
    await page.getByTestId("rubric-criterion-name-0").fill("Overall");
    await expect(page.getByTestId("rubric-criterion-name-0")).toHaveValue(
      "Overall",
    );
    const hideToggle = page.getByTestId("rubric-hide-speakers");
    await expect(hideToggle).toBeVisible();
    await hideToggle.check();
    await page.getByTestId("rubric-save").click();
    await expect(page.getByTestId("rubric-status")).toContainText(
      /rubric saved/i,
      { timeout: 10_000 },
    );

    // Assign the evaluator.
    const evaluator = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f13-eval-${stamp}@example.com`,
      "evaluator",
      event.id,
    );
    const assignRes = await request.post(
      `/api/submissions/${submissionId}/assign`,
      {
        headers: sessionHeaders(admin.session),
        data: { userIds: [evaluator.userId] },
      },
    );
    expect(assignRes.status()).toBe(200);
    const assignmentId = ((await assignRes.json()) as {
      assignments: Array<{ id: string }>;
    }).assignments[0]!.id;

    // Evaluator opens the queue. The first assignment auto-selects and the
    // proposal loads immediately — clicking is still exercised, but the
    // network-DTO proof must not race the auto-fetch, so the raw response
    // body is asserted via a direct GET with the evaluator's own session.
    await page.goto("/eval");
    const queueItem = page.getByTestId(`eval-queue-item-${assignmentId}`);
    await expect(queueItem).toBeVisible({ timeout: 15_000 });
    await queueItem.click();
    await expect(
      page.getByTestId("eval-proposal-speakers-hidden"),
    ).toBeVisible({ timeout: 15_000 });

    // Network DTO: seeded tokens absent from the raw response body served to
    // the evaluator credentials (same endpoint the queue consumed).
    const proposalRes = await request.get(
      `/api/me/eval-assignments/${assignmentId}/proposal`,
      { headers: sessionHeaders(evaluator.session) },
    );
    expect(proposalRes.status()).toBe(200);
    const rawBody = await proposalRes.text();
    expect(rawBody).not.toContain(SPEAKER_NAME);
    expect(rawBody).not.toContain(SPEAKER_EMAIL);
    expect(rawBody).not.toContain(COMPANY_TOKEN);
    expect(rawBody).not.toContain("Zephyrine");
    const dto = JSON.parse(rawBody) as {
      speakers?: unknown;
      speakersHidden?: boolean;
    };
    expect(dto.speakers).toBeUndefined();
    expect(dto.speakersHidden).toBe(true);

    // Rendered DOM: honest hidden note; no tokens anywhere on the page.
    await expect(
      page.getByTestId("eval-proposal-speakers-hidden"),
    ).toBeVisible();
    await expect(
      page.getByTestId("eval-proposal-speakers-hidden"),
    ).toContainText(/hidden for this review round/i);
    const domText = await page.locator("body").innerText();
    expect(domText).not.toContain(SPEAKER_NAME);
    expect(domText).not.toContain(SPEAKER_EMAIL);
    expect(domText).not.toContain(COMPANY_TOKEN);
    expect(domText).not.toContain("Zephyrine");
    // Content still available for honest scoring.
    await expect(page.getByTestId("eval-proposal-answers")).toContainText(
      "observability",
    );

    // Admin detail stays complete while the roster is hidden.
    const adminDetail = await request.get(
      `/api/submissions/${submissionId}`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(adminDetail.status()).toBe(200);
    const adminBody = await adminDetail.text();
    expect(adminBody).toContain(SPEAKER_NAME);
    expect(adminBody).toContain(SPEAKER_EMAIL.toLowerCase());

    // Toggle OFF through the UI → roster returns to the evaluator.
    // (loginAs(evaluator) replaced the browser cookie — restore admin first.)
    await seedSessionCookie(context, baseURL, admin.session);
    await selectAdminEvent(page, baseURL, event.id, "/admin/settings/rubric");
    await expect(page.getByTestId("rubric-hide-speakers")).toBeChecked();
    await page.getByTestId("rubric-hide-speakers").uncheck();
    await page.getByTestId("rubric-save").click();
    await expect(page.getByTestId("rubric-status")).toContainText(
      /rubric saved/i,
      { timeout: 10_000 },
    );

    await seedSessionCookie(context, baseURL, evaluator.session);
    await page.goto("/eval");
    const itemAgain = page.getByTestId(`eval-queue-item-${assignmentId}`);
    await expect(itemAgain).toBeVisible({ timeout: 15_000 });
    await itemAgain.click();
    await expect(
      page.getByTestId("eval-proposal-speaker-0"),
    ).toContainText(SPEAKER_NAME, { timeout: 15_000 });
    await expect(
      page.getByTestId("eval-proposal-speakers-hidden"),
    ).toHaveCount(0);
  });
});
