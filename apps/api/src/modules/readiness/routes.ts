/**
 * Reports.Readiness HTTP route (section 6.3 / S-READY).
 *
 * GET /api/events/:eventId/readiness → Reports.Readiness
 * Query: overdueOnly? (true|1)
 *
 * Role: admin (evaluator/speaker → 403; no membership → 404).
 * Scope (later keys): reports:read.
 * Zod + E4 envelopes; no stack traces on 500.
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  ReportsReadinessQuerySchema,
  ReportsReadinessResponseSchema,
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
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import { requireRole } from "../../middleware/authz.js";
import { getReadiness } from "./commands.js";

export type ReadinessRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  submissions: SubmissionsStore;
  decisions: DecisionsStore;
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
 * Mount under /api/events — path /:eventId/readiness
 */
export function createReadinessRoutes(
  options: ReadinessRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, decisions } = options;
  const deps = { decisions, events, auth: store, submissions };

  /**
   * GET /:eventId/readiness — Reports.Readiness (H01–H05 live poll)
   */
  app.get(
    "/:eventId/readiness",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const q = ReportsReadinessQuerySchema.safeParse({
        overdueOnly: c.req.query("overdueOnly") ?? undefined,
      });
      if (!q.success) {
        return c.json(
          errorEnvelope("Invalid query", VALIDATION_ERROR, q.error.flatten()),
          400,
        );
      }

      const result = await getReadiness(deps, {
        eventId,
        overdueOnly: q.data.overdueOnly,
      });
      if (!result.ok) return commandError(c, result);

      const parsed = ReportsReadinessResponseSchema.safeParse(result.value);
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
