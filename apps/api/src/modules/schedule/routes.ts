/**
 * Schedule HTTP routes — COMMANDS.md map (section 2.2 role gate for Schedule.Place).
 *
 * POST /api/events/:eventId/schedule/place → Schedule.Place
 *
 * Full conflict engine is section 6.1. This module enforces:
 * - Zod body validation (E4)
 * - requireRole(['admin']) on eventId
 * - cross-event isolation 404 when no membership
 * - evaluator/speaker → 403
 * - audit_events on successful place stub
 */
import { Hono } from "hono";
import {
  SchedulePlaceBodySchema,
  SchedulePlaceResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  uuidv7,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import { requireRole } from "../../middleware/authz.js";

export type ScheduleRouteOptions = {
  store: AuthStore;
};

export function createScheduleRoutes(
  options: ScheduleRouteOptions,
): Hono<ApiEnv> {
  const schedule = new Hono<ApiEnv>();
  const { store } = options;

  /**
   * POST /api/events/:eventId/schedule/place — Schedule.Place
   * Role: admin only (evaluator cannot schedule write — B06)
   */
  schedule.post(
    "/:eventId/schedule/place",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
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

      const user = c.get("user");
      const correlationId = c.get("correlationId");
      const placementId = uuidv7();
      const body = parsed.data;

      const response = {
        ok: true as const,
        placement: {
          id: placementId,
          eventId,
          sessionId: body.sessionId,
          roomId: body.roomId,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          version: 1,
        },
      };

      const out = SchedulePlaceResponseSchema.safeParse(response);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }

      // Consequential write audit (stub placement until 6.1 engine)
      await store.insertAudit({
        id: uuidv7(),
        eventId,
        actorType: "user",
        actorId: user?.id ?? "unknown",
        action: "Schedule.Place",
        entityType: "schedule_placement",
        entityId: placementId,
        afterJson: JSON.stringify({
          sessionId: body.sessionId,
          roomId: body.roomId,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
        }),
        correlationId,
        createdAt: new Date().toISOString(),
      });

      return c.json(out.data, 200);
    },
  );

  return schedule;
}
