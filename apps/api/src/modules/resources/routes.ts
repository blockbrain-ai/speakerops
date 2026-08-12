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
import { requireRole, requireSession } from "../../middleware/authz.js";
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
  const { store, resources } = options;

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
    const rows = await resources.listFileRequests(eventId);
    return c.json(
      {
        fileRequests: rows
          .filter((r) => r.status === "published")
          .map((r) => ({
            id: r.id,
            title: r.title,
            instructions: r.instructions,
            purpose: r.purpose,
            updatedAt: r.updatedAt,
          })),
      },
      200,
    );
  });

  return app;
}
