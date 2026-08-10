/**
 * Wave 2 — agenda day-window enforcement on Schedule.Place / Schedule.Move.
 *
 * Server-side law: the configured agendaDayStart/agendaDayEnd (events.
 * settings_json, wall time in the event timezone) bound every placement.
 * Out-of-bounds → 409 CONFLICT with conflicts[] type "hours". Settings absent
 * → defaults 09:00–17:00 apply.
 */
import { describe, it, expect } from "vitest";
import {
  EventResponseSchema,
  RoomResponseSchema,
  DirectSessionResponseSchema,
  SchedulePlaceResponseSchema,
  ScheduleMoveResponseSchema,
  ScheduleConflictErrorSchema,
  CONFLICT,
  SESSION_COOKIE_NAME,
  mergeEventAgendaSettings,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  cookie: string;
}> {
  const ctx = createAppWithAuth({ cookieSecure: true });
  const { app, outbox } = ctx;
  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose }),
    },
    env,
  );
  const token = outbox.lastForEmail(email)!.token;
  const exchange = await app.request(
    "http://localhost/api/auth/exchange",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    },
    env,
  );
  expect(exchange.status).toBe(200);
  const setCookie = exchange.headers.get("set-cookie")!;
  const sessionValue = setCookie.split(";")[0]!.split("=").slice(1).join("=");
  return { app, cookie: `${SESSION_COOKIE_NAME}=${sessionValue}` };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name: string,
  timezone = "UTC",
): Promise<{ id: string; version: number; settingsJson: string | null }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name,
        timezone,
        // Wall times 09:00/17:00 so the unconfigured (widened-default) window
        // stays exactly 09:00–17:00 for the defaults test below.
        startsAt: "2026-09-01T09:00:00.000Z",
        endsAt: "2026-09-03T17:00:00.000Z",
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const parsed = EventResponseSchema.parse(await res.json());
  return {
    id: parsed.event.id,
    version: parsed.event.version,
    settingsJson: parsed.event.settingsJson ?? null,
  };
}

async function configureAgenda(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  event: { id: string; version: number; settingsJson: string | null },
  agenda: {
    agendaDayStart?: string;
    agendaDayEnd?: string;
    slotIntervalMin?: 15 | 30 | 60;
  },
): Promise<void> {
  const res = await app.request(
    `http://localhost/api/events/${event.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        settingsJson: mergeEventAgendaSettings(event.settingsJson, agenda),
        expectedVersion: event.version,
      }),
    },
    env,
  );
  expect(res.status).toBe(200);
  const parsed = EventResponseSchema.parse(await res.json());
  event.version = parsed.event.version;
  event.settingsJson = parsed.event.settingsJson ?? null;
}

async function upsertRoom(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  eventId: string,
  roomId: string,
): Promise<void> {
  const res = await app.request(
    `http://localhost/api/events/${eventId}/rooms/${roomId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Agenda Hall", capacity: 50 }),
    },
    env,
  );
  expect(res.status).toBe(200);
  RoomResponseSchema.parse(await res.json());
}

async function createDirectSession(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  eventId: string,
  title: string,
  speakerEmail: string,
): Promise<string> {
  const res = await app.request(
    `http://localhost/api/events/${eventId}/sessions/direct`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title,
        speakers: [{ name: "Agenda Spk", email: speakerEmail, isPrimary: true }],
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const body = DirectSessionResponseSchema.parse(await res.json());
  return body.session.id;
}

function place(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  eventId: string,
  sessionId: string,
  roomId: string,
  startsAt: string,
  endsAt: string,
) {
  return app.request(
    `http://localhost/api/events/${eventId}/schedule/place`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ sessionId, roomId, startsAt, endsAt }),
    },
    env,
  );
}

function move(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  eventId: string,
  placementId: string,
  roomId: string,
  startsAt: string,
  endsAt: string,
  expectedVersion: number,
) {
  return app.request(
    `http://localhost/api/events/${eventId}/schedule/move`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        placementId,
        roomId,
        startsAt,
        endsAt,
        expectedVersion,
      }),
    },
    env,
  );
}

async function expectHours409(res: Response): Promise<void> {
  expect(res.status).toBe(409);
  const body = ScheduleConflictErrorSchema.parse(await res.json());
  expect(body.code).toBe(CONFLICT);
  expect(body.conflicts.some((c) => c.type === "hours")).toBe(true);
}

