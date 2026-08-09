/**
 * Decisions HTTP routes (section 3.5).
 *
 * POST /api/submissions/:submissionId/decision  → Decision.Record
 * GET  /api/submissions/:submissionId           → Submission.Get
 * GET  /api/events/:eventId/submissions         → Submission.List
 * POST /api/events/:eventId/sessions/direct     → Session.CreateDirect
 * POST /api/events/:eventId/submissions/bulk-preview → bulk preview (E08)
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  DecisionRecordBodySchema,
  DecisionRecordResponseSchema,
  DirectSessionBodySchema,
  DirectSessionResponseSchema,
  SubmissionListResponseSchema,
  SubmissionDetailResponseSchema,
  BulkDecisionPreviewBodySchema,
  BulkDecisionPreviewResponseSchema,
  SubmissionStatusSchema,
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
import type { DecisionsStore } from "./store.js";
import { requireRole, actorFromContext } from "../../middleware/authz.js";
import {
  recordDecision,
  createDirectSession,
  listSubmissions,
  getSubmission,
  previewBulkDecision,
} from "./commands.js";

export type DecisionRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  submissions: SubmissionsStore;
  decisions: DecisionsStore;
  /** Bearer decisions:write / submissions:read (COMMANDS.md / CLI 7.2). */
  keys?: import("../keys/store.js").KeysStore;
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
          : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

/**
 * Event-scoped submission list + direct session + bulk preview.
 * Mounted under /api/events
 */
export function createEventDecisionRoutes(
  options: DecisionRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, decisions, keys } = options;
  const deps = {
    decisions,
    events,
    auth: store,
    submissions,
  };
  const bearerRead = keys
    ? {
        keysStore: keys,
        bearerScopes: ["submissions:read", "decisions:write"] as const,
        eventsStore: events,
      }
    : {};
  const bearerWrite = keys
    ? {
        keysStore: keys,
        bearerScopes: ["decisions:write"] as const,
        eventsStore: events,
      }
    : {};

  /**
   * GET /:eventId/submissions — Submission.List (admin)
   * Query: status?, category?
   */
  app.get(
    "/:eventId/submissions",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerRead }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const statusRaw = c.req.query("status");
      const category = c.req.query("category") ?? undefined;

      let status: ReturnType<typeof SubmissionStatusSchema.parse> | undefined;
      if (statusRaw) {
        const parsedStatus = SubmissionStatusSchema.safeParse(statusRaw);
        if (!parsedStatus.success) {
          return c.json(
            errorEnvelope("Invalid status filter", VALIDATION_ERROR, {
              status: statusRaw,
            }),
            400,
          );
        }
        status = parsedStatus.data;
      }

      const result = await listSubmissions(deps, {
        eventId,
        status,
        category,
      });
      if (!result.ok) {
        return commandError(c, result);
      }

      const out = SubmissionListResponseSchema.safeParse(result.value);
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
   * POST /:eventId/sessions/direct — direct/sponsor session (E07, admin)
   */
  app.post(
    "/:eventId/sessions/direct",
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

      const parsed = DirectSessionBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await createDirectSession(deps, {
        ...parsed.data,
        eventId,
        actorUserId: actor.userId,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = DirectSessionResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 201);
    },
  );

  /**
   * POST /:eventId/submissions/bulk-preview — E08 preview (no writes)
   */
  app.post(
    "/:eventId/submissions/bulk-preview",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerWrite }),
    async (c) => {
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

      const parsed = BulkDecisionPreviewBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await previewBulkDecision(deps, {
        eventId,
        submissionIds: parsed.data.submissionIds,
        decision: parsed.data.decision,
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = BulkDecisionPreviewResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  return app;
}

/**
 * Submission decision + get routes mounted at /api/submissions
 * POST /:submissionId/decision
 * GET  /:submissionId
 */
export function createSubmissionDecisionRoutes(
  options: DecisionRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, decisions, keys } = options;
  const deps = {
    decisions,
    events,
    auth: store,
    submissions,
  };
  const bearerWrite = keys
    ? {
        keysStore: keys,
        bearerScopes: ["decisions:write"] as const,
        eventsStore: events,
      }
    : {};
  const bearerRead = keys
    ? {
        keysStore: keys,
        bearerScopes: ["submissions:read", "decisions:write"] as const,
        eventsStore: events,
      }
    : {};

  /**
   * GET /:submissionId — Submission.Get (admin)
   */
  app.get("/:submissionId", requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerRead }), async (c) => {
    const submissionId = c.req.param("submissionId");
    const submission = await submissions.findSubmissionById(submissionId);
    if (!submission) {
      return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
    }

    const apiKey = c.get("apiKey");
    if (apiKey) {
      if (apiKey.eventId && apiKey.eventId !== submission.eventId) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      if (!apiKey.eventId) {
        const event = await events.findEventById(submission.eventId);
        if (!event || event.orgId !== apiKey.orgId) {
          return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
        }
      }
    } else {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }
      const membership = await store.findMembership(
        submission.eventId,
        user.id,
      );
      if (!membership) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
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
    }

    const result = await getSubmission(deps, submissionId);
    if (!result.ok) {
      return commandError(c, result);
    }

    const out = SubmissionDetailResponseSchema.safeParse(result.value);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200);
  });

  /**
   * POST /:submissionId/decision — Decision.Record (admin / decisions:write)
   * Evaluator → 403 (assert evaluator decision 403).
   */
  app.post("/:submissionId/decision", requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerWrite }), async (c) => {
    const actor = actorFromContext(c);
    if (!actor) {
      return c.json(
        errorEnvelope("Authentication required", "UNAUTHORIZED"),
        401,
      );
    }

    const submissionId = c.req.param("submissionId");
    const submission = await submissions.findSubmissionById(submissionId);
    if (!submission) {
      return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
    }

    const apiKey = c.get("apiKey");
    if (apiKey) {
      if (apiKey.eventId && apiKey.eventId !== submission.eventId) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      if (!apiKey.eventId) {
        const event = await events.findEventById(submission.eventId);
        if (!event || event.orgId !== apiKey.orgId) {
          return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
        }
      }
    } else {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }
      const membership = await store.findMembership(
        submission.eventId,
        user.id,
      );
      if (!membership) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      if (membership.role !== "admin") {
        // Evaluators explicitly 403 (not 404) so UI/tests can assert denial
        return c.json(
          errorEnvelope("Insufficient role", FORBIDDEN, {
            required: ["admin"],
            role: membership.role,
          }),
          403,
        );
      }
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

    const parsed = DecisionRecordBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorEnvelope("Validation failed", VALIDATION_ERROR, {
          issues: parsed.error.flatten(),
        }),
        400,
      );
    }

    const result = await recordDecision(deps, {
      ...parsed.data,
      submissionId,
      actorUserId: actor.userId,
      correlationId: c.get("correlationId"),
    });

    if (!result.ok) {
      return commandError(c, result);
    }

    const out = DecisionRecordResponseSchema.safeParse(result.value);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200);
  });

  return app;
}
