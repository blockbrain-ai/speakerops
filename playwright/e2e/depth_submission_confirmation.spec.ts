/**
 * Post-11.9 depth Wave 1B — submission confirmation lifecycle email (S-COMMS).
 *
 * J12: public submit through the real CFP form → the Comms delivery log shows
 *      a queued lifecycle job to the submitter with rendered merge fields
 *      (sandbox provider — no live email); the seeded `submission_confirmation`
 *      template is editable in Comms templates and the next submission renders
 *      the edited copy; disabling the EventSettings toggle stops new jobs.
 *
 * Inventory: @inv:J12 (one test).
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). New critical spec → retries 0.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  selectAdminEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed";

test.describe.configure({ retries: 0 });

test.describe("Wave 1B — submission confirmation email", () => {
  test("@inv:J12 e2e/comms/submission-confirmation submit → delivery log job with merge fields; template editable; toggle off stops jobs", async ({
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
      `e2e-j12-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Confirm Mail ${stamp}`,
    );

    // Seed a published one-field CFP via API (prerequisite only).
    const formRes = await request.post(`/api/events/${event.id}/forms`, {
      headers: sessionHeaders(admin.session),
      data: { name: "Confirm mail CFP" },
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

    // Public submit through the REAL form (the lifecycle trigger under test).
    const submitterEmail = `confirmed-${stamp}@example.com`;
    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    await page.getByTestId("cfp-title").fill(`Confirmed talk ${stamp}`);
    await page
      .getByTestId("cfp-field-abstract")
      .fill("A talk that earns its confirmation email.");
    await page.getByTestId("cfp-speaker-name-0").fill("Confirmed Speaker");
    await page.getByTestId("cfp-speaker-email-0").fill(submitterEmail);
    await page.getByTestId("cfp-turnstile-check").check();
    const [submitRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/public/cfp/${event.slug}/submissions`) &&
          r.request().method() === "POST",
      ),
      page.getByTestId("public-cfp-primary").click(),
    ]);
    expect(submitRes.status()).toBe(201);
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible();

    // Comms delivery log shows exactly one queued lifecycle job.
    await selectAdminEvent(page, baseURL, event.id, "/admin/comms");
    await page.getByTestId("comms-log-refresh").click();
    const logRows = page.locator('[data-testid^="comms-log-row-"]');
    await expect(logRows).toHaveCount(1, { timeout: 15_000 });
    await expect(logRows.first()).toContainText("submission_confirmation");
    await expect(logRows.first()).toHaveAttribute("data-status", "queued");

    // Job detail: submitter recipient with the rendered (merge-field) subject.
    await page.locator('[data-testid^="comms-log-open-"]').first().click();
    const recipients = page.getByTestId("comms-log-recipients");
    await expect(recipients).toBeVisible();
    await expect(recipients).toContainText(submitterEmail);
    await expect(recipients).toContainText(
      `We received your proposal for Depth Confirm Mail ${stamp}`,
    );
    // Merge tokens must be rendered, never sent raw.
    await expect(recipients).not.toContainText("{{");

    // Template is editable in Comms templates (lazily seeded per event).
    // Exclusive wizard: Message requires a non-empty audience — seed one speaker.
    const seedSp = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/sessions/direct`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          title: `J12 audience seed ${stamp}`,
          speakers: [
            { name: "J12 Seed", email: `j12-seed-${stamp}@example.com` },
          ],
        },
      },
    );
    expect(seedSp.status(), await seedSp.text()).toBe(201);
    await page.reload();
    await expect(page.getByTestId("page-comms")).toBeVisible();
    await expect(page.getByTestId("comms-summary-count")).toHaveAttribute(
      "data-count",
      /[1-9]/,
      { timeout: 15_000 },
    );
    await page.getByTestId("comms-step-nav-message").click();
    await expect(page.getByTestId("comms-template-editor")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("comms-template-pick-submission_confirmation").click();
    await expect(page.getByTestId("comms-template-key-input")).toHaveValue(
      "submission_confirmation",
    );
    await page
      .getByTestId("comms-template-subject-input")
      .fill("Received: {{submissionTitle}}");
    await page.getByTestId("comms-template-save").click();
    await expect(page.getByTestId("comms-template-status")).toContainText(
      /saved/i,
      { timeout: 10_000 },
    );

    // Next submission (API seed) renders the edited template.
    const second = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        data: {
          formVersionId: versionId,
          title: `Edited render ${stamp}`,
          answers: [{ fieldKey: "abstract", value: "Second proposal." }],
          speakers: [
            { name: "Second Speaker", email: `second-${stamp}@example.com` },
          ],
          turnstileToken: "XXXX.DUMMY.TOKEN",
        },
      },
    );
    expect(second.status()).toBe(201);
    await page.getByTestId("comms-log-refresh").click();
    await expect(logRows).toHaveCount(2, { timeout: 15_000 });
    // Open the newest job (rows are newest-first) and check the re-render.
    await page.locator('[data-testid^="comms-log-open-"]').first().click();
    await expect(page.getByTestId("comms-log-recipients")).toContainText(
      `Received: Edited render ${stamp}`,
      { timeout: 10_000 },
    );

    // Negative: turn the lifecycle off in Event settings (real toggle),
    // submit again → no new delivery-log job.
    await selectAdminEvent(page, baseURL, event.id, "/admin/settings");
    const toggle = page.getByTestId("event-notify-confirmation-toggle");
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await page.getByTestId("event-notify-save").click();
    await expect(page.getByTestId("event-notify-status")).toContainText(
      /saved/i,
      { timeout: 10_000 },
    );

    const third = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        data: {
          formVersionId: versionId,
          title: `Silent submit ${stamp}`,
          answers: [{ fieldKey: "abstract", value: "No email expected." }],
          speakers: [
            { name: "Silent Speaker", email: `silent-${stamp}@example.com` },
          ],
          turnstileToken: "XXXX.DUMMY.TOKEN",
        },
      },
    );
    expect(third.status(), "submission must succeed with emails off").toBe(201);
    await selectAdminEvent(page, baseURL, event.id, "/admin/comms");
    await page.getByTestId("comms-log-refresh").click();
    // Still exactly two jobs — the disabled lifecycle enqueued nothing.
    await expect(logRows).toHaveCount(2, { timeout: 15_000 });
  });
});
