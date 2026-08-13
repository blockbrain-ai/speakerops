/**
 * F7 / P11 programme routes.
 *
 * POST /api/events/:eventId/programme/publish
 * GET  /api/events/:eventId/programme/status
 * GET  /api/public/programme/:slug
 */
import { Hono, type Context } from "hono";
import {
  PublicProgrammeResponseSchema,
  ProgrammePublishResponseSchema,
  ProgrammeStatusResponseSchema,
  errorEnvelope,
  NOT_FOUND,
  FORBIDDEN,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import { requireRole } from "../../middleware/authz.js";
import type { ProgrammeCommandDeps } from "./commands.js";
import {
  getPublicProgramme,
  publishProgramme,
  getProgrammeStatus,
} from "./commands.js";

export type ProgrammeRouteOptions = ProgrammeCommandDeps & {
  store: AuthStore;
};

function commandError(
  c: Context<ApiEnv>,
  err: { status: 400 | 403 | 404; error: string; code: string },
) {
  const code: ErrorCode =
    err.code === "NOT_FOUND"
      ? NOT_FOUND
      : err.code === "FORBIDDEN"
        ? FORBIDDEN
        : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code), err.status);
}

export function createEventProgrammeRoutes(opts: ProgrammeRouteOptions) {
  const app = new Hono<ApiEnv>();
  const { store, ...deps } = opts;

  app.get(
    "/:eventId/programme/status",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const result = await getProgrammeStatus(deps, eventId);
      if (!result.ok) return commandError(c, result);
      return c.json(ProgrammeStatusResponseSchema.parse(result.value), 200);
    },
  );

  app.post(
    "/:eventId/programme/publish",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const user = c.get("user");
      if (!user?.id) {
        return c.json(errorEnvelope("Unauthorized", FORBIDDEN), 403);
      }
      const result = await publishProgramme(deps, {
        eventId,
        userId: user.id,
        correlationId: c.get("correlationId"),
      });
      if (!result.ok) return commandError(c, result);
      return c.json(ProgrammePublishResponseSchema.parse(result.value), 200);
    },
  );

  return app;
}

export function createPublicProgrammeRoutes(opts: ProgrammeCommandDeps) {
  const app = new Hono<ApiEnv>();

  app.get("/programme/:slug", async (c) => {
    const slug = c.req.param("slug");
    const result = await getPublicProgramme(opts, slug);
    if (!result.ok) return commandError(c, result);
    c.header("cache-control", "public, max-age=60");
    return c.json(PublicProgrammeResponseSchema.parse(result.value), 200);
  });

  return app;
}
