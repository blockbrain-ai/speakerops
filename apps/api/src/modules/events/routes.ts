/**
 * Events HTTP routes — COMMANDS.md map (section 2.2 role gate for Event.List).
 *
 * GET /api/events → Event.List (admin)
 *
 * Full Event.Create/Update land in later sections; 2.2 enforces requireRole
 * and returns events derived from admin memberships.
 */
import { Hono } from "hono";
import {
  EventListResponseSchema,
  errorEnvelope,
  INTERNAL_ERROR,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import { requireRole } from "../../middleware/authz.js";

export type EventsRouteOptions = {
  store: AuthStore;
};

export function createEventsRoutes(options: EventsRouteOptions): Hono<ApiEnv> {
  const events = new Hono<ApiEnv>();
  const { store } = options;

  /**
   * GET /api/events — Event.List
   * Role: admin (any event membership with role admin)
   * Unauthenticated → 401; speaker/evaluator without admin → 403
   */
  events.get(
    "/",
    requireRole(store, ["admin"], { eventIdFrom: "none" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
      }

      const memberships = await store.listMembershipsForUser(user.id);
      const adminEvents = memberships
        .filter((m) => m.role === "admin")
        .map((m) => ({
          id: m.eventId,
          name: m.eventId,
        }));

      const payload = { events: adminEvents };
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

  return events;
}
