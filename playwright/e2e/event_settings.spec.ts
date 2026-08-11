/**
 * Section 2.3 — Event settings inventory journeys.
 *
 * - @inv:C01 e2e/admin/event-create
 * - @inv:C02 e2e/admin/event-switch
 * - @inv:C07 e2e/admin/settings-cfp-window
 * - @inv:C11 e2e/admin/event-isolation
 * - @inv:O01 e2e/settings/event
 * - @inv:O02 e2e/settings/rooms
 * - @inv:O03 e2e/settings/tracks
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "e2e-events-admin@example.com";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
}

async function fetchDevToken(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok(), `dev outbox status ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { link: { token: string } | null };
  expect(body.link?.token, "dev outbox must capture token").toBeTruthy();
  return body.link!.token;
}

async function exchangeForCookie(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<string> {
  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  return match![1]!;
}

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email = ADMIN_EMAIL,
): Promise<string> {
  await requestMagicLink(request, email, "admin");
  const token = await fetchDevToken(request, email);
  const sessionValue = await exchangeForCookie(request, token);
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sessionValue,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return sessionValue;
}

/** Wait until EventProvider has loaded events and rendered the switcher <select>. */
async function waitForEventSelect(
  page: import("@playwright/test").Page,
) {
  const switcher = page.getByTestId("event-context");
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  // Prefer select; if still a div placeholder, wait for select role/tag
  await expect
    .poll(
      async () => {
        const tag = await switcher.evaluate((el) => el.tagName.toLowerCase());
        return tag;
      },
      { timeout: 15_000 },
    )
    .toBe("select");
  return switcher;
}

test("@inv:C01 e2e/admin/event-create create event with timezone", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c01@example.com",
  );

  // API proof: Event.Create returns id and timezone
  const create = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: {
      name: "C01 Summit",
      timezone: "America/Chicago",
      startsAt: "2026-11-01T09:00:00.000Z",
      endsAt: "2026-11-02T17:00:00.000Z",
    },
  });
  expect(create.status()).toBe(201);
  const body = await create.json();
  expect(body.event.id).toBeTruthy();
  expect(body.event.timezone).toBe("America/Chicago");
  expect(body.event.name).toBe("C01 Summit");

  // UI: "+ New event" beside the header event switcher (fix wave A3) is the
  // discoverable route into creation from ANY admin page.
  await page.goto(`${baseURL ?? ""}/admin`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("admin-new-event")).toBeVisible();

  // A1 evidence: capture the mounted shell node — in-app navigation must not
  // remount the admin chrome (no per-page "Checking access…" teardown).
  const shellHandle = await page.getByTestId("admin-shell").elementHandle();

  await page.getByTestId("admin-new-event").click();
  await expect(page).toHaveURL(/\/admin\/settings\?intent=create-event/);
  await expect(page.getByTestId("event-create-form")).toBeVisible();
  // Create intent: card scrolled into view with the Name input focused.
  await expect(page.getByTestId("event-create-name")).toBeFocused();
  // Judge guidance: start-from-scratch hint + shared-demo expectation copy.
  await expect(page.getByTestId("event-create-hint")).toBeVisible();
  await expect(page.getByTestId("event-create-shared-note")).toContainText(
    /shared/i,
  );

  // The pre-navigation shell node is still connected — chrome persisted.
  expect(
    await page.evaluate((el) => el?.isConnected === true, shellHandle),
  ).toBe(true);
  await page.getByTestId("event-create-name").fill("C01 UI Event");
  await page.getByTestId("event-create-timezone").fill("Europe/Paris");
  await page.getByTestId("event-create-submit").click();
  await expect(page.getByTestId("event-create-status")).toContainText(
    /Created|Paris/i,
    { timeout: 10_000 },
  );

  // Validation fail negative
  const bad = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: { name: "", timezone: "UTC" },
  });
  expect(bad.status()).toBe(400);
  const err = await bad.json();
  expect(err).toMatchObject({ code: "VALIDATION_ERROR" });
});

test("@inv:C02 e2e/admin/event-switch switch active event updates event-context", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c02@example.com",
  );

  const a = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: { name: "Switch Alpha", timezone: "UTC" },
  });
  const b = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: { name: "Switch Beta", timezone: "UTC" },
  });
  expect(a.status()).toBe(201);
  expect(b.status()).toBe(201);
  const eventA = (await a.json()).event;
  const eventB = (await b.json()).event;

  await page.goto(`${baseURL ?? ""}/admin`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 15_000 });
  const switcher = await waitForEventSelect(page);

  // Select is a <select> when events exist
  await switcher.selectOption(eventA.id);
  await expect(switcher).toHaveValue(eventA.id);
  await switcher.selectOption(eventB.id);
  await expect(switcher).toHaveValue(eventB.id);
  // assert switch active event updates UI testid event-context
  const selectedLabel = await switcher.locator("option:checked").textContent();
  expect(selectedLabel).toContain("Switch Beta");
});

