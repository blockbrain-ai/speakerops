/**
 * Reports.AirtableStatus HTTP route (section 7.3 / S-AIRTABLE).
 *
 * GET /api/events/:eventId/airtable/status → Reports.AirtableStatus
 *
 * Role: admin (evaluator/speaker → 403; no membership → 404).
 * Scope: airtable:read (Bearer keys).
 * Zod + E4 envelopes; never calls Airtable HTTP on request path (E7).
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  ReportsAirtableStatusResponseSchema,
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
import type { KeysStore } from "../keys/store.js";
import type { AirtableStore } from "./store.js";
import type { AirtableClientEnv } from "./client.js";
import { requireRole } from "../../middleware/authz.js";
import { getAirtableStatus } from "./commands.js";

export type AirtableRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  airtable: AirtableStore;
  /** When set, Bearer airtable:read accepted (7.2 CLI). */
  keys?: KeysStore;
  /** Env names for configured/paused (never secrets in responses). */
  clientEnv?: AirtableClientEnv;
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
 * Mount under /api/events — path /:eventId/airtable/status
 */
export function createAirtableRoutes(
  options: AirtableRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, airtable, keys, clientEnv } = options;
  const deps = { airtable, events, clientEnv };
  const bearer = keys
    ? { keysStore: keys, bearerScopes: ["airtable:read"] as const }
    : {};

  /**
   * GET /:eventId/airtable/status — Reports.AirtableStatus (O06)
   * Bearer: airtable:read
   * Returns lag fields; never performs Airtable HTTP (E7 / S-AIRTABLE).
   */
  app.get(
    "/:eventId/airtable/status",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearer }),
    async (c) => {
      const eventId = c.req.param("eventId");
      if (!eventId || eventId.trim().length === 0) {
        return c.json(
          errorEnvelope("eventId required", VALIDATION_ERROR),
          400,
        );
      }

      // Prefer live Worker bindings when present (configured/paused for O06).
      const envFromBindings: AirtableClientEnv = {
        AIRTABLE_API_KEY: c.env?.AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID: c.env?.AIRTABLE_BASE_ID,
        AIRTABLE_TABLE_SUBMISSIONS: c.env?.AIRTABLE_TABLE_SUBMISSIONS,
        AIRTABLE_TABLE_SPEAKERS: c.env?.AIRTABLE_TABLE_SPEAKERS,
        AIRTABLE_TABLE_SESSIONS: c.env?.AIRTABLE_TABLE_SESSIONS,
        AIRTABLE_TABLE_TASKS: c.env?.AIRTABLE_TABLE_TASKS,
        AIRTABLE_TABLE_SCHEDULE: c.env?.AIRTABLE_TABLE_SCHEDULE,
        AIRTABLE_TABLE_EVENTS: c.env?.AIRTABLE_TABLE_EVENTS,
      };
      const result = await getAirtableStatus(
        {
          ...deps,
          clientEnv: {
            ...clientEnv,
            ...envFromBindings,
          },
        },
        { eventId },
      );
      if (!result.ok) return commandError(c, result);

      const parsed = ReportsAirtableStatusResponseSchema.safeParse(
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

  return app;
}
