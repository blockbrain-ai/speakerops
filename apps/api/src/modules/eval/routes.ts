/**
 * Evaluation HTTP routes (section 3.4).
 *
 * PUT  /api/events/:eventId/eval/rubric          → Eval.UpsertRubric
 * GET  /api/events/:eventId/eval/rubric          → get rubric
 * GET  /api/events/:eventId/eval/rollup          → admin aggregates
 * POST /api/assignments/:assignmentId/scores     → Eval.Score
 * GET  /api/me/eval-queue                        → assigned queue only
 * POST /api/submissions/:submissionId/assign     → Submission.AssignEvaluators
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
  SubmissionAssignBodySchema,
  SubmissionAssignResponseSchema,
  EvalAdminRollupResponseSchema,
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
import type { EvalStore } from "./store.js";
import { requireRole, requireSession } from "../../middleware/authz.js";
import {
  upsertRubric,
  getRubric,
  scoreAssignment,
  assignEvaluators,
  getEvalQueue,
  getAdminEvalRollup,
} from "./commands.js";

export type EvalRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  submissions: SubmissionsStore;
  eval: EvalStore;
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
 * Paths: /:eventId/eval/rubric, /:eventId/eval/rollup
 */
export function createEventEvalRoutes(
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
   * PUT /:eventId/eval/rubric — Eval.UpsertRubric (admin)
   */
  app.put(
    "/:eventId/eval/rubric",
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
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
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
   */
  app.get(
    "/:eventId/eval/rollup",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const result = await getAdminEvalRollup(deps, eventId);
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = EvalAdminRollupResponseSchema.safeParse(result.value);
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
 * Path: GET /eval-queue
 */
export function createMeEvalRoutes(options: EvalRouteOptions): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, submissions, eval: evalStore } = options;
  const deps = {
    eval: evalStore,
    events,
    auth: store,
    submissions,
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

    const result = await getEvalQueue(deps, user.id);
    const out = EvalQueueResponseSchema.safeParse(result.value);
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

/**
 * Submission assign route mounted at /api/submissions
 * Path: POST /:submissionId/assign
 */
export function createSubmissionAssignRoutes(
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
   * POST /:submissionId/assign — Submission.AssignEvaluators (admin)
   */
  app.post(
    "/:submissionId/assign",
    requireSession(store),
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