test("@inv:C07 e2e/admin/settings-cfp-window edit event name and close dates", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c07@example.com",
  );

  const create = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: {
      name: "CFP Window Event",
      timezone: "UTC",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-06-01T00:00:00.000Z",
    },
  });
  expect(create.status()).toBe(201);
  const event = (await create.json()).event;

  await page.goto(`${baseURL ?? ""}/admin/settings`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 15_000 });

  // Select the created event (wait for Event.List load)
  const switcher = await waitForEventSelect(page);
  await switcher.selectOption(event.id);

  await expect(page.getByTestId("event-settings-form")).toBeVisible({
    timeout: 10_000,
  });
  // Wait for Event.Get to populate form
  await expect(page.getByTestId("event-settings-name")).toHaveValue(
    "CFP Window Event",
    { timeout: 10_000 },
  );
  await page.getByTestId("event-settings-name").fill("CFP Window Updated");
  await page.getByTestId("event-settings-timezone").fill("America/Denver");
  await page
    .getByTestId("event-settings-starts")
    .fill("2026-02-01T00:00:00.000Z");
  await page
    .getByTestId("event-settings-ends")
    .fill("2026-07-15T23:59:00.000Z");
  await page.getByTestId("event-settings-save").click();
  await expect(page.getByTestId("event-settings-status")).toContainText(
    /saved/i,
    { timeout: 10_000 },
  );

  // API verify
  const get = await request.get(`/api/events/${event.id}`, {
    headers: { cookie: `speakerops_session=${session}` },
  });
  expect(get.status()).toBe(200);
  const body = await get.json();
  expect(body.event.name).toBe("CFP Window Updated");
  expect(body.event.timezone).toBe("America/Denver");
  expect(body.event.endsAt).toBe("2026-07-15T23:59:00.000Z");
});

test("@inv:C11 e2e/admin/event-isolation switch A→B no A rooms in B", async ({
  request,
  context,
  page,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c11@example.com",
  );

  const a = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: { name: "Iso A", timezone: "UTC" },
  });
  const b = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: { name: "Iso B", timezone: "UTC" },
  });
  const eventA = (await a.json()).event;
  const eventB = (await b.json()).event;

  const roomId = "room_iso_a";
  const upsert = await request.put(
    `/api/events/${eventA.id}/rooms/${roomId}`,
    {
      headers: {
        cookie: `speakerops_session=${session}`,
        "content-type": "application/json",
      },
      data: { name: "Only On A", capacity: 50 },
    },
  );
  expect(upsert.status()).toBe(200);

  // Room readable on A
  const getA = await request.get(
    `/api/events/${eventA.id}/rooms/${roomId}`,
    { headers: { cookie: `speakerops_session=${session}` } },
  );
  expect(getA.status()).toBe(200);

  // Room from A not readable with event B context → 404
  const getB = await request.get(
    `/api/events/${eventB.id}/rooms/${roomId}`,
    { headers: { cookie: `speakerops_session=${session}` } },
  );
  expect(getB.status()).toBe(404);
  const err = await getB.json();
  expect(err).toMatchObject({ code: "NOT_FOUND" });

  // List B empty of A's room
  const listB = await request.get(`/api/events/${eventB.id}/rooms`, {
    headers: { cookie: `speakerops_session=${session}` },
  });
  expect(listB.status()).toBe(200);
  const rooms = (await listB.json()).rooms as { id: string }[];
  expect(rooms.some((r) => r.id === roomId)).toBe(false);

  // UI: switch context and rooms list for B empty of "Only On A"
  await page.goto(`${baseURL ?? ""}/admin/settings`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 15_000 });
  const switcher = await waitForEventSelect(page);
  await switcher.selectOption(eventB.id);
  await expect(page.getByTestId("rooms-list")).toBeVisible();
  await expect(page.getByTestId("rooms-list")).not.toContainText("Only On A");
});

test("@inv:O01 e2e/settings/event name dates tz settings form", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-o01@example.com",
  );
  const create = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: { name: "O01 Event", timezone: "Pacific/Auckland" },
  });
  const event = (await create.json()).event;

  await page.goto(`${baseURL ?? ""}/admin/settings`);
  await expect(page.getByTestId("page-settings")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = await waitForEventSelect(page);
  await switcher.selectOption(event.id);
  await expect(page.getByTestId("event-settings-name")).toHaveValue("O01 Event", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("event-settings-timezone")).toHaveValue(
    "Pacific/Auckland",
  );
});

test("@inv:O02 e2e/settings/rooms rooms CRUD", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-o02@example.com",
  );
  const create = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: { name: "O02 Rooms Event", timezone: "UTC" },
  });
  const event = (await create.json()).event;

  await page.goto(`${baseURL ?? ""}/admin/settings`);
  await expect(page.getByTestId("rooms-section")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = await waitForEventSelect(page);
  await switcher.selectOption(event.id);
  await page.getByTestId("room-name-input").fill("Ballroom");
  await page.getByTestId("room-capacity-input").fill("120");
  await page.getByTestId("room-save").click();
  await expect(page.getByTestId("room-status")).toContainText(/Ballroom/i, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("rooms-list")).toContainText("Ballroom");
});

test("@inv:O03 e2e/settings/tracks tracks CRUD", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-o03@example.com",
  );
  const create = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: { name: "O03 Tracks Event", timezone: "UTC" },
  });
  const event = (await create.json()).event;

  await page.goto(`${baseURL ?? ""}/admin/settings`);
  await expect(page.getByTestId("tracks-section")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = await waitForEventSelect(page);
  await switcher.selectOption(event.id);
  await page.getByTestId("track-name-input").fill("Platform");
  await page.getByTestId("track-color-input").fill("#3f6e8c");
  await page.getByTestId("track-save").click();
  await expect(page.getByTestId("track-status")).toContainText(/Platform/i, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("tracks-list")).toContainText("Platform");
});
