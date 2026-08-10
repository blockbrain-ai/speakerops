/**
 * Post-11.9 depth Wave 2 — Submissions CSV export (S-SUB-LIST depth).
 *
 * E14: filter the submissions list to Accepted in the real UI, click
 *      "Export CSV", and inspect the download BYTES: stable headers, exactly
 *      the accepted rows, an answer value column (layout nodes excluded) and
 *      the flattened speaker email. Non-matching rows never leak.
 *
 * Inventory: @inv:E14 (one test).
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

test.describe("Wave 2 — submissions CSV export", () => {
  test("@inv:E14 e2e/submissions/export-csv filtered export bytes: headers + answers + speaker email", async ({
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
      `e2e-e14-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Export ${stamp}`,
    );

    // Published form with an input field AND a layout section node — the
    // layout key must never appear as an export column (Wave 1B law).
    const formRes = await request.post(`/api/events/${event.id}/forms`, {
      headers: sessionHeaders(admin.session),
      data: { name: "Export CFP" },
    });
    expect(formRes.status()).toBe(201);
    const formId = ((await formRes.json()) as { form: { id: string } }).form.id;
    const draftRes = await request.put(`/api/forms/${formId}/draft`, {
      headers: sessionHeaders(admin.session),
      data: {
        fields: [
          {
            fieldKey: "layout_about",
            type: "text",
            label: "About this talk",
            required: false,
            sortOrder: 0,
            nodeKind: "layout",
            layoutType: "section",
          },
          {
            fieldKey: "abstract",
            type: "textarea",
            label: "Abstract",
            required: true,
            sortOrder: 1,
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

    const ANSWER_TOKEN = `Signature-answer-${stamp}`;
    const ACCEPTED_EMAIL = `e14-accepted-${stamp}@example.com`;

    async function submitPublic(n: number, email: string, answer: string) {
      const res = await request.post(
        `/api/public/cfp/${event.slug}/submissions`,
        {
          data: {
            formVersionId: versionId,
            title: `Export talk ${n} ${stamp}`,
            answers: [{ fieldKey: "abstract", value: answer }],
            speakers: [{ name: `Export Speaker ${n}`, email }],
            turnstileToken: "XXXX.DUMMY.TOKEN",
          },
        },
      );
      expect(res.status()).toBe(201);
      return ((await res.json()) as { submission: { id: string } }).submission
        .id;
    }

    const acceptedId = await submitPublic(1, ACCEPTED_EMAIL, ANSWER_TOKEN);
    await submitPublic(2, `e14-pending-${stamp}@example.com`, "Not exported");

    const decisionRes = await request.post(
      `/api/submissions/${acceptedId}/decision`,
      {
        headers: sessionHeaders(admin.session),
        data: { decision: "accept" },
      },
    );
    expect(decisionRes.status()).toBe(200);

    // —— Real browser: filter to Accepted, then export ——
    await selectAdminEvent(page, baseURL, event.id, "/admin/submissions");
    await page.getByTestId("submissions-chip-status-accepted").click();
    await expect(
      page.getByTestId(`submission-row-${acceptedId}`),
    ).toBeVisible();

    const exportWait = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/events/${event.id}/submissions/export`) &&
        r.request().method() === "GET",
    );
    await page.getByTestId("submissions-export-csv").click();
    const exportRes = await exportWait;
    expect(exportRes.status()).toBe(200);
    expect(exportRes.headers()["content-type"]).toMatch(/text\/csv/);
    // The click carried the active status filter.
    expect(exportRes.url()).toContain("status=accepted");

    // —— Byte inspection (download tests inspect bytes) ——
    const byteRes = await request.get(
      `/api/events/${event.id}/submissions/export?status=accepted`,
      {
        headers: {
          cookie: `speakerops_session=${admin.session}`,
          accept: "text/csv",
        },
      },
    );
    expect(byteRes.status()).toBe(200);
    const csv = await byteRes.text();
    const lines = csv.trim().split("\r\n");
    // Header + exactly one accepted row.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "submissionId,title,status,category,submittedAt,primarySpeakerName,primarySpeakerEmail,speakers,abstract",
    );
    expect(lines[0]).not.toContain("layout_about");
    const row = lines[1]!;
    expect(row).toContain(acceptedId);
    expect(row).toContain(`Export talk 1 ${stamp}`);
    expect(row).toContain("accepted");
    expect(row).toContain(ANSWER_TOKEN);
    expect(row).toContain(ACCEPTED_EMAIL);
    expect(row).toContain(`Export Speaker 1 <${ACCEPTED_EMAIL}>`);
    // The submitted-only row never leaks into the filtered export.
    expect(csv).not.toContain(`Export talk 2 ${stamp}`);
    expect(csv).not.toContain("Not exported");
  });
});
