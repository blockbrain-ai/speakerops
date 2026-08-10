/**
 * Portal + admin speakers + task templates HTTP routes (section 4.1).
 *
 * GET    /api/portal/home
 * PATCH  /api/portal/participations/:id
 * POST   /api/portal/tasks/:taskId/complete
 * GET    /api/events/:eventId/speakers
 * GET    /api/events/:eventId/speakers/:participationId
 * GET    /api/events/:eventId/task-templates
 * POST   /api/events/:eventId/task-templates
 * PATCH  /api/events/:eventId/task-templates/:templateId
 * DELETE /api/events/:eventId/task-templates/:templateId
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  PortalHomeQuerySchema,
  PortalHomeResponseSchema,
  ParticipationUpdateProfileBodySchema,
  ParticipationUpdateProfileResponseSchema,
  SpeakersUpdateProfileBodySchema,
  SpeakersUpdateProfileResponseSchema,
  TaskCompleteBodySchema,
  TaskCompleteResponseSchema,
  AdminSpeakersListQuerySchema,
  AdminSpeakersListResponseSchema,
  AdminSpeakerDetailResponseSchema,
  TaskTemplateCreateBodySchema,
  TaskTemplateUpdateBodySchema,
  TaskTemplateDeleteBodySchema,
  TaskTemplateListResponseSchema,
  TaskTemplateResponseSchema,
  TaskTemplateDeleteResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  CONFLICT,
  FORBIDDEN,
  UNAUTHORIZED,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import type { DesignStore } from "../design/store.js";
import {
  requireRole,
  requireSession,
  actorFromContext,
} from "../../middleware/authz.js";
import {
  getPortalHome,
  completeTask,
  adminCompleteSpeakerTask,
  updateParticipationProfile,
  adminUpdateSpeakerProfile,
  listSpeakers,
  getSpeakerDetail,
  listTaskTemplates,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
  portalSessionIcs,
} from "./commands.js";

export type PortalRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  submissions: SubmissionsStore;
  decisions: DecisionsStore;
  design?: DesignStore;
  /** Session when/where for portal home. */
  schedule?: import("../schedule/store.js").ScheduleStore;
  /** Bearer speakers:write for Speakers.UpdateProfile (CLI). */
  keys?: import("../keys/store.js").KeysStore;
  /** Calendar-invite UID/SEQUENCE continuity for Portal.SessionIcs (optional). */
  comms?: import("../comms/store.js").CommsStore;
};

