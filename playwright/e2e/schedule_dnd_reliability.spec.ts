/**
 * Schedule DnD reliability — first-try success gate for the pointer-event
 * drag implementation (replaces the exploratory zz_dnd_trial scratch spec).
 *
 * Users reported native HTML5 drags "don't always work first try" (Chromium
 * intermittently resolved a drag as a click, opening the reschedule
 * inspector). The studio now uses pointer events with a ~6px activation
 * threshold, so real mouse input is the exact production path. This spec runs
 * 5 consecutive tray→slot placements and 5 consecutive placed-tile moves with
 * the real mouse; EVERY attempt must succeed (10/10) — a single first-try
 * failure fails the gate.
 *
 * Strengthens existing @inv:I06 (drag place) and @inv:I13 (move) coverage —
 * intentionally owns no new inventory rows (IDs stay 1:1 on
 * schedule_studio.spec.ts per inventory law).
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAs, sessionHeaders } from "./helpers/cfp-eval-seed.js";
import { pointerDragTo } from "./helpers/pointer-dnd.js";

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const ROOM_A = "room_rel_a";
const ROOM_B = "room_rel_b";
/** Five distinct hourly slots inside the day window (09:00–17:00 UTC). */
const SLOTS = [
  "2026-09-01T10:00:00.000Z",
  "2026-09-01T11:00:00.000Z",
  "2026-09-01T12:00:00.000Z",
  "2026-09-01T13:00:00.000Z",
  "2026-09-01T14:00:00.000Z",
] as const;

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
        speakers: [{ name: `Spk ${title}`, email: speakerEmail }],
      },
    },
  );
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { session: { id: string } };
  return body.session.id;
}

test.describe("schedule DnD reliability (pointer drag, first-try)", () => {
  test("5 tray→slot places + 5 tile moves — 10/10 first-try success", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const run = `${Date.now()}`;
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `dnd-reliability-${run}@example.com`,
      "admin",
    );

    const create = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `DnD Reliability ${run}`,
        timezone: "UTC",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const { event } = (await create.json()) as { event: { id: string } };
    await upsertRoom(request, admin.session, event.id, ROOM_A, "Rel Hall A");
    await upsertRoom(request, admin.session, event.id, ROOM_B, "Rel Hall B");

    const sessionIds: string[] = [];
    for (let i = 0; i < SLOTS.length; i++) {
      sessionIds.push(
        await createSession(
          request,
          admin.session,
          event.id,
          `Reliability Talk ${i} ${run}`,
          `rel-${i}-${run}@example.com`,
        ),
      );
    }

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto("/admin/schedule");
    await expect(page.getByTestId("page-schedule")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-day-view")).toBeVisible();
    await expect(page.getByTestId("schedule-tray")).toBeVisible();
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "0",
      { timeout: 15_000 },
    );

    // ---- Phase 1: 5 consecutive tray→slot drags; each must land first try.
    let trayOk = 0;
    for (let i = 0; i < SLOTS.length; i++) {
      const sessionId = sessionIds[i]!;
      const slot = SLOTS[i]!;
      await expect(
        page.getByTestId(`schedule-tray-item-${sessionId}`),
      ).toBeVisible({ timeout: 15_000 });

      await pointerDragTo(
        page,
        `schedule-tray-item-${sessionId}`,
        slotTestId(ROOM_A, slot),
      );

      // First-try success: placement count increments and tray item leaves.
      await expect(
        page.getByTestId("schedule-placement-count"),
        `tray→slot attempt ${i + 1} must place first try`,
      ).toHaveAttribute("data-count", String(i + 1), { timeout: 15_000 });
      await expect(
        page.getByTestId(`schedule-tray-item-${sessionId}`),
      ).toHaveCount(0);
      await expect(
        page
          .getByTestId(slotTestId(ROOM_A, slot))
          .locator(`[data-session-id="${sessionId}"]`),
      ).toBeVisible({ timeout: 15_000 });
      trayOk += 1;
    }

    // ---- Phase 2: 5 consecutive placed-tile moves (Room A → Room B, same
    // hour); each must move first try. Placed-tile moves were the flakiest
    // native-DnD path (drag resolving as click → inspector instead of move).
    let moveOk = 0;
    for (let i = 0; i < SLOTS.length; i++) {
      const sessionId = sessionIds[i]!;
      const slot = SLOTS[i]!;
      const tile = page.locator(
        `[data-testid^="schedule-placement-"][data-session-id="${sessionId}"]`,
      );
      await expect(tile).toBeVisible({ timeout: 15_000 });
      const placementId = await tile.getAttribute("data-placement-id");
      expect(placementId, `placement id for move attempt ${i + 1}`).toBeTruthy();

      await pointerDragTo(
        page,
        `schedule-placement-${placementId}`,
        slotTestId(ROOM_B, slot),
      );

      // First-try success: tile lands in the Room B slot; count unchanged.
      await expect(
        page
          .getByTestId(slotTestId(ROOM_B, slot))
          .locator(`[data-session-id="${sessionId}"]`),
        `tile move attempt ${i + 1} must land first try`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByTestId("schedule-placement-count"),
      ).toHaveAttribute("data-count", String(SLOTS.length));
      moveOk += 1;
    }

    expect(trayOk, "all tray→slot drags must succeed first try").toBe(
      SLOTS.length,
    );
    expect(moveOk, "all tile moves must succeed first try").toBe(SLOTS.length);
    console.log(
      `[dnd-reliability] tray→slot ${trayOk}/${SLOTS.length} · tile-move ${moveOk}/${SLOTS.length} (10/10 required)`,
    );
  });
});
