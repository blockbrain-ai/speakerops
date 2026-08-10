/**
 * Schedule DnD honesty — defects owner hit on dogfood that synthetic-only
 * suites under-tested:
 * - Place removes session from tray (terminal UI)
 * - Move already-placed tile via drop onto a *filled* slot (nested hit-target)
 * - Click tile → inspector reschedule (non-drag path; below-threshold press)
 *
 * Schedule Studio DnD is now pointer-event based (native HTML5 DnD removed —
 * Chromium's native drag intermittently resolved as a click). The old caveat
 * that "Playwright can't initiate real HTML5 DnD" no longer applies: real
 * mouse input (pointerDragTo) IS the production drag path, so these tests
 * drive exactly what humans do — press, cross the ~6px threshold, glide, drop.
 *
 * Complements @inv:I06/I13 without owning inventory IDs.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAs, sessionHeaders } from "./helpers/cfp-eval-seed.js";
import { pointerDragTo } from "./helpers/pointer-dnd.js";

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const SLOT_A = "2026-09-01T10:00:00.000Z";
const SLOT_A_END = "2026-09-01T11:00:00.000Z";
const SLOT_B = "2026-09-01T14:00:00.000Z";
/** Empty hour between A and B for move target. */
const SLOT_C = "2026-09-01T11:00:00.000Z";
const ROOM = "room_dnd_hall";

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

async function acceptSession(
  request: APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  run: string,
  label: string,
): Promise<{ sessionId: string }> {
  const formRes = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: `DnD CFP ${label} ${run}` },
  });
  expect(formRes.status()).toBe(201);
  const form = (await formRes.json()) as { form: { id: string } };
  await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "talk_title",
          type: "text",
          label: "Title",
          required: true,
          sortOrder: 0,
        },
      ],
    },
  });
  const pub = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(session),
    data: {},
  });
  expect(pub.status()).toBe(200);
  const published = (await pub.json()) as { formVersion: { id: string } };
  const title = `DnD Talk ${label} ${run}`;
  const sub = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: published.formVersion.id,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [
        {
          name: `Spk ${label}`,
          email: `dnd-${label}-${run}@example.com`,
          isPrimary: true,
        },
      ],
      turnstileToken: "XXXX.DUMMY.TOKEN",
    },
  });
  expect(sub.status()).toBe(201);
  const subBody = (await sub.json()) as { submission: { id: string } };
  const dec = await request.post(
    `/api/submissions/${subBody.submission.id}/decision`,
    {
      headers: sessionHeaders(session),
      data: { decision: "accept" },
    },
  );
  expect(dec.status()).toBe(200);
  const body = (await dec.json()) as {
    session: { id: string } | null;
  };
  expect(body.session?.id).toBeTruthy();
  return { sessionId: body.session!.id };
}

