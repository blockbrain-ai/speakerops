/**
 * Section 10.6 — Schedule day chrome (S-SCHED-CHROME / AC-10.6-A).
 *
 * Inventory I03 (e2e/sched/week) remains owned by schedule_studio.spec.ts —
 * this file is the AC-10.6-A chrome bound (no second @inv:I03 owner).
 *
 * Named ACs:
 * - AC-10.6-A: Week/day headers only within event dates — no pre-event empty
 *   day when event starts mid-week.
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";
import { loginAs, sessionHeaders } from "./helpers/cfp-eval-seed.js";

/** Wed–Fri mid-week event (UTC). */
const EVENT_START = "2026-09-02T09:00:00.000Z"; // Wednesday
const EVENT_END = "2026-09-04T17:00:00.000Z"; // Friday

test.describe("10.6 schedule day chrome", () => {
  test("AC-10.6-A e2e/sched/week-chrome no pre-event empty days", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = `chrome-${Date.now()}`;
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `admin-${run}@example.com`,
      "admin",
    );

    const create = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `Midweek ${run}`,
        timezone: "UTC",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    expect(create.status()).toBe(201);
    const { event } = (await create.json()) as {
      event: { id: string; startsAt: string; endsAt: string };
    };

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto("/admin/schedule");
    await expect(page.getByTestId("page-schedule")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("schedule-view-week").click();
    await expect(page.getByTestId("schedule-week-view")).toBeVisible();

    // In-range days present
    await expect(
      page.getByTestId("schedule-week-day-2026-09-02"),
    ).toBeVisible();
    await expect(
      page.getByTestId("schedule-week-day-2026-09-03"),
    ).toBeVisible();
    await expect(
      page.getByTestId("schedule-week-day-2026-09-04"),
    ).toBeVisible();

    // Pre-event Mon/Tue and post-event Sat must not appear
    await expect(
      page.getByTestId("schedule-week-day-2026-08-31"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("schedule-week-day-2026-09-01"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("schedule-week-day-2026-09-05"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("schedule-week-day-2026-09-06"),
    ).toHaveCount(0);

    const dayCount = await page
      .getByTestId("schedule-week-view")
      .getAttribute("data-day-count");
    expect(dayCount).toBe("3");
    const eventDays = await page
      .getByTestId("schedule-week-view")
      .getAttribute("data-event-days");
    expect(eventDays).toBe("2026-09-02,2026-09-03,2026-09-04");
  });
});
