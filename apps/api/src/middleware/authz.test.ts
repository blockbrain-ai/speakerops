/**
 * Section 2.2 — roles and route guards (Vitest).
 *
 * Named assertions from spec:
 * - assert speaker session GET /api/events admin list returns 403
 * - assert evaluator POST schedule place returns 403
 * - assert unauthenticated admin route 401
 *
 * Plus: cross-event isolation 404, admin success, audit on place, Zod 400.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  EventListResponseSchema,
  FORBIDDEN,
  UNAUTHORIZED,
  NOT_FOUND,
  VALIDATION_ERROR,
  SESSION_COOKIE_NAME,
  DEFAULT_BOOTSTRAP_EVENT_ID,
} from "@speakerops/shared";
import { createAppWithAuth } from "../index.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  store: ReturnType<typeof createAppWithAuth>["store"];
  cookie: string;
}> {
  const { app, store, outbox } = createAppWithAuth({ cookieSecure: true });
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
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
  };
}

describe("2.2 roles and route guards", () => {
  it("assert speaker session GET /api/events admin list returns 403", async () => {
    const { app, cookie } = await magicLinkSession(
      "speaker",
      "speaker-guard@example.com",
    );

    const res = await app.request(
      "http://localhost/api/events",
      {
        method: "GET",
        headers: { cookie },
      },
      env,
    );
    expect(res.status).toBe(403);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(FORBIDDEN);
  });

  it("assert evaluator POST schedule place returns 403", async () => {
    const eventId = "evt_eval_place";
    const { app, cookie } = await magicLinkSession(
      "evaluator",
      "evaluator-guard@example.com",
      eventId,
    );

    const res = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-eval-place",
        },
        body: JSON.stringify({
          sessionId: "sess_1",
          roomId: "room_1",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(FORBIDDEN);
  });

  it("assert unauthenticated admin route 401", async () => {
    const { app } = createAppWithAuth();
    const res = await app.request(
      "http://localhost/api/events",
      { method: "GET" },
      env,
    );
    expect(res.status).toBe(401);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(UNAUTHORIZED);
  });

  it("admin GET /api/events returns 200 with events from memberships", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-list@example.com",
    );

    const res = await app.request(
      "http://localhost/api/events",
      {
        method: "GET",
        headers: { cookie },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = EventListResponseSchema.parse(await res.json());
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.events.some((e) => e.id === DEFAULT_BOOTSTRAP_EVENT_ID)).toBe(
      true,
    );
  });

  it("admin POST schedule place passes role gate then 501 (no fake placement)", async () => {
    const eventId = "evt_admin_place";
    const { app, store, cookie } = await magicLinkSession(
      "admin",
      "admin-place@example.com",
      eventId,
    );

    const res = await app.request(
      `http://localhost/api/events/${eventId}/schedule/place`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-admin-place-1",
        },
        body: JSON.stringify({
          sessionId: "sess_a",
          roomId: "room_a",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
      },
      env,
    );
    // Section 2.2: role gate only — no D1 schedule_placements until 6.1
    expect(res.status).toBe(501);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe("NOT_IMPLEMENTED");

    const audits = await store.listAudits();
    const placeAudit = audits.find((a) => a.action === "Schedule.Place");
    expect(placeAudit).toBeUndefined();
  });

  it("cross-event isolation: no membership on event returns 404 not 403", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-cross@example.com",
      "evt_A",
    );

    const res = await app.request(
      "http://localhost/api/events/evt_B_unknown/schedule/place",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
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
    expect(res.status).toBe(404);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(NOT_FOUND);
  });

  it("schedule place invalid body returns 400 VALIDATION_ERROR", async () => {
    const eventId = "evt_val";
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-val@example.com",
      eventId,
    );

    const res = await app.request(
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
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
  });

  it("magic-link purpose seeds event_memberships role", async () => {
    const { store } = await magicLinkSession(
      "evaluator",
      "member-seed@example.com",
      "evt_seed",
    );
    const memberships = await store.listMemberships();
    const row = memberships.find((m) => m.eventId === "evt_seed");
    expect(row).toBeTruthy();
    expect(row!.role).toBe("evaluator");
  });

  it("unauthenticated schedule place returns 401", async () => {
    const { app } = createAppWithAuth();
    const res = await app.request(
      "http://localhost/api/events/evt_x/schedule/place",
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
    expect(res.status).toBe(401);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(UNAUTHORIZED);
  });
});
