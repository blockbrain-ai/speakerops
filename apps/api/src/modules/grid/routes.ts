/**
 * Saved views HTTP routes (F3).
 *
 * GET    /api/events/:eventId/saved-views?surface=submissions
 * POST   /api/events/:eventId/saved-views
 * PATCH  /api/events/:eventId/saved-views/:viewId
 * DELETE /api/events/:eventId/saved-views/:viewId
 */
import { Hono, type Context } from "hono";
import {
  SavedViewCreateBodySchema,
  SavedViewUpdateBodySchema,
  SavedViewListResponseSchema,
  SavedViewResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  NOT_FOUND,
  FORBIDDEN,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import { requireRole } from "../../middleware/authz.js";
import type { SavedViewsStore } from "./store.js";
import {
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
} from "./commands.js";

export type GridRouteOptions = {
  store: AuthStore;
  savedViews: SavedViewsStore;
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
    err.code === "NOT_FOUND"
      ? NOT_FOUND
      : err.code === "FORBIDDEN"
        ? FORBIDDEN
        : err.code === "VALIDATION_ERROR"
          ? VALIDATION_ERROR
          : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

function actorUserId(c: Context<ApiEnv>): string | null {
  const user = c.get("user");
  return user?.id ?? null;
}

export function createEventGridRoutes(opts: GridRouteOptions) {
  const app = new Hono<ApiEnv>();
  const { store, savedViews } = opts;

  app.get(
    "/:eventId/saved-views",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const userId = actorUserId(c);
      if (!userId) {
        return c.json(errorEnvelope("Unauthorized", FORBIDDEN), 403);
      }
      const surface = c.req.query("surface") ?? "submissions";
      const result = await listSavedViews(savedViews, {
        userId,
        eventId,
        surface,
      });
      if (!result.ok) return commandError(c, result);
      return c.json(
        SavedViewListResponseSchema.parse(result.value),
        200,
      );
    },
  );

  app.post(
    "/:eventId/saved-views",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const userId = actorUserId(c);
      if (!userId) {
        return c.json(errorEnvelope("Unauthorized", FORBIDDEN), 403);
      }
      const surface = c.req.query("surface") ?? "submissions";
      const bodyRaw: unknown = await c.req.json().catch(() => null);
      const body = SavedViewCreateBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope("Invalid body", VALIDATION_ERROR, {
            issues: body.error.flatten(),
          }),
          400,
        );
      }
      const result = await createSavedView(savedViews, {
        userId,
        eventId,
        surface,
        name: body.data.name,
        definition: body.data.definition,
        isDefault: body.data.isDefault,
      });
      if (!result.ok) return commandError(c, result);
      return c.json(SavedViewResponseSchema.parse(result.value), 201);
    },
  );

  app.patch(
    "/:eventId/saved-views/:viewId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const userId = actorUserId(c);
      if (!userId) {
        return c.json(errorEnvelope("Unauthorized", FORBIDDEN), 403);
      }
      const eventId = c.req.param("eventId");
      const viewId = c.req.param("viewId");
      // Surface defaults to submissions; must match the row scope on mutation.
      const surface = c.req.query("surface") ?? "submissions";
      const bodyRaw: unknown = await c.req.json().catch(() => null);
      const body = SavedViewUpdateBodySchema.safeParse(bodyRaw);
      if (!body.success) {
        return c.json(
          errorEnvelope("Invalid body", VALIDATION_ERROR, {
            issues: body.error.flatten(),
          }),
          400,
        );
      }
      const result = await updateSavedView(savedViews, {
        id: viewId,
        userId,
        eventId,
        surface,
        name: body.data.name,
        definition: body.data.definition,
        isDefault: body.data.isDefault,
        expectedVersion: body.data.expectedVersion,
      });
      if (!result.ok) return commandError(c, result);
      return c.json(SavedViewResponseSchema.parse(result.value), 200);
    },
  );

  app.delete(
    "/:eventId/saved-views/:viewId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const userId = actorUserId(c);
      if (!userId) {
        return c.json(errorEnvelope("Unauthorized", FORBIDDEN), 403);
      }
      const eventId = c.req.param("eventId");
      const viewId = c.req.param("viewId");
      const surface = c.req.query("surface") ?? "submissions";
      const result = await deleteSavedView(savedViews, {
        id: viewId,
        userId,
        eventId,
        surface,
      });
      if (!result.ok) return commandError(c, result);
      return c.json({ deleted: true }, 200);
    },
  );

  return app;
}
