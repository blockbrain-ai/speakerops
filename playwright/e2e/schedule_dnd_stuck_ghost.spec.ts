/**
 * Stuck-ghost regressions (docs/reports/SCHEDULE_STUCK_DRAG_INVESTIGATION_2026-08-12.md).
 * Owner symptom: drag ghost stays glued to the mouse; cannot put session down.
 * retries:0 — first-try means first run.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAs, sessionHeaders } from "./helpers/cfp-eval-seed.js";
import { pointerDragTo } from "./helpers/pointer-dnd.js";

test.describe.configure({ retries: 0 });

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const SLOT_A = "2026-09-01T10:00:00.000Z";
const ROOM = "room_ghost_hall";

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
    data: { name: `Ghost CFP ${label} ${run}` },
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
  const title = `Ghost Talk ${label} ${run}`;
  const sub = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: published.formVersion.id,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [
        {
          name: `Spk ${label}`,
          email: `ghost-${label}-${run}@example.com`,
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

async function seedSchedulePage(
  page: import("@playwright/test").Page,
  request: APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  run: string,
) {
  const admin = await loginAs(
    request,
    context,
    baseURL,
    `admin-ghost-${run}@example.com`,
    "admin",
  );
  const create = await request.post("/api/events", {
    headers: sessionHeaders(admin.session),
    data: {
      name: `DnD Ghost ${run}`,
      timezone: "UTC",
      startsAt: EVENT_START,
      endsAt: EVENT_END,
    },
  });
  expect(create.status()).toBe(201);
  const { event } = (await create.json()) as {
    event: { id: string; slug: string };
  };
  await upsertRoom(request, admin.session, event.id, ROOM, "Ghost Hall");
  const tray = await acceptSession(
    request,
    admin.session,
    event.id,
    event.slug,
    run,
    "tray",
  );
  await page.addInitScript((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, event.id);
  await page.goto("/admin/schedule");
  await expect(page.getByTestId("page-schedule")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("schedule-view-day").click();
  await expect(
    page.getByTestId(`schedule-tray-item-${tray.sessionId}`),
  ).toBeVisible({ timeout: 15_000 });
  return { admin, event, tray };
}

test.describe("schedule DnD stuck-ghost regressions", () => {
  test("release over non-slot chrome clears ghost without place", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const run = `${Date.now()}`;
    const { tray } = await seedSchedulePage(
      page,
      request,
      context,
      baseURL,
      run,
    );

    let placePosts = 0;
    page.on("response", (res) => {
      if (
        res.url().includes("/schedule/place") &&
        res.request().method() === "POST"
      ) {
        placePosts += 1;
      }
    });

    const source = page.getByTestId(`schedule-tray-item-${tray.sessionId}`);
    await source.hover();
    const sb = await source.boundingBox();
    expect(sb).toBeTruthy();
    const sx = sb!.x + sb!.width / 2;
    const sy = sb!.y + sb!.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 20, sy + 16, { steps: 4 });
    await expect(page.getByTestId("schedule-dnd-ghost")).toBeVisible();

    // Release over toolbar chrome (not a slot).
    const toolbar = page.getByTestId("schedule-toolbar");
    await expect(toolbar).toBeVisible();
    const tb = await toolbar.boundingBox();
    expect(tb).toBeTruthy();
    await page.mouse.move(tb!.x + tb!.width / 2, tb!.y + tb!.height / 2, {
      steps: 8,
    });
    await page.mouse.up();

    await expect(page.getByTestId("schedule-dnd-ghost")).toHaveCount(0, {
      timeout: 5_000,
    });
    expect(placePosts).toBe(0);
    // R2: outside/toolbar release must not be silent — miss toast, no POST.
    await expect(page.getByTestId("schedule-status-toast")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("schedule-status-toast")).toContainText(
      /time slot|board|tray|toolbar|gaps/i,
    );
    await expect(
      page.getByTestId(`schedule-tray-item-${tray.sessionId}`),
    ).toBeVisible();
  });

  test("Escape mid-drag clears ghost", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const run = `${Date.now()}-esc`;
    const { tray } = await seedSchedulePage(
      page,
      request,
      context,
      baseURL,
      run,
    );

    const source = page.getByTestId(`schedule-tray-item-${tray.sessionId}`);
    const sb = await source.boundingBox();
    expect(sb).toBeTruthy();
    const sx = sb!.x + sb!.width / 2;
    const sy = sb!.y + sb!.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 24, sy + 18, { steps: 4 });
    await expect(page.getByTestId("schedule-dnd-ghost")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("schedule-dnd-ghost")).toHaveCount(0, {
      timeout: 5_000,
    });
    await page.mouse.up();
    await expect(
      page.getByTestId(`schedule-tray-item-${tray.sessionId}`),
    ).toBeVisible();
  });

  test("happy-path tray place still works once; below-threshold click selects", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const run = `${Date.now()}-ok`;
    const { tray } = await seedSchedulePage(
      page,
      request,
      context,
      baseURL,
      run,
    );

    let placePosts = 0;
    page.on("response", (res) => {
      if (
        res.url().includes("/schedule/place") &&
        res.request().method() === "POST"
      ) {
        placePosts += 1;
      }
    });

    // Below-threshold press should select, not drag.
    const source = page.getByTestId(`schedule-tray-item-${tray.sessionId}`);
    await source.click();
    await expect(source).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("schedule-dnd-ghost")).toHaveCount(0);

    await pointerDragTo(
      page,
      `schedule-tray-item-${tray.sessionId}`,
      slotTestId(ROOM, SLOT_A),
    );
    await expect(
      page
        .getByTestId(slotTestId(ROOM, SLOT_A))
        .locator(`[data-session-id="${tray.sessionId}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => placePosts).toBe(1);
    await expect(page.getByTestId("schedule-dnd-ghost")).toHaveCount(0);
  });

  test("lostpointercapture mid-drag clears ghost", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const run = `${Date.now()}-lost`;
    const { tray } = await seedSchedulePage(
      page,
      request,
      context,
      baseURL,
      run,
    );

    const source = page.getByTestId(`schedule-tray-item-${tray.sessionId}`);
    const sb = await source.boundingBox();
    expect(sb).toBeTruthy();
    const sx = sb!.x + sb!.width / 2;
    const sy = sb!.y + sb!.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 20, sy + 14, { steps: 4 });
    await expect(page.getByTestId("schedule-dnd-ghost")).toBeVisible();

    // Simulate UA/source disconnect. Playwright's mouse path may not hold
    // element capture, so also dispatch pointercancel (same product path).
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid^="schedule-tray-item-"][data-draggable="true"]',
      ) as HTMLElement | null;
      if (!el) throw new Error("no tray item");
      let released = false;
      for (let id = 0; id < 32; id++) {
        try {
          if (el.hasPointerCapture(id)) {
            el.releasePointerCapture(id);
            released = true;
          }
        } catch {
          /* not capturing this id */
        }
      }
      if (!released) {
        for (const id of [0, 1, 2]) {
          window.dispatchEvent(
            new PointerEvent("pointercancel", {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: id,
            }),
          );
        }
      }
    });

    await expect(page.getByTestId("schedule-dnd-ghost")).toHaveCount(0, {
      timeout: 5_000,
    });
    // R2: unexpected capture loss while active → cancel toast, no place.
    await expect(page.getByTestId("schedule-status-toast")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("schedule-status-toast")).toContainText(
      /cancelled|try again/i,
    );
    await page.mouse.up();
  });
});
