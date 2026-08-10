/**
 * Evaluation HTTP routes (section 3.4).
 *
 * PUT  /api/events/:eventId/eval/rubric          → Eval.UpsertRubric
 * GET  /api/events/:eventId/eval/rubric          → get rubric
 * GET  /api/events/:eventId/eval/rollup          → admin aggregates
 * GET  /api/events/:eventId/eval/export          → Eval.ExportScores (CSV)
 * GET  /api/events/:eventId/members              → evaluator roster + workload
 * POST /api/assignments/:assignmentId/scores     → Eval.Score
 * GET  /api/me/eval-queue                        → assigned queue only
 * POST /api/submissions/:submissionId/assign     → Submission.AssignEvaluators
 * GET  /api/submissions/:submissionId/eval-reviews → individual reviews
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  EvalUpsertRubricBodySchema,
  EvalRubricResponseSchema,
  EvalScoreBodySchema,
  EvalScoreResponseSchema,
  EvalQueueResponseSchema,
  EvalProposalResponseSchema,
  SubmissionAssignBodySchema,
  SubmissionAssignResponseSchema,
  EvalAdminRollupResponseSchema,
  EvalReviewsResponseSchema,
  EvalScoreSortSchema,
  EventMembersResponseSchema,
  EventRoleSchema,
  sortEvalSubmissionsByScore,
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
import type { FormsStore } from "../forms/store.js";
import type { KeysStore } from "../keys/store.js";
import type { EvalStore } from "./store.js";
import { requireRole, requireSession } from "../../middleware/authz.js";
import {
  upsertRubric,
  getRubric,
  scoreAssignment,
  assignEvaluators,
  getEvalQueue,
  getEvalAssignmentProposal,
  getAdminEvalRollup,
  exportAdminEvalCsv,
  getSubmissionEvalReviews,
} from "./commands.js";

export type EvalRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  submissions: SubmissionsStore;
  eval: EvalStore;
  forms?: FormsStore;
  /** Bearer submissions:read / submissions:write for CLI (7.2). */
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
          : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

/**
 * Event-scoped eval routes mounted under /api/events
 * Paths: /:eventId/eval/rubric, /:eventId/eval/rollup, /:eventId/eval/export
 */