describe("Wave 2 agenda day-window enforcement (I17)", () => {
  it("in-bounds place passes; out-of-bounds place is 409 hours", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "agenda-place@example.com",
    );
    const event = await createEvent(app, cookie, "Agenda Place Event");
    await configureAgenda(app, cookie, event, {
      agendaDayStart: "10:00",
      agendaDayEnd: "16:00",
      slotIntervalMin: 30,
    });
    await upsertRoom(app, cookie, event.id, "room_ag");
    const inBounds = await createDirectSession(
      app,
      cookie,
      event.id,
      "In Bounds",
      "ag-in@example.com",
    );
    const outBounds = await createDirectSession(
      app,
      cookie,
      event.id,
      "Out of Bounds",
      "ag-out@example.com",
    );

    const ok = await place(
      app,
      cookie,
      event.id,
      inBounds,
      "room_ag",
      "2026-09-01T10:00:00.000Z",
      "2026-09-01T10:30:00.000Z",
    );
    expect(ok.status).toBe(201);
    SchedulePlaceResponseSchema.parse(await ok.json());

    // Before the window
    const early = await place(
      app,
      cookie,
      event.id,
      outBounds,
      "room_ag",
      "2026-09-01T09:00:00.000Z",
      "2026-09-01T09:30:00.000Z",
    );
    await expectHours409(early);

    // Ends past the window
    const late = await place(
      app,
      cookie,
      event.id,
      outBounds,
      "room_ag",
      "2026-09-01T15:30:00.000Z",
      "2026-09-01T16:30:00.000Z",
    );
    await expectHours409(late);

    // Human message includes the configured window
    const again = await place(
      app,
      cookie,
      event.id,
      outBounds,
      "room_ag",
      "2026-09-01T08:00:00.000Z",
      "2026-09-01T08:30:00.000Z",
    );
    expect(again.status).toBe(409);
    const body = ScheduleConflictErrorSchema.parse(await again.json());
    expect(body.conflicts[0]!.message).toContain("10:00");
    expect(body.conflicts[0]!.message).toContain("16:00");
  });

  it("move honors the window: out-of-bounds move is 409 hours, in-bounds passes", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "agenda-move@example.com",
    );
    const event = await createEvent(app, cookie, "Agenda Move Event");
    await configureAgenda(app, cookie, event, {
      agendaDayStart: "10:00",
      agendaDayEnd: "16:00",
    });
    await upsertRoom(app, cookie, event.id, "room_mv");
    const sessionId = await createDirectSession(
      app,
      cookie,
      event.id,
      "Move Me",
      "ag-move@example.com",
    );
    const placed = await place(
      app,
      cookie,
      event.id,
      sessionId,
      "room_mv",
      "2026-09-01T11:00:00.000Z",
      "2026-09-01T12:00:00.000Z",
    );
    expect(placed.status).toBe(201);
    const p = SchedulePlaceResponseSchema.parse(await placed.json());

    // Out of bounds move rejected; placement untouched (version still 1)
    const bad = await move(
      app,
      cookie,
      event.id,
      p.placement.id,
      "room_mv",
      "2026-09-01T08:00:00.000Z",
      "2026-09-01T09:00:00.000Z",
      p.placement.version,
    );
    await expectHours409(bad);

    // In-bounds move with the same (unbumped) version succeeds
    const good = await move(
      app,
      cookie,
      event.id,
      p.placement.id,
      "room_mv",
      "2026-09-01T14:00:00.000Z",
      "2026-09-01T15:00:00.000Z",
      p.placement.version,
    );
    expect(good.status).toBe(200);
    const moved = ScheduleMoveResponseSchema.parse(await good.json());
    expect(moved.placement.startsAt).toBe("2026-09-01T14:00:00.000Z");
  });

  it("defaults 09:00–17:00 apply when settings are absent", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "agenda-default@example.com",
    );
    const event = await createEvent(app, cookie, "Agenda Default Event");
    await upsertRoom(app, cookie, event.id, "room_df");
    const s1 = await createDirectSession(
      app,
      cookie,
      event.id,
      "Default In",
      "ag-df1@example.com",
    );
    const s2 = await createDirectSession(
      app,
      cookie,
      event.id,
      "Default Out",
      "ag-df2@example.com",
    );

    const ok = await place(
      app,
      cookie,
      event.id,
      s1,
      "room_df",
      "2026-09-01T09:00:00.000Z",
      "2026-09-01T10:00:00.000Z",
    );
    expect(ok.status).toBe(201);

    const early = await place(
      app,
      cookie,
      event.id,
      s2,
      "room_df",
      "2026-09-01T08:00:00.000Z",
      "2026-09-01T09:00:00.000Z",
    );
    await expectHours409(early);

    const late = await place(
      app,
      cookie,
      event.id,
      s2,
      "room_df",
      "2026-09-01T16:30:00.000Z",
      "2026-09-01T17:30:00.000Z",
    );
    await expectHours409(late);
  });

  it("window is wall time in the event timezone (America/New_York)", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "agenda-tz@example.com",
    );
    // EDT in September: UTC-4. Window 10:00–16:00 local = 14:00Z–20:00Z.
    const event = await createEvent(
      app,
      cookie,
      "Agenda TZ Event",
      "America/New_York",
    );
    await configureAgenda(app, cookie, event, {
      agendaDayStart: "10:00",
      agendaDayEnd: "16:00",
    });
    await upsertRoom(app, cookie, event.id, "room_tz");
    const s1 = await createDirectSession(
      app,
      cookie,
      event.id,
      "NY In Bounds",
      "ag-tz1@example.com",
    );
    const s2 = await createDirectSession(
      app,
      cookie,
      event.id,
      "NY Out of Bounds",
      "ag-tz2@example.com",
    );

    // 14:00Z = 10:00 New York → allowed
    const ok = await place(
      app,
      cookie,
      event.id,
      s1,
      "room_tz",
      "2026-09-01T14:00:00.000Z",
      "2026-09-01T15:00:00.000Z",
    );
    expect(ok.status).toBe(201);

    // 13:00Z = 09:00 New York → before window even though 13:00 > "10:00" UTC
    const early = await place(
      app,
      cookie,
      event.id,
      s2,
      "room_tz",
      "2026-09-01T13:00:00.000Z",
      "2026-09-01T13:30:00.000Z",
    );
    await expectHours409(early);

    // Crossing local midnight is rejected (21:00 NY → 11:00 next day NY)
    const overnight = await place(
      app,
      cookie,
      event.id,
      s2,
      "room_tz",
      "2026-09-02T01:00:00.000Z",
      "2026-09-02T15:00:00.000Z",
    );
    await expectHours409(overnight);
  });
});
