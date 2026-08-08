/**
 * Comms HTTP routes — COMMANDS.md map (section 5.1–5.3 / S-COMMS).
 *
 * PUT  /api/events/:eventId/templates/:key → Comms.UpsertTemplate
 * GET  /api/events/:eventId/templates      → Comms.ListTemplates
 * GET  /api/events/:eventId/comms/jobs     → Comms.ListJobs
 * GET  /api/events/:eventId/comms/jobs/:id → Comms.GetJob
 * GET  /api/events/:eventId/comms/ics      → Comms.ListIcs
 * POST /api/events/:eventId/comms/ics      → Comms.IcsForPlacement
 * POST /api/comms/preview                  → Comms.Preview
 * POST /api/comms/send                     → Comms.Send (enqueue; sandbox drain in 5.2)
 *
 * Roles: admin for all (browser maps admin ⊂ scopes).
 * Scope names comms:draft / comms:send apply to API keys (Phase 7); session path uses roles.
 * Send requires previewId + idempotencyKey (J08/J04); provider never called on request path.
 */
import { Hono, type Context } from "hono";
import {
  CommsUpsertTemplateBodySchema,
  CommsUpsertTemplateResponseSchema,
  CommsPreviewBodySchema,
  CommsPreviewResponseSchema,
  CommsSendBodySchema,
  CommsSendResponseSchema,
  CommsListTemplatesResponseSchema,
  CommsListJobsResponseSchema,
  CommsGetJobResponseSchema,
  CommsListIcsResponseSchema,
  CommsIcsForPlacementBodySchema,
  CommsIcsForPlacementResponseSchema,
  TemplateKeySchema,
  COMMS_OUTBOX_TOPIC,
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
import type { CommsStore } from "./store.js";
import type { KeysStore } from "../keys/store.js";
import { requireRole } from "../../middleware/authz.js";
import {
  upsertTemplate,
  previewComms,
  sendComms,
  listTemplates,
  listJobs,
  getJob,
  listIcs,
  icsForPlacementCommand,
} from "./commands.js";

export type CommsRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  submissions: SubmissionsStore;
  decisions: DecisionsStore;
  comms: CommsStore;
  /** When set, Bearer comms:draft|send accepted (7.2 CLI09–CLI10). */
  keys?: KeysStore;
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
 * Event-scoped template routes — mounted at /api/events
 */
export function createEventCommsRoutes(
  options: CommsRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, decisions, comms } = options;
  const deps = { comms, events, auth: store, submissions, decisions };

  /**
   * GET /:eventId/templates — Comms.ListTemplates
   * Role: admin
   */
  app.get(
    "/:eventId/templates",
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
      const result = await listTemplates(deps, { eventId });
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = CommsListTemplatesResponseSchema.safeParse(result.value);
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
   * GET /:eventId/comms/jobs — Comms.ListJobs (delivery log)
   */
  app.get(
    "/:eventId/comms/jobs",
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
      const result = await listJobs(deps, { eventId });
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = CommsListJobsResponseSchema.safeParse(result.value);
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
   * GET /:eventId/comms/jobs/:jobId — Comms.GetJob
   */
  app.get(
    "/:eventId/comms/jobs/:jobId",
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
      const jobId = c.req.param("jobId");
      const result = await getJob(deps, { eventId, jobId });
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = CommsGetJobResponseSchema.safeParse(result.value);
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
   * GET /:eventId/comms/ics — Comms.ListIcs
   */
  app.get(
    "/:eventId/comms/ics",
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
      const result = await listIcs(deps, { eventId });
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = CommsListIcsResponseSchema.safeParse(result.value);
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
   * POST /:eventId/comms/ics — Comms.IcsForPlacement (fixture-friendly for J06/J10)
   */
  app.post(
    "/:eventId/comms/ics",
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
      const parsed = CommsIcsForPlacementBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }
      const result = await icsForPlacementCommand(deps, {
        placement: {
          eventId,
          placementId: parsed.data.placementId,
          sessionId: parsed.data.sessionId ?? null,
          summary: parsed.data.summary,
          startsAt: parsed.data.startsAt,
          endsAt: parsed.data.endsAt,
          location: parsed.data.location ?? null,
          description: parsed.data.description ?? null,
          organizerEmail: parsed.data.organizerEmail ?? null,
          attendeeEmail: parsed.data.attendeeEmail ?? null,
        },
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
        cancel: parsed.data.cancel,
      });
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = CommsIcsForPlacementResponseSchema.safeParse(
        result.value.response,
      );
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      const status = result.value.invite.version === 1 ? 201 : 200;
      return c.json(out.data, status);
    },
  );

  /**
   * PUT /:eventId/templates/:key — Comms.UpsertTemplate
   * Role: admin
   */
  app.put(
    "/:eventId/templates/:key",
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
      const keyRaw = c.req.param("key");
      const keyParsed = TemplateKeySchema.safeParse(keyRaw);
      if (!keyParsed.success) {
        return c.json(
          errorEnvelope("Invalid template key", VALIDATION_ERROR, {
            issues: keyParsed.error.flatten(),
          }),
          400,
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

      const parsed = CommsUpsertTemplateBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await upsertTemplate(deps, {
        eventId,
        key: keyParsed.data,
        body: parsed.data,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = CommsUpsertTemplateResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      // 200 for update, 201 for create (version === 1 and no expectedVersion)
      const status =
        result.value.template.version === 1 &&
        parsed.data.expectedVersion === undefined
          ? 201
          : 200;
      return c.json(out.data, status);
    },
  );

  return app;
}

/**
 * Comms preview/send routes — mounted at /api/comms
 */
export function createCommsRoutes(options: CommsRouteOptions): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, decisions, comms, keys } = options;
  const deps = { comms, events, auth: store, submissions, decisions };
  const bearerDraft = keys
    ? { keysStore: keys, bearerScopes: ["comms:draft"] as const }
    : {};
  const bearerSend = keys
    ? { keysStore: keys, bearerScopes: ["comms:send"] as const }
    : {};

  /**
   * POST /preview — Comms.Preview (comms:draft / admin role)
   * Body carries templateId; event membership checked after load for sessions.
   * Bearer: comms:draft (7.2 CLI09) — scope gate; membership via key createdBy.
   */
  app.post(
    "/preview",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerDraft }),
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

      const parsed = CommsPreviewBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      // Resolve template → event for membership (cross-event isolation)
      const template = await comms.findTemplateById(parsed.data.templateId);
      if (!template) {
        return c.json(errorEnvelope("Template not found", NOT_FOUND), 404);
      }
      const apiKey = c.get("apiKey");
      if (!apiKey) {
        const membership = await store.findMembership(
          template.eventId,
          user.id,
        );
        if (!membership) {
          return c.json(
            errorEnvelope("Not found", NOT_FOUND, { path: c.req.path }),
            404,
          );
        }
        if (membership.role !== "admin") {
          return c.json(
            errorEnvelope("Insufficient role", FORBIDDEN, {
              required: ["admin"],
              role: membership.role,
            }),
            403,
          );
        }
      } else if (apiKey.eventId && apiKey.eventId !== template.eventId) {
        return c.json(
          errorEnvelope("Not found", NOT_FOUND, { path: c.req.path }),
          404,
        );
      }

      const result = await previewComms(deps, {
        body: parsed.data,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = CommsPreviewResponseSchema.safeParse(result.value);
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
   * POST /send — Comms.Send enqueue only (comms:send / admin).
   * Inserts outbox_events; never calls provider HTTP.
   * Bearer: comms:send only (7.2 CLI10 — draft-only key → 403 → exit 2).
   */
  app.post(
    "/send",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerSend }),
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

      const parsed = CommsSendBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const job = await comms.findJobById(parsed.data.previewId);
      if (!job) {
        // Also check idempotent key path later in command
        const byKey = await comms.findJobByIdempotencyKey(
          parsed.data.idempotencyKey,
        );
        if (!byKey) {
          return c.json(errorEnvelope("Preview not found", NOT_FOUND), 404);
        }
      } else {
        const apiKey = c.get("apiKey");
        if (!apiKey) {
          const membership = await store.findMembership(job.eventId, user.id);
          if (!membership) {
            return c.json(
              errorEnvelope("Not found", NOT_FOUND, { path: c.req.path }),
              404,
            );
          }
          if (membership.role !== "admin") {
            return c.json(
              errorEnvelope("Insufficient role", FORBIDDEN, {
                required: ["admin"],
                role: membership.role,
              }),
              403,
            );
          }
        } else if (apiKey.eventId && apiKey.eventId !== job.eventId) {
          return c.json(
            errorEnvelope("Not found", NOT_FOUND, { path: c.req.path }),
            404,
          );
        }
      }

      const result = await sendComms(deps, {
        body: parsed.data,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = CommsSendResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }

      // Kick queue consumer so production drains outbox promptly (E7).
      // Cron scheduled handler is the backup if the kick is unavailable.
      if (result.value.enqueued) {
        const queue = c.env?.JOBS_QUEUE;
        if (queue && typeof queue.send === "function") {
          try {
            await queue.send({
              topic: COMMS_OUTBOX_TOPIC,
              jobId: result.value.job.id,
              eventId: result.value.job.eventId,
              correlationId: c.get("correlationId"),
            });
          } catch {
            // Outbox row is SoR; scheduled drain will pick it up.
          }
        }
      }

      return c.json(out.data, result.value.enqueued ? 201 : 200);
    },
  );

  return app;
}
