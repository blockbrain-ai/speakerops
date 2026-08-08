/**
 * File HTTP routes — section 2.4 logo + section 4.2 portal headshot/slides.
 *
 * POST /api/files/presign              → File.PresignUpload
 * PUT  /api/files/:fileId/upload       → File.Upload
 * POST /api/files/:fileId/complete     → File.CompleteUpload
 * GET  /api/public/files/:fileId       → File.GetPublic (logo published only)
 *
 * Private headshot/slides are never public; download requires auth (via
 * admin/portal metadata + Upload path). Public GET of non-logo → 404.
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  FilePresignBodySchema,
  FilePresignResponseSchema,
  FileUploadResponseSchema,
  FileCompleteBodySchema,
  FileCompleteResponseSchema,
  FILE_UPLOAD_MAX_BYTES,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  FORBIDDEN,
  type ErrorCode,
  type EventRole,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { DesignStore } from "../design/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import { requireRole, requireSession } from "../../middleware/authz.js";
import {
  presignFileUpload,
  uploadFileBytes,
  completeFileUpload,
  rolesForFilePurpose,
} from "./commands.js";
import { resolveOwnParticipations } from "../portal/commands.js";

export type FileRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  design: DesignStore;
  decisions: DecisionsStore;
  submissions: SubmissionsStore;
};

function commandError(
  c: Context<ApiEnv>,
  result: {
    status: 400 | 404 | 409;
    error: string;
    code: string;
    details?: unknown;
  },
) {
  return c.json(
    errorEnvelope(result.error, result.code as ErrorCode, result.details),
    result.status,
  );
}

/**
 * Speakers may only act on files owned by their own participation (same event).
 * Admins may act on any file in the event.
 */
async function assertSpeakerOwnsFile(
  options: {
    store: AuthStore;
    events: EventsStore;
    decisions: DecisionsStore;
    submissions: SubmissionsStore;
  },
  input: {
    eventId: string;
    ownerParticipationId: string | null;
    userId: string;
    userEmail: string;
    role: string;
    correlationId?: string;
  },
): Promise<{ ok: true } | { ok: false; status: 403; error: string }> {
  if (input.role === "admin") return { ok: true };
  if (!input.ownerParticipationId) {
    return {
      ok: false,
      status: 403,
      error: "File is not associated with a speaker participation",
    };
  }
  const own = await resolveOwnParticipations(
    {
      decisions: options.decisions,
      events: options.events,
      auth: options.store,
      submissions: options.submissions,
    },
    {
      eventId: input.eventId,
      userId: input.userId,
      userEmail: input.userEmail,
      correlationId: input.correlationId,
    },
  );
  if (!own.some((p) => p.id === input.ownerParticipationId)) {
    return {
      ok: false,
      status: 403,
      error: "Cannot upload or complete another speaker's file",
    };
  }
  return { ok: true };
}

/**
 * File routes — File.PresignUpload / Upload / CompleteUpload.
 * Mounted at /api/files
 */
