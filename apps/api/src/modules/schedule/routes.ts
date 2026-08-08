/**
 * Schedule HTTP routes — COMMANDS.md map (section 6.1 / S-SCHED).
 *
 * GET  /api/events/:eventId/schedule              → Schedule.List
 * POST /api/events/:eventId/schedule/place        → Schedule.Place
 * POST /api/events/:eventId/schedule/move         → Schedule.Move
 * POST /api/events/:eventId/schedule/unschedule   → Schedule.Unschedule
 *
 * Role: admin (evaluator/speaker → 403; no membership → 404).
 * Zod + E4 envelopes; hard conflicts return 409 CONFLICT with conflicts[].
 * Stale placement version → 409 VERSION.
 */
import { Hono, type Context } from "hono";
import {
  SchedulePlaceBodySchema,
  SchedulePlaceResponseSchema,
  ScheduleMoveBodySchema,
  ScheduleMoveResponseSchema,
  ScheduleUnscheduleBodySchema,
  ScheduleUnscheduleResponseSchema,
  ScheduleListResponseSchema,
  ScheduleViewSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  CONFLICT,
  FORBIDDEN,
  VERSION,
  type ErrorCode,
  type ScheduleConflictItem,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import type { ScheduleStore } from "./store.js";
import { requireRole } from "../../middleware/authz.js";
import {
  placeSession,
  movePlacement,
  unschedulePlacement,
  listSchedule,
} from "./commands.js";

export type ScheduleRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  decisions: DecisionsStore;
  schedule: ScheduleStore;
};

function commandError(
  c: Context<ApiEnv>,
  err: {
    status: 400 | 403 | 404 | 409;
    error: string;
    code: string;
    conflicts?: ScheduleConflictItem[];
    details?: unknown;
  },
) {
  const code: ErrorCode =
    err.code === "CONFLICT"
      ? CONFLICT
      : err.code === "VERSION"
        ? VERSION
        : err.code === "NOT_FOUND"
          ? NOT_FOUND
          : err.code === "FORBIDDEN"
            ? FORBIDDEN
            : (err.code as ErrorCode);

  // Schedule hard conflicts: top-level conflicts[] per 6.1 interface
  if (err.code === "CONFLICT" && err.conflicts && err.conflicts.length > 0) {
    return c.json(
      {
        error: err.error,
        code: CONFLICT,
        conflicts: err.conflicts,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      err.status,
    );
  }

  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

export function createScheduleRoutes(
  options: ScheduleRouteOptions,
): Hono<ApiEnv> {
  const schedule = new Hono<ApiEnv>();
  const { store, events, decisions, schedule: scheduleStore } = options;
  const deps = {
    schedule: scheduleStore,
    events,
    decisions,
    auth: store,
  };

  /**
   * GET /:eventId/schedule — Schedule.List
   * Query: view? = list|day|week|track|room
   * Role: admin (schedule:read maps to admin membership in dogfood)
   */
  schedule.get(
    "/:eventId/schedule",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const viewRaw = c.req.query("view");
      let view: string | undefined;
      if (viewRaw) {
        const parsedView = ScheduleViewSchema.safeParse(viewRaw);
        if (!parsedView.success) {
          return c.json(
            errorEnvelope("Invalid view filter", VALIDATION_ERROR, {
              view: viewRaw,
            }),
            400,
          );
        }
        view = parsedView.data;
      }

      const result = await listSchedule(deps, { eventId, view });
      if (!result.ok) {
        return commandError(c, result);
      }

      const out = ScheduleListResponseSchema.safeParse(result.value);
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
   * POST /:eventId/schedule/place — Schedule.Place
   * Role: admin only (evaluator cannot schedule write — B06)
   */
  schedule.post(
    "/:eventId/schedule/place",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
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

      const parsed = SchedulePlaceBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await placeSession(deps, {
        ...parsed.data,
        eventId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = SchedulePlaceResponseSchema.safeParse({
        ok: true as const,
        placement: result.value.placement,
      });
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
   * POST /:eventId/schedule/move — Schedule.Move
   */
  schedule.post(
    "/:eventId/schedule/move",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
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

      const parsed = ScheduleMoveBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await movePlacement(deps, {
        ...parsed.data,
        eventId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = ScheduleMoveResponseSchema.safeParse({
        ok: true as const,
        placement: result.value.placement,
      });
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
   * POST /:eventId/schedule/unschedule — Schedule.Unschedule
   */
  schedule.post(
    "/:eventId/schedule/unschedule",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
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

      const parsed = ScheduleUnscheduleBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await unschedulePlacement(deps, {
        ...parsed.data,
        eventId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = ScheduleUnscheduleResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  return schedule;
}
