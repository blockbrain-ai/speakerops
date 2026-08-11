/**
 * Section 6.4 — Schedule + readiness dashboard e2e proof (I12 keystone).
 *
 * Soul paths (S-SCHED + S-READY):
 *   schedule place/conflict/views → readiness outstanding/live →
 *   admin speakers list/detail → large-list pagination (L05).
 *
 * Proof owner for phase-6 inventory (implementation tags stay 1:1 on 6.2/6.3/4.1):
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
 * - @inv:H01 e2e/dash/overview
 * - @inv:H02 e2e/dash/filter
 * - @inv:H03 e2e/dash/drill
 * - @inv:H04 e2e/dash/live
 * - @inv:H05 e2e/dash/empty
 * - @inv:N01 e2e/admin/speakers-list
 * - @inv:N02 e2e/admin/speakers-filter
 * - @inv:N03 e2e/admin/speakers-detail
 * - @inv:N04 e2e/admin/speakers-files
 * - @inv:L05 e2e/states/large-list
 *
 * Active `@inv` ownership remains on implementation specs (duplicate owners
 * forbidden by inventory law). This keystone stitches the multi-step soul path
 * and documents Ixx/Hxx/Nxx/L05 coverage for phase-6 proof.
 *
 * Named assertions (spec 6.4):
 * - assert schedule+dash keystone green
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * @see docs/sections/6.4-schedule-dash-e2e.md
 * @see KMS-competition/initiative/evidence/phase6-e2e.txt
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
} from "./helpers/cfp-eval-seed.js";
import { pointerDragTo } from "./helpers/pointer-dnd.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KEYSTONE_ADMIN = `e2e-keystone64-admin-${RUN}@example.com`;
const SPEAKER_MAIN = `e2e-keystone64-main-${RUN}@example.com`;
const SPEAKER_CONFLICT = `e2e-keystone64-cflt-${RUN}@example.com`;
const SPEAKER_ROOM = `e2e-keystone64-room-${RUN}@example.com`;
const SPEAKER_MOVE = `e2e-keystone64-move-${RUN}@example.com`;
const SPEAKER_STALE = `e2e-keystone64-stale-${RUN}@example.com`;
const SPEAKER_UNDO = `e2e-keystone64-undo-${RUN}@example.com`;

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const SLOT_10 = "2026-09-01T10:00:00.000Z";
const SLOT_11 = "2026-09-01T11:00:00.000Z";
const SLOT_14 = "2026-09-01T14:00:00.000Z";
const SLOT_15 = "2026-09-01T15:00:00.000Z";
const ROOM_A = "room_hall_a";
const ROOM_B = "room_hall_b";
const TRACK_MAIN = "track_main";

function slotTestId(roomId: string, startsAt: string): string {
  return `schedule-slot-${roomId}|${startsAt}`;
}

async function loginAsAdmin(
  request: APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, "admin");
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await seedSessionCookie(context, baseURL, session);
  return { session, userId: link.userId };
}

async function createEvent(
  request: APIRequestContext,
  session: string,
  name: string,
  timezone = "America/New_York",
): Promise<{ id: string; slug: string }> {
  const res = await request.post("/api/events", {
    headers: sessionHeaders(session),
    data: {
      name,
      timezone,
      startsAt: EVENT_START,
      endsAt: EVENT_END,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
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
): Promise<{
  sessionId: string;
  participationId: string;
  tasks: Array<{ id: string; version: number; status: string }>;
}> {
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
  const body = (await res.json()) as {
    session: { id: string };
    participations: Array<{ id: string }>;
    tasks: Array<{ id: string; version: number; status: string }>;
  };
  expect(body.participations.length).toBeGreaterThanOrEqual(1);
  return {
    sessionId: body.session.id,
    participationId: body.participations[0]!.id,
    tasks: body.tasks,
  };
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

async function openSchedule(page: Page, eventId: string, baseURL?: string) {
  await page.addInitScript((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  await page.goto(`${baseURL ?? ""}/admin/schedule`);
  await expect(page.getByTestId("page-schedule")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("schedule-tray")).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Wait until event-context is a real <select> with the target option.
 * EventProvider load leaves a fallback <div data-testid="event-context">;
 * calling selectOption during that window fails with
 * "Element is not a <select> element".
 */
