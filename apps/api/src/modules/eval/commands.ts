/**
 * Evaluation domain commands (section 3.4 / S-EVAL).
 *
 * Eval.UpsertRubric · Eval.Score · Submission.AssignEvaluators
 * + queue query + admin aggregate rollup.
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 * Human scoring only — no AI.
 */
import {
  uuidv7,
  computeWeightedAggregate,
  computeScoreSpread,
  coerceFiniteNumber,
  sortEvalSubmissionsByScore,
  evalRollupToCsv,
  isSubmissionEvalEligible,
  isEvalRoundClosed,
  type EvalAbstainBody,
  type EvalUpsertRubricBody,
  type EvalScoreBody,
  type EvalRoundDto,
  type EvalCriterionDto,
  type EvalAssignmentDto,
  type ScoreDto,
  type EvalQueueItem,
  type EvalAdminSubmissionRollup,
  type EvalAssignmentStatus,
  type EvalRoundStatus,
  type EvalScoreSort,
  type EvalProposalResponse,
  type EvalReviewsResponse,
  type EvalReviewItem,
  type EvalBulkAssignBody,
  type EvalBulkAssignResponse,
  type EvalBulkAssignPair,
  type EvalBulkAssignSkip,
  type EvalBulkAssignCapacityFailure,
  type EvalBulkAssignPerEvaluator,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { FormsStore } from "../forms/store.js";
import {
  type EvalStore,
  type EvalRoundRow,
  type EvalCriterionRow,
  type EvalAssignmentRow,
  type ScoreRow,
  newEvalRoundId,
  newEvalCriterionId,
  newEvalAssignmentId,
  newScoreId,
} from "./store.js";

export type EvalCommandDeps = {
  eval: EvalStore;
  events: EventsStore;
  auth: AuthStore;
  submissions: SubmissionsStore;
  /** Optional — enriches proposal answers with form field labels. */
  forms?: FormsStore;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

function asRoundStatus(status: string): EvalRoundStatus {
  return status === "closed" ? "closed" : "open";
}

function asAssignmentStatus(status: string): EvalAssignmentStatus {
  if (status === "scored") return "scored";
  if (status === "abstained") return "abstained";
  return "pending";
}

/** Human 409 message when a review round is closed for scoring/abstain. */
function roundClosedError(round: EvalRoundRow): CommandErr {
  const when = round.closesAt
    ? new Date(round.closesAt).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : null;
  return {
    ok: false,
    status: 409,
    error: when
      ? `This review round closed on ${when} (UTC) — scores can no longer change`
      : "This review round is closed — scores can no longer change",
    code: "CONFLICT",
    details: {
      roundId: round.id,
      status: round.status,
      closesAt: round.closesAt,
    },
  };
}

function finiteOr(
  value: unknown,
  fallback: number,
): number {
  const n = coerceFiniteNumber(value);
  return n === undefined ? fallback : n;
}

function toRoundDto(row: EvalRoundRow): EvalRoundDto {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name ?? "",
    status: asRoundStatus(row.status),
    closesAt: row.closesAt ?? null,
    instructionsMd: row.instructionsMd ?? null,
    hideSpeakers: row.hideSpeakers === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCriterionDto(row: EvalCriterionRow): EvalCriterionDto {
  return {
    id: row.id,
    roundId: row.roundId,
    name: row.name ?? "",
    maxScore: finiteOr(row.maxScore, 0),
    weight: finiteOr(row.weight, 1),
    sortOrder: Math.trunc(finiteOr(row.sortOrder, 0)),
  };
}

function toScoreDto(row: ScoreRow): ScoreDto {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    criterionId: row.criterionId,
    value: finiteOr(row.value, 0),
    comment: row.comment ?? null,
  };
}

/**
 * Pure weighted aggregate from prefetched score rows (no store round-trips).
 * Only `scored` assignments aggregate; scores for unknown criteria are ignored.
 * Single source of aggregation semantics for both the per-assignment path
 * (assignmentAggregate) and the batched paths (queue + admin rollup).
 */
function aggregateFromScoreRows(
  status: string,
  criteria: EvalCriterionRow[],
  scoreRows: ScoreRow[],
): number | null {
  if (status !== "scored") return null;
  const byCriterion = new Map(criteria.map((c) => [c.id, c]));
  const items: Array<{ value: number; weight: number }> = [];
  for (const s of scoreRows) {
    const c = byCriterion.get(s.criterionId);
    if (!c) continue;
    items.push({ value: s.value, weight: c.weight });
  }
  return computeWeightedAggregate(items);
}

async function assignmentAggregate(
  deps: EvalCommandDeps,
  assignment: EvalAssignmentRow,
  criteria: EvalCriterionRow[],
): Promise<number | null> {
  if (assignment.status !== "scored") return null;
  const scoreRows = await deps.eval.listScores(assignment.id);
  return aggregateFromScoreRows(assignment.status, criteria, scoreRows);
}

async function toAssignmentDto(
  deps: EvalCommandDeps,
  row: EvalAssignmentRow,
  criteria?: EvalCriterionRow[],
  includeScores = false,
): Promise<EvalAssignmentDto> {
  const crit =
    criteria ?? (await deps.eval.listCriteria(row.roundId));
  const aggregateScore = await assignmentAggregate(deps, row, crit);
  const dto: EvalAssignmentDto = {
    id: row.id,
    roundId: row.roundId,
    submissionId: row.submissionId,
    evaluatorUserId: row.evaluatorUserId,
    status: asAssignmentStatus(row.status),
    overallComment: row.overallComment ?? null,
    abstainReason: row.abstainReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    aggregateScore:
      aggregateScore != null && Number.isFinite(aggregateScore)
        ? aggregateScore
        : null,
  };
  if (includeScores) {
    const scores = await deps.eval.listScores(row.id);
    dto.scores = scores.map(toScoreDto);
  }
  return dto;
}

/**
 * Pure DTO mapper using prefetched score rows (no store round-trips).
 * Same semantics as toAssignmentDto(..., includeScores = true) — used by the
 * batched evaluator queue so aggregates never trigger per-assignment queries.
 */
function toAssignmentDtoWithScores(
  row: EvalAssignmentRow,
  criteria: EvalCriterionRow[],
  scoreRows: ScoreRow[],
): EvalAssignmentDto {
  const aggregateScore = aggregateFromScoreRows(row.status, criteria, scoreRows);
  return {
    id: row.id,
    roundId: row.roundId,
    submissionId: row.submissionId,
    evaluatorUserId: row.evaluatorUserId,
    status: asAssignmentStatus(row.status),
    overallComment: row.overallComment ?? null,
    abstainReason: row.abstainReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    aggregateScore:
      aggregateScore != null && Number.isFinite(aggregateScore)
        ? aggregateScore
        : null,
    scores: scoreRows.map(toScoreDto),
  };
}

export type UpsertRubricInput = EvalUpsertRubricBody & {
  eventId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Eval.UpsertRubric — create/update active round + replace criteria.
 */
export async function upsertRubric(
  deps: EvalCommandDeps,
  input: UpsertRubricInput,
): Promise<
  CommandOk<{ round: EvalRoundDto; criteria: EvalCriterionDto[] }> | CommandErr
> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
  }

  const now = new Date().toISOString();
  let round: EvalRoundRow | null = null;

  // Deadline / instructions / hide-speakers knobs: omitted keeps current, null clears.
  const roundPatch: {
    closesAt?: string | null;
    instructionsMd?: string | null;
    hideSpeakers?: boolean;
  } = {};
  if (input.closesAt !== undefined) roundPatch.closesAt = input.closesAt;
  if (input.instructionsMd !== undefined) {
    roundPatch.instructionsMd = input.instructionsMd?.trim()
      ? input.instructionsMd
      : null;
  }
  if (input.hideSpeakers !== undefined) {
    roundPatch.hideSpeakers = input.hideSpeakers === true;
  }

  if (input.roundId) {
    round = await deps.eval.findRoundById(input.roundId);
    if (!round || round.eventId !== input.eventId) {
      return {
        ok: false,
        status: 404,
        error: "Eval round not found",
        code: "NOT_FOUND",
      };
    }
    round =
      (await deps.eval.updateRound(round.id, {
        name: input.name ?? round.name,
        ...roundPatch,
        updatedAt: now,
      })) ?? round;
  } else {
    round = await deps.eval.findActiveRoundForEvent(input.eventId);
    if (round) {
      round =
        (await deps.eval.updateRound(round.id, {
          name: input.name ?? round.name,
          ...roundPatch,
          updatedAt: now,
        })) ?? round;
    } else {
      round = await deps.eval.insertRound({
        id: newEvalRoundId(),
        eventId: input.eventId,
        name: input.name ?? "Default rubric",
        status: "open",
        closesAt: input.closesAt ?? null,
        instructionsMd: input.instructionsMd?.trim()
          ? input.instructionsMd
          : null,
        hideSpeakers: input.hideSpeakers === true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Reject replace when scores exist and criterion set shrinks ids with scores
  const existingCriteria = await deps.eval.listCriteria(round.id);
  const scoreCount = await deps.eval.countScoresForRound(round.id);
  if (scoreCount > 0) {
    const newIds = new Set(
      input.criteria.map((c) => c.id).filter((id): id is string => !!id),
    );
    const removedWithScores = existingCriteria.filter((c) => !newIds.has(c.id));
    if (removedWithScores.length > 0 && newIds.size < existingCriteria.length) {
      // Allow full replace of names/weights if all existing ids are kept; block id drop
      return {
        ok: false,
        status: 409,
        error: "Cannot remove criteria that have scores",
        code: "CONFLICT",
        details: { criterionIds: removedWithScores.map((c) => c.id) },
      };
    }
  }

  const criterionRows: EvalCriterionRow[] = input.criteria.map((c, i) => ({
    id: c.id ?? newEvalCriterionId(),
    roundId: round!.id,
    name: c.name,
    maxScore: c.maxScore,
    weight: c.weight ?? 1,
    sortOrder: c.sortOrder ?? i,
  }));

  await deps.eval.replaceCriteria(round.id, criterionRows);

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Eval.UpsertRubric",
    entityType: "eval_round",
    entityId: round.id,
    afterJson: JSON.stringify({
      name: round.name,
      hideSpeakers: round.hideSpeakers === true,
      criteriaCount: criterionRows.length,
      criteria: criterionRows.map((c) => ({
        id: c.id,
        name: c.name,
        maxScore: c.maxScore,
        weight: c.weight,
      })),
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      round: toRoundDto(round),
      criteria: criterionRows.map(toCriterionDto),
    },
  };
}

/**
 * Get rubric for event (active round + criteria).
 */
export async function getRubric(
  deps: EvalCommandDeps,
  eventId: string,
): Promise<
  CommandOk<{ round: EvalRoundDto; criteria: EvalCriterionDto[] } | null> | CommandErr
> {
  const event = await deps.events.findEventById(eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
  }
  const round = await deps.eval.findActiveRoundForEvent(eventId);
  if (!round) {
    return { ok: true, value: null };
  }
  const criteria = await deps.eval.listCriteria(round.id);
  return {
    ok: true,
    value: {
      round: toRoundDto(round),
      criteria: criteria.map(toCriterionDto),
    },
  };
}

export type ScoreAssignmentInput = EvalScoreBody & {
  assignmentId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Eval.Score — human evaluator scores assigned submission criteria.
 */
export async function scoreAssignment(
  deps: EvalCommandDeps,
  input: ScoreAssignmentInput,
): Promise<CommandOk<{ assignment: EvalAssignmentDto }> | CommandErr> {
  const assignment = await deps.eval.findAssignmentById(input.assignmentId);
  if (!assignment) {
    return {
      ok: false,
      status: 404,
      error: "Assignment not found",
      code: "NOT_FOUND",
    };
  }

  if (assignment.evaluatorUserId !== input.actorUserId) {
    return {
      ok: false,
      status: 403,
      error: "Not assigned to this evaluator",
      code: "FORBIDDEN",
    };
  }

  const round = await deps.eval.findRoundById(assignment.roundId);
  if (!round) {
    return {
      ok: false,
      status: 404,
      error: "Eval round not found",
      code: "NOT_FOUND",
    };
  }

  // Deadline enforcement: closed rounds accept no further scores (409).
  if (isEvalRoundClosed(round)) {
    return roundClosedError(round);
  }

  const criteria = await deps.eval.listCriteria(round.id);
  const byId = new Map(criteria.map((c) => [c.id, c]));

  if (criteria.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Rubric has no criteria",
      code: "VALIDATION_ERROR",
    };
  }

  // Require a score for every criterion
  const provided = new Set(input.scores.map((s) => s.criterionId));
  for (const c of criteria) {
    if (!provided.has(c.id)) {
      return {
        ok: false,
        status: 400,
        error: "Missing score for criterion",
        code: "VALIDATION_ERROR",
        details: { criterionId: c.id },
      };
    }
  }

  const scoreRows: ScoreRow[] = [];
  for (const item of input.scores) {
    const criterion = byId.get(item.criterionId);
    if (!criterion) {
      return {
        ok: false,
        status: 400,
        error: "Unknown criterion",
        code: "VALIDATION_ERROR",
        details: { criterionId: item.criterionId },
      };
    }
    if (item.value < 0 || item.value > criterion.maxScore) {
      return {
        ok: false,
        status: 400,
        error: "Score exceeds max for criterion",
        code: "VALIDATION_ERROR",
        details: {
          criterionId: item.criterionId,
          value: item.value,
          maxScore: criterion.maxScore,
        },
      };
    }
    scoreRows.push({
      id: newScoreId(),
      assignmentId: assignment.id,
      criterionId: item.criterionId,
      value: item.value,
      comment: item.comment ?? null,
    });
  }

  const now = new Date().toISOString();
  await deps.eval.replaceScores(assignment.id, scoreRows);
  const updated = await deps.eval.updateAssignment(assignment.id, {
    status: "scored",
    overallComment: input.comment ?? null,
    // Scoring after an abstention re-activates the review.
    abstainReason: null,
    updatedAt: now,
  });

  if (!updated) {
    return {
      ok: false,
      status: 404,
      error: "Assignment not found",
      code: "NOT_FOUND",
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: round.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Eval.Score",
    entityType: "eval_assignment",
    entityId: assignment.id,
    afterJson: JSON.stringify({
      submissionId: assignment.submissionId,
      scores: scoreRows.map((s) => ({
        criterionId: s.criterionId,
        value: s.value,
      })),
      comment: input.comment ?? null,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  const dto = await toAssignmentDto(deps, updated, criteria, true);
  return { ok: true, value: { assignment: dto } };
}

export type AbstainAssignmentInput = EvalAbstainBody & {
  assignmentId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Eval.Abstain — evaluator declines to score an assignment (conflict of
 * interest, expertise mismatch, …). Owner-verified; optional reason is shown
 * to admins. Abstained assignments leave the pending flow and never
 * contribute to score aggregates. Rejected after round close (409).
 */
export async function abstainAssignment(
  deps: EvalCommandDeps,
  input: AbstainAssignmentInput,
): Promise<CommandOk<{ assignment: EvalAssignmentDto }> | CommandErr> {
  const assignment = await deps.eval.findAssignmentById(input.assignmentId);
  if (!assignment) {
    return {
      ok: false,
      status: 404,
      error: "Assignment not found",
      code: "NOT_FOUND",
    };
  }

  // Ownership: only the assigned evaluator may abstain.
  if (assignment.evaluatorUserId !== input.actorUserId) {
    return {
      ok: false,
      status: 403,
      error: "Not assigned to this evaluator",
      code: "FORBIDDEN",
    };
  }

  const round = await deps.eval.findRoundById(assignment.roundId);
  if (!round) {
    return {
      ok: false,
      status: 404,
      error: "Eval round not found",
      code: "NOT_FOUND",
    };
  }

  if (isEvalRoundClosed(round)) {
    return roundClosedError(round);
  }

  if (assignment.status === "abstained") {
    return {
      ok: false,
      status: 409,
      error: "You have already abstained from this review",
      code: "CONFLICT",
    };
  }

  const reason = input.reason?.trim() ? input.reason.trim() : null;
  const now = new Date().toISOString();

  // Abstaining discards any partial scores so aggregates stay honest.
  await deps.eval.replaceScores(assignment.id, []);
  const updated = await deps.eval.updateAssignment(assignment.id, {
    status: "abstained",
    abstainReason: reason,
    updatedAt: now,
  });
  if (!updated) {
    return {
      ok: false,
      status: 404,
      error: "Assignment not found",
      code: "NOT_FOUND",
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: round.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Eval.Abstain",
    entityType: "eval_assignment",
    entityId: assignment.id,
    afterJson: JSON.stringify({
      submissionId: assignment.submissionId,
      reason,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  const criteria = await deps.eval.listCriteria(round.id);
  const dto = await toAssignmentDto(deps, updated, criteria, true);
  return { ok: true, value: { assignment: dto } };
}

export type AssignEvaluatorsInput = {
  submissionId: string;
  userIds: string[];
  actorUserId: string;
  correlationId: string;
};

/**
 * Submission.AssignEvaluators — create pending assignments for active round.
 */
export async function assignEvaluators(
  deps: EvalCommandDeps,
  input: AssignEvaluatorsInput,
): Promise<CommandOk<{ assignments: EvalAssignmentDto[] }> | CommandErr> {
  const submission = await deps.submissions.findSubmissionById(
    input.submissionId,
  );
  if (!submission) {
    return {
      ok: false,
      status: 404,
      error: "Submission not found",
      code: "NOT_FOUND",
    };
  }

  // Incomplete public drafts must not be assigned or scored (10.5 + S-EVAL).
  if (!isSubmissionEvalEligible(submission.status)) {
    return {
      ok: false,
      status: 400,
      error:
        submission.status === "draft"
          ? "Cannot assign evaluators to a draft submission"
          : "Submission is not eligible for evaluation assignment",
      code: "VALIDATION_ERROR",
      details: {
        status: submission.status,
        eligible: ["submitted", "in_review"],
      },
    };
  }

  const round = await deps.eval.findActiveRoundForEvent(submission.eventId);
  if (!round) {
    return {
      ok: false,
      status: 400,
      error: "No eval rubric configured for event",
      code: "VALIDATION_ERROR",
    };
  }

  const now = new Date().toISOString();
  const created: EvalAssignmentRow[] = [];

  for (const userId of input.userIds) {
    const membership = await deps.auth.findMembership(
      submission.eventId,
      userId,
    );
    if (!membership) {
      return {
        ok: false,
        status: 400,
        error: "User is not a member of this event",
        code: "VALIDATION_ERROR",
        details: { userId },
      };
    }
    if (membership.role !== "evaluator" && membership.role !== "admin") {
      return {
        ok: false,
        status: 400,
        error: "User is not an evaluator for this event",
        code: "VALIDATION_ERROR",
        details: { userId, role: membership.role },
      };
    }

    const existing = await deps.eval.findAssignment(
      round.id,
      submission.id,
      userId,
    );
    if (existing) {
      created.push(existing);
      continue;
    }

    const row = await deps.eval.insertAssignment({
      id: newEvalAssignmentId(),
      roundId: round.id,
      submissionId: submission.id,
      evaluatorUserId: userId,
      status: "pending",
      overallComment: null,
      createdAt: now,
      updatedAt: now,
    });
    created.push(row);
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: submission.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Submission.AssignEvaluators",
    entityType: "submission",
    entityId: submission.id,
    afterJson: JSON.stringify({
      userIds: input.userIds,
      assignmentIds: created.map((a) => a.id),
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  const criteria = await deps.eval.listCriteria(round.id);
  const assignments = await Promise.all(
    created.map((a) => toAssignmentDto(deps, a, criteria)),
  );
  return { ok: true, value: { assignments } };
}

export type BulkAssignEvaluatorsInput = EvalBulkAssignBody & {
  eventId: string;
  actorUserId: string;
  correlationId: string;
};

/** Scope prefix for Eval.BulkAssign keys in the shared idempotency_keys table. */
export const EVAL_BULK_ASSIGN_IDEMPOTENCY_PREFIX = "eval.bulk-assign:" as const;

/** SHA-256 hex digest (Worker-safe; mirrors comms hashSendRequest). */
async function sha256Hex(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic (submission, evaluator) pair key. */
function pairKey(submissionId: string, evaluatorUserId: string): string {
  return `${submissionId} ${evaluatorUserId}`;
}

/**
 * Eval.BulkAssign — cohort assignment wizard (Wave 2).
 *
 * Preview (dryRun=true): computes a deterministic plan and returns previewId =
 * SHA-256 over the FULL assignment estate: round.updatedAt + sorted matched
 * submissions (id + status, so eligibility drift is bound even without a
 * status filter) + sorted evaluator membership rows (userId + role) + every
 * existing round assignment ({assignmentId, submissionId, evaluatorId,
 * status, updatedAt}) + mode + caps + existing + filter.
 * Commit (dryRun=false): requires that previewId; the hash is recomputed from
 * current DB state — ANY drift (new/scored/abstained/removed assignment,
 * submission eligibility change, membership change) → 409 "preview is stale".
 * A post-commit re-preview therefore always mints a NEW token (the committed
 * rows are part of the estate).
 *
 * Commit is atomic: removals + additions + audit + the single-use idempotency
 * claim are one store batch (D1) / all-or-nothing unit (Memory). Replay of a
 * committed previewId returns the stored response with `idempotent: true` and
 * creates no rows; concurrent duplicate commits — exactly one applies.
 *
 * Determinism: submissions sorted by id asc, evaluators sorted by id asc.
 * Ineligible submissions (not submitted/in_review) are skipped, never assigned.
 */
export async function bulkAssignEvaluators(
  deps: EvalCommandDeps,
  input: BulkAssignEvaluatorsInput,
): Promise<CommandOk<EvalBulkAssignResponse> | CommandErr> {
  // Cross-field guards (also Zod-refined at the route; kept for direct callers).
  if (input.mode === "all_to_all" && input.reviewersPerSubmission != null) {
    return {
      ok: false,
      status: 400,
      error: "reviewersPerSubmission only applies to round-robin",
      code: "VALIDATION_ERROR",
    };
  }
  if (!input.dryRun && (input.previewId == null || input.previewId === "")) {
    return {
      ok: false,
      status: 400,
      error: "previewId is required to apply a plan — preview first",
      code: "VALIDATION_ERROR",
    };
  }

  const round = await deps.eval.findRoundById(input.roundId);
  if (!round || round.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Eval round not found",
      code: "NOT_FOUND",
    };
  }

  // Idempotent replay first: a committed plan replays its stored response even
  // if the estate has since drifted (the work already happened — E7).
  if (!input.dryRun && input.previewId) {
    const storageKey = `${EVAL_BULK_ASSIGN_IDEMPOTENCY_PREFIX}${input.previewId}`;
    const stored = await deps.eval.findIdempotencyKey(storageKey);
    if (stored && stored.requestHash === input.previewId) {
      if (stored.responseJson) {
        try {
          const cached = JSON.parse(
            stored.responseJson,
          ) as EvalBulkAssignResponse;
          return { ok: true, value: { ...cached, idempotent: true } };
        } catch {
          /* corrupt cache — fall through to recompute */
        }
      }
    }
  }

  // Closed rounds accept no new assignment writes (mirror score/abstain).
  if (isEvalRoundClosed(round)) {
    return roundClosedError(round);
  }

  // Evaluators must hold an evaluator/admin membership on THIS event.
  // Membership rows are part of the estate hash (drift → 409 at commit).
  const evaluatorIds = [...new Set(input.evaluatorIds)].sort();
  const badIds: string[] = [];
  const membershipRows: Array<{ userId: string; role: string | null }> = [];
  for (const userId of evaluatorIds) {
    const membership = await deps.auth.findMembership(input.eventId, userId);
    membershipRows.push({ userId, role: membership?.role ?? null });
    if (
      !membership ||
      (membership.role !== "evaluator" && membership.role !== "admin")
    ) {
      badIds.push(userId);
    }
  }

  // Matched submissions: event-scoped + filter; deterministic id asc.
  const filter = input.submissionFilter ?? {};
  const allSubmissions = await deps.submissions.listSubmissionsForEvent(
    input.eventId,
  );
  const matched = allSubmissions
    .filter((s) => (s.id ?? "").trim() !== "")
    .filter((s) => filter.status == null || s.status === filter.status)
    .filter(
      (s) => filter.category == null || (s.category ?? "") === filter.category,
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  // Existing assignment estate — loaded BEFORE hashing: every row binds the
  // previewId so an add/score/abstain/remove between preview and commit is
  // drift, and a post-commit re-preview always yields a fresh token.
  const existingRows = await deps.eval.listAssignmentsForRound(round.id);

  // Full-estate surrogate hash — previewId (deterministic hex).
  const hash = await sha256Hex(
    JSON.stringify({
      v: 2,
      roundId: round.id,
      roundUpdatedAt: round.updatedAt,
      // id + status: eligibility-relevant fields even without a status filter.
      submissions: matched.map((s) => ({ id: s.id, status: s.status })),
      // Sorted by userId (evaluatorIds is sorted); role binds membership state.
      evaluators: membershipRows,
      assignments: [...existingRows]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((a) => ({
          assignmentId: a.id,
          submissionId: a.submissionId,
          evaluatorId: a.evaluatorUserId,
          status: a.status,
          updatedAt: a.updatedAt,
        })),
      mode: input.mode,
      reviewersPerSubmission: input.reviewersPerSubmission ?? null,
      maxPerEvaluator: input.maxPerEvaluator ?? null,
      existing: input.existing,
      filter: {
        status: filter.status ?? null,
        category: filter.category ?? null,
      },
    }),
  );

  // Commit drift check first: ANY estate change 409s before other validation
  // so a revoked membership between preview and commit reads as staleness.
  if (!input.dryRun && input.previewId !== hash) {
    return {
      ok: false,
      status: 409,
      error:
        "The preview is stale — the round, assignments, evaluators, or matching submissions changed. Preview again.",
      code: "CONFLICT",
      details: { previewId: input.previewId },
    };
  }

  if (badIds.length > 0) {
    return {
      ok: false,
      status: 400,
      error: "Some selected users are not evaluators on this event",
      code: "VALIDATION_ERROR",
      details: { userIds: badIds },
    };
  }
  const byPair = new Map<string, EvalAssignmentRow>();
  for (const a of existingRows) {
    byPair.set(pairKey(a.submissionId, a.evaluatorUserId), a);
  }

  // Cap counters: preserve counts every pre-existing assignment; replace
  // counts only kept (scored/abstained) rows — kept pendings add when planned.
  const counter = new Map<string, number>(evaluatorIds.map((e) => [e, 0]));
  for (const a of existingRows) {
    if (!counter.has(a.evaluatorUserId)) continue;
    if (input.existing === "preserve" || a.status !== "pending") {
      counter.set(a.evaluatorUserId, counter.get(a.evaluatorUserId)! + 1);
    }
  }
  const cap = input.maxPerEvaluator ?? Number.POSITIVE_INFINITY;

  const additions: EvalBulkAssignPair[] = [];
  const skipped: EvalBulkAssignSkip[] = [];
  const capacityFailures: EvalBulkAssignCapacityFailure[] = [];
  const plannedPairs = new Set<string>();

  // Ineligible matched rows are reported, never assigned (10.5 + S-EVAL).
  const eligible: typeof matched = [];
  for (const s of matched) {
    if (!isSubmissionEvalEligible(s.status)) {
      skipped.push({
        submissionId: s.id,
        reason: `Not eligible for review (status ${s.status})`,
      });
      continue;
    }
    eligible.push(s);
  }

  /** Keep an existing pair that the plan would (re)make. */
  const keepExisting = (submissionId: string, e: string, row: EvalAssignmentRow) => {
    plannedPairs.add(pairKey(submissionId, e));
    skipped.push({
      submissionId,
      evaluatorUserId: e,
      reason: "already assigned",
    });
    if (input.existing === "replace" && row.status === "pending") {
      // Kept pending counts toward the cap as planned work.
      counter.set(e, counter.get(e)! + 1);
    }
  };

  if (input.mode === "all_to_all") {
    for (const s of eligible) {
      for (const e of evaluatorIds) {
        const row = byPair.get(pairKey(s.id, e));
        if (row) {
          keepExisting(s.id, e, row);
          continue;
        }
        if (counter.get(e)! >= cap) {
          capacityFailures.push({
            submissionId: s.id,
            evaluatorUserId: e,
            reason: `Evaluator is at the cap of ${cap} assignment${cap === 1 ? "" : "s"}`,
          });
          continue;
        }
        additions.push({ submissionId: s.id, evaluatorUserId: e });
        plannedPairs.add(pairKey(s.id, e));
        counter.set(e, counter.get(e)! + 1);
      }
    }
  } else {
    // round_robin: rotate through evaluators in id order per submission.
    const rps = input.reviewersPerSubmission ?? 1;
    const n = evaluatorIds.length;
    let cursor = 0;
    for (const s of eligible) {
      const chosen = new Set<string>();
      for (const e of evaluatorIds) {
        const row = byPair.get(pairKey(s.id, e));
        if (row) {
          keepExisting(s.id, e, row);
          chosen.add(e);
        }
      }
      let got = chosen.size;
      while (got < rps) {
        let picked = -1;
        for (let step = 0; step < n; step++) {
          const idx = (cursor + step) % n;
          const e = evaluatorIds[idx]!;
          if (chosen.has(e)) continue;
          if (counter.get(e)! >= cap) continue;
          picked = idx;
          break;
        }
        if (picked < 0) break;
        const e = evaluatorIds[picked]!;
        additions.push({ submissionId: s.id, evaluatorUserId: e });
        plannedPairs.add(pairKey(s.id, e));
        counter.set(e, counter.get(e)! + 1);
        chosen.add(e);
        got += 1;
        cursor = (picked + 1) % n;
      }
      if (got < rps) {
        capacityFailures.push({
          submissionId: s.id,
          needed: rps,
          got,
          reason: `Only ${got} of ${rps} reviewer${rps === 1 ? "" : "s"} available for this submission`,
        });
      }
    }
  }

  // existing=replace: pending assignments not in the new plan are removed;
  // scored/abstained rows are NEVER removed — reported as kept.
  const removals: EvalBulkAssignPair[] = [];
  const removalAssignmentIds: string[] = [];
  if (input.existing === "replace") {
    const sortedExisting = [...existingRows].sort((a, b) =>
      a.submissionId === b.submissionId
        ? a.evaluatorUserId.localeCompare(b.evaluatorUserId)
        : a.submissionId.localeCompare(b.submissionId),
    );
    for (const a of sortedExisting) {
      if (plannedPairs.has(pairKey(a.submissionId, a.evaluatorUserId))) {
        continue;
      }
      if (a.status === "pending") {
        removals.push({
          submissionId: a.submissionId,
          evaluatorUserId: a.evaluatorUserId,
        });
        removalAssignmentIds.push(a.id);
      } else {
        skipped.push({
          submissionId: a.submissionId,
          evaluatorUserId: a.evaluatorUserId,
          reason: "has a score — kept",
        });
      }
    }
  }

  // Per-evaluator workload (current → planned), evaluator id asc.
  const perEvaluator: EvalBulkAssignPerEvaluator[] = [];
  for (const e of evaluatorIds) {
    const current = existingRows.filter(
      (a) => a.evaluatorUserId === e,
    ).length;
    const adds = additions.filter((a) => a.evaluatorUserId === e).length;
    const rems = removals.filter((r) => r.evaluatorUserId === e).length;
    const user = await deps.auth.findUserById(e);
    perEvaluator.push({
      userId: e,
      email: user?.email ?? e,
      current,
      planned: Math.max(0, current + adds - rems),
    });
  }

  const value: EvalBulkAssignResponse = {
    previewId: hash,
    dryRun: input.dryRun,
    roundId: round.id,
    mode: input.mode,
    existing: input.existing,
    matchedSubmissionCount: matched.length,
    additions,
    removals,
    skipped,
    perEvaluator,
    capacityFailures,
    counts: {
      additions: additions.length,
      removals: removals.length,
      skipped: skipped.length,
    },
  };

  if (input.dryRun) {
    return { ok: true, value };
  }

  // Commit — one atomic unit (E7): pending-only removals + additions + audit
  // + the single-use idempotency claim commit or roll back together.
  const now = new Date().toISOString();
  const additionRows: EvalAssignmentRow[] = additions.map((pair) => ({
    id: newEvalAssignmentId(),
    roundId: round.id,
    submissionId: pair.submissionId,
    evaluatorUserId: pair.evaluatorUserId,
    status: "pending",
    overallComment: null,
    createdAt: now,
    updatedAt: now,
  }));

  const storageKey = `${EVAL_BULK_ASSIGN_IDEMPOTENCY_PREFIX}${hash}`;
  const committed = await deps.eval.commitBulkAssignAtomic(
    {
      roundId: round.id,
      removalAssignmentIds,
      additions: additionRows,
      idempotency: {
        id: uuidv7(),
        key: storageKey,
        requestHash: hash,
        responseJson: JSON.stringify(value),
        createdAt: now,
      },
      audit: {
        id: uuidv7(),
        eventId: input.eventId,
        actorType: "user",
        actorId: input.actorUserId,
        action: "Eval.BulkAssign",
        entityType: "eval_round",
        entityId: round.id,
        afterJson: JSON.stringify({
          previewId: hash,
          mode: input.mode,
          existing: input.existing,
          matchedSubmissionCount: matched.length,
          counts: value.counts,
          capacityFailureCount: capacityFailures.length,
        }),
        correlationId: input.correlationId,
        createdAt: now,
      },
    },
    (row) => deps.auth.insertAudit(row),
  );

  if (!committed) {
    // Concurrent duplicate commit won the single-use claim — this call wrote
    // nothing. Replay the winner's stored response (same estate hash = same
    // plan by construction).
    const stored = await deps.eval.findIdempotencyKey(storageKey);
    if (stored?.responseJson) {
      try {
        const cached = JSON.parse(
          stored.responseJson,
        ) as EvalBulkAssignResponse;
        return { ok: true, value: { ...cached, idempotent: true } };
      } catch {
        /* corrupt cache — fall through to the equivalent local plan */
      }
    }
    return { ok: true, value: { ...value, idempotent: true } };
  }

  return { ok: true, value };
}

/**
 * GET /api/me/eval-queue — only assignments for the current user.
 * Unassigned submissions are never included (F01).
 * Optional eventId filters to one programme (multi-event evaluators).
 *
 * Batched (no N+1): submissions/scores fetch in bulk; rounds, criteria, and
 * events resolve once per unique id. On D1 every store call is a network hop,
 * so per-assignment lookups made /eval take ~10s at dogfood scale.
 */
export async function getEvalQueue(
  deps: EvalCommandDeps,
  evaluatorUserId: string,
  opts?: { eventId?: string | null },
): Promise<CommandOk<{ items: EvalQueueItem[] }>> {
  const assignments =
    await deps.eval.listAssignmentsForEvaluator(evaluatorUserId);
  const items: EvalQueueItem[] = [];
  const filterEventId = opts?.eventId?.trim() || null;
  if (assignments.length === 0) {
    return { ok: true, value: { items } };
  }

  const [submissionById, scoresByAssignment] = await Promise.all([
    deps.submissions.listSubmissionsByIds(
      assignments.map((a) => a.submissionId),
    ),
    deps.eval.listScoresForAssignments(assignments.map((a) => a.id)),
  ]);

  const uniqueRoundIds = [...new Set(assignments.map((a) => a.roundId))];
  const roundById = new Map<string, EvalRoundRow>();
  const criteriaByRound = new Map<string, EvalCriterionRow[]>();
  await Promise.all(
    uniqueRoundIds.map(async (roundId) => {
      const [round, criteria] = await Promise.all([
        deps.eval.findRoundById(roundId),
        deps.eval.listCriteria(roundId),
      ]);
      if (round) roundById.set(roundId, round);
      criteriaByRound.set(roundId, criteria);
    }),
  );

  const uniqueEventIds = [
    ...new Set([...roundById.values()].map((r) => r.eventId)),
  ];
  const eventById = new Map<string, { id: string; name: string }>();
  await Promise.all(
    uniqueEventIds.map(async (eventId) => {
      const event = await deps.events.findEventById(eventId);
      if (event) eventById.set(eventId, { id: event.id, name: event.name });
    }),
  );

  for (const a of assignments) {
    const submission = submissionById.get(a.submissionId);
    if (!submission) continue;
    if (filterEventId && submission.eventId !== filterEventId) continue;
    const round = roundById.get(a.roundId);
    if (!round) continue;
    if (filterEventId && round.eventId !== filterEventId) continue;
    const event = eventById.get(round.eventId);
    if (!event) continue;
    const criteria = criteriaByRound.get(round.id) ?? [];
    const scoreRows = scoresByAssignment.get(a.id) ?? [];
    const assignmentDto = toAssignmentDtoWithScores(a, criteria, scoreRows);
    const roundDto = toRoundDto(round);
    items.push({
      assignment: assignmentDto,
      submission: {
        id: submission.id,
        title: submission.title,
        eventId: submission.eventId,
        category: submission.category,
        status: submission.status,
      },
      criteria: criteria.map(toCriterionDto),
      event: {
        id: event.id,
        name: event.name,
      },
      round: {
        id: roundDto.id,
        name: roundDto.name,
        status: roundDto.status,
        closesAt: roundDto.closesAt,
        instructionsMd: roundDto.instructionsMd ?? null,
      },
    });
  }

  return { ok: true, value: { items } };
}

/**
 * GET /api/me/eval-assignments/:assignmentId/proposal
 * Full proposal (answers + speakers) for an assignment owned by the evaluator.
 */
export async function getEvalAssignmentProposal(
  deps: EvalCommandDeps,
  assignmentId: string,
  evaluatorUserId: string,
): Promise<CommandOk<EvalProposalResponse> | CommandErr> {
  const assignment = await deps.eval.findAssignmentById(assignmentId);
  if (!assignment) {
    return {
      ok: false,
      status: 404,
      error: "Assignment not found",
      code: "NOT_FOUND",
    };
  }

  // Ownership: only the assigned evaluator may read the proposal (404, not 403).
  if (assignment.evaluatorUserId !== evaluatorUserId) {
    return {
      ok: false,
      status: 404,
      error: "Assignment not found",
      code: "NOT_FOUND",
    };
  }

  const submission = await deps.submissions.findSubmissionById(
    assignment.submissionId,
  );
  if (!submission) {
    return {
      ok: false,
      status: 404,
      error: "Submission not found",
      code: "NOT_FOUND",
    };
  }

  const labelByKey = new Map<string, string>();
  if (deps.forms) {
    try {
      const fields = await deps.forms.listFields(submission.formVersionId);
      for (const f of fields) {
        if (f.label?.trim()) labelByKey.set(f.fieldKey, f.label.trim());
      }
      if (labelByKey.size === 0) {
        const ver = await deps.forms.findVersionById(submission.formVersionId);
        if (ver?.snapshotJson) {
          const snap = JSON.parse(ver.snapshotJson) as {
            fields?: Array<{ fieldKey?: string; label?: string }>;
          };
          for (const f of snap.fields ?? []) {
            if (f.fieldKey && f.label?.trim()) {
              labelByKey.set(f.fieldKey, f.label.trim());
            }
          }
        }
      }
    } catch {
      /* labels optional */
    }
  }

  const answerRows = await deps.submissions.listAnswers(submission.id);
  const answers = answerRows.map((a) => {
    let value: unknown = a.valueJson;
    try {
      value = JSON.parse(a.valueJson) as unknown;
    } catch {
      value = a.valueJson;
    }
    const label = labelByKey.get(a.fieldKey);
    return label
      ? { fieldKey: a.fieldKey, value, label }
      : { fieldKey: a.fieldKey, value };
  });

  // Wave 1B: when the round hides speaker identities, the roster is omitted
  // from the DTO entirely — the names/emails never leave the server (not CSS).
  const round = await deps.eval.findRoundById(assignment.roundId);
  const hideSpeakers = round?.hideSpeakers === true;

  const submissionDto = {
    id: submission.id,
    title: submission.title,
    eventId: submission.eventId,
    category: submission.category,
    status: submission.status,
  };

  if (hideSpeakers) {
    return {
      ok: true,
      value: {
        assignmentId: assignment.id,
        submission: submissionDto,
        answers,
        speakersHidden: true,
      },
    };
  }

  const speakerRows = await deps.submissions.listSpeakers(submission.id);
  const speakers = [];
  for (const s of speakerRows) {
    const person = await deps.submissions.findPersonById(s.personId);
    speakers.push({
      personId: s.personId,
      name: person?.name ?? "",
      email: person?.email ?? "",
      isPrimary: s.isPrimary,
      sortOrder: s.sortOrder,
    });
  }
  speakers.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    ok: true,
    value: {
      assignmentId: assignment.id,
      submission: submissionDto,
      answers,
      speakers,
    },
  };
}

/**
 * Admin rollup: aggregate scores visible to admin per submission.
 *
 * Reliability (S-EVAL-UI / 10.2):
 * - Event row may be absent for synthetic bootstrap memberships (evt_dogfood);
 *   rollup is still event-scoped by id (empty when no rows) — same as Submission.List.
 * - Always emit Zod-valid EvalAdminRollupResponse (coerce numerics, nullish fields,
 *   normalize assignment status) so SPA never sees "Response validation failed".
 * - Skip corrupt submission rows rather than 500 the whole progress view.
 */
export async function getAdminEvalRollup(
  deps: EvalCommandDeps,
  eventId: string,
): Promise<
  CommandOk<{
    round: EvalRoundDto | null;
    criteria: EvalCriterionDto[];
    submissions: EvalAdminSubmissionRollup[];
  }> | CommandErr
> {
  // Prefer real event; bootstrap-only memberships have no row — still rollup by id.
  void (await deps.events.findEventById(eventId));

  const round = await deps.eval.findActiveRoundForEvent(eventId);
  if (!round) {
    return {
      ok: true,
      value: { round: null, criteria: [], submissions: [] },
    };
  }

  const criteria = await deps.eval.listCriteria(round.id);
  const allAssignments = await deps.eval.listAssignmentsForRound(round.id);
  const submissions = await deps.submissions.listSubmissionsForEvent(eventId);

  // Batched lookups (S-EVAL performance): the previous shape awaited
  // assignmentAggregate + listScores + findUserById PER assignment — hundreds
  // of sequential D1 round-trips (~4s live; blew the 12s client abort for far
  // viewers). Batch, don't fan out: one chunked scores query for ALL
  // assignment ids, one chunked users query for ALL evaluator ids, and
  // aggregates computed in memory from the preloaded scores.
  const validAssignments = allAssignments.filter((a) => (a.id ?? "").trim());
  // Pre-group by submissionId — repeated allAssignments.filter(...) per
  // submission is avoidable quadratic work.
  const assignmentsBySubmission = new Map<string, EvalAssignmentRow[]>();
  for (const a of validAssignments) {
    const list = assignmentsBySubmission.get(a.submissionId);
    if (list) list.push(a);
    else assignmentsBySubmission.set(a.submissionId, [a]);
  }
  const [scoresByAssignment, usersById] = await Promise.all([
    deps.eval.listScoresForAssignments(validAssignments.map((a) => a.id)),
    deps.auth.findUsersByIds(validAssignments.map((a) => a.evaluatorUserId)),
  ]);

  const rollups: EvalAdminSubmissionRollup[] = [];
  for (const sub of submissions) {
    // Harden against corrupt SoR rows — skip rather than 500 the whole rollup.
    const submissionId = (sub.id ?? "").trim();
    if (!submissionId) continue;
    // Incomplete public drafts are not evaluation candidates (10.5).
    // Exclude from progress rollup and CSV export.
    if (sub.status === "draft") continue;
    const title = (sub.title ?? "").trim() || "(untitled)";
    const status =
      typeof sub.status === "string" && sub.status.trim() !== ""
        ? sub.status
        : "submitted";
    const category =
      sub.category == null || sub.category === ""
        ? null
        : String(sub.category);

    const subAssignments = assignmentsBySubmission.get(submissionId) ?? [];
    const assignmentSummaries: EvalAdminSubmissionRollup["assignments"] = [];
    const aggregates: number[] = [];
    for (const a of subAssignments) {
      const scoreRows = scoresByAssignment.get(a.id) ?? [];
      const agg = aggregateFromScoreRows(a.status, criteria, scoreRows);
      const safeAgg =
        agg != null && Number.isFinite(agg) ? agg : null;
      if (safeAgg != null) aggregates.push(safeAgg);
      const scores = scoreRows.map((s) => ({
        criterionId: s.criterionId,
        value: finiteOr(s.value, 0),
      }));
      const evaluator = usersById.get(a.evaluatorUserId) ?? null;
      assignmentSummaries.push({
        id: a.id,
        evaluatorUserId: a.evaluatorUserId,
        evaluatorEmail: evaluator?.email ?? null,
        status: asAssignmentStatus(a.status),
        aggregateScore: safeAgg,
        overallComment: a.overallComment ?? null,
        abstainReason: a.abstainReason ?? null,
        scores,
      });
    }
    const mean =
      aggregates.length > 0
        ? aggregates.reduce((s, v) => s + v, 0) / aggregates.length
        : null;
    const abstainedCount = assignmentSummaries.filter(
      (a) => a.status === "abstained",
    ).length;
    rollups.push({
      submissionId,
      title,
      category,
      status,
      aggregateScore:
        mean != null && Number.isFinite(mean) ? mean : null,
      // Divergence: max−min across scored assignment aggregates (≥2 required).
      scoreSpread: computeScoreSpread(aggregates),
      abstainedCount,
      assignments: assignmentSummaries,
    });
  }

  return {
    ok: true,
    value: {
      round: toRoundDto(round),
      criteria: criteria.map(toCriterionDto),
      submissions: rollups,
    },
  };
}

/**
 * Individual reviews for a submission (deliberation visibility).
 * Policy: admins see all reviews; evaluators with an assignment on the
 * submission see their own always and peers only when peer status is `scored`.
 * No discussion threads.
 */
export async function getSubmissionEvalReviews(
  deps: EvalCommandDeps,
  input: {
    submissionId: string;
    actorUserId: string;
    isAdmin: boolean;
  },
): Promise<CommandOk<EvalReviewsResponse> | CommandErr> {
  const submission = await deps.submissions.findSubmissionById(
    input.submissionId,
  );
  if (!submission) {
    return {
      ok: false,
      status: 404,
      error: "Submission not found",
      code: "NOT_FOUND",
    };
  }

  const allForSubmission = await deps.eval.listAssignmentsForSubmission(
    input.submissionId,
  );

  if (!input.isAdmin) {
    const owns = allForSubmission.some(
      (a) => a.evaluatorUserId === input.actorUserId,
    );
    if (!owns) {
      return {
        ok: false,
        status: 403,
        error: "Not assigned to this submission",
        code: "FORBIDDEN",
      };
    }
  }

  // Prefer active-round assignments when a round exists; else all.
  const activeRound = await deps.eval.findActiveRoundForEvent(
    submission.eventId,
  );
  const assignments =
    activeRound != null
      ? allForSubmission.filter((a) => a.roundId === activeRound.id)
      : allForSubmission;

  const criteriaByRound = new Map<string, EvalCriterionRow[]>();
  const reviews: EvalReviewItem[] = [];

  for (const a of assignments) {
    const status = asAssignmentStatus(a.status);
    const isSelf = a.evaluatorUserId === input.actorUserId;

    // Non-admin: reveal peers only after they have submitted (scored).
    if (!input.isAdmin && !isSelf && status !== "scored") {
      continue;
    }

    let criteria = criteriaByRound.get(a.roundId);
    if (!criteria) {
      criteria = await deps.eval.listCriteria(a.roundId);
      criteriaByRound.set(a.roundId, criteria);
    }

    const agg = await assignmentAggregate(deps, a, criteria);
    const scoreRows = await deps.eval.listScores(a.id);
    const evaluator = await deps.auth.findUserById(a.evaluatorUserId);

    reviews.push({
      assignmentId: a.id,
      evaluatorUserId: a.evaluatorUserId,
      evaluatorEmail: evaluator?.email ?? null,
      status,
      overallComment: a.overallComment ?? null,
      // Reason visible to admins (and self) in review detail.
      abstainReason: input.isAdmin || isSelf ? (a.abstainReason ?? null) : null,
      aggregateScore:
        agg != null && Number.isFinite(agg) ? agg : null,
      scores: scoreRows.map((s) => ({
        criterionId: s.criterionId,
        value: finiteOr(s.value, 0),
      })),
      isSelf,
    });
  }

  // Stable order: self first, then scored, then by evaluator email/id
  reviews.sort((x, y) => {
    if (x.isSelf && !y.isSelf) return -1;
    if (!x.isSelf && y.isSelf) return 1;
    if (x.status === "scored" && y.status !== "scored") return -1;
    if (x.status !== "scored" && y.status === "scored") return 1;
    const ex = (x.evaluatorEmail ?? x.evaluatorUserId).toLowerCase();
    const ey = (y.evaluatorEmail ?? y.evaluatorUserId).toLowerCase();
    return ex.localeCompare(ey);
  });

  return {
    ok: true,
    value: { submissionId: input.submissionId, reviews },
  };
}

/**
 * Eval.ExportScores — CSV of submission scores/status for the active round.
 * Section 10.6 / S-EVAL-EXPORT (ABS-13-class single-round export).
 * Sort defaults to score_desc (null aggregates last).
 * Delegates to getAdminEvalRollup, so it shares the batched (non-N+1)
 * scores/users lookups — as does the Overview readiness request.
 */
export async function exportAdminEvalCsv(
  deps: EvalCommandDeps,
  eventId: string,
  sort: EvalScoreSort = "score_desc",
): Promise<
  CommandOk<{ csv: string; filename: string }> | CommandErr
> {
  const rollup = await getAdminEvalRollup(deps, eventId);
  if (!rollup.ok) return rollup;

  const ordered = sortEvalSubmissionsByScore(
    rollup.value.submissions,
    sort,
  );
  const csv = evalRollupToCsv(ordered, { sort });
  const safeEvent = eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const filename = `eval-scores-${safeEvent}.csv`;
  return { ok: true, value: { csv, filename } };
}