async function placeViaApi(
  request: APIRequestContext,
  cookieSession: string,
  eventId: string,
  sessionId: string,
  roomId: string,
  startsAt: string,
  endsAt: string,
): Promise<{ id: string; version: number }> {
  const res = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/schedule/place`,
    {
      headers: sessionHeaders(cookieSession),
      data: { sessionId, roomId, startsAt, endsAt },
    },
  );
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as {
    placement: { id: string; version: number };
  };
  return body.placement;
}

test.describe("schedule DnD honesty", () => {
  test("tray place removes tray item; move onto filled slot; inspector reschedule", async ({
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
      `admin-dnd-${run}@example.com`,
      "admin",
    );

    const create = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `DnD Honesty ${run}`,
        timezone: "UTC",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    expect(create.status()).toBe(201);
    const { event } = (await create.json()) as {
      event: { id: string; slug: string };
    };
    await upsertRoom(request, admin.session, event.id, ROOM, "Hall DnD");

    const a = await acceptSession(
      request,
      admin.session,
      event.id,
      event.slug,
      run,
      "a",
    );
    const b = await acceptSession(
      request,
      admin.session,
      event.id,
      event.slug,
      run,
      "b",
    );
    // Pre-place A so B can drop onto a *filled* slot (nested tile drop target).
    const placementA = await placeViaApi(
      request,
      admin.session,
      event.id,
      a.sessionId,
      ROOM,
      SLOT_A,
      SLOT_A_END,
    );

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
    await expect(
      page.getByTestId(`schedule-tray-item-${b.sessionId}`),
    ).toBeVisible();

    // Tray is a div role=button, not <button> (grab reliability)
    const trayTag = await page
      .getByTestId(`schedule-tray-item-${b.sessionId}`)
      .evaluate((el) => el.tagName.toLowerCase());
    expect(trayTag).not.toBe("button");
    expect(trayTag).toBe("div");

    // Place B onto empty slot
    await pointerDragTo(
      page,
      `schedule-tray-item-${b.sessionId}`,
      slotTestId(ROOM, SLOT_B),
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "2",
      { timeout: 15_000 },
    );
    // Tray must drop the placed session
    await expect(
      page.getByTestId(`schedule-tray-item-${b.sessionId}`),
    ).toHaveCount(0);

    // Find B placement id from DOM
    const bTile = page.locator(
      `[data-testid^="schedule-placement-"][data-session-id="${b.sessionId}"]`,
    );
    await expect(bTile).toBeVisible({ timeout: 10_000 });
    const bPlacementId = await bTile.getAttribute("data-placement-id");
    expect(bPlacementId).toBeTruthy();

    // Move B to empty SLOT_C (drag from placed tile → empty slot)
    await pointerDragTo(
      page,
      `schedule-placement-${bPlacementId}`,
      slotTestId(ROOM, SLOT_C),
    );
    await expect(page.getByTestId("schedule-status-toast")).toContainText(
      /moved/i,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "2",
      { timeout: 10_000 },
    );

    // Nested honesty: drop *onto the filled tile* for A while moving B back to
    // 14:00 would be empty — instead drop onto A's tile (same room+10:00) must
    // not silently lose placements (hard conflict or no-op; count stays 2).
    await pointerDragTo(
      page,
      `schedule-placement-${bPlacementId}`,
      `schedule-placement-${placementA.id}`,
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "2",
      { timeout: 15_000 },
    );

    // Inspector: select A, reschedule via form (non-drag)
    await page.getByTestId(`schedule-placement-${placementA.id}`).click();
    await expect(page.getByTestId("schedule-inspector")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId("schedule-inspector-time").fill("15:00");
    await page.getByTestId("schedule-inspector-apply").click();
    await expect(page.getByTestId("schedule-status-toast")).toContainText(
      /moved/i,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "2",
      { timeout: 10_000 },
    );
  });

  test("tray/tile grab surface contract (pointer drag; nested hit-targets)", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    /**
     * Locks the DOM contracts that make pointer-event drag reliable:
     * tray is a div (not <button>), grab surfaces are marked
     * data-draggable="true" with native HTML5 draggable REMOVED (native DnD
     * was the flaky path), touch-action none so touch drags don't scroll,
     * and a drop landing on a *filled tile* resolves to its enclosing slot
     * via hit-testing (nested-drop honesty).
     */
    test.setTimeout(90_000);
    const run = `contract-${Date.now()}`;
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `admin-contract-${run}@example.com`,
      "admin",
    );
    const create = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `Contract DnD ${run}`,
        timezone: "UTC",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    expect(create.status()).toBe(201);
    const { event } = (await create.json()) as {
      event: { id: string; slug: string };
    };
    await upsertRoom(request, admin.session, event.id, ROOM, "Hall Contract");
    const a = await acceptSession(
      request,
      admin.session,
      event.id,
      event.slug,
      run,
      "c",
    );
    const placement = await placeViaApi(
      request,
      admin.session,
      event.id,
      a.sessionId,
      ROOM,
      SLOT_A,
      SLOT_A_END,
    );

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto("/admin/schedule");
    await expect(page.getByTestId("page-schedule")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("schedule-view-day").click();

    const tile = page.getByTestId(`schedule-placement-${placement.id}`);
    await expect(tile).toBeVisible({ timeout: 15_000 });
    const tileProps = await tile.evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      nativeDraggable: (el as HTMLElement).draggable,
      dataDrag: el.getAttribute("data-draggable"),
      touchAction: getComputedStyle(el).touchAction,
    }));
    // Pointer drag surface: marked draggable for tooling, native HTML5 DnD off
    // (native drag was the intermittent click-vs-drag failure mode).
    expect(tileProps.dataDrag).toBe("true");
    expect(tileProps.nativeDraggable).toBe(false);
    expect(tileProps.touchAction).toBe("none");

    // Nested honesty: dropping on the *tile* (not empty slot chrome) places/moves
    const b = await acceptSession(
      request,
      admin.session,
      event.id,
      event.slug,
      run,
      "c2",
    );
    await page.getByTestId("schedule-refresh").click();
    await expect(
      page.getByTestId(`schedule-tray-item-${b.sessionId}`),
    ).toBeVisible({ timeout: 15_000 });
    const tray = page.getByTestId(`schedule-tray-item-${b.sessionId}`);
    const trayProps = await tray.evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      nativeDraggable: (el as HTMLElement).draggable,
      dataDrag: el.getAttribute("data-draggable"),
      touchAction: getComputedStyle(el).touchAction,
    }));
    expect(trayProps.tag).toBe("div");
    expect(trayProps.dataDrag).toBe("true");
    expect(trayProps.nativeDraggable).toBe(false);
    expect(trayProps.touchAction).toBe("none");

    // Drop onto filled tile surface (nested path) via real mouse drag —
    // hit-test resolves the tile to its enclosing slot.
    await pointerDragTo(
      page,
      `schedule-tray-item-${b.sessionId}`,
      `schedule-placement-${placement.id}`,
    );
    // The drop resolves to A's slot → hard room conflict from the server.
    // Never a silent no-op: conflict toast surfaces and count is unchanged.
    await expect(page.getByTestId("schedule-conflict-toast")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-conflict-toast")).toContainText(
      /Room|booked|conflict/i,
    );
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
    );
  });
});