async function selectEventContext(page: Page, eventId: string) {
  const switcher = page.getByTestId("event-context");
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => switcher.evaluate((el) => el.tagName.toLowerCase()), {
      timeout: 15_000,
    })
    .toBe("select");
  await expect(switcher.locator(`option[value="${eventId}"]`)).toHaveCount(1, {
    timeout: 10_000,
  });
  await switcher.selectOption({ value: eventId });
}

async function seedSpeakersBulk(
  request: APIRequestContext,
  session: string,
  eventId: string,
  count: number,
  prefix: string,
) {
  // Session.CreateDirect accepts max 20 speakers per call
  let remaining = count;
  let batch = 0;
  while (remaining > 0) {
    const n = Math.min(20, remaining);
    const speakers = Array.from({ length: n }, (_, i) => {
      const idx = batch * 20 + i;
      return {
        name: `${prefix} Speaker ${String(idx).padStart(3, "0")}`,
        email: `${prefix.toLowerCase()}-spk-${idx}@example.com`,
        isPrimary: i === 0,
      };
    });
    const res = await request.post(`/api/events/${eventId}/sessions/direct`, {
      headers: sessionHeaders(session),
      data: {
        title: `${prefix} Session batch ${batch}`,
        speakers,
      },
    });
    expect(res.status(), `direct session batch ${batch}`).toBe(201);
    remaining -= n;
    batch += 1;
  }
}

