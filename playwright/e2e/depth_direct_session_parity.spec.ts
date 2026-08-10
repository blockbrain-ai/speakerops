/**
 * Post-11.9 depth Wave 2 — direct/sponsor session UI parity (S-SUB depth).
 *
 * E15: the direct-session dialog supports what the API always supported —
 *      repeatable speaker rows (add/remove) and a track select. Creating a
 *      session with 2 speakers + a track through the REAL dialog produces a
 *      session whose track chip shows in Schedule Studio's tray and whose
 *      two speakers appear on the admin Speakers surface with the session
 *      linked in their detail.
 *
 * Inventory: @inv:E15 (one test).
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

test.describe("Wave 2 — direct session parity", () => {
  test("@inv:E15 e2e/submissions/direct-session-parity two speakers + track via dialog → tray chip + speakers linked", async ({
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
      `e2e-e15-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Direct ${stamp}`,
    );

    // Seed a track (API prerequisite for the select).
    const trackId = `trk_e15_${stamp}`;
    const TRACK_NAME = `AI Frontier ${stamp}`;
    const trackRes = await request.put(
      `/api/events/${event.id}/tracks/${trackId}`,
      {
        headers: sessionHeaders(admin.session),
        data: { name: TRACK_NAME },
      },
    );
    expect([200, 201]).toContain(trackRes.status());

    const SPEAKER_1 = {
      name: `Direct Alpha ${stamp}`,
      email: `e15-alpha-${stamp}@example.com`,
    };
    const SPEAKER_2 = {
      name: `Direct Beta ${stamp}`,
      email: `e15-beta-${stamp}@example.com`,
    };
    const TITLE = `Sponsor showcase ${stamp}`;

    // —— Real browser: the dialog with two speaker rows + track select ——
    await selectAdminEvent(page, baseURL, event.id, "/admin/submissions");
    await page.getByTestId("submissions-direct-open").click();
    await expect(page.getByTestId("submissions-direct-form")).toBeVisible();

    await page.getByTestId("direct-session-title").fill(TITLE);
    await page.getByTestId("direct-session-track").selectOption(trackId);
    await page.getByTestId("direct-session-speaker-name").fill(SPEAKER_1.name);
    await page
      .getByTestId("direct-session-speaker-email")
      .fill(SPEAKER_1.email);
    await page.getByTestId("direct-session-speaker-add").click();
    await page
      .getByTestId("direct-session-speaker-name-1")
      .fill(SPEAKER_2.name);
    await page
      .getByTestId("direct-session-speaker-email-1")
      .fill(SPEAKER_2.email);

    const createWait = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/events/${event.id}/sessions/direct`) &&
        r.request().method() === "POST",
    );
    await page.getByTestId("direct-session-submit").click();
    const createRes = await createWait;
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as {
      session: { id: string; trackId: string | null };
      participations: Array<{ id: string }>;
    };
    // DTO: both speakers materialized + the track persisted.
    expect(created.participations).toHaveLength(2);
    expect(created.session.trackId).toBe(trackId);
    await expect(page.getByTestId("submissions-status")).toContainText(
      "2 speakers",
    );

    // —— Schedule Studio tray shows the session with its track chip ——
    await page.goto(`${baseURL ?? ""}/admin/schedule`);
    const trayItem = page.getByTestId(
      `schedule-tray-item-${created.session.id}`,
    );
    await expect(trayItem).toBeVisible({ timeout: 15_000 });
    await expect(trayItem).toContainText(TRACK_NAME);

    // —— Both speakers exist on the admin Speakers surface ——
    await page.goto(`${baseURL ?? ""}/admin/speakers`);
    await expect(page.getByText(SPEAKER_1.name)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(SPEAKER_2.name)).toBeVisible();

    // Open one speaker's detail — the created session is linked there.
    await page
      .getByTestId(`speaker-open-${created.participations[0]!.id}`)
      .click();
    await expect(
      page.getByTestId(`speakers-session-${created.session.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`speakers-session-${created.session.id}`),
    ).toContainText(TITLE);

    // DTO: session_speakers rows for both participations (via speaker detail).
    for (const part of created.participations) {
      const detailRes = await request.get(
        `/api/events/${event.id}/speakers/${part.id}`,
        { headers: sessionHeaders(admin.session) },
      );
      expect(detailRes.status()).toBe(200);
      const detail = (await detailRes.json()) as {
        sessions: Array<{ id: string; trackId: string | null }>;
      };
      const linked = detail.sessions.find((s) => s.id === created.session.id);
      expect(linked).toBeTruthy();
      expect(linked!.trackId).toBe(trackId);
    }
  });
});
