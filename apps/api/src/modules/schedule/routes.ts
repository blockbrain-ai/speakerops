/**
 * Schedule HTTP routes — COMMANDS.md map (section 2.2 role gate for Schedule.Place).
 *
 * POST /api/events/:eventId/schedule/place → Schedule.Place
 *
 * Full conflict engine + D1 schedule_placements persistence is section 6.1.
 * This module enforces only:
 * - Zod body validation (E4)
 * - requireRole(['admin']) on eventId
 * - cross-event isolation 404 when no membership
 * - evaluator/speaker → 403
 *
 * Admin callers that pass the guard receive 501 NOT_IMPLEMENTED — not a fake
 * 200 placement that is immediately lost (no D1 write, no misleading success).
 */
import { Hono } from "hono";
import {
  SchedulePlaceBodySchema,
  errorEnvelope,
  VALIDATION_ERROR,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import { requireRole } from "../../middleware/authz.js";

export type ScheduleRouteOptions = {
  store: AuthStore;
};

/** Machine-readable code for deferred Schedule.Place persistence (6.1). */
export const NOT_IMPLEMENTED = "NOT_IMPLEMENTED" as const;

export function createScheduleRoutes(
  options: ScheduleRouteOptions,
): Hono<ApiEnv> {
  const schedule = new Hono<ApiEnv>();
  const { store } = options;

  /**
   * POST /api/events/:eventId/schedule/place — Schedule.Place
   * Role: admin only (evaluator cannot schedule write — B06)
   *
   * After authz + validation: 501 until schedule placements are D1-backed (6.1).
   */
  schedule.post(
    "/:eventId/schedule/place",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
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

      // Guard passed. Do not invent a placement or audit a non-write.
      return c.json(
        errorEnvelope(
          "Schedule.Place persistence is not implemented until section 6.1",
          NOT_IMPLEMENTED,
          { section: "6.1" },
        ),
        501,
      );
    },
  );

  return schedule;
}
