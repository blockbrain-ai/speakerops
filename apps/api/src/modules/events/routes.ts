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
  FORBIDDEN,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "./store.js";
import type { KeysStore } from "../keys/store.js";
import type { AirtableStore } from "../airtable/store.js";
import type { DesignStore } from "../design/store.js";
import { requireRole, actorFromContext } from "../../middleware/authz.js";
import {
  createInvite,
  setMemberRole,
} from "../auth/commands.js";
import type { MagicLinkMailDeps } from "../auth/commands.js";
import {
  createEvent,
  updateEvent,
  listEventsForAdmin,
  listEventsByOrg,
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
  /** When set, N6 GET /:eventId/files lists file_assets for the event. */
  design?: DesignStore;
  /** WS-C invite email outbox */
  magicLinkMail?: MagicLinkMailDeps | null;
  magicLinkOutbox?: import("../auth/store.js").MagicLinkTestOutbox;
  /** C2 assignment-orphan guard on demotion to speaker */
  eval?: import("../eval/store.js").EvalStore;
};

import { MagicLinkTestOutbox } from "../auth/store.js";

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
  const {
    store,
    events: eventsStore,
    keys,
    airtable,
    design,
    magicLinkMail,
    magicLinkOutbox,
    eval: evalStore,
  } = options;
  const deps = { events: eventsStore, auth: store, airtable };
  const authDeps = {
    store,
    outbox: magicLinkOutbox ?? new MagicLinkTestOutbox(),
    magicLinkMail: magicLinkMail ?? null,
    bootstrapPolicy: "controlled" as const,
    eval: evalStore,
  };
  const bearer = keys
    ? {
        keysStore: keys,
        bearerScopes: ["events:read"] as const,
        eventsStore,
      }
    : {};
  const bearerWrite = keys
    ? {
        keysStore: keys,
        bearerScopes: ["events:write"] as const,
        eventsStore,
      }
    : {};

  /**
   * GET /api/events — Event.List
   * Role: admin (any event membership with role admin)
   * Bearer: events:read (7.2 CLI01)
   * Event-scoped keys: only the bound event (never creator's full admin set).
   * Org-scoped keys: only events in apiKey.orgId (never cross-org via creator).
   */
  events.get(
    "/",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearer }),
    async (c) => {
      const actor = actorFromContext(c);
      if (!actor) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }

      const apiKey = c.get("apiKey");
      let payload: Awaited<ReturnType<typeof listEventsForAdmin>>;
      if (apiKey?.eventId) {
        // Event-scoped Bearer: constrain list to the key's binding only (E2).
        const one = await getEvent(deps, apiKey.eventId);
        payload = {
          events: one.ok ? [one.value.event] : [],
        };
      } else if (apiKey) {
        // Org-scoped Bearer: all events in apiKey.orgId via listEventsByOrgId
        // — not the key creator's admin memberships (unbound org automation).
        payload = await listEventsByOrg(deps, apiKey.orgId);
      } else {
        payload = await listEventsForAdmin(deps, actor.userId);
      }
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
   * Bearer: events:write (7.2) — unscoped keys only; event-scoped keys forbidden.
   * Org-scoped keys: orgId forced to apiKey.orgId (cannot create in another org).
   */
  events.post(
    "/",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerWrite }),
    async (c) => {
      const actor = actorFromContext(c);
      if (!actor) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }

      // Event-scoped keys cannot create events outside their binding (E2).
      const apiKey = c.get("apiKey");
      if (apiKey?.eventId) {
        return c.json(
          errorEnvelope(
            "Event-scoped API key cannot create events",
            FORBIDDEN,
            { eventId: apiKey.eventId },
          ),
          403,
        );
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

      // Org-scoped Bearer: constrain orgId to the key's organization (E2).
      // Ignore/override body.orgId so a key cannot mint events in another org.
      const body = apiKey
        ? { ...parsed.data, orgId: apiKey.orgId }
        : parsed.data;

      const result = await createEvent(deps, {
        ...body,
        actorUserId: actor.userId,
        actorType: actor.actorType,
        actorId: actor.actorId,
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
   * Role: admin · Bearer: events:read (SCOPES.md / OpenAPI Event.Get)
   */
  events.get(
    "/:eventId",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearer }),
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
    requireRole(store, ["admin"], {
      eventIdFrom: "param",
      ...bearerWrite,
    }),
    async (c) => {
      const actor = actorFromContext(c);
      if (!actor) {
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
        actorUserId: actor.userId,
        actorType: actor.actorType,
        actorId: actor.actorId,
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
    requireRole(store, ["admin"], {
      eventIdFrom: "param",
      ...bearerWrite,
    }),
    async (c) => {
      const actor = actorFromContext(c);
      if (!actor) {
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
        actorUserId: actor.userId,
        actorType: actor.actorType,
        actorId: actor.actorId,
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
    requireRole(store, ["admin"], {
      eventIdFrom: "param",
      ...bearerWrite,
    }),
    async (c) => {
      const actor = actorFromContext(c);
      if (!actor) {
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
        actorUserId: actor.userId,
        actorType: actor.actorType,
        actorId: actor.actorId,
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

  /**
   * GET /:eventId/history — N6 audit browser (event-scoped).
   */
  events.get(
    "/:eventId/history",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const all = await store.listAudits();
      const eventsFor = all
        .filter((a) => a.eventId === eventId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200)
        .map((a) => ({
          id: a.id,
          eventId: a.eventId,
          actorType: a.actorType,
          actorId: a.actorId,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          correlationId: a.correlationId,
          createdAt: a.createdAt,
        }));
      return c.json({ events: eventsFor }, 200);
    },
  );

  /**
   * GET /:eventId/files — N6 centralized file library (admin).
   * Lists file_assets metadata for the event (no bytes).
   */
  events.get(
    "/:eventId/files",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const event = await eventsStore.findEventById(eventId);
      if (!event) {
        return c.json(errorEnvelope("Event not found", NOT_FOUND), 404);
      }
      if (!design?.listFilesForEvent) {
        return c.json({ files: [] }, 200);
      }
      const rows = await design.listFilesForEvent(eventId);
      return c.json(
        {
          files: rows.slice(0, 500).map((f) => ({
            id: f.id,
            purpose: f.purpose,
            filename: f.filename,
            contentType: f.mime,
            sizeBytes: f.size,
            uploaded: f.uploaded,
            ownerParticipationId: f.ownerParticipationId,
            createdAt: f.createdAt,
          })),
        },
        200,
      );
    },
  );

  /**
   * POST /:eventId/invites — Auth.CreateInvite (WS-C1)
   * Body: { email, role } — eventId from path only.
   */
  events.post(
    "/:eventId/invites",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON body", VALIDATION_ERROR), 400);
      }
      const body = raw as { email?: string; role?: string; eventId?: string };
      if (body.eventId && body.eventId !== eventId) {
        return c.json(
          errorEnvelope("eventId must match path", VALIDATION_ERROR),
          400,
        );
      }
      const result = await createInvite(authDeps, {
        eventId,
        email: String(body.email ?? ""),
        role: (body.role ?? "evaluator") as "admin" | "evaluator" | "speaker",
        actorUserId: user.id,
        correlationId: c.get("correlationId") ?? "unknown",
      });
      if (!result.ok) {
        return c.json(
          errorEnvelope(result.error, result.code as never),
          result.status,
        );
      }
      return c.json(
        {
          inviteId: result.inviteId,
          mailEnqueued: result.mailEnqueued,
          message: result.mailEnqueued
            ? "Invite sent"
            : "Invite created but delivery failed — check email config",
        },
        201,
      );
    },
  );

  /**
   * PATCH /:eventId/members/:userId — setMemberRole (WS-C2)
   */
  events.patch(
    "/:eventId/members/:userId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const userId = c.req.param("userId");
      const actor = c.get("user");
      if (!actor) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON body", VALIDATION_ERROR), 400);
      }
      const role = (raw as { role?: string }).role;
      if (!role) {
        return c.json(errorEnvelope("role required", VALIDATION_ERROR), 400);
      }
      const result = await setMemberRole(authDeps, {
        eventId,
        userId,
        role: role as "admin" | "evaluator" | "speaker",
        actorUserId: actor.id,
        correlationId: c.get("correlationId") ?? "unknown",
      });
      if (!result.ok) {
        return c.json(
          errorEnvelope(result.error, result.code as never),
          result.status,
        );
      }
      return c.json({ userId, role: result.role }, 200);
    },
  );

  return events;
}
