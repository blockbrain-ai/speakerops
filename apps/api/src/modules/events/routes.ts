/**
 * Events HTTP routes — COMMANDS.md map (section 2.3 Event settings).
 *
 * GET    /api/events                              → Event.List (admin)
 * POST   /api/events                              → Event.Create
 * GET    /api/events/:eventId                     → Event.Get
 * PATCH  /api/events/:eventId                     → Event.Update
 * GET    /api/events/:eventId/rooms               → Room.List
 * GET    /api/events/:eventId/rooms/:roomId       → Room.Get
 * PUT    /api/events/:eventId/rooms/:roomId       → Room.Upsert
 * GET    /api/events/:eventId/tracks              → Track.List
 * GET    /api/events/:eventId/tracks/:trackId     → Track.Get
 * PUT    /api/events/:eventId/tracks/:trackId     → Track.Upsert
 */
import { Hono, type Context } from "hono";
import {
  EventCreateBodySchema,
  EventUpdateBodySchema,
  EventResponseSchema,
  EventListResponseSchema,
  RoomUpsertBodySchema,
  RoomResponseSchema,
  RoomListResponseSchema,
  TrackUpsertBodySchema,
  TrackResponseSchema,
  TrackListResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  CONFLICT,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "./store.js";
import type { KeysStore } from "../keys/store.js";
import type { AirtableStore } from "../airtable/store.js";
import { requireRole } from "../../middleware/authz.js";
import {
  createEvent,
  updateEvent,
  listEventsForAdmin,
  getEvent,
  listRooms,
  getRoom,
  upsertRoom,
  listTracks,
  getTrack,
  upsertTrack,
} from "./commands.js";

export type EventsRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  /** When set, Bearer API keys with events:read|write are accepted (7.2). */
  keys?: KeysStore;
  /** When set, Event.Create/Update enqueue airtable.project (7.3 / S-AIRTABLE). */
  airtable?: AirtableStore;
};

function commandError(
  c: Context<ApiEnv>,
  err: { status: 400 | 404 | 409; error: string; code: string; details?: unknown },
) {
  const code: ErrorCode =
    err.code === "CONFLICT"
      ? CONFLICT
      : err.code === "NOT_FOUND"
        ? NOT_FOUND
        : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

export function createEventsRoutes(options: EventsRouteOptions): Hono<ApiEnv> {
  const events = new Hono<ApiEnv>();
  const { store, events: eventsStore, keys, airtable } = options;
  const deps = { events: eventsStore, auth: store, airtable };
  const bearer = keys
    ? { keysStore: keys, bearerScopes: ["events:read"] as const }
    : {};
  const bearerWrite = keys
    ? { keysStore: keys, bearerScopes: ["events:write"] as const }
    : {};

  /**
   * GET /api/events — Event.List
   * Role: admin (any event membership with role admin)
   * Bearer: events:read (7.2 CLI01)
   */
  events.get(
    "/",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearer }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }

      const payload = await listEventsForAdmin(deps, user.id);
      const parsed = EventListResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(parsed.data, 200);
    },
  );

  /**
   * POST /api/events — Event.Create
   * Role: admin (any admin membership — bootstrap / multi-event)
   * Bearer: events:write (7.2)
   */
  events.post(
    "/",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerWrite }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = EventCreateBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await createEvent(deps, {
        ...parsed.data,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = EventResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 201);
    },
  );

  /**
   * GET /api/events/:eventId — Event.Get
   */
  events.get(
    "/:eventId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const result = await getEvent(deps, eventId);
      if (!result.ok) {
        // Cross-event isolation: membership exists but no row → still 404
        return commandError(c, result);
      }
      const out = EventResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * PATCH /api/events/:eventId — Event.Update
   */
  events.patch(
    "/:eventId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }

      const eventId = c.req.param("eventId");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = EventUpdateBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await updateEvent(deps, {
        ...parsed.data,
        eventId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = EventResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * GET /api/events/:eventId/rooms — Room.List
   */
  events.get(
    "/:eventId/rooms",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const payload = await listRooms(deps, eventId);
      const parsed = RoomListResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(parsed.data, 200);
    },
  );

  /**
   * GET /api/events/:eventId/rooms/:roomId — Room.Get (C11 isolation)
   */
  events.get(
    "/:eventId/rooms/:roomId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const roomId = c.req.param("roomId");
      const result = await getRoom(deps, eventId, roomId);
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = RoomResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * PUT /api/events/:eventId/rooms/:roomId — Room.Upsert
   */
  events.put(
    "/:eventId/rooms/:roomId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }

      const eventId = c.req.param("eventId");
      const roomId = c.req.param("roomId");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = RoomUpsertBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await upsertRoom(deps, {
        ...parsed.data,
        eventId,
        roomId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = RoomResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * GET /api/events/:eventId/tracks — Track.List
   */
  events.get(
    "/:eventId/tracks",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const payload = await listTracks(deps, eventId);
      const parsed = TrackListResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(parsed.data, 200);
    },
  );

  /**
   * GET /api/events/:eventId/tracks/:trackId — Track.Get
   */
  events.get(
    "/:eventId/tracks/:trackId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const trackId = c.req.param("trackId");
      const result = await getTrack(deps, eventId, trackId);
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = TrackResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * PUT /api/events/:eventId/tracks/:trackId — Track.Upsert
   */
  events.put(
    "/:eventId/tracks/:trackId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }

      const eventId = c.req.param("eventId");
      const trackId = c.req.param("trackId");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = TrackUpsertBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await upsertTrack(deps, {
        ...parsed.data,
        eventId,
        trackId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = TrackResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  return events;
}