function commandError(
  c: Context<ApiEnv>,
  err: {
    status: 400 | 403 | 404 | 409;
    error: string;
    code: string;
    details?: unknown;
  },
) {
  const code: ErrorCode =
    err.code === "CONFLICT"
      ? CONFLICT
      : err.code === "NOT_FOUND"
        ? NOT_FOUND
        : err.code === "FORBIDDEN"
          ? FORBIDDEN
          : err.code === "VALIDATION_ERROR"
            ? VALIDATION_ERROR
            : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

/**
 * Speaker portal routes — mounted at /api/portal
 */
export function createPortalRoutes(
  options: PortalRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, decisions, design, schedule, comms } =
    options;
  const deps = {
    decisions,
    events,
    auth: store,
    submissions,
    design,
    schedule,
    comms,
  };

  /**
   * GET /sessions/:sessionId/invite.ics — Portal.SessionIcs (G09).
   * Speaker-owned calendar download: ownership verified server-side
   * (participation → session link); non-owned / unknown → 404. Read-only:
   * reuses stored invite UID/SEQUENCE when present, never writes.
   * Query: eventId (required). Response: text/calendar attachment.
   */
  app.get(
    "/sessions/:sessionId/invite.ics",
    requireSession(store),
    async (c) => {
      const q = PortalHomeQuerySchema.safeParse({
        eventId: c.req.query("eventId"),
      });
      if (!q.success) {
        return c.json(
          errorEnvelope("Invalid query", VALIDATION_ERROR, q.error.flatten()),
          400,
        );
      }
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }
      const result = await portalSessionIcs(deps, {
        eventId: q.data.eventId,
        userId: user.id,
        userEmail: user.email,
        sessionId: c.req.param("sessionId"),
        correlationId: c.get("correlationId"),
      });
      if (!result.ok) {
        return commandError(c, result);
      }
      c.header("Content-Type", "text/calendar; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="${result.value.filename}"`,
      );
      c.header("Cache-Control", "no-store");
      return c.body(result.value.body, 200);
    },
  );

  /**
   * GET /home — Portal.GetHome
   * Authz: speaker/admin membership OR bound event_participation for user
   * (accepted speakers who retain evaluator/admin role still access portal).
   * Query: eventId (required)
   */
  app.get("/home", requireSession(store), async (c) => {
    const q = PortalHomeQuerySchema.safeParse({
      eventId: c.req.query("eventId"),
    });
    if (!q.success) {
      return c.json(
        errorEnvelope("Invalid query", VALIDATION_ERROR, q.error.flatten()),
        400,
      );
    }
    const user = c.get("user");
    if (!user) {
      return c.json(errorEnvelope("Authentication required", UNAUTHORIZED), 401);
    }
    const membership = await store.findMembership(q.data.eventId, user.id);
    const parts = await decisions.listParticipationsForEvent(q.data.eventId);
    const bound = parts.some((p) => p.userId === user.id);
    const roleOk =
      membership != null &&
      (membership.role === "speaker" || membership.role === "admin");
    if (!roleOk && !bound) {
      if (!membership) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      return c.json(
        errorEnvelope("Insufficient role", FORBIDDEN, {
          required: ["speaker"],
          role: membership.role,
        }),
        403,
      );
    }
    const result = await getPortalHome(deps, {
      eventId: q.data.eventId,
      userId: user.id,
      userEmail: user.email,
      correlationId:
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown",
    });
    if (!result.ok) return commandError(c, result);

    const parsed = PortalHomeResponseSchema.safeParse(result.value);
    if (!parsed.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(parsed.data, 200);
  });

  /**
   * PATCH /participations/:id — Participation.UpdateProfile
   */
  app.patch(
    "/participations/:id",
    requireSession(store),
    async (c) => {
      const participationId = c.req.param("id");
      let bodyRaw: unknown;
      try {
        bodyRaw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }
      const body = ParticipationUpdateProfileBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, body.error.flatten()),
          400,
        );
      }

      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", UNAUTHORIZED), 401);
      }

      // Role check against participation's event
      const part = await decisions.findParticipationById(participationId);
      if (!part) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      const membership = await store.findMembership(part.eventId, user.id);
      const ownsParticipation = part.userId === user.id;
      const roleOk =
        membership != null &&
        (membership.role === "speaker" || membership.role === "admin");
      if (!roleOk && !ownsParticipation) {
        if (!membership) {
          return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
        }
        return c.json(
          errorEnvelope("Insufficient role", FORBIDDEN, {
            required: ["speaker"],
            role: membership.role,
          }),
          403,
        );
      }

      const correlationId =
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";
      const result = await updateParticipationProfile(deps, {
        participationId,
        userId: user.id,
        userEmail: user.email,
        body: body.data,
        correlationId,
      });
      if (!result.ok) return commandError(c, result);

      const parsed = ParticipationUpdateProfileResponseSchema.safeParse(
        result.value,
      );
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
   * POST /tasks/:taskId/complete — Task.Complete
   */
  app.post(
    "/tasks/:taskId/complete",
    requireSession(store),
    async (c) => {
      const taskId = c.req.param("taskId");
      let bodyRaw: unknown;
      try {
        bodyRaw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }
      const body = TaskCompleteBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, body.error.flatten()),
          400,
        );
      }

      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", UNAUTHORIZED), 401);
      }

      const task = await decisions.findSpeakerTaskById(taskId);
      if (!task) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      const part = await decisions.findParticipationById(task.participationId);
      if (!part) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      const membership = await store.findMembership(part.eventId, user.id);
      const ownsPart = part.userId === user.id;
      const roleOk =
        membership != null &&
        (membership.role === "speaker" || membership.role === "admin");
      if (!roleOk && !ownsPart) {
        if (!membership) {
          return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
        }
        return c.json(
          errorEnvelope("Insufficient role", FORBIDDEN, {
            required: ["speaker"],
            role: membership.role,
          }),
          403,
        );
      }

      const correlationId =
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";
      const result = await completeTask(deps, {
        taskId,
        userId: user.id,
        userEmail: user.email,
        body: body.data,
        correlationId,
      });
      if (!result.ok) return commandError(c, result);

      const parsed = TaskCompleteResponseSchema.safeParse(result.value);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(parsed.data, 200);
    },
  );

  return app;
}