export function createEventEvalRoutes(
  options: EvalRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, eval: evalStore, keys } = options;
  const deps = {
    eval: evalStore,
    events,
    auth: store,
    submissions,
  };
  const bearerRead = keys
    ? {
        keysStore: keys,
        bearerScopes: ["submissions:read"] as const,
        eventsStore: events,
      }
    : {};
  const bearerWrite = keys
    ? {
        keysStore: keys,
        bearerScopes: ["submissions:write"] as const,
        eventsStore: events,
      }
    : {};

  /**
   * GET /:eventId/members — event roster (admin).
   * Query: role? = evaluator|admin|speaker (default all when omitted).
   * assignmentCount from active eval round (0 if none).
   */
  app.get(
    "/:eventId/members",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerRead }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const roleRaw = c.req.query("role");
      let roleFilter: string | undefined;
      if (roleRaw != null && roleRaw !== "") {
        const parsedRole = EventRoleSchema.safeParse(roleRaw);
        if (!parsedRole.success) {
          return c.json(
            errorEnvelope("Invalid role filter", VALIDATION_ERROR, {
              role: roleRaw,
              allowed: EventRoleSchema.options,
            }),
            400,
          );
        }
        roleFilter = parsedRole.data;
      }

      const memberships = (await store.listMemberships()).filter(
        (m) => m.eventId === eventId,
      );
      const filtered = roleFilter
        ? memberships.filter((m) => m.role === roleFilter)
        : memberships;

      const round = await evalStore.findActiveRoundForEvent(eventId);
      const roundAssignments = round
        ? await evalStore.listAssignmentsForRound(round.id)
        : [];
      const countByUser = new Map<string, number>();
      for (const a of roundAssignments) {
        countByUser.set(
          a.evaluatorUserId,
          (countByUser.get(a.evaluatorUserId) ?? 0) + 1,
        );
      }

      const members = [];
      for (const m of filtered) {
        const user = await store.findUserById(m.userId);
        members.push({
          userId: m.userId,
          email: user?.email ?? m.userId,
          role: m.role,
          assignmentCount: countByUser.get(m.userId) ?? 0,
        });
      }
      members.sort((a, b) => a.email.localeCompare(b.email));

      const out = EventMembersResponseSchema.safeParse({ members });
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
   * PUT /:eventId/eval/rubric — Eval.UpsertRubric (admin)
   */
  app.put(
    "/:eventId/eval/rubric",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerWrite }),
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

      const parsed = EvalUpsertRubricBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await upsertRubric(deps, {
        ...parsed.data,
        eventId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = EvalRubricResponseSchema.safeParse(result.value);
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
   * GET /:eventId/eval/rubric — read active rubric (admin)
   */
  app.get(
    "/:eventId/eval/rubric",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerRead }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const result = await getRubric(deps, eventId);
      if (!result.ok) {
        return commandError(c, result);
      }
      if (result.value == null) {
        return c.json({ round: null, criteria: [] }, 200);
      }
      const out = EvalRubricResponseSchema.safeParse(result.value);
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
   * GET /:eventId/eval/rollup — admin aggregate scores per submission
   * Section 10.2: always return EvalAdminRollupResponse (never 500
   * "Response validation failed" for dogfood-shaped progress data).
   * Section 10.6: optional ?sort=score_desc|score_asc|title orders submissions.
   */
  app.get(
    "/:eventId/eval/rollup",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerRead }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const sortRaw = c.req.query("sort");
      let sort: ReturnType<typeof EvalScoreSortSchema.parse> | undefined;
      if (sortRaw != null && sortRaw !== "") {
        const parsedSort = EvalScoreSortSchema.safeParse(sortRaw);
        if (!parsedSort.success) {
          return c.json(
            errorEnvelope("Invalid sort", VALIDATION_ERROR, {
              sort: sortRaw,
              allowed: EvalScoreSortSchema.options,
            }),
            400,
          );
        }
        sort = parsedSort.data;
      }
      const result = await getAdminEvalRollup(deps, eventId);
      if (!result.ok) {
        return commandError(c, result);
      }
      const value =
        sort != null
          ? {
              ...result.value,
              submissions: sortEvalSubmissionsByScore(
                result.value.submissions,
                sort,
              ),
            }
          : result.value;
      const out = EvalAdminRollupResponseSchema.safeParse(value);
      if (!out.success) {
        // Last-resort honest empty progress — never block admin UI with INTERNAL_ERROR.
        // Command path is hardened; this is defense-in-depth only.
        return c.json(
          EvalAdminRollupResponseSchema.parse({
            round: null,
            criteria: [],
            submissions: [],
          }),
          200,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * GET /:eventId/eval/export — Eval.ExportScores (admin CSV download)
   * Section 10.6 / S-EVAL-EXPORT. Query: sort? = score_desc|score_asc|title
   */
  app.get(
    "/:eventId/eval/export",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerRead }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const sortRaw = c.req.query("sort") ?? "score_desc";
      const parsedSort = EvalScoreSortSchema.safeParse(sortRaw);
      if (!parsedSort.success) {
        return c.json(
          errorEnvelope("Invalid sort", VALIDATION_ERROR, {
            sort: sortRaw,
            allowed: EvalScoreSortSchema.options,
          }),
          400,
        );
      }
      const result = await exportAdminEvalCsv(deps, eventId, parsedSort.data);
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

  return app;
}

/**
 * Assignment score route mounted at /api/assignments
 * Path: POST /:assignmentId/scores
 */
export function createAssignmentRoutes(
  options: EvalRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, eval: evalStore } = options;
  const deps = {
    eval: evalStore,
    events,
    auth: store,
    submissions,
  };

  /**
   * POST /:assignmentId/scores — Eval.Score (evaluator on own assignment)
   */
  app.post(
    "/:assignmentId/scores",
    requireSession(store),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }

      const assignmentId = c.req.param("assignmentId");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = EvalScoreBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      // Resolve assignment → event membership (evaluator or admin)
      const assignment = await evalStore.findAssignmentById(assignmentId);
      if (!assignment) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      const round = await evalStore.findRoundById(assignment.roundId);
      if (!round) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      const membership = await store.findMembership(round.eventId, user.id);
      if (!membership) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }
      if (
        membership.role !== "evaluator" &&
        membership.role !== "admin"
      ) {
        return c.json(
          errorEnvelope("Insufficient role", FORBIDDEN, {
            required: ["evaluator"],
            role: membership.role,
          }),
          403,
        );
      }

      const result = await scoreAssignment(deps, {
        ...parsed.data,
        assignmentId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = EvalScoreResponseSchema.safeParse(result.value);
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
 * Me routes mounted at /api/me
 * Paths: GET /eval-queue, GET /eval-assignments/:assignmentId/proposal
 */
export function createMeEvalRoutes(options: EvalRouteOptions): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, eval: evalStore, forms } = options;
  const deps = {
    eval: evalStore,
    events,
    auth: store,
    submissions,
    forms,
  };

  /**
   * GET /eval-queue — only assignments for session user (F01).
   * Requires session + at least one evaluator or admin membership.
   */
  app.get("/eval-queue", requireSession(store), async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json(
        errorEnvelope("Authentication required", "UNAUTHORIZED"),
        401,
      );
    }

    const memberships = await store.listMembershipsForUser(user.id);
    const allowed = memberships.some(
      (m) => m.role === "evaluator" || m.role === "admin",
    );
    if (!allowed) {
      return c.json(
        errorEnvelope("Insufficient role", FORBIDDEN, {
          required: ["evaluator"],
        }),
        403,
      );
    }

    const eventIdQ = c.req.query("eventId")?.trim() || null;
    const result = await getEvalQueue(deps, user.id, { eventId: eventIdQ });
    const out = EvalQueueResponseSchema.safeParse(result.value);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200);
  });

  /**
   * GET /eval-assignments/:assignmentId/proposal — full proposal for scoring.
   * Assignment must be owned by the session evaluator.
   */
  app.get(
    "/eval-assignments/:assignmentId/proposal",
    requireSession(store),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }

      const assignmentId = c.req.param("assignmentId");
      const result = await getEvalAssignmentProposal(
        deps,
        assignmentId,
        user.id,
      );
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = EvalProposalResponseSchema.safeParse(result.value);
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
 * Submission assign route mounted at /api/submissions
 * Path: POST /:submissionId/assign
 */
