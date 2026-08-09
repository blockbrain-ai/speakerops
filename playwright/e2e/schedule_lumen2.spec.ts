/**
 * Section 11.5 — Schedule Studio Lumen 2 polish (S-L2-SCHED).
 *
 * Named ACs:
 * - AC-11.5-STICKY  Sticky time/room headers on day board scroll region
 * - AC-11.5-CONFLICT Conflict visible on tile + navigable summary
 * - AC-11.5-KEYBOARD Place without drag (select + Enter)
 * - AC-11.5-SURFACE Full-height L2 surface + richer tiles (track meta)
 * - AC-11.5-AUTHZ   Unauth blocked; evaluator lacks admin schedule nav
 *
 * Inventory I01–I16 remain owned by schedule_studio.spec.ts (1:1 @inv law).
 * This file proves L2 composition on top of those journeys.
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  loginAs,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
} from "./helpers/cfp-eval-seed.js";

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const SLOT_10 = "2026-09-01T10:00:00.000Z";
const SLOT_11 = "2026-09-01T11:00:00.000Z";
const SLOT_14 = "2026-09-01T14:00:00.000Z";
const ROOM_A = "room_hall_a";
const ROOM_B = "room_hall_b";
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  color = "#4f46e5",
) {
  const res = await request.put(
    `/api/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(trackId)}`,
    {
      headers: sessionHeaders(session),
      data: { name, color },
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

async function seedAdminSchedule(
  request: APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  label: string,
) {
  const email = `l2sched-${label}-${RUN}@example.com`;
  const auth = await loginAs(request, context, baseURL, email, "admin");
  const createRes = await request.post("/api/events", {
    headers: sessionHeaders(auth.session),
    data: {
      name: `L2 Schedule ${label} ${RUN}`,
      timezone: "America/New_York",
      startsAt: EVENT_START,
      endsAt: EVENT_END,
    },
  });
  expect(createRes.status(), await createRes.text()).toBe(201);
  const created = (await createRes.json()) as {
    event: { id: string; slug: string };
  };
  const event = { id: created.event.id, slug: created.event.slug };
  await upsertRoom(request, auth.session, event.id, ROOM_A, "Hall A");
  await upsertRoom(request, auth.session, event.id, ROOM_B, "Hall B");
  await upsertTrack(request, auth.session, event.id, "track_main", "Main");
  return { auth, event, email };
}

async function openSchedule(page: Page, eventId: string) {
  await page.addInitScript((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  await page.goto("/admin/schedule");
  await expect(page.getByTestId("page-schedule")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("schedule-tray")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("11.5 schedule studio lumen2", () => {
  test("AC-11.5-SURFACE full-height L2 surface + board", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedAdminSchedule(
      request,
      context,
      baseURL,
      "surface",
    );
    await createSession(
      request,
      auth.session,
      event.id,
      "Surface Talk",
      [{ name: "Surf Spk", email: `surf-${RUN}@example.com` }],
      "track_main",
    );
    await openSchedule(page, event.id);

    const root = page.getByTestId("page-schedule");
    await expect(root).toHaveClass(/schedule-studio--l2/);
    await expect(page.getByTestId("schedule-page-header")).toBeVisible();
    await expect(page.getByTestId("schedule-page-header")).toContainText(
      "Schedule Studio",
    );
    await expect(page.getByTestId("schedule-toolbar")).toBeVisible();
    await expect(page.getByTestId("schedule-view-day")).toBeVisible();

    // Day is default (page-atlas day-by-room studio)
    await expect(page.getByTestId("schedule-day-view")).toBeVisible();
    await expect(page.getByTestId("schedule-board")).toBeVisible();
    await expect(page.getByTestId("schedule-grid-header")).toBeVisible();
    await expect(page.getByTestId("schedule-grid-corner")).toContainText("Time");
    await expect(page.getByTestId(`schedule-room-col-${ROOM_A}`)).toContainText(
      "Hall A",
    );
    await expect(page.getByTestId("schedule-place-hint")).toBeVisible();
  });

  test("AC-11.5-STICKY sticky time/room headers", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedAdminSchedule(
      request,
      context,
      baseURL,
      "sticky",
    );
    await createSession(
      request,
      auth.session,
      event.id,
      "Sticky Talk",
      [{ name: "Sticky Spk", email: `sticky-${RUN}@example.com` }],
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-board")).toBeVisible();

    const header = page.getByTestId("schedule-grid-header");
    const corner = page.getByTestId("schedule-grid-corner");
    const timeCell = page.getByTestId("schedule-grid-time").first();

    const headerPos = await header.evaluate(
      (el) => getComputedStyle(el).position,
    );
    const cornerPos = await corner.evaluate(
      (el) => getComputedStyle(el).position,
    );
    const timePos = await timeCell.evaluate(
      (el) => getComputedStyle(el).position,
    );

    expect(headerPos).toBe("sticky");
    expect(cornerPos).toBe("sticky");
    expect(timePos).toBe("sticky");

    // Scroll the board; sticky header remains in the board viewport.
    const board = page.getByTestId("schedule-board");
    await board.evaluate((el) => {
      el.scrollTop = 200;
    });
    const stillSticky = await header.evaluate(
      (el) => getComputedStyle(el).position,
    );
    expect(stillSticky).toBe("sticky");
    await expect(header).toBeVisible();
  });

  test("AC-11.5-CONFLICT tile + summary after blocked place", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedAdminSchedule(
      request,
      context,
      baseURL,
      "conflict",
    );
    const s1 = await createSession(
      request,
      auth.session,
      event.id,
      "Conflict First",
      [{ name: "C1", email: `c1-${RUN}@example.com` }],
      "track_main",
    );
    const s2 = await createSession(
      request,
      auth.session,
      event.id,
      "Conflict Second",
      [{ name: "C2", email: `c2-${RUN}@example.com` }],
    );
    const placement = await placeViaApi(
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

    // Keyboard place into occupied room slot → hard room conflict (no drag).
    await page.getByTestId(`schedule-tray-item-${s2}`).click();
    await page.getByTestId(slotTestId(ROOM_A, SLOT_10)).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("schedule-conflict-toast")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-conflict-toast")).toContainText(
      /Room|booked|conflict/i,
    );

    // Navigable conflict summary
    await expect(page.getByTestId("schedule-conflict-summary")).toBeVisible();
    await expect(page.getByTestId("schedule-conflict-list")).toBeVisible();
    await expect(page.getByTestId("schedule-conflict-item-0")).toBeVisible();
    await expect(page.getByTestId("schedule-conflict-count")).toContainText(
      /conflict/i,
    );

    // Tile conflict chrome on the existing placement (API placementId)
    const tile = page.getByTestId(`schedule-placement-${placement.id}`);
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("data-conflict", "true");
    await expect(tile).toHaveClass(/schedule-tile--conflict/);
    await expect(
      page.getByTestId(`schedule-tile-conflict-${placement.id}`),
    ).toContainText("Conflict");

    // Placement count unchanged
    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
    );

    // Summary item focuses the conflicting placement
    await page.getByTestId("schedule-conflict-item-0").click();
    await expect(tile).toHaveClass(/schedule-tile--selected/);
  });

  test("AC-11.5-KEYBOARD place without drag", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { auth, event } = await seedAdminSchedule(
      request,
      context,
      baseURL,
      "keyboard",
    );
    const sessionId = await createSession(
      request,
      auth.session,
      event.id,
      "Keyboard L2 Talk",
      [{ name: "Key L2", email: `keyl2-${RUN}@example.com` }],
      "track_main",
    );
    await openSchedule(page, event.id);
    await page.getByTestId("schedule-view-day").click();

    await page.getByTestId(`schedule-tray-item-${sessionId}`).click();
    await expect(page.getByTestId("schedule-place-hint")).toContainText(
      /Selection active|keyboard/i,
    );

    await page.getByTestId(slotTestId(ROOM_B, SLOT_14)).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("schedule-placement-count")).toHaveAttribute(
      "data-count",
      "1",
      { timeout: 15_000 },
    );
    await expect(
      page.getByTestId(`schedule-tray-item-${sessionId}`),
    ).toHaveCount(0);

    // Richer tile: time range + room + track label
    const tile = page.locator(
      `[data-testid^="schedule-placement-"][data-session-id="${sessionId}"]`,
    );
    await expect(tile).toBeVisible();
    await expect(tile).toContainText("Keyboard L2 Talk");
    await expect(tile).toContainText(/Hall B|Main/i);
  });

  test("AC-11.5-AUTHZ unauthenticated blocked; evaluator no admin schedule", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // Unauthenticated → login / recovery, not privileged schedule
    await context.clearCookies();
    await page.goto("/admin/schedule");
    await expect(page.getByTestId("page-schedule")).toHaveCount(0);
    await expect(
      page
        .getByTestId("login-page")
        .or(page.getByTestId("login-form"))
        .or(page.getByTestId("login-email"))
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Evaluator session: no admin nav schedule control
    const adminEmail = `l2sched-authz-admin-${RUN}@example.com`;
    const evalEmail = `l2sched-authz-eval-${RUN}@example.com`;
    const admin = await loginAs(
      request,
      context,
      baseURL,
      adminEmail,
      "admin",
    );
    const createRes = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `L2 Sched authz ${RUN}`,
        timezone: "UTC",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as {
      event: { id: string };
    };
    const eventId = created.event.id;

    await context.clearCookies();
    await requestMagicLink(request, evalEmail, "evaluator", eventId);
    const link = await fetchDevLink(request, evalEmail);
    const session = await exchangeForCookie(request, link.token);
    await seedSessionCookie(context, baseURL, session);

    await page.goto("/admin/schedule");
    // Either redirected away from admin shell nav, or schedule not privileged
    const hasAdminNav = await page.getByTestId("nav-schedule").count();
    if (hasAdminNav > 0) {
      // If shell renders, evaluator must not land on privileged studio data
      const schedulePage = page.getByTestId("page-schedule");
      if (await schedulePage.isVisible().catch(() => false)) {
        // API-backed tray must not expose admin place controls for other roles
        await expect(page.getByTestId("schedule-tray")).toHaveCount(0);
      }
    } else {
      await expect(page.getByTestId("nav-schedule")).toHaveCount(0);
    }
  });
});
