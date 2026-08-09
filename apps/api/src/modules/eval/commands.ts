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
  coerceFiniteNumber,
  sortEvalSubmissionsByScore,
  evalRollupToCsv,
  isSubmissionEvalEligible,
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
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
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
  return status === "scored" ? "scored" : "pending";
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

async function assignmentAggregate(
  deps: EvalCommandDeps,
  assignment: EvalAssignmentRow,
  criteria: EvalCriterionRow[],
): Promise<number | null> {
  if (assignment.status !== "scored") return null;
  const scoreRows = await deps.eval.listScores(assignment.id);
  const byCriterion = new Map(criteria.map((c) => [c.id, c]));
  const items: Array<{ value: number; weight: number }> = [];
  for (const s of scoreRows) {
    const c = byCriterion.get(s.criterionId);
    if (!c) continue;
    items.push({ value: s.value, weight: c.weight });
  }
  return computeWeightedAggregate(items);
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
        updatedAt: now,
      })) ?? round;
  } else {
    round = await deps.eval.findActiveRoundForEvent(input.eventId);
    if (round) {
      round =
        (await deps.eval.updateRound(round.id, {
          name: input.name ?? round.name,
          updatedAt: now,
        })) ?? round;
    } else {
      round = await deps.eval.insertRound({
        id: newEvalRoundId(),
        eventId: input.eventId,
        name: input.name ?? "Default rubric",
        status: "open",
        closesAt: null,
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

/**
 * GET /api/me/eval-queue — only assignments for the current user.
 * Unassigned submissions are never included (F01).
 */
export async function getEvalQueue(
  deps: EvalCommandDeps,
  evaluatorUserId: string,
): Promise<CommandOk<{ items: EvalQueueItem[] }>> {
  const assignments =
    await deps.eval.listAssignmentsForEvaluator(evaluatorUserId);
  const items: EvalQueueItem[] = [];

  for (const a of assignments) {
    const submission = await deps.submissions.findSubmissionById(
      a.submissionId,
    );
    if (!submission) continue;
    const round = await deps.eval.findRoundById(a.roundId);
    if (!round) continue;
    const event = await deps.events.findEventById(round.eventId);
    if (!event) continue;
    const criteria = await deps.eval.listCriteria(round.id);
    const assignmentDto = await toAssignmentDto(deps, a, criteria, true);
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
    });
  }

  return { ok: true, value: { items } };
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

    const subAssignments = allAssignments.filter(
      (a) => a.submissionId === submissionId,
    );
    const assignmentSummaries: EvalAdminSubmissionRollup["assignments"] = [];
    const aggregates: number[] = [];
    for (const a of subAssignments) {
      if (!(a.id ?? "").trim()) continue;
      const agg = await assignmentAggregate(deps, a, criteria);
      const safeAgg =
        agg != null && Number.isFinite(agg) ? agg : null;
      if (safeAgg != null) aggregates.push(safeAgg);
      assignmentSummaries.push({
        id: a.id,
        evaluatorUserId: a.evaluatorUserId,
        status: asAssignmentStatus(a.status),
        aggregateScore: safeAgg,
      });
    }
    const mean =
      aggregates.length > 0
        ? aggregates.reduce((s, v) => s + v, 0) / aggregates.length
        : null;
    rollups.push({
      submissionId,
      title,
      category,
      status,
      aggregateScore:
        mean != null && Number.isFinite(mean) ? mean : null,
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
 * Eval.ExportScores — CSV of submission scores/status for the active round.
 * Section 10.6 / S-EVAL-EXPORT (ABS-13-class single-round export).
 * Sort defaults to score_desc (null aggregates last).
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