export function createSubmissionAssignRoutes(
  options: EvalRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, eval: evalStore, keys } = options;
  const deps = {
    eval: evalStore,
    events,
    auth: store,
    submissions,
  };
  const bearerWrite = keys
    ? {
        keysStore: keys,
        bearerScopes: ["submissions:write"] as const,
        eventsStore: events,
      }
    : {};
  const bearerRead = keys
    ? {
        keysStore: keys,
        bearerScopes: ["submissions:read"] as const,
        eventsStore: events,
      }
    : {};

  /**
   * GET /:submissionId/eval-reviews — individual reviews (admin or assigned evaluator).
   * Peers reveal-after-submit for non-admin (status === scored only).
   */
  app.get(
    "/:submissionId/eval-reviews",
    requireRole(store, ["admin", "evaluator"], {
      eventIdFrom: "none",
      ...bearerRead,
    }),
    async (c) => {
      const submissionId = c.req.param("submissionId");
      const submission = await submissions.findSubmissionById(submissionId);
      if (!submission) {
        return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
      }

      const apiKey = c.get("apiKey");
      let isAdmin = false;
      let actorUserId: string | null = null;

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
        // Bearer with submissions:read is admin-equivalent for review visibility.
        isAdmin = true;
        actorUserId = apiKey.createdBy;
      } else {
        const user = c.get("user");
        if (!user) {
          return c.json(
            errorEnvelope("Authentication required", "UNAUTHORIZED"),
            401,
          );
        }
        actorUserId = user.id;
        const membership = await store.findMembership(
          submission.eventId,
          user.id,
        );
        if (!membership) {
          return c.json(errorEnvelope("Not found", NOT_FOUND), 404);
        }
        if (membership.role === "admin") {
          isAdmin = true;
        } else if (membership.role !== "evaluator") {
          return c.json(
            errorEnvelope("Insufficient role", FORBIDDEN, {
              required: ["admin", "evaluator"],
              role: membership.role,
            }),
            403,
          );
        }
      }

      if (!actorUserId) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }

      const result = await getSubmissionEvalReviews(deps, {
        submissionId,
        actorUserId,
        isAdmin,
      });
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = EvalReviewsResponseSchema.safeParse(result.value);
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
   * POST /:submissionId/assign — Submission.AssignEvaluators (admin / submissions:write)
   */
  app.post(
    "/:submissionId/assign",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerWrite }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
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

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = SubmissionAssignBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await assignEvaluators(deps, {
        submissionId,
        userIds: parsed.data.userIds,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = SubmissionAssignResponseSchema.safeParse(result.value);
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
