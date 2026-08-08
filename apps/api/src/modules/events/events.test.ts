/**
 * Section 2.3 — Event settings (Vitest).
 *
 * Named assertions from spec:
 * - assert Event.Create returns id and timezone
 * - assert room from event A not readable with event B context 404
 * - assert switch active event updates UI testid event-context (Playwright)
 *
 * Plus: Zod 400, authz 401/403, audit_events + correlationId, Event.Update.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  EventResponseSchema,
  EventListResponseSchema,
  RoomResponseSchema,
  RoomListResponseSchema,
  TrackResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  CONFLICT,
  SESSION_COOKIE_NAME,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  store: ReturnType<typeof createAppWithAuth>["store"];
  events: ReturnType<typeof createAppWithAuth>["events"];
  cookie: string;
}> {
  const { app, store, events, outbox } = createAppWithAuth({
    cookieSecure: true,
  });
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
  return {
    app,
    store,
    events,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
  };
}

describe("2.3 event settings", () => {
  it("assert Event.Create returns id and timezone", async () => {
    const { app, store, cookie } = await magicLinkSession(
      "admin",
      "admin-create@example.com",
    );

    const res = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-event-create-1",
        },
        body: JSON.stringify({
          name: "Summit 2026",
          timezone: "America/New_York",
          startsAt: "2026-09-01T09:00:00.000Z",
          endsAt: "2026-09-03T18:00:00.000Z",
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = EventResponseSchema.parse(await res.json());
    expect(body.event.id).toBeTruthy();
    expect(body.event.timezone).toBe("America/New_York");
    expect(body.event.name).toBe("Summit 2026");
    expect(body.event.version).toBe(1);

    const audits = await store.listAudits();
    const createAudit = audits.find((a) => a.action === "Event.Create");
    expect(createAudit).toBeTruthy();
    expect(createAudit!.correlationId).toBe("corr-event-create-1");
    expect(createAudit!.entityId).toBe(body.event.id);
  });

  it("assert room from event A not readable with event B context 404", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-iso@example.com",
    );

    // Create event A and event B
    const createA = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "Event A",
          timezone: "UTC",
        }),
      },
      env,
    );
    expect(createA.status).toBe(201);
    const eventA = EventResponseSchema.parse(await createA.json()).event;

    const createB = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "Event B",
          timezone: "Europe/London",
        }),
      },
      env,
    );
    expect(createB.status).toBe(201);
    const eventB = EventResponseSchema.parse(await createB.json()).event;

    // Room under event A
    const roomId = "room_main_a";
    const upsert = await app.request(
      `http://localhost/api/events/${eventA.id}/rooms/${roomId}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-room-upsert-1",
        },
        body: JSON.stringify({ name: "Main Hall", capacity: 200 }),
      },
      env,
    );
    expect(upsert.status).toBe(200);
    const room = RoomResponseSchema.parse(await upsert.json()).room;
    expect(room.eventId).toBe(eventA.id);
    expect(room.name).toBe("Main Hall");

    // Readable under A
    const getA = await app.request(
      `http://localhost/api/events/${eventA.id}/rooms/${roomId}`,
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(getA.status).toBe(200);

    // Not readable under B context (same roomId, different event) → 404
    const getB = await app.request(
      `http://localhost/api/events/${eventB.id}/rooms/${roomId}`,
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(getB.status).toBe(404);
    const err = ErrorEnvelopeSchema.parse(await getB.json());
    expect(err.code).toBe(NOT_FOUND);

    // Room list for B does not include A's room
    const listB = await app.request(
      `http://localhost/api/events/${eventB.id}/rooms`,
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(listB.status).toBe(200);
    const roomsB = RoomListResponseSchema.parse(await listB.json());
    expect(roomsB.rooms.some((r) => r.id === roomId)).toBe(false);
  });

  it("Event.Create validation error returns 400", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-val-create@example.com",
    );
    const res = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "", timezone: "UTC" }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
  });

  it("unauthenticated Event.Create returns 401", async () => {
    const { app } = createAppWithAuth();
    const res = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", timezone: "UTC" }),
      },
      env,
    );
    expect(res.status).toBe(401);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(UNAUTHORIZED);
  });

  it("speaker Event.Create returns 403", async () => {
    const { app, cookie } = await magicLinkSession(
      "speaker",
      "speaker-create@example.com",
    );
    const res = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Nope", timezone: "UTC" }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(FORBIDDEN);
  });

  it("Event.Update changes name/timezone and audits correlationId", async () => {
    const { app, store, cookie } = await magicLinkSession(
      "admin",
      "admin-update@example.com",
    );
    const create = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "Before",
          timezone: "UTC",
        }),
      },
      env,
    );
    const created = EventResponseSchema.parse(await create.json()).event;

    const patch = await app.request(
      `http://localhost/api/events/${created.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-event-update-1",
        },
        body: JSON.stringify({
          name: "After Summit",
          timezone: "Europe/Berlin",
          startsAt: "2026-10-01T00:00:00.000Z",
          endsAt: "2026-10-02T00:00:00.000Z",
          expectedVersion: created.version,
        }),
      },
      env,
    );
    expect(patch.status).toBe(200);
    const updated = EventResponseSchema.parse(await patch.json()).event;
    expect(updated.name).toBe("After Summit");
    expect(updated.timezone).toBe("Europe/Berlin");
    expect(updated.version).toBe(created.version + 1);

    const audits = await store.listAudits();
    const upd = audits.find((a) => a.action === "Event.Update");
    expect(upd).toBeTruthy();
    expect(upd!.correlationId).toBe("corr-event-update-1");
  });

  it("Event.Update version conflict returns 409", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-conflict@example.com",
    );
    const create = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "V", timezone: "UTC" }),
      },
      env,
    );
    const created = EventResponseSchema.parse(await create.json()).event;

    const patch = await app.request(
      `http://localhost/api/events/${created.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "Clash",
          expectedVersion: 999,
        }),
      },
      env,
    );
    expect(patch.status).toBe(409);
    const err = ErrorEnvelopeSchema.parse(await patch.json());
    expect(err.code).toBe(CONFLICT);
  });

  it("Track.Upsert and Track.List are event-scoped", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-track@example.com",
    );
    const create = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Track Event", timezone: "UTC" }),
      },
      env,
    );
    const event = EventResponseSchema.parse(await create.json()).event;

    const put = await app.request(
      `http://localhost/api/events/${event.id}/tracks/track_keynote`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-track-1",
        },
        body: JSON.stringify({ name: "Keynote", color: "#4f46e5" }),
      },
      env,
    );
    expect(put.status).toBe(200);
    const track = TrackResponseSchema.parse(await put.json()).track;
    expect(track.name).toBe("Keynote");
    expect(track.eventId).toBe(event.id);

    const list = await app.request(
      `http://localhost/api/events/${event.id}/tracks`,
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.tracks).toHaveLength(1);
  });

  it("Event.List returns created events with timezone for admin", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-list-full@example.com",
    );
    await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "Listed",
          timezone: "Asia/Tokyo",
        }),
      },
      env,
    );
    const res = await app.request(
      "http://localhost/api/events",
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = EventListResponseSchema.parse(await res.json());
    const listed = body.events.find((e) => e.name === "Listed");
    expect(listed).toBeTruthy();
    expect(listed!.timezone).toBe("Asia/Tokyo");
  });

});

describe("2.3 event settings same-store isolation", () => {
  it("user without membership on event A cannot read A rooms (404)", async () => {
    const { app, store, outbox } = createAppWithAuth({ cookieSecure: true });

    // Admin A
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "same-a@example.com",
          purpose: "admin",
          eventId: "seed_a",
        }),
      },
      env,
    );
    const tokenA = outbox.lastForEmail("same-a@example.com")!.token;
    const exA = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenA }),
      },
      env,
    );
    const cookieA = `${SESSION_COOKIE_NAME}=${exA.headers
      .get("set-cookie")!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=")}`;

    const create = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ name: "Private A", timezone: "UTC" }),
      },
      env,
    );
    const eventA = EventResponseSchema.parse(await create.json()).event;
    await app.request(
      `http://localhost/api/events/${eventA.id}/rooms/r1`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ name: "Hall" }),
      },
      env,
    );

    // Admin B — membership only on seed_b (not event A)
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "same-b@example.com",
          purpose: "admin",
          eventId: "seed_b",
        }),
      },
      env,
    );
    const tokenB = outbox.lastForEmail("same-b@example.com")!.token;
    const exB = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenB }),
      },
      env,
    );
    const cookieB = `${SESSION_COOKIE_NAME}=${exB.headers
      .get("set-cookie")!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=")}`;

    // Ensure B has no membership on event A
    const mem = await store.findMembership(eventA.id, (await store.findUserByEmail("same-b@example.com"))!.id);
    expect(mem).toBeNull();

    const res = await app.request(
      `http://localhost/api/events/${eventA.id}/rooms/r1`,
      { method: "GET", headers: { cookie: cookieB } },
      env,
    );
    expect(res.status).toBe(404);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(NOT_FOUND);
  });
});
