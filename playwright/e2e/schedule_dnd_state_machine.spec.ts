/**
 * Schedule DnD state-machine regressions (DND_VERDICT_SYNTHESIS.md).
 * retries:0. Complements reliability/honesty without owning inventory IDs.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAs, sessionHeaders } from "./helpers/cfp-eval-seed.js";
import { pointerDragTo } from "./helpers/pointer-dnd.js";

test.describe.configure({ retries: 0 });

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const SLOT_A = "2026-09-01T10:00:00.000Z";
const SLOT_A_END = "2026-09-01T11:00:00.000Z";
const SLOT_B = "2026-09-01T11:00:00.000Z";
const SLOT_B_END = "2026-09-01T12:00:00.000Z";
const SLOT_C = "2026-09-01T12:00:00.000Z";
const ROOM = "room_sm_hall";

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
    data: { name: `SM CFP ${label} ${run}` },
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
  const title = `SM Talk ${label} ${run}`;
  const sub = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: published.formVersion.id,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [
        {
          name: `Spk ${label}`,
          email: `sm-${label}-${run}@example.com`,
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
  const body = (await dec.json()) as { session: { id: string } | null };
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

test.describe("schedule DnD state machine (verdict regressions)", () => {
  test("same placement moved twice without VERSION 409 (dead-window)", async ({
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
      `admin-sm-${run}@example.com`,
      "admin",
    );
    const create = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `DnD SM ${run}`,
        timezone: "UTC",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    expect(create.status()).toBe(201);
    const { event } = (await create.json()) as {
      event: { id: string; slug: string };
    };
    await upsertRoom(request, admin.session, event.id, ROOM, "SM Hall");
    const a = await acceptSession(
      request,
      admin.session,
      event.id,
      event.slug,
      run,
      "a",
    );
    await placeViaApi(
      request,
      admin.session,
      event.id,
      a.sessionId,
      ROOM,
      SLOT_A,
      SLOT_A_END,
    );

    const movePosts: { status: number; code?: string }[] = [];
    page.on("response", async (res) => {
      if (
        res.url().includes("/schedule/move") &&
        res.request().method() === "POST"
      ) {
        let code: string | undefined;
        try {
          const j = (await res.json()) as { code?: string; error?: string };
          code = j.code;
        } catch {
          /* ignore */
        }
        movePosts.push({ status: res.status(), code });
      }
    });

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto("/admin/schedule");
    await expect(page.getByTestId("page-schedule")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("schedule-view-day").click();

    const tile = page.locator(
      `[data-testid^="schedule-placement-"][data-session-id="${a.sessionId}"]`,
    );
    await expect(tile).toBeVisible();
    const placementTestId = await tile.getAttribute("data-testid");
    expect(placementTestId).toBeTruthy();

    // Move A → B
    await pointerDragTo(page, placementTestId!, slotTestId(ROOM, SLOT_B));
    await expect(
      page
        .getByTestId(slotTestId(ROOM, SLOT_B))
        .locator(`[data-session-id="${a.sessionId}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => movePosts.length).toBeGreaterThanOrEqual(1);

    // Immediate second move B → C (must not be eaten by dead window)
    const beforeSecond = movePosts.length;
    // Re-resolve tile test id after optimistic/response apply
    const tileAfter = page.locator(
      `[data-testid^="schedule-placement-"][data-session-id="${a.sessionId}"]`,
    );
    const placementTestId2 = await tileAfter.getAttribute("data-testid");
    expect(placementTestId2).toBeTruthy();
    await pointerDragTo(page, placementTestId2!, slotTestId(ROOM, SLOT_C));
    await expect(
      page
        .getByTestId(slotTestId(ROOM, SLOT_C))
        .locator(`[data-session-id="${a.sessionId}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => movePosts.length).toBeGreaterThan(beforeSecond);

    const failed = movePosts.filter((m) => m.status >= 400);
    expect(failed, JSON.stringify(movePosts)).toHaveLength(0);
    expect(movePosts.length).toBeGreaterThanOrEqual(2);
  });

  test("duration-overlap slot blocked with zero place POST", async ({
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
      `admin-blk-${run}@example.com`,
      "admin",
    );
    const create = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `DnD Block ${run}`,
        timezone: "UTC",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    const { event } = (await create.json()) as {
      event: { id: string; slug: string };
    };
    await upsertRoom(request, admin.session, event.id, ROOM, "Block Hall");
    const long = await acceptSession(
      request,
      admin.session,
      event.id,
      event.slug,
      run,
      "long",
    );
    const short = await acceptSession(
      request,
      admin.session,
      event.id,
      event.slug,
      run,
      "short",
    );
    // 10:00–12:00 long session
    await placeViaApi(
      request,
      admin.session,
      event.id,
      long.sessionId,
      ROOM,
      SLOT_A,
      SLOT_B_END,
    );

    let placePosts = 0;
    page.on("request", (req) => {
      if (req.url().includes("/schedule/place") && req.method() === "POST") {
        placePosts += 1;
      }
    });

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto("/admin/schedule");
    await page.getByTestId("schedule-view-day").click();
    await expect(
      page.getByTestId(`schedule-tray-item-${short.sessionId}`),
    ).toBeVisible();

    // 11:00 row is continuation occupancy of the long talk
    await expect(page.getByTestId(slotTestId(ROOM, SLOT_B))).toHaveAttribute(
      "data-continuation",
      "true",
    );

    await pointerDragTo(
      page,
      `schedule-tray-item-${short.sessionId}`,
      slotTestId(ROOM, SLOT_B),
    );
    await expect(page.getByTestId("schedule-conflict-toast")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId("schedule-conflict-toast")).toContainText(
      /Room|booked|conflict/i,
    );
    expect(placePosts).toBe(0);

    // Short still in tray
    await expect(
      page.getByTestId(`schedule-tray-item-${short.sessionId}`),
    ).toBeVisible();
  });
});
