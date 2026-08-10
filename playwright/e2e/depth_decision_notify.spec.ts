/**
 * Post-11.9 depth Wave 2 — decision → notify hand-off (S-COMMS depth).
 *
 * E13: bulk accept 3 submissions in the Submissions UI → "Notify accepted"
 *      hand-off routes into Comms with the EXACT decision result set pinned
 *      as the audience and the typed decision template preselected
 *      (lazy-seeded). The existing preview → send flow is unchanged: preview
 *      lists exactly those 3 recipients (a previously accepted 4th speaker is
 *      NOT included), send enqueues once, and the delivery log shows the job.
 *
 * Inventory: @inv:E13 (one test).
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

type Seeded = { id: string; email: string; title: string };

test.describe("Wave 2 — decision → notify hand-off", () => {
  test("@inv:E13 e2e/submissions/decision-notify bulk accept → notify exact audience → preview → send → delivery log", async ({
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
      `e2e-e13-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Notify ${stamp}`,
    );

    // Published CFP form (API prerequisite).
    const formRes = await request.post(`/api/events/${event.id}/forms`, {
      headers: sessionHeaders(admin.session),
      data: { name: "Notify CFP" },
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

    async function submitPublic(n: number): Promise<Seeded> {
      const email = `e13-speaker-${n}-${stamp}@example.com`;
      const title = `Notify talk ${n} ${stamp}`;
      const res = await request.post(
        `/api/public/cfp/${event.slug}/submissions`,
        {
          data: {
            formVersionId: versionId,
            title,
            answers: [{ fieldKey: "abstract", value: `Abstract ${n}` }],
            speakers: [{ name: `Notify Speaker ${n}`, email }],
            turnstileToken: "XXXX.DUMMY.TOKEN",
          },
        },
      );
      expect(res.status()).toBe(201);
      const body = (await res.json()) as { submission: { id: string } };
      return { id: body.submission.id, email, title };
    }

    const targets = [
      await submitPublic(1),
      await submitPublic(2),
      await submitPublic(3),
    ];
    // A 4th submission accepted OUTSIDE the hand-off — must never appear in
    // the notify audience (proves "exact decision result set").
    const outsider = await submitPublic(4);
    const outsiderDecision = await request.post(
      `/api/submissions/${outsider.id}/decision`,
      {
        headers: sessionHeaders(admin.session),
        data: { decision: "accept" },
      },
    );
    expect(outsiderDecision.status()).toBe(200);

    // —— Real browser: bulk accept the 3 targets ——
    await selectAdminEvent(page, baseURL, event.id, "/admin/submissions");
    for (const t of targets) {
      await page.getByTestId(`submission-select-${t.id}`).check();
    }
    await page.getByTestId("submissions-bulk-bar-accept").click();
    await expect(page.getByTestId("submissions-bulk-preview")).toBeVisible();
    await page.getByTestId("submissions-bulk-commit").click();
    await expect(page.getByTestId("submissions-status")).toContainText(
      "Applied 3 accept",
    );

    // Hand-off control appears with the exact result set.
    const handoff = page.getByTestId("submissions-notify-handoff");
    await expect(handoff).toBeVisible();
    await expect(handoff).toHaveAttribute("data-count", "3");
    await page.getByTestId("submissions-notify-accept").click();

    // —— Comms: pinned audience + preselected typed template ——
    await expect(page.getByTestId("comms-notify-banner")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-notify-banner")).toHaveAttribute(
      "data-count",
      "3",
    );
    await expect(page.getByTestId("comms-summary-notify-mode")).toBeVisible();
    // Lazy-seeded decision template is selected (template id present) and the
    // editor shows the typed key.
    await expect(page.getByTestId("comms-template-id")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-template-key-input")).toHaveValue(
      "decision_accepted",
    );

    // Preview required — response DTO must list exactly the 3 target speakers.
    const previewWait = page.waitForResponse(
      (r) =>
        r.url().includes("/api/comms/preview") &&
        r.request().method() === "POST",
    );
    await page.getByTestId("comms-preview-run").click();
    const previewRes = await previewWait;
    expect(previewRes.status()).toBe(200);
    const previewJson = (await previewRes.json()) as {
      recipientCount: number;
      recipients: Array<{ email: string; submissionId?: string | null }>;
    };
    expect(previewJson.recipientCount).toBe(3);
    expect(previewJson.recipients.map((r) => r.email).sort()).toEqual(
      targets.map((t) => t.email).sort(),
    );
    expect(
      previewJson.recipients.some((r) => r.email === outsider.email),
    ).toBe(false);

    // Rendered DOM lists exactly those 3.
    await expect(
      page.getByTestId("comms-preview-recipients").locator("li"),
    ).toHaveCount(3);
    for (const t of targets) {
      await expect(page.getByTestId("comms-preview-recipients")).toContainText(
        t.email,
      );
    }
    await expect(
      page.getByTestId("comms-preview-recipients"),
    ).not.toContainText(outsider.email);

    // —— Send (existing idempotent path) ——
    const sendWait = page.waitForResponse(
      (r) =>
        r.url().includes("/api/comms/send") && r.request().method() === "POST",
    );
    await page.getByTestId("comms-send-button").click();
    const sendRes = await sendWait;
    expect([200, 201]).toContain(sendRes.status());
    const sendJson = (await sendRes.json()) as {
      job: { id: string };
      enqueued: boolean;
    };
    expect(sendJson.enqueued).toBe(true);
    await expect(page.getByTestId("comms-send-status")).toContainText(
      "Enqueued job",
    );

    // —— Delivery log shows the job with 3 recipients ——
    await page.getByTestId("comms-log-refresh").click();
    const logRow = page.getByTestId(`comms-log-row-${sendJson.job.id}`);
    await expect(logRow).toBeVisible();
    await expect(logRow).toContainText("3");

    // Durable DTO: job detail carries all 3 queued recipients.
    const jobRes = await request.get(
      `/api/events/${event.id}/comms/jobs/${sendJson.job.id}`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(jobRes.status()).toBe(200);
    const jobJson = (await jobRes.json()) as {
      recipients: Array<{ toEmail: string; status: string }>;
    };
    expect(jobJson.recipients).toHaveLength(3);
    expect(jobJson.recipients.map((r) => r.toEmail).sort()).toEqual(
      targets.map((t) => t.email).sort(),
    );
  });
});
