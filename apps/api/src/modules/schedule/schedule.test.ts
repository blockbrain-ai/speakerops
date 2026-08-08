/**
 * Section 6.1 — Schedule conflict engine (Vitest).
 *
 * Named assertions from spec:
 * - assert double-book speaker returns 409 CONFLICT
 * - assert unschedule removes reservation allowing rebook
 * - assert stale version 409 VERSION
 *
 * Plus: room overlap, list unscheduled, audit+correlationId, Zod 400, evaluator 403.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  SchedulePlaceResponseSchema,
  ScheduleMoveResponseSchema,
  ScheduleUnscheduleResponseSchema,
  ScheduleListResponseSchema,
  ScheduleConflictErrorSchema,
  DirectSessionResponseSchema,
  EventResponseSchema,
  RoomResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  CONFLICT,
  VERSION,
  NOT_FOUND,
  SESSION_COOKIE_NAME,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { OPENAPI_COMMANDS } from "../../openapi.js";
import { intervalsOverlap } from "./store.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
  shared?: ReturnType<typeof createAppWithAuth>,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  store: ReturnType<typeof createAppWithAuth>["store"];
  events: ReturnType<typeof createAppWithAuth>["events"];
  decisions: ReturnType<typeof createAppWithAuth>["decisions"];
  schedule: ReturnType<typeof createAppWithAuth>["schedule"];
  cookie: string;
  userId: string;
}> {
  const ctx = shared ?? createAppWithAuth({ cookieSecure: true });
  const { app, store, events, decisions, schedule, outbox } = ctx;
  const body: Record<string, string> = { email, purpose };
  if (eventId) body.eventId = eventId;

  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
  const sessionValue = setCookie
    .split(";")[0]!
    .split("=")
    .slice(1)
    .join("=");
  const user = await store.findUserByEmail(email);
  expect(user).toBeTruthy();
  return {
    app,
    store,
    events,
    decisions,
    schedule,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
    userId: user!.id,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name = "Schedule Event",
): Promise<{ id: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-sched-create-event",
      },
      body: JSON.stringify({
        name,
        timezone: "UTC",
        startsAt: "2026-09-01T09:00:00.000Z",
        endsAt: "2026-09-03T18:00:00.000Z",
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const parsed = EventResponseSchema.safeParse(await res.json());
  expect(parsed.success).toBe(true);
  return { id: parsed.data!.event.id };
}

async function upsertRoom(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  eventId: string,
  roomId: string,
  name: string,
): Promise<void> {
  const res = await app.request(
    `http://localhost/api/events/${eventId}/rooms/${roomId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ name, capacity: 100 }),
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
  speakers: Array<{ name: string; email: string; isPrimary?: boolean }>,
): Promise<{ sessionId: string; participationIds: string[] }> {
  const res = await app.request(
    `http://localhost/api/events/${eventId}/sessions/direct`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-sched-direct-session",
      },
      body: JSON.stringify({ title, speakers }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const body = DirectSessionResponseSchema.parse(await res.json());
  return {
    sessionId: body.session.id,
    participationIds: body.participations.map((p) => p.id),
  };
}

describe("6.1 schedule conflict engine", () => {
  it("intervalsOverlap detects half-open style overlaps", () => {
    expect(
      intervalsOverlap(
        "2026-09-01T10:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
        "2026-09-01T10:30:00.000Z",
        "2026-09-01T11:30:00.000Z",
      ),
    ).toBe(true);
    // adjacent blocks do not overlap
    expect(
      intervalsOverlap(
        "2026-09-01T10:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
        "2026-09-01T12:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("assert double-book speaker returns 409 CONFLICT", async () => {
    const { app, cookie, store } = await magicLinkSession(
      "admin",
      "sched-dbl-spk@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Double Book Spk");
    await upsertRoom(app, cookie, eventId, "room_a", "Hall A");
    await upsertRoom(app, cookie, eventId, "room_b", "Hall B");

    // Same speaker on two sessions
    const s1 = await createDirectSession(app, cookie, eventId, "Talk One", [
      { name: "Ada", email: "ada-dbl@example.com", isPrimary: true },
    ]);
    const s2 = await createDirectSession(app, cookie, eventId, "Talk Two", [
      { name: "Ada", email: "ada-dbl@example.com", isPrimary: true },
    ]);
    // Same person → same participation
    expect(s1.participationIds[0]).toBe(s2.participationIds[0]);

    const place1 = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-dbl-spk-1",
        },
        body: JSON.stringify({
          sessionId: s1.sessionId,
          roomId: "room_a",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(place1.status).toBe(201);
    SchedulePlaceResponseSchema.parse(await place1.json());

    // Second session same speaker overlapping time, different room
    const place2 = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-dbl-spk-2",
        },
        body: JSON.stringify({
          sessionId: s2.sessionId,
          roomId: "room_b",
          startsAt: "2026-09-01T10:30:00.000Z",
          endsAt: "2026-09-01T11:30:00.000Z",
        }),
      },
      env,
    );
    expect(place2.status).toBe(409);
    const body = await place2.json();
    const parsed = ScheduleConflictErrorSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.code).toBe(CONFLICT);
    expect(parsed.data!.conflicts.some((c) => c.type === "speaker")).toBe(true);

    // First place audited with correlationId
    const audits = await store.listAudits();
    const placeAudit = audits.find(
      (a) =>
        a.action === "Schedule.Place" && a.correlationId === "corr-dbl-spk-1",
    );
    expect(placeAudit).toBeTruthy();
    expect(placeAudit!.eventId).toBe(eventId);
  });

  it("assert room overlap returns 409 CONFLICT", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "sched-dbl-room@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Double Book Room");
    await upsertRoom(app, cookie, eventId, "room_main", "Main Hall");

    const s1 = await createDirectSession(app, cookie, eventId, "Alpha", [
      { name: "Bob", email: "bob-room@example.com" },
    ]);
    const s2 = await createDirectSession(app, cookie, eventId, "Beta", [
      { name: "Cara", email: "cara-room@example.com" },
    ]);

    const place1 = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: s1.sessionId,
          roomId: "room_main",
          startsAt: "2026-09-01T14:00:00.000Z",
          endsAt: "2026-09-01T15:00:00.000Z",
        }),
      },
      env,
    );
    expect(place1.status).toBe(201);

    const place2 = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: s2.sessionId,
          roomId: "room_main",
          startsAt: "2026-09-01T14:30:00.000Z",
          endsAt: "2026-09-01T15:30:00.000Z",
        }),
      },
      env,
    );
    expect(place2.status).toBe(409);
    const body = ScheduleConflictErrorSchema.parse(await place2.json());
    expect(body.conflicts.some((c) => c.type === "room")).toBe(true);
  });

  it("assert unschedule removes reservation allowing rebook", async () => {
    const { app, cookie, store } = await magicLinkSession(
      "admin",
      "sched-unschedule@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Unschedule Free");
    await upsertRoom(app, cookie, eventId, "room_u", "Unsched Hall");

    const s1 = await createDirectSession(app, cookie, eventId, "First Talk", [
      { name: "Dan", email: "dan-unsched@example.com" },
    ]);
    const s2 = await createDirectSession(app, cookie, eventId, "Second Talk", [
      { name: "Eve", email: "eve-unsched@example.com" },
    ]);

    const place1 = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-unsched-place",
        },
        body: JSON.stringify({
          sessionId: s1.sessionId,
          roomId: "room_u",
          startsAt: "2026-09-02T10:00:00.000Z",
          endsAt: "2026-09-02T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(place1.status).toBe(201);
    const p1 = SchedulePlaceResponseSchema.parse(await place1.json());

    // Occupied → conflict
    const blocked = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: s2.sessionId,
          roomId: "room_u",
          startsAt: "2026-09-02T10:00:00.000Z",
          endsAt: "2026-09-02T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(blocked.status).toBe(409);

    // Unschedule frees reservation
    const unschedule = await app.request(
      `http://localhost/api/events/${eventId}/schedule/unschedule`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-unsched-1",
        },
        body: JSON.stringify({
          placementId: p1.placement.id,
          expectedVersion: p1.placement.version,
        }),
      },
      env,
    );
    expect(unschedule.status).toBe(200);
    ScheduleUnscheduleResponseSchema.parse(await unschedule.json());

    // Rebook same slot succeeds
    const rebook = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-unsched-rebook",
        },
        body: JSON.stringify({
          sessionId: s2.sessionId,
          roomId: "room_u",
          startsAt: "2026-09-02T10:00:00.000Z",
          endsAt: "2026-09-02T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(rebook.status).toBe(201);

    const audits = await store.listAudits();
    expect(
      audits.some(
        (a) =>
          a.action === "Schedule.Unschedule" &&
          a.correlationId === "corr-unsched-1",
      ),
    ).toBe(true);
  });

  it("assert stale version 409 VERSION", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "sched-version@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Version Event");
    await upsertRoom(app, cookie, eventId, "room_v", "Version Hall");

    const s1 = await createDirectSession(app, cookie, eventId, "Version Talk", [
      { name: "Fay", email: "fay-ver@example.com" },
    ]);

    const place = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: s1.sessionId,
          roomId: "room_v",
          startsAt: "2026-09-01T16:00:00.000Z",
          endsAt: "2026-09-01T17:00:00.000Z",
        }),
      },
      env,
    );
    expect(place.status).toBe(201);
    const p = SchedulePlaceResponseSchema.parse(await place.json());

    // Move succeeds and bumps version
    const move = await app.request(
      `http://localhost/api/events/${eventId}/schedule/move`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-move-ok",
        },
        body: JSON.stringify({
          placementId: p.placement.id,
          roomId: "room_v",
          startsAt: "2026-09-01T17:00:00.000Z",
          endsAt: "2026-09-01T18:00:00.000Z",
          expectedVersion: p.placement.version,
        }),
      },
      env,
    );
    expect(move.status).toBe(200);
    const moved = ScheduleMoveResponseSchema.parse(await move.json());
    expect(moved.placement.version).toBe(p.placement.version + 1);

    // Stale expectedVersion on unschedule → 409 VERSION
    const stale = await app.request(
      `http://localhost/api/events/${eventId}/schedule/unschedule`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          placementId: p.placement.id,
          expectedVersion: p.placement.version, // stale (was 1, now 2)
        }),
      },
      env,
    );
    expect(stale.status).toBe(409);
    const err = ErrorEnvelopeSchema.parse(await stale.json());
    expect(err.code).toBe(VERSION);

    // Stale move also VERSION
    const staleMove = await app.request(
      `http://localhost/api/events/${eventId}/schedule/move`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          placementId: p.placement.id,
          roomId: "room_v",
          startsAt: "2026-09-01T18:00:00.000Z",
          endsAt: "2026-09-01T19:00:00.000Z",
          expectedVersion: 1,
        }),
      },
      env,
    );
    expect(staleMove.status).toBe(409);
    expect(ErrorEnvelopeSchema.parse(await staleMove.json()).code).toBe(
      VERSION,
    );
  });

  it("List returns unscheduled sessions", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "sched-list@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "List Event");
    await upsertRoom(app, cookie, eventId, "room_l", "List Hall");

    const s1 = await createDirectSession(app, cookie, eventId, "Placed Talk", [
      { name: "Gina", email: "gina-list@example.com" },
    ]);
    const s2 = await createDirectSession(
      app,
      cookie,
      eventId,
      "Unscheduled Talk",
      [{ name: "Hank", email: "hank-list@example.com" }],
    );

    await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: s1.sessionId,
          roomId: "room_l",
          startsAt: "2026-09-01T09:00:00.000Z",
          endsAt: "2026-09-01T10:00:00.000Z",
        }),
      },
      env,
    );

    const list = await app.request(
      `http://localhost/api/events/${eventId}/schedule?view=list`,
      {
        method: "GET",
        headers: { cookie },
      },
      env,
    );
    expect(list.status).toBe(200);
    const body = ScheduleListResponseSchema.parse(await list.json());
    expect(body.placements.length).toBe(1);
    expect(body.placements[0]!.sessionId).toBe(s1.sessionId);
    expect(body.unscheduled.some((u) => u.id === s2.sessionId)).toBe(true);
    expect(body.unscheduled.some((u) => u.id === s1.sessionId)).toBe(false);
    expect(body.view).toBe("list");
  });

  it("adjacent non-overlapping blocks are allowed", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "sched-adjacent@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Adjacent Event");
    await upsertRoom(app, cookie, eventId, "room_adj", "Adj Hall");

    const s1 = await createDirectSession(app, cookie, eventId, "A", [
      { name: "Ivy", email: "ivy-adj@example.com" },
    ]);
    const s2 = await createDirectSession(app, cookie, eventId, "B", [
      { name: "Jon", email: "jon-adj@example.com" },
    ]);

    const p1 = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: s1.sessionId,
          roomId: "room_adj",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(p1.status).toBe(201);

    const p2 = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: s2.sessionId,
          roomId: "room_adj",
          startsAt: "2026-09-01T11:00:00.000Z",
          endsAt: "2026-09-01T12:00:00.000Z",
        }),
      },
      env,
    );
    expect(p2.status).toBe(201);
  });

  it("evaluator schedule place returns 403", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "sched-admin2@example.com",
      undefined,
      shared,
    );
    const { id: eid } = await createEvent(admin.app, admin.cookie);
    const evaluator = await magicLinkSession(
      "evaluator",
      "sched-eval2@example.com",
      eid,
      shared,
    );

    const res = await evaluator.app.request(
      `http://localhost/api/events/${eid}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: evaluator.cookie,
        },
        body: JSON.stringify({
          sessionId: "sess_x",
          roomId: "room_x",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await res.json()).code).toBe(FORBIDDEN);
  });

  it("place missing session returns 404; invalid body 400; unauth 401", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "sched-val@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie);
    await upsertRoom(app, cookie, eventId, "room_miss", "Miss Hall");

    const missing = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: "sess_does_not_exist",
          roomId: "room_miss",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(missing.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await missing.json()).code).toBe(
      NOT_FOUND,
    );

    const bad = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ sessionId: "" }),
      },
      env,
    );
    expect(bad.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await bad.json()).code).toBe(
      VALIDATION_ERROR,
    );

    // endsAt <= startsAt
    const order = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          sessionId: "sess_x",
          roomId: "room_miss",
          startsAt: "2026-09-01T11:00:00.000Z",
          endsAt: "2026-09-01T10:00:00.000Z",
        }),
      },
      env,
    );
    expect(order.status).toBe(400);

    const unauth = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "s",
          roomId: "r",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(unauth.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(await unauth.json()).code).toBe(
      UNAUTHORIZED,
    );
  });

  it("OpenAPI lists Schedule commands", () => {
    expect(OPENAPI_COMMANDS).toContain("Schedule.List");
    expect(OPENAPI_COMMANDS).toContain("Schedule.Place");
    expect(OPENAPI_COMMANDS).toContain("Schedule.Move");
    expect(OPENAPI_COMMANDS).toContain("Schedule.Unschedule");
  });

  it("wrong event placement returns 404", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const a = await magicLinkSession(
      "admin",
      "sched-evt-a@example.com",
      undefined,
      shared,
    );
    const b = await magicLinkSession(
      "admin",
      "sched-evt-b@example.com",
      undefined,
      shared,
    );
    const { id: eventA } = await createEvent(a.app, a.cookie, "Event A");
    const { id: eventB } = await createEvent(b.app, b.cookie, "Event B");
    await upsertRoom(a.app, a.cookie, eventA, "room_a", "A");
    await upsertRoom(b.app, b.cookie, eventB, "room_b", "B");
    // Ensure a is admin on eventB for cross-attempt (use b cookie for B)
    const s = await createDirectSession(a.app, a.cookie, eventA, "Cross", [
      { name: "Kim", email: "kim-cross@example.com" },
    ]);
    const place = await a.app.request(
      `http://localhost/api/events/${eventA}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: a.cookie,
        },
        body: JSON.stringify({
          sessionId: s.sessionId,
          roomId: "room_a",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(place.status).toBe(201);
    const p = SchedulePlaceResponseSchema.parse(await place.json());

    // Admin B cannot move placement belonging to event A via event B path
    // (no membership on A would 404; membership on B with wrong placement → 404)
    await shared.store.upsertMembership({
      eventId: eventB,
      userId: a.userId,
      role: "admin",
    });
    const wrong = await a.app.request(
      `http://localhost/api/events/${eventB}/schedule/move`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: a.cookie,
        },
        body: JSON.stringify({
          placementId: p.placement.id,
          roomId: "room_b",
          startsAt: "2026-09-01T12:00:00.000Z",
          endsAt: "2026-09-01T13:00:00.000Z",
          expectedVersion: 1,
        }),
      },
      env,
    );
    expect(wrong.status).toBe(404);
  });
});
