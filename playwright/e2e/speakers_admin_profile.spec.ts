/**
 * Admin Speakers.UpdateProfile + session deep-link to schedule.
 */
import { test, expect } from "@playwright/test";
import { loginAs, sessionHeaders } from "./helpers/cfp-eval-seed.js";

const TURNSTILE = "XXXX.DUMMY.TOKEN";

test.describe("admin speaker profile edit + session link", () => {
  test("admin can edit bio/company/title; session opens schedule", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const run = `${Date.now()}`;
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `admin-spk-edit-${run}@example.com`,
      "admin",
    );

    const create = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `Spk Edit ${run}`,
        timezone: "UTC",
        startsAt: "2026-09-01T09:00:00.000Z",
        endsAt: "2026-09-02T17:00:00.000Z",
      },
    });
    expect(create.status()).toBe(201);
    const { event } = (await create.json()) as {
      event: { id: string; slug: string };
    };

    const formRes = await request.post(`/api/events/${event.id}/forms`, {
      headers: sessionHeaders(admin.session),
      data: { name: `CFP ${run}` },
    });
    const form = (await formRes.json()) as { form: { id: string } };
    await request.put(`/api/forms/${form.form.id}/draft`, {
      headers: sessionHeaders(admin.session),
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
    const pub = await request.post(`/api/forms/${form.form.id}/publish`, {
      headers: sessionHeaders(admin.session),
      data: {},
    });
    const published = (await pub.json()) as { formVersion: { id: string } };
    const speakerEmail = `spk-edit-${run}@example.com`;
    const sub = await request.post(`/api/public/cfp/${event.slug}/submissions`, {
      data: {
        formVersionId: published.formVersion.id,
        title: `Talk ${run}`,
        answers: [{ fieldKey: "talk_title", value: `Talk ${run}` }],
        speakers: [
          { name: "Edit Speaker", email: speakerEmail, isPrimary: true },
        ],
        turnstileToken: TURNSTILE,
      },
    });
    expect(sub.status()).toBe(201);
    const subBody = (await sub.json()) as { submission: { id: string } };
    const dec = await request.post(
      `/api/submissions/${subBody.submission.id}/decision`,
      {
        headers: sessionHeaders(admin.session),
        data: { decision: "accept" },
      },
    );
    expect(dec.status()).toBe(200);
    const decBody = (await dec.json()) as {
      session: { id: string } | null;
      participations: Array<{ id: string }>;
    };
    const partId = decBody.participations[0]!.id;
    const sessionId = decBody.session!.id;

    // Place session so schedule deep-link finds a placement
    const roomId = `room_edit_${run}`;
    await request.put(`/api/events/${event.id}/rooms/${roomId}`, {
      headers: sessionHeaders(admin.session),
      data: { name: "Hall", capacity: 50 },
    });
    await request.post(`/api/events/${event.id}/schedule/place`, {
      headers: sessionHeaders(admin.session),
      data: {
        sessionId,
        roomId,
        startsAt: "2026-09-01T10:00:00.000Z",
        endsAt: "2026-09-01T11:00:00.000Z",
      },
    });

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    // Deep-link opens detail (same as readiness H03)
    await page.goto(
      `/admin/speakers?participationId=${encodeURIComponent(partId)}`,
    );
    await expect(page.getByTestId("page-speakers")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("speakers-detail")).toBeVisible({
      timeout: 15_000,
    });

    // View mode by default — no inputs until Edit
    await expect(page.getByTestId("speakers-detail-profile-edit")).toBeVisible();
    await expect(page.getByTestId("speakers-detail-bio-input")).toHaveCount(0);
    await page.getByTestId("speakers-detail-profile-edit").click();
    await page.getByTestId("speakers-detail-bio-input").fill("Admin wrote bio");
    await page.getByTestId("speakers-detail-company-input").fill("Nood Co");
    await page.getByTestId("speakers-detail-title-input").fill("Founder");
    await page.getByTestId("speakers-detail-profile-save").click();
    await expect(page.getByTestId("speakers-detail-profile-status")).toHaveText(
      "Saved",
      { timeout: 10_000 },
    );
    // Back to view mode after save
    await expect(page.getByTestId("speakers-detail-bio-input")).toHaveCount(0);
    await expect(page.getByTestId("speakers-detail-bio")).toContainText(
      "Admin wrote bio",
    );

    // Session click-through
    await page.getByTestId(`speakers-session-link-${sessionId}`).click();
    await expect(page.getByTestId("page-schedule")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator(
        `[data-testid^="schedule-placement-"][data-session-id="${sessionId}"]`,
      ),
    ).toBeVisible({ timeout: 15_000 });
  });
});