/**
 * Admin speakers + task templates — mounted under /api/events
 */
export function createEventPortalRoutes(
  options: PortalRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, decisions, design, keys } = options;
  const deps = { decisions, events, auth: store, submissions, design };

  /**
   * GET /:eventId/speakers — admin speakers list (N01/N02)
   * Query: q?, status?
   */
  app.get(
    "/:eventId/speakers",
    requireRole(store, ["admin"], {
      eventIdFrom: "param",
      ...(keys
        ? {
            keysStore: keys,
            bearerScopes: ["speakers:read", "speakers:write"] as const,
            eventsStore: events,
          }
        : {}),
    }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const q = AdminSpeakersListQuerySchema.safeParse({
        q: c.req.query("q") ?? undefined,
        status: c.req.query("status") ?? undefined,
      });
      if (!q.success) {
        return c.json(
          errorEnvelope("Invalid query", VALIDATION_ERROR, q.error.flatten()),
          400,
        );
      }
      const result = await listSpeakers(deps, {
        eventId,
        q: q.data.q,
        status: q.data.status,
      });
      if (!result.ok) return commandError(c, result);
      const parsed = AdminSpeakersListResponseSchema.safeParse(result.value);
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
   * GET /:eventId/speakers/:participationId — admin speaker detail (N03/N04)
   */
  app.get(
    "/:eventId/speakers/:participationId",
    requireRole(store, ["admin"], {
      eventIdFrom: "param",
      ...(keys
        ? {
            keysStore: keys,
            bearerScopes: ["speakers:read", "speakers:write"] as const,
            eventsStore: events,
          }
        : {}),
    }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const participationId = c.req.param("participationId");
      const result = await getSpeakerDetail(deps, {
        eventId,
        participationId,
      });
      if (!result.ok) return commandError(c, result);
      const parsed = AdminSpeakerDetailResponseSchema.safeParse(result.value);
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
   * PATCH /:eventId/speakers/:participationId — Speakers.UpdateProfile (admin)
   */
  app.patch(
    "/:eventId/speakers/:participationId",
    requireRole(store, ["admin"], {
      eventIdFrom: "param",
      ...(keys
        ? {
            keysStore: keys,
            bearerScopes: ["speakers:write"] as const,
            eventsStore: events,
          }
        : {}),
    }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const participationId = c.req.param("participationId");
      let bodyRaw: unknown;
      try {
        bodyRaw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }
      const body = SpeakersUpdateProfileBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope(
            "Validation failed",
            VALIDATION_ERROR,
            body.error.flatten(),
          ),
          400,
        );
      }
      const actor = actorFromContext(c);
      if (!actor) {
        return c.json(
          errorEnvelope("Authentication required", UNAUTHORIZED),
          401,
        );
      }
      const correlationId =
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";
      const result = await adminUpdateSpeakerProfile(deps, {
        eventId,
        participationId,
        actorUserId: actor.userId,
        body: body.data,
        correlationId,
      });
      if (!result.ok) return commandError(c, result);
      const parsed = SpeakersUpdateProfileResponseSchema.safeParse(
        result.value,
      );
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
   * POST /:eventId/speakers/:participationId/tasks/:taskId/complete —
   * Speakers.CompleteTask (Wave 2 N05): admin completes a task on behalf of a
   * speaker. Body: { expectedVersion }. Idempotent on already-completed tasks.
   */
  app.post(
    "/:eventId/speakers/:participationId/tasks/:taskId/complete",
    requireRole(store, ["admin"], {
      eventIdFrom: "param",
      ...(keys
        ? {
            keysStore: keys,
            bearerScopes: ["speakers:write"] as const,
            eventsStore: events,
          }
        : {}),
    }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const participationId = c.req.param("participationId");
      const taskId = c.req.param("taskId");
      let bodyRaw: unknown;
      try {
        bodyRaw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }
      const body = TaskCompleteBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope(
            "Validation failed",
            VALIDATION_ERROR,
            body.error.flatten(),
          ),
          400,
        );
      }
      const actor = actorFromContext(c);
      if (!actor) {
        return c.json(
          errorEnvelope("Authentication required", UNAUTHORIZED),
          401,
        );
      }
      const correlationId =
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";
      const result = await adminCompleteSpeakerTask(deps, {
        eventId,
        participationId,
        taskId,
        actorUserId: actor.userId,
        body: body.data,
        correlationId,
      });
      if (!result.ok) return commandError(c, result);
      const parsed = TaskCompleteResponseSchema.safeParse(result.value);
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
   * GET /:eventId/task-templates — list (O05)
   */
  app.get(
    "/:eventId/task-templates",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const result = await listTaskTemplates(deps, { eventId });
      if (!result.ok) return commandError(c, result);
      const parsed = TaskTemplateListResponseSchema.safeParse(result.value);
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
   * POST /:eventId/task-templates — create (O05)
   */
  app.post(
    "/:eventId/task-templates",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      let bodyRaw: unknown;
      try {
        bodyRaw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }
      const body = TaskTemplateCreateBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, body.error.flatten()),
          400,
        );
      }
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", UNAUTHORIZED), 401);
      }
      const correlationId =
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";
      const result = await createTaskTemplate(deps, {
        eventId,
        body: body.data,
        actorUserId: user.id,
        correlationId,
      });
      if (!result.ok) return commandError(c, result);
      const parsed = TaskTemplateResponseSchema.safeParse(result.value);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(parsed.data, 201);
    },
  );

  /**
   * PATCH /:eventId/task-templates/:templateId — update (O05)
   */
  app.patch(
    "/:eventId/task-templates/:templateId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const templateId = c.req.param("templateId");
      let bodyRaw: unknown;
      try {
        bodyRaw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }
      const body = TaskTemplateUpdateBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, body.error.flatten()),
          400,
        );
      }
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", UNAUTHORIZED), 401);
      }
      const correlationId =
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";
      const result = await updateTaskTemplate(deps, {
        eventId,
        templateId,
        body: body.data,
        actorUserId: user.id,
        correlationId,
      });
      if (!result.ok) return commandError(c, result);
      const parsed = TaskTemplateResponseSchema.safeParse(result.value);
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
   * DELETE /:eventId/task-templates/:templateId — delete (O05)
   * Body: { expectedVersion } for E1 optimistic concurrency.
   */
  app.delete(
    "/:eventId/task-templates/:templateId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const templateId = c.req.param("templateId");
      let bodyRaw: unknown;
      try {
        bodyRaw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }
      const body = TaskTemplateDeleteBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope(
            "Validation failed",
            VALIDATION_ERROR,
            body.error.flatten(),
          ),
          400,
        );
      }
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", UNAUTHORIZED), 401);
      }
      const correlationId =
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";
      const result = await deleteTaskTemplate(deps, {
        eventId,
        templateId,
        expectedVersion: body.data.expectedVersion,
        actorUserId: user.id,
        correlationId,
      });
      if (!result.ok) return commandError(c, result);
      const parsed = TaskTemplateDeleteResponseSchema.safeParse(result.value);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(parsed.data, 200);
    },
  );

  return app;
}
