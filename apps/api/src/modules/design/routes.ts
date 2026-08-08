/**
 * Design Kit + logo presign HTTP routes (section 2.4).
 *
 * GET  /api/events/:eventId/design           → Design.Get
 * PUT  /api/events/:eventId/design           → Design.SetDraft
 * POST /api/events/:eventId/design/publish   → Design.Publish
 * GET  /api/public/design/:slug              → public published tokens only
 * POST /api/files/presign                    → File.PresignUpload (logo PNG)
 * PUT  /api/files/:fileId/upload             → File.Upload
 * GET  /api/public/files/:fileId             → File.GetPublic
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
  FilePresignBodySchema,
  FilePresignResponseSchema,
  FileUploadResponseSchema,
  FILE_UPLOAD_MAX_BYTES,
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
import { requireRole } from "../../middleware/authz.js";
import {
  getDesign,
  setDesignDraft,
  publishDesign,
  getPublicDesign,
  presignFileUpload,
  uploadFileBytes,
  getPublicFileBytes,
} from "./commands.js";

export type DesignRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  design: DesignStore;
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
  const { store, events, design: designStore } = options;
  const deps = { design: designStore, events, auth: store };

  /**
   * GET /:eventId/design — Design.Get (admin)
   */
  design.get(
    "/:eventId/design",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
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
   */
  design.put(
    "/:eventId/design",
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
        actorUserId: user.id,
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
   */
  design.post(
    "/:eventId/design/publish",
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
        actorUserId: user.id,
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

/**
 * File routes — File.PresignUpload for logo.
 * Mounted at /api/files
 */
export function createFileRoutes(options: DesignRouteOptions): Hono<ApiEnv> {
  const files = new Hono<ApiEnv>();
  const { store, events, design: designStore } = options;
  const deps = { design: designStore, events, auth: store };

  /**
   * POST /presign — File.PresignUpload
   * Session required; event membership checked against body.eventId (E2).
   */
  files.post(
    "/presign",
    requireRole(store, ["admin"], { eventIdFrom: "none" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = FilePresignBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      // Event-scoped membership for body.eventId (cross-event → 404)
      const membership = await store.findMembership(
        parsed.data.eventId,
        user.id,
      );
      if (!membership) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      if (membership.role !== "admin") {
        return c.json(
          errorEnvelope("Insufficient role", "FORBIDDEN", {
            required: ["admin"],
            role: membership.role,
          }),
          403,
        );
      }

      const result = await presignFileUpload(deps, {
        ...parsed.data,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = FilePresignResponseSchema.safeParse(result.value);
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
   * PUT /:fileId/upload?eventId= — File.Upload
   * Accept PNG body for a prior File.PresignUpload (session + admin on eventId).
   * Rejects oversized Content-Length before buffering the body (Worker memory).
   */
  files.put(
    "/:fileId/upload",
    requireRole(store, ["admin"], { eventIdFrom: "none" }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }

      const fileId = c.req.param("fileId");
      const eventId = c.req.query("eventId");
      if (!eventId || eventId.trim().length === 0) {
        return c.json(
          errorEnvelope("eventId query parameter is required", VALIDATION_ERROR),
          400,
        );
      }

      const membership = await store.findMembership(eventId, user.id);
      if (!membership) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      if (membership.role !== "admin") {
        return c.json(
          errorEnvelope("Insufficient role", "FORBIDDEN", {
            required: ["admin"],
            role: membership.role,
          }),
          403,
        );
      }

      // Bound memory: refuse Content-Length above global max before arrayBuffer().
      const contentLengthHeader = c.req.header("content-length");
      if (contentLengthHeader !== undefined && contentLengthHeader !== "") {
        const contentLength = Number(contentLengthHeader);
        if (!Number.isFinite(contentLength) || contentLength < 0) {
          return c.json(
            errorEnvelope("Invalid Content-Length", VALIDATION_ERROR),
            400,
          );
        }
        if (contentLength > FILE_UPLOAD_MAX_BYTES) {
          return c.json(
            errorEnvelope("Upload exceeds maximum size", VALIDATION_ERROR, {
              max: FILE_UPLOAD_MAX_BYTES,
              contentLength,
            }),
            400,
          );
        }
        if (contentLength === 0) {
          return c.json(
            errorEnvelope("Empty upload body", VALIDATION_ERROR),
            400,
          );
        }
      }

      const body = await c.req.arrayBuffer();
      // Post-read guard when Content-Length was absent or lying.
      if (body.byteLength > FILE_UPLOAD_MAX_BYTES) {
        return c.json(
          errorEnvelope("Upload exceeds maximum size", VALIDATION_ERROR, {
            max: FILE_UPLOAD_MAX_BYTES,
            actual: body.byteLength,
          }),
          400,
        );
      }

      const result = await uploadFileBytes(deps, {
        eventId,
        fileId,
        body,
        contentType: c.req.header("content-type") ?? undefined,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }
      const out = FileUploadResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  return files;
}