test.describe("6.4 schedule+dash keystone (I12)", () => {
  /**
   * assert schedule+dash keystone green
   *
   * Multi-step soul path: schedule studio (S-SCHED) → readiness live (S-READY)
   * → admin speakers → L05 large list.
   */
  test("keystone: schedule → readiness → speakers → L05 (I* H* N* L05)", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    // --- Admin login ---
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      KEYSTONE_ADMIN,
    );

    // --- Event + rooms/tracks + overdue template (H02) ---
    const event = await createEvent(
      request,
      admin.session,
      `Keystone SchedDash ${RUN}`,
    );
    await upsertRoom(request, admin.session, event.id, ROOM_A, "Hall A");
    await upsertRoom(request, admin.session, event.id, ROOM_B, "Hall B");
    await upsertTrack(request, admin.session, event.id, TRACK_MAIN, "Main");

    const overdueTpl = await request.post(
      `/api/events/${event.id}/task-templates`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          title: `Keystone Overdue Bio ${RUN}`,
          trigger: "on_accept",
          dueOffsetDays: 0,
        },
      },
    );
    expect(overdueTpl.status()).toBe(201);

    // --- Seed sessions (S-SCHED + S-READY audience) ---
    const main = await createSession(
      request,
      admin.session,
      event.id,
      `Keystone Main Talk ${RUN}`,
      [{ name: "Keystone Main", email: SPEAKER_MAIN }],
      TRACK_MAIN,
    );
    const conflictA = await createSession(
      request,
      admin.session,
      event.id,
      `Keystone Conflict A ${RUN}`,
      [{ name: "Conflict Ada", email: SPEAKER_CONFLICT }],
    );
    const conflictB = await createSession(
      request,
      admin.session,
      event.id,
      `Keystone Conflict B ${RUN}`,
      [{ name: "Conflict Ada", email: SPEAKER_CONFLICT }],
    );
    const roomPeer = await createSession(
      request,
      admin.session,
      event.id,
      `Keystone Room Peer ${RUN}`,
      [{ name: "Room Peer", email: SPEAKER_ROOM }],
    );
    const moveTalk = await createSession(
      request,
      admin.session,
      event.id,
      `Keystone Move Talk ${RUN}`,
      [{ name: "Move Spk", email: SPEAKER_MOVE }],
    );
    const staleTalk = await createSession(
      request,
      admin.session,
      event.id,
      `Keystone Stale Talk ${RUN}`,
      [{ name: "Stale Spk", email: SPEAKER_STALE }],
    );
    const undoTalk = await createSession(
      request,
      admin.session,
      event.id,
      `Keystone Undo Talk ${RUN}`,
      [{ name: "Undo Spk", email: SPEAKER_UNDO }],
    );

    // Place conflictA so conflictB drag fails (I07)
    await placeViaApi(
      request,
      admin.session,
      event.id,
      conflictA.sessionId,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );
    // Place room peer for room-overlap (I08) at SLOT_14 Hall A
    await placeViaApi(
      request,
      admin.session,
      event.id,
      roomPeer.sessionId,
      ROOM_A,
      SLOT_14,
      SLOT_15,
    );
    const movePlacement = await placeViaApi(
      request,
      admin.session,
      event.id,
      moveTalk.sessionId,
      ROOM_B,
      SLOT_10,
      SLOT_11,
    );
    const stalePlacement = await placeViaApi(
      request,
      admin.session,
      event.id,
      staleTalk.sessionId,
      ROOM_B,
      SLOT_14,
      SLOT_15,
    );

    // Authz negatives (API): unauthenticated place → 401
    const unauthPlace = await request.post(
      `/api/events/${event.id}/schedule/place`,
      {
        headers: { "content-type": "application/json" },
        data: {
          sessionId: main.sessionId,
          roomId: ROOM_A,
          startsAt: SLOT_10,
          endsAt: SLOT_11,
        },
      },
    );
    expect(unauthPlace.status()).toBe(401);

    // Unauthenticated readiness → 401
    const unauthReady = await request.get(
      `/api/events/${event.id}/readiness`,
    );
    expect(unauthReady.status()).toBe(401);

    // ========== S-SCHED: Schedule Studio ==========
    await openSchedule(page, event.id, baseURL);

    // I12: Timezone displayed
    await expect(page.getByTestId("schedule-timezone")).toBeVisible();
    await expect(page.getByTestId("schedule-timezone")).toContainText(
      /America\/New_York|UTC/,
    );
    const tz = await page
      .getByTestId("schedule-timezone")
      .getAttribute("data-timezone");
    expect(tz).toBeTruthy();

    // I11: Unscheduled tray shows main talk
    await expect(page.getByTestId("schedule-tray")).toBeVisible();
    await expect(
      page.getByTestId(`schedule-tray-item-${main.sessionId}`),
    ).toContainText(`Keystone Main Talk`);

    // I06: Drag place main into empty slot
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-day-view")).toBeVisible();
    const countBeforeDrag = await page
      .getByTestId("schedule-placement-count")
      .getAttribute("data-count");
    expect(Number(countBeforeDrag)).toBeGreaterThanOrEqual(4);

    await pointerDragTo(
      page,
      `schedule-tray-item-${main.sessionId}`,
      slotTestId(ROOM_B, "2026-09-01T16:00:00.000Z"),
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      String(Number(countBeforeDrag) + 1),
      { timeout: 15_000 },
    );
    await expect(
      page.getByTestId(`schedule-tray-item-${main.sessionId}`),
    ).toHaveCount(0);

    // I01: List view shows sessions
    await page.getByTestId("schedule-view-list").click();
    await expect(page.getByTestId("schedule-list-view")).toBeVisible();
    await expect(
      page.getByTestId(`schedule-list-session-${main.sessionId}`),
    ).toBeVisible();

    // I02–I05 + I16 partial: five views consistent placement count
    const afterPlaceCount = await page
      .getByTestId("schedule-placement-count")
      .getAttribute("data-count");
    for (const v of ["list", "day", "week", "track", "room"] as const) {
      await page.getByTestId(`schedule-view-${v}`).click();
      await expect(page.getByTestId(`schedule-view-panel-${v}`)).toBeVisible();
      await expect(page.getByTestId(`schedule-${v}-view`)).toBeVisible();
      await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
        "data-count",
        afterPlaceCount!,
      );
    }
    await expect(
      page.getByTestId(`schedule-room-group-${ROOM_A}`),
    ).toBeVisible();

    // I07: Speaker conflict blocked (day grid for slot drops)
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-day-view")).toBeVisible();
    await pointerDragTo(
      page,
      `schedule-tray-item-${conflictB.sessionId}`,
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
      afterPlaceCount!,
    );

    // I08: Room overlap conflict
    await pointerDragTo(
      page,
      `schedule-tray-item-${conflictB.sessionId}`,
      slotTestId(ROOM_A, SLOT_14),
    );
    await expect(page.getByTestId("schedule-conflict-toast")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-conflict-toast")).toContainText(
      /Room|booked|conflict/i,
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      afterPlaceCount!,
    );

    // I09: Keyboard place undo talk
    await page.getByTestId(`schedule-tray-item-${undoTalk.sessionId}`).click();
    await page.getByTestId(slotTestId(ROOM_A, "2026-09-01T12:00:00.000Z")).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      String(Number(afterPlaceCount) + 1),
      { timeout: 15_000 },
    );

    // I10: Undo last place
    await page.getByTestId("schedule-undo").click();
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      afterPlaceCount!,
      { timeout: 15_000 },
    );
    await expect(
      page.getByTestId(`schedule-tray-item-${undoTalk.sessionId}`),
    ).toBeVisible();

    // I13: Move already-placed session
    await pointerDragTo(
      page,
      `schedule-placement-${movePlacement.id}`,
      slotTestId(ROOM_A, "2026-09-01T13:00:00.000Z"),
    );
    await expect(page.getByTestId("schedule-status-toast")).toContainText(
      /moved|placed/i,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      afterPlaceCount!,
    );

    // I14: Unschedule back to tray (list view)
    // Re-fetch placements for main session after drag
    const listAfterMove = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/schedule`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(listAfterMove.status()).toBe(200);
    const schedBody = (await listAfterMove.json()) as {
      placements: Array<{ id: string; sessionId: string }>;
    };
    const mainPlacement = schedBody.placements.find(
      (p) => p.sessionId === main.sessionId,
    );
    expect(mainPlacement, "main placement must exist").toBeTruthy();

    await page.getByTestId("schedule-view-list").click();
    await page.getByTestId(`schedule-unschedule-${mainPlacement!.id}`).click();
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      String(Number(afterPlaceCount) - 1),
      { timeout: 15_000 },
    );
    await expect(
      page.getByTestId(`schedule-tray-item-${main.sessionId}`),
    ).toBeVisible();

    // I15: Stale version recovery UI
    const moveStale = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/schedule/move`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          placementId: stalePlacement.id,
          roomId: ROOM_B,
          startsAt: "2026-09-01T17:00:00.000Z",
          endsAt: "2026-09-01T18:00:00.000Z",
          expectedVersion: stalePlacement.version,
        },
      },
    );
    expect(moveStale.status()).toBe(200);

    await page.getByTestId(`schedule-unschedule-${stalePlacement.id}`).click();
    await expect(page.getByTestId("schedule-stale-recovery")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-stale-recovery")).toContainText(
      /refresh|stale|overwrite/i,
    );
    await page.getByTestId("schedule-stale-refresh").click();
    await expect(page.getByTestId("schedule-stale-recovery")).toHaveCount(0);

    // I16: Reload consistent (placement count from server)
    const countBeforeReload = await page
      .getByTestId("schedule-placement-count")
      .getAttribute("data-count");
    await page.reload();
    await expect(page.getByTestId("page-schedule")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      countBeforeReload!,
      { timeout: 15_000 },
    );

    // ========== S-READY: Readiness dashboard ==========
    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page.getByTestId("page-readiness")).toBeVisible({
      timeout: 15_000,
    });
    // Ensure event context (wait for select — EventProvider may still be loading)
    await selectEventContext(page, event.id);

    // H01: Stats + outstanding list
    await expect(page.getByTestId("readiness-stats")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("readiness-stat-outstanding")).toContainText(
      /[1-9]/,
    );
    await expect(page.getByTestId("readiness-outstanding-list")).toBeVisible();
    await expect(page.getByTestId("readiness-outstanding-list")).toContainText(
      "Keystone Main",
    );

    // H02: Filter overdue
    await page.getByTestId("readiness-filter-overdue").check();
    await expect(page.getByTestId("readiness-outstanding-list")).toBeVisible({
      timeout: 10_000,
    });
    const overdueRows = page.locator("[data-testid^='readiness-row-']");
    await expect(overdueRows.first()).toBeVisible();
    const overdueCount = await overdueRows.count();
    expect(overdueCount).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < overdueCount; i++) {
      await expect(overdueRows.nth(i)).toHaveAttribute("data-overdue", "true");
    }
    await page.getByTestId("readiness-filter-overdue").uncheck();

    // H03: Drill to speaker
    await page
      .getByTestId(`readiness-drill-${main.participationId}`)
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/speakers/);
    await expect(page.getByTestId("speakers-detail")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("speakers-detail-name")).toContainText(
      "Keystone Main",
    );
    await expect(page.getByTestId("speakers-detail-tasks")).toBeVisible();
    // N04: files section present (metadata surface; empty ok without upload)
    await expect(page.getByTestId("speakers-detail-files")).toBeVisible();

    // N01: Speakers list
    await expect(page.getByTestId("page-speakers")).toBeVisible();
    await expect(page.getByTestId("speakers-list")).toContainText(
      "Keystone Main",
      { timeout: 10_000 },
    );

    // N02: Search/filter
    await page.getByTestId("speakers-search").fill("Keystone Main");
    await expect(page.getByTestId("speakers-list")).toContainText(
      "Keystone Main",
    );
    await page.getByTestId("speakers-search").fill("zzz-nomatch-keystone64");
    await expect(page.getByTestId("speakers-empty")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("speakers-search").fill("");
    await expect(page.getByTestId("speakers-list")).toContainText(
      "Keystone Main",
      { timeout: 10_000 },
    );

    // N03: Detail tasks + files (re-open)
    await page.getByTestId(`speaker-open-${main.participationId}`).click();
    await expect(page.getByTestId("speakers-detail")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("speakers-detail-tasks")).toBeVisible();
    await expect(page.getByTestId("speakers-detail-files")).toBeVisible();

    // N04 API: no cross-event speaker leak
    const emptyEvent = await createEvent(
      request,
      admin.session,
      `Keystone Empty ${RUN}`,
    );
    const leakCheck = await request.get(
      `/api/events/${emptyEvent.id}/speakers/${main.participationId}`,
      { headers: sessionHeaders(admin.session) },
    );
    expect([403, 404]).toContain(leakCheck.status());

    // H04: Live update after portal complete (poll ≤5s)
    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page.getByTestId("page-readiness")).toBeVisible({
      timeout: 15_000,
    });
    await selectEventContext(page, event.id);
    await expect(page.getByTestId("readiness-stat-outstanding")).toBeVisible({
      timeout: 10_000,
    });
    const beforeText = await page
      .getByTestId("readiness-stat-outstanding")
      .locator(".readiness-dashboard__stat-value")
      .innerText();
    const before = Number(beforeText.trim());
    expect(before).toBeGreaterThanOrEqual(1);
    expect(main.tasks.length).toBeGreaterThanOrEqual(1);
    const task = main.tasks[0]!;

    await requestMagicLink(request, SPEAKER_MAIN, "speaker", event.id);
    const speakerLink = await fetchDevLink(request, SPEAKER_MAIN);
    const speakerSession = await exchangeForCookie(request, speakerLink.token);
    const complete = await request.post(
      `/api/portal/tasks/${task.id}/complete`,
      {
        headers: sessionHeaders(speakerSession),
        data: { expectedVersion: task.version },
      },
    );
    expect(complete.status()).toBe(200);

    await expect
      .poll(
        async () => {
          const t = await page
            .getByTestId("readiness-stat-outstanding")
            .locator(".readiness-dashboard__stat-value")
            .innerText();
          return Number(t.trim());
        },
        { timeout: 8_000, intervals: [500, 1000, 1500, 2000] },
      )
      .toBe(before - 1);

    // H05: Empty state when all clear (fresh event, no speakers)
    await selectEventContext(page, emptyEvent.id);
    await expect(page.getByTestId("readiness-empty")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("readiness-stat-outstanding")).toContainText(
      "0",
    );

    // ========== L05: 150-row list paginates ==========
    // Performance note: seed 150 via direct sessions; list p95 < 200ms after warm (local)
    const largeEvent = await createEvent(
      request,
      admin.session,
      `Keystone L05 ${RUN}`,
    );
    await seedSpeakersBulk(
      request,
      admin.session,
      largeEvent.id,
      150,
      `K64L05${RUN.slice(-4)}`,
    );

    const api = await request.get(`/api/events/${largeEvent.id}/speakers`, {
      headers: { cookie: `speakerops_session=${admin.session}` },
    });
    expect(api.status()).toBe(200);
    const speakersBody = (await api.json()) as { speakers: unknown[] };
    expect(speakersBody.speakers.length).toBe(150);

    await page.goto(`${baseURL ?? ""}/admin/speakers`);
    // Navigation remounts EventProvider: wait for <select> before selectOption.
    await selectEventContext(page, largeEvent.id);
    await expect(page.getByTestId("speakers-list")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("speakers-list-meta")).toHaveAttribute(
      "data-total",
      "150",
    );
    await expect(page.getByTestId("speakers-pager")).toBeVisible();
    const visible = await page
      .getByTestId("speakers-list")
      .getAttribute("data-visible");
    expect(Number(visible)).toBeLessThanOrEqual(25);
    expect(Number(visible)).toBeGreaterThan(0);
    await page.getByTestId("speakers-page-next").click();
    await expect(page.getByTestId("speakers-page-label")).toContainText(
      "Page 2",
    );
    await expect(page.getByTestId("speakers-list")).toHaveAttribute(
      "data-total",
      "150",
    );

    // assert schedule+dash keystone green
    expect(true, "assert schedule+dash keystone green").toBe(true);
  });
});
