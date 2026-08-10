/**
 * Decisions HTTP routes (section 3.5).
 *
 * POST /api/submissions/:submissionId/decision  → Decision.Record
 * GET  /api/submissions/:submissionId           → Submission.Get
 * GET  /api/events/:eventId/submissions         → Submission.List
 * POST /api/events/:eventId/sessions/direct     → Session.CreateDirect
 * POST /api/events/:eventId/submissions/bulk-preview → bulk preview (E08)
 * POST /api/events/:eventId/submissions/bulk-decision → bulk commit
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
  SubmissionListQuerySchema,
  SubmissionDetailResponseSchema,
  BulkDecisionPreviewBodySchema,
  BulkDecisionPreviewResponseSchema,
  BulkDecisionCommitBodySchema,
  BulkDecisionCommitResponseSchema,
  SubmissionStatusSchema,
  SUBMISSION_LIST_DEFAULT_LIMIT,
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
  commitBulkDecision,
  exportSubmissionsCsv,
} from "./commands.js";

export type DecisionRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  submissions: SubmissionsStore;
  decisions: DecisionsStore;
  /** When set, Submission.Get includes human field labels on answers. */
  forms?: import("../forms/store.js").FormsStore;
  /** Bearer decisions:write / submissions:read (COMMANDS.md / CLI 7.2). */
  keys?: import("../keys/store.js").KeysStore;
  /** Optional accept → program magic-link invite. */
  programInvite?: {
    issue: (input: {
      email: string;
      userId: string;
      eventId: string;
      correlationId: string;
    }) => Promise<unknown>;
  } | null;
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
  const { store, events, submissions, decisions, keys, forms, programInvite } =
    options;
  const deps = {
    decisions,
    events,
    auth: store,
    submissions,
    forms,
    programInvite: programInvite ?? null,
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
  /** CSV export is a pure read — bearer submissions:read (COMMANDS.md). */
  const bearerExport = keys
    ? {
        keysStore: keys,
        bearerScopes: ["submissions:read"] as const,
        eventsStore: events,
      }
    : {};

  /**
   * GET /:eventId/submissions — Submission.List (admin)
   * Query: status?, category?, limit? (default 25, max 100), offset? (default 0)
   * Response: { submissions, total, limit, offset, categories } — page contract AC-10.1-E
   */
  app.get(
    "/:eventId/submissions",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerRead }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const statusRaw = c.req.query("status");
      const categoryRaw = c.req.query("category");
      // Accept both `q` (SPA) and `search` (CLI/manual) as the text filter.
      const qRaw = c.req.query("q") || c.req.query("search");
      const limitRaw = c.req.query("limit");
      const offsetRaw = c.req.query("offset");

      const queryParsed = SubmissionListQuerySchema.safeParse({
        status: statusRaw || undefined,
        category: categoryRaw || undefined,
        q: qRaw || undefined,
        limit: limitRaw ?? undefined,
        offset: offsetRaw ?? undefined,
      });
      if (!queryParsed.success) {
        return c.json(
          errorEnvelope("Invalid list query", VALIDATION_ERROR, {
            issues: queryParsed.error.flatten(),
          }),
          400,
        );
      }

      // Keep explicit status validation message for invalid enums (existing tests)
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
      }

      const result = await listSubmissions(deps, {
        eventId,
        status: queryParsed.data.status,
        category: queryParsed.data.category,
        q: queryParsed.data.q,
        limit: queryParsed.data.limit ?? SUBMISSION_LIST_DEFAULT_LIMIT,
        offset: queryParsed.data.offset ?? 0,
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
   * GET /:eventId/submissions/export — Submission.ExportCsv (Wave 2 depth).
   * Same filters as Submission.List (status/category/q); admin session or
   * bearer submissions:read. Stable headers; layout nodes never exported.
   */
  app.get(
    "/:eventId/submissions/export",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerExport }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const statusRaw = c.req.query("status");
      const categoryRaw = c.req.query("category");
      const qRaw = c.req.query("q") || c.req.query("search");

      const queryParsed = SubmissionListQuerySchema.safeParse({
        status: statusRaw || undefined,
        category: categoryRaw || undefined,
        q: qRaw || undefined,
      });
      if (!queryParsed.success) {
        return c.json(
          errorEnvelope("Invalid export query", VALIDATION_ERROR, {
            issues: queryParsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await exportSubmissionsCsv(deps, {
        eventId,
        status: queryParsed.data.status,
        category: queryParsed.data.category,
        q: queryParsed.data.q,
      });
      if (!result.ok) {
        return commandError(c, result);
      }

      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="${result.value.filename}"`,
      );
      c.header("Cache-Control", "no-store");
      return c.body(result.value.csv, 200);
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

  /**
   * POST /:eventId/submissions/bulk-decision — commit via Decision.Record loop
   */
  app.post(
    "/:eventId/submissions/bulk-decision",
    requireRole(store, ["admin"], {
      eventIdFrom: "param",
      ...bearerWrite,
    }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const actor = actorFromContext(c);
      if (!actor) {
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

      const parsed = BulkDecisionCommitBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await commitBulkDecision(deps, {
        eventId,
        submissionIds: parsed.data.submissionIds,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
        expectedVersions: parsed.data.expectedVersions,
        actorUserId: actor.actorId,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = BulkDecisionCommitResponseSchema.safeParse(result.value);
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
  const { store, events, submissions, decisions, keys, forms, programInvite } =
    options;
  const deps = {
    decisions,
    events,
    auth: store,
    submissions,
    forms,
    programInvite: programInvite ?? null,
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
