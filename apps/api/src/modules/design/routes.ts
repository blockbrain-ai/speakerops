/**
 * Design Kit HTTP routes (section 2.4).
 *
 * GET  /api/events/:eventId/design           → Design.Get
 * PUT  /api/events/:eventId/design           → Design.SetDraft
 * POST /api/events/:eventId/design/publish   → Design.Publish
 * GET  /api/public/design/:slug              → public published tokens only
 * GET  /api/public/files/:fileId             → File.GetPublic (logo published only)
 *
 * File.PresignUpload / Upload / CompleteUpload live in modules/files (2.4 + 4.2).
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  DesignGetResponseSchema,
  DesignSetDraftBodySchema,
  DesignSetDraftResponseSchema,
  DesignPublishBodySchema,
  DesignPublishResponseSchema,
  PublicDesignResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  CONFLICT,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { DesignStore } from "./store.js";
import type { KeysStore } from "../keys/store.js";
import { requireRole, actorFromContext } from "../../middleware/authz.js";
import {
  getDesign,
  setDesignDraft,
  publishDesign,
  getPublicDesign,
  getPublicFileBytes,
} from "./commands.js";

/** Re-export file routes from 4.2 module so composition root can stay stable. */
export { createFileRoutes } from "../files/routes.js";

export type DesignRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  design: DesignStore;
  /** When set, Bearer design:read|write accepted (7.2 CLI03–CLI05). */
  keys?: KeysStore;
};

function commandError(
  c: Context<ApiEnv>,
  err: { status: 400 | 404 | 409; error: string; code: string; details?: unknown },
) {
  const code: ErrorCode =
    err.code === "CONFLICT"
      ? CONFLICT
      : err.code === "NOT_FOUND"
        ? NOT_FOUND
        : err.code === "CONTRAST_FAILED"
          ? "CONTRAST_FAILED"
          : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

/**
 * Admin design routes mounted under /api/events
 * Paths: /:eventId/design, /:eventId/design/publish
 */
export function createDesignRoutes(options: DesignRouteOptions): Hono<ApiEnv> {
  const design = new Hono<ApiEnv>();
  const { store, events, design: designStore, keys } = options;
  const deps = { design: designStore, events, auth: store };
  const bearerRead = keys
    ? { keysStore: keys, bearerScopes: ["design:read", "design:write"] as const }
    : {};
  const bearerWrite = keys
    ? { keysStore: keys, bearerScopes: ["design:write"] as const }
    : {};

  /**
   * GET /:eventId/design — Design.Get (admin)
   * Bearer: design:read or design:write (7.2 CLI03)
   */
  design.get(
    "/:eventId/design",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerRead }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const result = await getDesign(deps, eventId);
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = DesignGetResponseSchema.safeParse(result.value);
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
   * PUT /:eventId/design — Design.SetDraft (admin)
   * Bearer: design:write (7.2 CLI04)
   */
  design.put(
    "/:eventId/design",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerWrite }),
    async (c) => {
      const actor = actorFromContext(c);
      if (!actor) {
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

      const parsed = DesignSetDraftBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await setDesignDraft(deps, {
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

      const out = DesignSetDraftResponseSchema.safeParse(result.value);
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
   * POST /:eventId/design/publish — Design.Publish (admin, contrast gate)
   * Bearer: design:write (7.2 CLI05)
   */
  design.post(
    "/:eventId/design/publish",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerWrite }),
    async (c) => {
      const actor = actorFromContext(c);
      if (!actor) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }

      const eventId = c.req.param("eventId");
      let raw: unknown = {};
      try {
        const text = await c.req.text();
        if (text.trim().length > 0) {
          raw = JSON.parse(text) as unknown;
        }
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = DesignPublishBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await publishDesign(deps, {
        eventId,
        expectedVersion: parsed.data.expectedVersion,
        actorUserId: actor.userId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = DesignPublishResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  return design;
}

/**
 * Public design route — published tokens only.
 * Mounted at /api/public
 */
export function createPublicDesignRoutes(
  options: DesignRouteOptions,
): Hono<ApiEnv> {
  const pub = new Hono<ApiEnv>();
  const deps = {
    design: options.design,
    events: options.events,
    auth: options.store,
  };

  /**
   * GET /design/:slug — public published design (no auth).
   * Never returns draft (C10).
   */
  pub.get("/design/:slug", async (c) => {
    const slug = c.req.param("slug");
    const result = await getPublicDesign(deps, slug);
    if (!result.ok) {
      return commandError(c, result);
    }
    const out = PublicDesignResponseSchema.safeParse(result.value);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200);
  });

  /**
   * GET /design/:slug/css — CSS variables only (text/css) for optional link tag.
   */
  pub.get("/design/:slug/css", async (c) => {
    const slug = c.req.param("slug");
    const result = await getPublicDesign(deps, slug);
    if (!result.ok) {
      return commandError(c, result);
    }
    const vars = result.value.cssVariables;
    if (!vars) {
      // Empty published set — emit Lumen defaults comment only
      return c.body(
        "/* no published design tokens */\n:root { }\n",
        200,
        { "content-type": "text/css; charset=utf-8" },
      );
    }
    return c.body(
      `:root { ${vars}; }\n`,
      200,
      { "content-type": "text/css; charset=utf-8" },
    );
  });

  /**
   * GET /files/:fileId — File.GetPublic (published design logo only).
   * Used by public CFP <img src> for logoFileId field flow (C04).
   */
  pub.get("/files/:fileId", async (c) => {
    const fileId = c.req.param("fileId");
    const result = await getPublicFileBytes(deps, fileId);
    if (!result.ok) {
      return commandError(c, result);
    }
    return new Response(result.value.bytes, {
      status: 200,
      headers: {
        "content-type": result.value.mime,
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  });

  return pub;
}
