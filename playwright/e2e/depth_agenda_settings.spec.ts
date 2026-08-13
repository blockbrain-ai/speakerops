/**
 * Wave 2 depth — agenda settings (I17).
 *
 * Event-level agendaDayStart / agendaDayEnd / slotIntervalMin live in
 * events.settings_json (Wave 1B passthrough — no migration). The EventSettings
 * "Agenda & schedule grid" card writes them; Schedule Studio's grid and snap
 * durations follow them; and the schedule API enforces the day window
 * server-side (409 CONFLICT, conflicts[] type "hours") — the knob is a law,
 * not a grid hint.
 *
 * Inventory: @inv:I17 (one test).
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). New critical spec → retries 0.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  loginAs,
  selectAdminEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed";

test.describe.configure({ retries: 0 });

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const ROOM_ID = "room_agenda_hall";
const SLOT_11 = "2026-09-01T11:00:00.000Z";

function slotTestId(roomId: string, startsAt: string): string {
  return `schedule-slot-${roomId}|${startsAt}`;
}

async function createSession(
  request: APIRequestContext,
  session: string,
  eventId: string,
  title: string,
  speakerEmail: string,
): Promise<string> {
  const res = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/sessions/direct`,
    {
      headers: sessionHeaders(session),
      data: {
        title,
        speakers: [{ name: "Agenda Speaker", email: speakerEmail }],
      },
    },
  );
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { session: { id: string } };
  return body.session.id;
}

test.describe("Wave 2 — agenda settings drive grid + API bounds", () => {
  test("@inv:I17 e2e/schedule/agenda-settings settings card configures day window + interval; grid follows; API rejects out-of-bounds with 409 hours", async ({
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
      `e2e-k05-admin-${stamp}@example.com`,
      "admin",
    );

    // Seed event (UTC so wall times match the ISO instants) + room + sessions.
    const createRes = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `Agenda Settings ${stamp}`,
        timezone: "UTC",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const event = ((await createRes.json()) as { event: { id: string } })
      .event;

    const roomRes = await request.put(
      `/api/events/${encodeURIComponent(event.id)}/rooms/${ROOM_ID}`,
      {
        headers: sessionHeaders(admin.session),
        data: { name: "Agenda Hall", capacity: 60 },
      },
    );
    expect(roomRes.status(), await roomRes.text()).toBe(200);

    const sessionId = await createSession(
      request,
      admin.session,
      event.id,
      "Agenda Grid Talk",
      `k05-spk-${stamp}@example.com`,
    );
    const outOfBoundsSessionId = await createSession(
      request,
      admin.session,
      event.id,
      "Too Early Talk",
      `k05-early-${stamp}@example.com`,
    );

    // 1) EventSettings card: set 10:00–16:00 at 30-minute slots and save.
    await selectAdminEvent(page, baseURL, event.id, "/admin/settings");
    await expect(page.getByTestId("event-agenda-section")).toBeVisible();
    // Wait until the form hydrated for the created event (save enabled).
    await expect(page.getByTestId("event-agenda-save")).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByTestId("event-agenda-day-start").fill("10:00");
    await page.getByTestId("event-agenda-day-end").fill("16:00");
    await page.getByTestId("event-agenda-interval").selectOption("30");
    await expect(page.getByTestId("event-agenda-day-start")).toHaveValue("10:00");
    await expect(page.getByTestId("event-agenda-day-end")).toHaveValue("16:00");
    await expect(page.getByTestId("event-agenda-interval")).toHaveValue("30");
    await page.getByTestId("event-agenda-save").click();
    await expect(page.getByTestId("event-agenda-status")).toContainText(
      "Agenda settings saved",
      { timeout: 15_000 },
    );

    // 2) Schedule Studio day view: grid rows mirror the configured window.
    await page.goto("/admin/schedule");
    await expect(page.getByTestId("page-schedule")).toBeVisible();
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-day-view")).toBeVisible();

    // 12 slot rows: 10:00 … 15:30 at 30-minute steps.
    const timeLabels = page.getByTestId("schedule-grid-time");
    await expect(timeLabels).toHaveCount(12, { timeout: 15_000 });
    await expect(timeLabels.first()).toHaveText("10:00");
    await expect(timeLabels.last()).toHaveText("15:30");
    // Slot targets carry the configured 30-minute snap (data-ends-at).
    const slot11 = page.getByTestId(slotTestId(ROOM_ID, SLOT_11));
    await expect(slot11).toBeVisible();
    await expect(slot11).toHaveAttribute(
      "data-ends-at",
      "2026-09-01T11:30:00.000Z",
    );
    // No slot exists before the window (09:00 row is gone).
    await expect(
      page.getByTestId(slotTestId(ROOM_ID, "2026-09-01T09:00:00.000Z")),
    ).toHaveCount(0);

    // 3) Place via the non-drag path: select tray session, Enter on 11:00 slot.
    await page.getByTestId(`schedule-tray-item-${sessionId}`).click();
    await slot11.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
      { timeout: 15_000 },
    );

    // Placement duration honors the 30-minute interval (API DTO is truth).
    const listRes = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/schedule`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      placements: Array<{
        sessionId: string;
        startsAt: string;
        endsAt: string;
      }>;
    };
    const placed = listBody.placements.find((p) => p.sessionId === sessionId);
    expect(placed).toBeTruthy();
    expect(placed!.startsAt).toBe(SLOT_11);
    expect(placed!.endsAt).toBe("2026-09-01T11:30:00.000Z");

    // 4) Negative: API place outside the window → 409 with conflicts[] "hours".
    const badRes = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/schedule/place`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          sessionId: outOfBoundsSessionId,
          roomId: ROOM_ID,
          startsAt: "2026-09-01T09:00:00.000Z",
          endsAt: "2026-09-01T09:30:00.000Z",
        },
      },
    );
    expect(badRes.status(), await badRes.text()).toBe(409);
    const badBody = (await badRes.json()) as {
      code: string;
      conflicts: Array<{ type: string; message: string }>;
    };
    expect(badBody.code).toBe("CONFLICT");
    expect(badBody.conflicts.some((c) => c.type === "hours")).toBe(true);
    expect(
      badBody.conflicts.find((c) => c.type === "hours")!.message,
    ).toContain("10:00");
  });
});
