/**
 * N2 resources + N3 file requests admin routes under /api/events.
 */
import { Hono } from "hono";
import {
  errorEnvelope,
  VALIDATION_ERROR,
  NOT_FOUND,
  CONFLICT,
  FORBIDDEN,
  uuidv7,
} from "@speakerops/shared";
import { z } from "zod";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import {
  FILE_UPLOAD_STORED,
  type DesignStore,
} from "../design/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import { requireRole, requireSession } from "../../middleware/authz.js";
import { resolveOwnParticipations } from "../portal/commands.js";
import type { ResourcesStore } from "./store.js";

const StatusSchema = z.enum(["draft", "published", "archived"]);

const ResourceCreateSchema = z.object({
  title: z.string().min(1).max(200),
  bodyMd: z.string().max(20000).nullable().optional(),
});
const ResourceUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    bodyMd: z.string().max(20000).nullable().optional(),
    status: StatusSchema.optional(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (b) =>
      b.title !== undefined || b.bodyMd !== undefined || b.status !== undefined,
    { message: "At least one field required" },
  );

const FileRequestCreateSchema = z.object({
  title: z.string().min(1).max(200),
  instructions: z.string().max(5000).nullable().optional(),
  purpose: z.enum(["headshot", "slides", "other"]).default("other"),
});
const FileRequestUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    instructions: z.string().max(5000).nullable().optional(),
    purpose: z.enum(["headshot", "slides", "other"]).optional(),
    status: StatusSchema.optional(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (b) =>
      b.title !== undefined ||
      b.instructions !== undefined ||
      b.purpose !== undefined ||
      b.status !== undefined,
    { message: "At least one field required" },
  );

export type ResourcesRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  resources: ResourcesStore;
  /** Optional: required for secure file-request fulfilment (file meta + ownership). */
  design?: DesignStore;
  decisions?: DecisionsStore;
  submissions?: SubmissionsStore;
};

export function createResourcesRoutes(
  options: ResourcesRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, resources } = options;

  app.get(
    "/:eventId/resources",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      if (!(await events.findEventById(eventId))) {
        return c.json(errorEnvelope("Event not found", NOT_FOUND), 404);
      }
      const rows = await resources.listResources(eventId);
      return c.json({ resources: rows }, 200);
    },
  );

  app.post(
    "/:eventId/resources",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      if (!(await events.findEventById(eventId))) {
        return c.json(errorEnvelope("Event not found", NOT_FOUND), 404);
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON", VALIDATION_ERROR), 400);
      }
      const parsed = ResourceCreateSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, parsed.error.flatten()),
          400,
        );
      }
      const now = new Date().toISOString();
      const row = await resources.insertResource({
        id: uuidv7(),
        eventId,
        title: parsed.data.title,
        bodyMd: parsed.data.bodyMd ?? null,
        status: "draft",
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      return c.json({ resource: row }, 201);
    },
  );

  app.patch(
    "/:eventId/resources/:resourceId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const resourceId = c.req.param("resourceId");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON", VALIDATION_ERROR), 400);
      }
      const parsed = ResourceUpdateSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, parsed.error.flatten()),
          400,
        );
      }
      const now = new Date().toISOString();
      const updated = await resources.updateResource(
        eventId,
        resourceId,
        parsed.data.expectedVersion,
        {
          title: parsed.data.title,
          bodyMd: parsed.data.bodyMd,
          status: parsed.data.status,
          updatedAt: now,
        },
      );
      if (!updated) {
        return c.json(errorEnvelope("Version conflict or not found", CONFLICT), 409);
      }
      return c.json({ resource: updated }, 200);
    },
  );

  app.delete(
    "/:eventId/resources/:resourceId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const ok = await resources.deleteResource(
        c.req.param("eventId"),
        c.req.param("resourceId"),
      );
      if (!ok) return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      return c.body(null, 204);
    },
  );

  // N3 file requests
  app.get(
    "/:eventId/file-requests",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      if (!(await events.findEventById(eventId))) {
        return c.json(errorEnvelope("Event not found", NOT_FOUND), 404);
      }
      return c.json(
        { fileRequests: await resources.listFileRequests(eventId) },
        200,
      );
    },
  );

  app.post(
    "/:eventId/file-requests",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      if (!(await events.findEventById(eventId))) {
        return c.json(errorEnvelope("Event not found", NOT_FOUND), 404);
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON", VALIDATION_ERROR), 400);
      }
      const parsed = FileRequestCreateSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, parsed.error.flatten()),
          400,
        );
      }
      const now = new Date().toISOString();
      const row = await resources.insertFileRequest({
        id: uuidv7(),
        eventId,
        title: parsed.data.title,
        instructions: parsed.data.instructions ?? null,
        scope: "participation",
        status: "draft",
        purpose: parsed.data.purpose,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      return c.json({ fileRequest: row }, 201);
    },
  );

  app.patch(
    "/:eventId/file-requests/:requestId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const requestId = c.req.param("requestId");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON", VALIDATION_ERROR), 400);
      }
      const parsed = FileRequestUpdateSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, parsed.error.flatten()),
          400,
        );
      }
      const now = new Date().toISOString();
      const updated = await resources.updateFileRequest(
        eventId,
        requestId,
        parsed.data.expectedVersion,
        {
          title: parsed.data.title,
          instructions: parsed.data.instructions,
          purpose: parsed.data.purpose,
          status: parsed.data.status,
          updatedAt: now,
        },
      );
      if (!updated) {
        return c.json(errorEnvelope("Version conflict or not found", CONFLICT), 409);
      }
      return c.json({ fileRequest: updated }, 200);
    },
  );

  app.delete(
    "/:eventId/file-requests/:requestId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const ok = await resources.deleteFileRequest(
        c.req.param("eventId"),
        c.req.param("requestId"),
      );
      if (!ok) return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      return c.body(null, 204);
    },
  );

  return app;
}