export function createFileRoutes(options: FileRouteOptions): Hono<ApiEnv> {
  const files = new Hono<ApiEnv>();
  const {
    store,
    events,
    design: designStore,
    decisions,
    submissions,
  } = options;
  const deps = { design: designStore, events, auth: store };
  const portalDeps = {
    decisions,
    events,
    auth: store,
    submissions,
    design: designStore,
  };

  /**
   * POST /presign — File.PresignUpload
   * Session required; event membership + purpose-scoped roles (E2).
   * logo → admin; headshot|slides → speaker|admin (must own participation).
   */
  files.post("/presign", requireSession(store), async (c) => {
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
      return c.json(errorEnvelope("Invalid JSON body", VALIDATION_ERROR), 400);
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

    const membership = await store.findMembership(
      parsed.data.eventId,
      user.id,
    );
    if (!membership) {
      return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
    }

    const allowed = rolesForFilePurpose(parsed.data.purpose);
    if (!(allowed as readonly string[]).includes(membership.role)) {
      return c.json(
        errorEnvelope("Insufficient role", FORBIDDEN, {
          required: [...allowed],
          role: membership.role,
          purpose: parsed.data.purpose,
        }),
        403,
      );
    }

    const correlationId =
      c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";

    // Bind headshot/slides to a participation; logo has no owner.
    if (
      parsed.data.purpose === "headshot" ||
      parsed.data.purpose === "slides"
    ) {
      const ownerId = parsed.data.ownerParticipationId?.trim();
      if (!ownerId) {
        return c.json(
          errorEnvelope(
            "ownerParticipationId is required for headshot and slides uploads",
            VALIDATION_ERROR,
            { purpose: parsed.data.purpose },
          ),
          400,
        );
      }
      const part = await decisions.findParticipationById(ownerId);
      if (!part || part.eventId !== parsed.data.eventId) {
        return c.json(
          errorEnvelope(
            "ownerParticipationId must be a participation in this event",
            VALIDATION_ERROR,
            { ownerParticipationId: ownerId },
          ),
          400,
        );
      }
      if (membership.role === "speaker") {
        const own = await resolveOwnParticipations(portalDeps, {
          eventId: parsed.data.eventId,
          userId: user.id,
          userEmail: user.email,
          correlationId,
        });
        if (!own.some((p) => p.id === ownerId)) {
          return c.json(
            errorEnvelope(
              "Cannot presign upload for another speaker's participation",
              FORBIDDEN,
            ),
            403,
          );
        }
      }
    }

    const result = await presignFileUpload(deps, {
      ...parsed.data,
      actorUserId: user.id,
      correlationId,
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
  });

  /**
   * PUT /:fileId/upload?eventId= — File.Upload
   * Session + membership; role must match file purpose (logo admin; portal speaker|admin).
   * Speakers may only upload files owned by their own participation.
   */
  files.put("/:fileId/upload", requireSession(store), async (c) => {
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

    // Load file for purpose-scoped role before buffering body
    const existing = await designStore.findFile(eventId, fileId);
    if (!existing) {
      return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
    }
    const allowed = rolesForFilePurpose(existing.purpose);
    if (!(allowed as readonly string[]).includes(membership.role)) {
      return c.json(
        errorEnvelope("Insufficient role", FORBIDDEN, {
          required: [...allowed],
          role: membership.role,
          purpose: existing.purpose,
        }),
        403,
      );
    }

    if (
      existing.purpose === "headshot" ||
      existing.purpose === "slides"
    ) {
      const ownership = await assertSpeakerOwnsFile(
        { store, events, decisions, submissions },
        {
          eventId,
          ownerParticipationId: existing.ownerParticipationId,
          userId: user.id,
          userEmail: user.email,
          role: membership.role,
          correlationId: c.get("correlationId"),
        },
      );
      if (!ownership.ok) {
        return c.json(errorEnvelope(ownership.error, FORBIDDEN), 403);
      }
    }

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
  });

  /**
   * POST /:fileId/complete — File.CompleteUpload
   * Session + speaker|admin on file's event; sets checksum metadata.
   * Speakers may only complete files owned by their own participation.
   */
  files.post(
    "/:fileId/complete",
    requireRole(store, ["speaker", "admin"] as EventRole[], {
      eventIdFrom: "none",
    }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }

      const fileId = c.req.param("fileId");

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = FileCompleteBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      // Resolve event from body or file row for membership check
      let eventId = parsed.data.eventId;
      const row = await designStore.findFileById(fileId);
      if (!eventId) {
        eventId = row?.eventId;
      }
      if (eventId) {
        const membership = await store.findMembership(eventId, user.id);
        if (!membership) {
          return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
        }
        if (membership.role !== "admin" && membership.role !== "speaker") {
          return c.json(
            errorEnvelope("Insufficient role", FORBIDDEN, {
              required: ["admin", "speaker"],
              role: membership.role,
            }),
            403,
          );
        }
        if (
          row &&
          (row.purpose === "headshot" || row.purpose === "slides")
        ) {
          const ownership = await assertSpeakerOwnsFile(
            { store, events, decisions, submissions },
            {
              eventId,
              ownerParticipationId: row.ownerParticipationId,
              userId: user.id,
              userEmail: user.email,
              role: membership.role,
              correlationId: c.get("correlationId"),
            },
          );
          if (!ownership.ok) {
            return c.json(errorEnvelope(ownership.error, FORBIDDEN), 403);
          }
        }
      }

      const result = await completeFileUpload(deps, {
        ...parsed.data,
        fileId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = FileCompleteResponseSchema.safeParse(result.value);
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
