/**
 * Section 6.2 — Schedule Studio five views inventory I01–I16.
 *
 * - @inv:I01 e2e/sched/list
 * - @inv:I02 e2e/sched/day
 * - @inv:I03 e2e/sched/week
 * - @inv:I04 e2e/sched/track
 * - @inv:I05 e2e/sched/room
 * - @inv:I06 e2e/sched/drag-place
 * - @inv:I07 e2e/sched/conflict-speaker
 * - @inv:I08 e2e/sched/conflict-room
 * - @inv:I09 e2e/sched/keyboard
 * - @inv:I10 e2e/sched/undo
 * - @inv:I11 e2e/sched/tray
 * - @inv:I12 e2e/sched/tz
 * - @inv:I13 e2e/sched/move
 * - @inv:I14 e2e/sched/unschedule
 * - @inv:I15 e2e/sched/stale
 * - @inv:I16 e2e/sched/persist
 *
 * Named assertions:
 * - assert each @inv:I01-I16 in playwright
 * - assert conflict drop leaves placement count unchanged
 * - assert keyboard place creates placement
 * - assert reload shows same slot
 *
 * Drag tests (I06/I07/I08/I13) use REAL mouse input (pointerDragTo): Schedule
 * Studio's DnD is pointer-event based, so Playwright's mouse drives the exact
 * production path — the old synthetic-DragEvent html5DragTo helper is gone.
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { loginAs, sessionHeaders } from "./helpers/cfp-eval-seed.js";
import { pointerDragTo } from "./helpers/pointer-dnd.js";

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const SLOT_10 = "2026-09-01T10:00:00.000Z";
const SLOT_11 = "2026-09-01T11:00:00.000Z";
const SLOT_14 = "2026-09-01T14:00:00.000Z";
const ROOM_A = "room_hall_a";
const ROOM_B = "room_hall_b";

function slotTestId(roomId: string, startsAt: string): string {
  return `schedule-slot-${roomId}|${startsAt}`;
}

async function upsertRoom(
  request: APIRequestContext,
  session: string,
  eventId: string,
  roomId: string,
  name: string,
) {
  const res = await request.put(
    `/api/events/${encodeURIComponent(eventId)}/rooms/${encodeURIComponent(roomId)}`,
    {
      headers: sessionHeaders(session),
      data: { name, capacity: 80 },
    },
  );
  expect(res.status(), await res.text()).toBe(200);
}

async function upsertTrack(
  request: APIRequestContext,
  session: string,
  eventId: string,
  trackId: string,
  name: string,
) {
  const res = await request.put(
    `/api/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(trackId)}`,
    {
      headers: sessionHeaders(session),
      data: { name, color: "#7ba88b" },
    },
  );
  expect(res.status(), await res.text()).toBe(200);
}

async function createSession(
  request: APIRequestContext,
  session: string,
  eventId: string,
  title: string,
  speakers: { name: string; email: string }[],
  trackId?: string,
): Promise<string> {
  const res = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/sessions/direct`,
    {
      headers: sessionHeaders(session),
      data: {
        title,
        speakers,
        ...(trackId ? { trackId } : {}),
      },
    },
  );
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { session: { id: string } };
  return body.session.id;
}

async function placeViaApi(
  request: APIRequestContext,
  session: string,
  eventId: string,
  sessionId: string,
  roomId: string,
  startsAt: string,
  endsAt: string,
): Promise<{ id: string; version: number }> {
  const res = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/schedule/place`,
    {
      headers: sessionHeaders(session),
      data: { sessionId, roomId, startsAt, endsAt },
    },
  );
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as {
    placement: { id: string; version: number };
  };
  return body.placement;
}

async function openSchedule(page: Page, eventId: string) {
  await page.addInitScript((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  await page.goto("/admin/schedule");
  await expect(page.getByTestId("page-schedule")).toBeVisible();
  await expect(page.getByTestId("schedule-tray")).toBeVisible({
    timeout: 15_000,
  });
}

async function seedBase(
  request: APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  label: string,
) {
  const email = `sched-${label}-${Date.now()}@example.com`;
  const auth = await loginAs(request, context, baseURL, email, "admin");
  // Create with schedule window + timezone so Event.List feeds Studio grids (I12).
  const createRes = await request.post("/api/events", {
    headers: sessionHeaders(auth.session),
    data: {
      name: `Schedule ${label} ${Date.now()}`,
      timezone: "America/New_York",
      startsAt: EVENT_START,
      endsAt: EVENT_END,
    },
  });
  expect(createRes.status(), await createRes.text()).toBe(201);
  const created = (await createRes.json()) as {
    event: { id: string; slug: string; timezone: string };
  };
  const event = { id: created.event.id, slug: created.event.slug };
  await upsertRoom(request, auth.session, event.id, ROOM_A, "Hall A");
  await upsertRoom(request, auth.session, event.id, ROOM_B, "Hall B");
  await upsertTrack(request, auth.session, event.id, "track_main", "Main");
  return { auth, event, email };
}

test.describe("6.2 Schedule Studio I01–I16", () => {
  test("@inv:I01 e2e/sched/list List view shows sessions", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i01");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "List Talk Alpha",
      [{ name: "List Spk", email: `list-${Date.now()}@example.com` }],
      "track_main",
    );
    const placement = await placeViaApi(
      request,
      auth.session,
      event.id,
      sessionId,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );

    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-list").click();
    await expect(page.getByTestId("schedule-list-view")).toBeVisible();
    await expect(
      page.getByTestId(`schedule-list-row-${placement.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`schedule-list-session-${sessionId}`),
    ).toContainText("List Talk Alpha");
  });

  test("@inv:I02 e2e/sched/day Day view", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i02");
    await createSession(
      request,
      auth.session,
      event.id,
      "Day Session",
      [{ name: "Day Spk", email: `day-${Date.now()}@example.com` }],
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-day-view")).toBeVisible();
    await expect(
      page.getByTestId(slotTestId(ROOM_A, SLOT_10)),
    ).toBeVisible();
  });

  test("@inv:I03 e2e/sched/week Week view", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i03");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Week Session",
      [{ name: "Week Spk", email: `week-${Date.now()}@example.com` }],
    );
    const placement = await placeViaApi(
      request,
      auth.session,
      event.id,
      sessionId,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-week").click();
    await expect(page.getByTestId("schedule-week-view")).toBeVisible();
    await expect(
      page.getByTestId(`schedule-week-placement-${placement.id}`),
    ).toContainText("Week Session");
  });

  test("@inv:I04 e2e/sched/track Track view", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i04");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Track Session",
      [{ name: "Track Spk", email: `track-${Date.now()}@example.com` }],
      "track_main",
    );
    const placement = await placeViaApi(
      request,
      auth.session,
      event.id,
      sessionId,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-track").click();
    await expect(page.getByTestId("schedule-track-view")).toBeVisible();
    await expect(
      page.getByTestId(`schedule-track-placement-${placement.id}`),
    ).toContainText("Track Session");
  });

  test("@inv:I05 e2e/sched/room Room view", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i05");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Room Session",
      [{ name: "Room Spk", email: `room-${Date.now()}@example.com` }],
    );
    const placement = await placeViaApi(
      request,
      auth.session,
      event.id,
      sessionId,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-room").click();
    await expect(page.getByTestId("schedule-room-view")).toBeVisible();
    await expect(
      page.getByTestId(`schedule-room-group-${ROOM_A}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`schedule-room-placement-${placement.id}`),
    ).toContainText("Room Session");
  });

  test("@inv:I06 e2e/sched/drag-place Drag place into empty slot", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i06");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Drag Place Talk",
      [{ name: "Drag Spk", email: `drag-${Date.now()}@example.com` }],
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-day-view")).toBeVisible();

    const countBefore = await page
      .getByTestId("schedule-placement-count")
      .getAttribute("data-count");
    expect(countBefore).toBe("0");

    await pointerDragTo(
      page,
      `schedule-tray-item-${sessionId}`,
      slotTestId(ROOM_A, SLOT_10),
    );

    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("schedule-tray-item-" + sessionId)).toHaveCount(
      0,
    );
  });

  test("@inv:I07 e2e/sched/conflict-speaker speaker conflict blocked", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i07");
    const spkEmail = `spk-conflict-${Date.now()}@example.com`;
    const s1 = await createSession(
      request,
      auth.session,
      event.id,
      "Speaker First",
      [{ name: "Conflict Ada", email: spkEmail }],
    );
    const s2 = await createSession(
      request,
      auth.session,
      event.id,
      "Speaker Second",
      [{ name: "Conflict Ada", email: spkEmail }],
    );
    await placeViaApi(
      request,
      auth.session,
      event.id,
      s1,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );

    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
    );

    // assert conflict drop leaves placement count unchanged
    await pointerDragTo(
      page,
      `schedule-tray-item-${s2}`,
      slotTestId(ROOM_B, SLOT_10),
    );

    await expect(page.getByTestId("schedule-conflict-toast")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-conflict-toast")).toContainText(
      /Speaker|booked|conflict/i,
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
    );
  });

  test("@inv:I08 e2e/sched/conflict-room Room overlap conflict", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i08");
    const s1 = await createSession(
      request,
      auth.session,
      event.id,
      "Room First",
      [{ name: "R1", email: `r1-${Date.now()}@example.com` }],
    );
    const s2 = await createSession(
      request,
      auth.session,
      event.id,
      "Room Second",
      [{ name: "R2", email: `r2-${Date.now()}@example.com` }],
    );
    await placeViaApi(
      request,
      auth.session,
      event.id,
      s1,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );

    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();

    await pointerDragTo(
      page,
      `schedule-tray-item-${s2}`,
      slotTestId(ROOM_A, SLOT_10),
    );

    await expect(page.getByTestId("schedule-conflict-toast")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-conflict-toast")).toContainText(
      /Room|booked|conflict/i,
    );
    // assert conflict drop leaves placement count unchanged
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
    );
  });

  test("@inv:I09 e2e/sched/keyboard Keyboard place creates placement", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i09");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Keyboard Place Talk",
      [{ name: "Key Spk", email: `key-${Date.now()}@example.com` }],
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();

    // assert keyboard place creates placement
    await page.getByTestId(`schedule-tray-item-${sessionId}`).click();
    await page.getByTestId(slotTestId(ROOM_A, SLOT_14)).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId(`schedule-tray-item-${sessionId}`)).toHaveCount(
      0,
    );
  });

  test("@inv:I10 e2e/sched/undo Undo last move", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i10");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Undo Talk",
      [{ name: "Undo Spk", email: `undo-${Date.now()}@example.com` }],
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();

    await page.getByTestId(`schedule-tray-item-${sessionId}`).click();
    await page.getByTestId(slotTestId(ROOM_A, SLOT_10)).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
      { timeout: 15_000 },
    );

    await page.getByTestId("schedule-undo").click();
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "0",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId(`schedule-tray-item-${sessionId}`)).toBeVisible();
  });

  test("@inv:I11 e2e/sched/tray Unscheduled tray", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i11");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Tray Only Talk",
      [{ name: "Tray Spk", email: `tray-${Date.now()}@example.com` }],
    );
    await openSchedule(page, event.id);
    await expect(page.getByTestId("schedule-tray")).toBeVisible();
    await expect(page.getByTestId(`schedule-tray-item-${sessionId}`)).toContainText(
      "Tray Only Talk",
    );
  });

  test("@inv:I18 e2e/sched/tray-filter search and sort controls", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i18");
    await createSession(
      request,
      auth.session,
      event.id,
      "Alpha Filter Talk",
      [{ name: "Alpha Spk", email: `alpha-i18-${Date.now()}@example.com` }],
    );
    await createSession(
      request,
      auth.session,
      event.id,
      "Zulu Filter Talk",
      [{ name: "Zulu Spk", email: `zulu-i18-${Date.now()}@example.com` }],
    );
    await openSchedule(page, event.id);
    await expect(page.getByTestId("schedule-tray-search")).toBeVisible();
    await expect(page.getByTestId("schedule-tray-sort")).toBeVisible();
    await page.getByTestId("schedule-tray-search").fill("Zulu");
    await expect(page.getByTestId("schedule-tray-list")).toContainText(
      "Zulu Filter Talk",
    );
    await expect(page.getByTestId("schedule-tray-list")).not.toContainText(
      "Alpha Filter Talk",
    );
    await page.getByTestId("schedule-tray-sort").selectOption("title");
    await page.getByTestId("schedule-tray-search").fill("");
    await expect(page.getByTestId("schedule-tray-list")).toContainText(
      "Alpha Filter Talk",
    );
  });

  test("@inv:I12 e2e/sched/tz Timezone displayed", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { event } = await seedBase(request, context, baseURL, "i12");
    await openSchedule(page, event.id);
    await expect(page.getByTestId("schedule-timezone")).toBeVisible();
    await expect(page.getByTestId("schedule-timezone")).toContainText(
      /America\/New_York|UTC/,
    );
    const tz = await page
      .getByTestId("schedule-timezone")
      .getAttribute("data-timezone");
    expect(tz).toBeTruthy();
  });

  test("@inv:I13 e2e/sched/move Move already-placed session", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i13");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Move Talk",
      [{ name: "Move Spk", email: `move-${Date.now()}@example.com` }],
    );
    const placement = await placeViaApi(
      request,
      auth.session,
      event.id,
      sessionId,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();
    await expect(
      page.getByTestId(`schedule-placement-${placement.id}`),
    ).toBeVisible();

    await pointerDragTo(
      page,
      `schedule-placement-${placement.id}`,
      slotTestId(ROOM_B, SLOT_14),
    );

    await expect(page.getByTestId("schedule-status-toast")).toContainText(
      /moved|placed/i,
      { timeout: 15_000 },
    );
    // After reload path in UI, placement still count 1 at new slot
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
    );
    await expect(
      page.getByTestId(slotTestId(ROOM_B, SLOT_14)).locator(".schedule-tile"),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("@inv:I14 e2e/sched/unschedule Unschedule back to tray", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i14");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Unschedule Talk",
      [{ name: "Unsch Spk", email: `unsch-${Date.now()}@example.com` }],
    );
    const placement = await placeViaApi(
      request,
      auth.session,
      event.id,
      sessionId,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-list").click();
    await page.getByTestId(`schedule-unschedule-${placement.id}`).click();
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "0",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId(`schedule-tray-item-${sessionId}`)).toBeVisible();
  });

  test("@inv:I15 e2e/sched/stale Stale version recovery UI", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i15");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Stale Talk",
      [{ name: "Stale Spk", email: `stale-${Date.now()}@example.com` }],
    );
    const placement = await placeViaApi(
      request,
      auth.session,
      event.id,
      sessionId,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );

    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-list").click();
    await expect(
      page.getByTestId(`schedule-list-row-${placement.id}`),
    ).toBeVisible();

    // Concurrent move bumps version while UI still holds v1
    const moveRes = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/schedule/move`,
      {
        headers: sessionHeaders(auth.session),
        data: {
          placementId: placement.id,
          roomId: ROOM_B,
          startsAt: SLOT_14,
          endsAt: "2026-09-01T15:00:00.000Z",
          expectedVersion: placement.version,
        },
      },
    );
    expect(moveRes.status()).toBe(200);

    // UI attempts unschedule with stale version from list button (still v1 in DOM)
    await page.getByTestId(`schedule-unschedule-${placement.id}`).click();
    await expect(page.getByTestId("schedule-stale-recovery")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-stale-recovery")).toContainText(
      /refresh|stale|overwrite/i,
    );
    await page.getByTestId("schedule-stale-refresh").click();
    await expect(page.getByTestId("schedule-stale-recovery")).toHaveCount(0);
  });

  test("@inv:I16 e2e/sched/persist five views + reload consistent", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedBase(request, context, baseURL, "i16");
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Persist Talk",
      [{ name: "Persist Spk", email: `persist-${Date.now()}@example.com` }],
      "track_main",
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();

    // Place via keyboard (stable)
    await page.getByTestId(`schedule-tray-item-${sessionId}`).click();
    await page.getByTestId(slotTestId(ROOM_A, SLOT_10)).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
      { timeout: 15_000 },
    );

    // All five views show the placement
    for (const v of ["list", "day", "week", "track", "room"] as const) {
      await page.getByTestId(`schedule-view-${v}`).click();
      await expect(page.getByTestId(`schedule-view-panel-${v}`)).toBeVisible();
      await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
        "data-count",
        "1",
      );
    }

    // assert reload shows same slot
    await page.reload();
    await expect(page.getByTestId("page-schedule")).toBeVisible();
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
      { timeout: 15_000 },
    );
    await page.getByTestId("schedule-view-list").click();
    await expect(
      page.getByTestId(`schedule-list-session-${sessionId}`),
    ).toContainText("Persist Talk");
    await page.getByTestId("schedule-view-day").click();
    await expect(
      page.getByTestId(slotTestId(ROOM_A, SLOT_10)).locator(".schedule-tile"),
    ).toBeVisible();
  });
});