/**
 * Speaker-facing library: published resources + file requests.
 * Mounted at /api/portal
 */
export function createPortalLibraryRoutes(
  options: ResourcesRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, resources, design, decisions, submissions } = options;

  app.get("/resources", requireSession(store), async (c) => {
    const eventId = c.req.query("eventId")?.trim();
    if (!eventId) {
      return c.json(errorEnvelope("eventId query required", VALIDATION_ERROR), 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
    }
    const membership = await store.findMembership(eventId, user.id);
    if (!membership) {
      return c.json(errorEnvelope("Not a member of this event", FORBIDDEN), 403);
    }
    const rows = await resources.listResources(eventId);
    return c.json(
      {
        resources: rows
          .filter((r) => r.status === "published")
          .map((r) => ({
            id: r.id,
            title: r.title,
            bodyMd: r.bodyMd,
            updatedAt: r.updatedAt,
          })),
      },
      200,
    );
  });

  app.get("/file-requests", requireSession(store), async (c) => {
    const eventId = c.req.query("eventId")?.trim();
    if (!eventId) {
      return c.json(errorEnvelope("eventId query required", VALIDATION_ERROR), 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
    }
    const membership = await store.findMembership(eventId, user.id);
    if (!membership || membership.role !== "speaker") {
      return c.json(
        errorEnvelope("Speaker membership required", FORBIDDEN),
        403,
      );
    }
    // Only list fulfilment for the caller's own participation(s) — never
    // accept an arbitrary participationId query (cross-speaker leak).
    let ownPartIds: string[] = [];
    if (decisions && submissions) {
      const own = await resolveOwnParticipations(
        {
          decisions,
          events,
          auth: store,
          submissions,
          design,
        },
        {
          eventId,
          userId: user.id,
          userEmail: user.email,
          correlationId: c.get("correlationId"),
        },
      );
      ownPartIds = own.map((p) => p.id);
    }
    const rows = await resources.listFileRequests(eventId);
    const fulfills =
      ownPartIds.length > 0
        ? (
            await Promise.all(
              ownPartIds.map((pid) =>
                resources.listFulfillments(eventId, { participationId: pid }),
              ),
            )
          ).flat()
        : [];
    const fulfillByRequest = new Map(fulfills.map((f) => [f.requestId, f]));
    return c.json(
      {
        fileRequests: rows
          .filter((r) => r.status === "published")
          .map((r) => {
            const f = fulfillByRequest.get(r.id);
            return {
              id: r.id,
              title: r.title,
              instructions: r.instructions,
              purpose: r.purpose,
              updatedAt: r.updatedAt,
              fulfilled: Boolean(f),
              fileId: f?.fileId ?? null,
            };
          }),
      },
      200,
    );
  });

  const FulfillSchema = z.object({
    eventId: z.string().min(1),
    participationId: z.string().min(1),
    fileId: z.string().min(1),
  });

  /**
   * POST /file-requests/:requestId/fulfill
   * Speaker associates an uploaded file (purpose=other|headshot|slides) with
   * a published file request. Ownership + completed upload enforced.
   */
  app.post(
    "/file-requests/:requestId/fulfill",
    requireSession(store),
    async (c) => {
      const requestId = c.req.param("requestId");
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }
      if (!design || !decisions || !submissions) {
        return c.json(
          errorEnvelope("File fulfilment not configured", "INTERNAL_ERROR"),
          500,
        );
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON body", VALIDATION_ERROR), 400);
      }
      const parsed = FulfillSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }
      const { eventId, participationId, fileId } = parsed.data;
      const membership = await store.findMembership(eventId, user.id);
      if (!membership || membership.role !== "speaker") {
        return c.json(
          errorEnvelope("Speaker membership required", FORBIDDEN),
          403,
        );
      }
      const own = await resolveOwnParticipations(
        {
          decisions,
          events,
          auth: store,
          submissions,
          design,
        },
        {
          eventId,
          userId: user.id,
          userEmail: user.email,
          correlationId: c.get("correlationId"),
        },
      );
      if (!own.some((p) => p.id === participationId)) {
        return c.json(
          errorEnvelope(
            "Cannot fulfil for another speaker's participation",
            FORBIDDEN,
          ),
          403,
        );
      }
      const reqs = await resources.listFileRequests(eventId);
      const req = reqs.find((r) => r.id === requestId);
      if (!req || req.status !== "published") {
        return c.json(errorEnvelope("File request not found", NOT_FOUND), 404);
      }
      const file = await design.findFile(eventId, fileId);
      if (!file) {
        return c.json(errorEnvelope("File not found", NOT_FOUND), 404);
      }
      // A3: only STORED (1) may fulfill — CLAIMED(2)/PENDING(0) rejected.
      const isStored =
        typeof file.uploadState === "number"
          ? file.uploadState === FILE_UPLOAD_STORED
          : Boolean(file.uploaded);
      if (!isStored) {
        return c.json(
          errorEnvelope("File upload is not complete", VALIDATION_ERROR),
          400,
        );
      }
      // Fail-closed ownership: purpose=other must still bind a participation;
      // null owner cannot be claimed by any speaker who knows the fileId.
      if (
        !file.ownerParticipationId ||
        file.ownerParticipationId !== participationId
      ) {
        return c.json(
          errorEnvelope("File is not owned by this participation", FORBIDDEN),
          403,
        );
      }
      // Purpose compatibility: request purpose must match the file purpose,
      // or either side may be "other" for generic library asks.
      if (
        req.purpose !== "other" &&
        file.purpose !== "other" &&
        req.purpose !== file.purpose
      ) {
        return c.json(
          errorEnvelope("File purpose does not match this request", VALIDATION_ERROR, {
            requestPurpose: req.purpose,
            filePurpose: file.purpose,
          }),
          400,
        );
      }
      const now = new Date().toISOString();
      const correlationId =
        c.get("correlationId") ?? c.req.header("x-correlation-id") ?? "unknown";
      const row = await resources.upsertFulfillment({
        id: uuidv7(),
        eventId,
        requestId,
        participationId,
        fileId,
        createdAt: now,
        updatedAt: now,
      });
      await store.insertAudit({
        id: uuidv7(),
        eventId,
        actorType: "user",
        actorId: user.id,
        action: "FileRequest.Fulfill",
        entityType: "file_request",
        entityId: requestId,
        beforeJson: null,
        afterJson: JSON.stringify({
          participationId,
          fileId,
          fulfillmentId: row.id,
        }),
        correlationId,
        createdAt: now,
      });
      return c.json(
        {
          fulfillment: {
            id: row.id,
            requestId: row.requestId,
            participationId: row.participationId,
            fileId: row.fileId,
            updatedAt: row.updatedAt,
          },
        },
        200,
      );
    },
  );

  return app;
}
