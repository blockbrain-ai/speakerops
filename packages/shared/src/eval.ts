import { z } from "zod";

/**
 * Evaluation scoring DTOs (section 3.4 / S-EVAL + 10.2 progress contract).
 * Commands: Eval.UpsertRubric · Eval.Score · Submission.AssignEvaluators
 * HTTP: PUT/GET /api/events/:eventId/eval/rubric
 *       GET /api/events/:eventId/eval/rollup
 *       POST /api/assignments/:assignmentId/scores
 *       GET /api/me/eval-queue
 *       POST /api/submissions/:submissionId/assign
 * Human scoring only — no AI.
 *
 * Section 10.2: response schemas accept production / D1-shaped numbers
 * (string numerics from some SQLite bindings) and nullish optionals so
 * admin evaluations never 500 with "Response validation failed".
 */

export const EvalRoundStatusSchema = z.enum(["open", "closed"]);
export type EvalRoundStatus = z.infer<typeof EvalRoundStatusSchema>;

export const EvalAssignmentStatusSchema = z.enum(["pending", "scored"]);
export type EvalAssignmentStatus = z.infer<typeof EvalAssignmentStatusSchema>;

/**
 * Finite number from number | numeric string (D1/SQLite quirks).
 * Rejects NaN/Infinity. Does not coerce null/undefined (caller controls nullability).
 */
export function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Zod helper: accept number or numeric string → finite number. */
const FiniteNumberSchema = z.preprocess((v) => {
  if (v === null || v === undefined) return v;
  const n = coerceFiniteNumber(v);
  return n === undefined ? v : n;
}, z.number().finite());

/** Nullable finite score (aggregate); null/undefined → null; NaN → fail then null via preprocess. */
const NullableFiniteNumberSchema = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  const n = coerceFiniteNumber(v);
  return n === undefined ? v : n;
}, z.number().finite().nullable());

/** nullish string → string | null (closesAt, comments, category). */
const NullableStringSchema = z.preprocess(
  (v) => (v === undefined || v === "" ? null : v),
  z.string().nullable(),
);

/** Rubric criterion input (UpsertRubric). */
export const EvalCriterionInputSchema = z.object({
  /** Optional stable id for replace-in-place; new UUID when omitted. */
  id: z.string().min(1).max(128).optional(),
  name: z.string().min(1).max(200),
  maxScore: z.number().positive().max(10_000),
  weight: z.number().positive().max(10_000).default(1),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type EvalCriterionInput = z.infer<typeof EvalCriterionInputSchema>;

/** Eval.UpsertRubric body (eventId from path). */
export const EvalUpsertRubricBodySchema = z.object({
  /** Optional existing round; when omitted, open/create the event's active round. */
  roundId: z.string().min(1).max(128).optional(),
  name: z.string().min(1).max(200).optional(),
  criteria: z.array(EvalCriterionInputSchema).min(1).max(50),
});
export type EvalUpsertRubricBody = z.infer<typeof EvalUpsertRubricBodySchema>;

export const EvalCriterionSchema = z.object({
  id: z.string().min(1),
  roundId: z.string().min(1),
  name: z.string(),
  maxScore: FiniteNumberSchema,
  weight: FiniteNumberSchema,
  sortOrder: z.preprocess((v) => {
    const n = coerceFiniteNumber(v);
    return n === undefined ? v : Math.trunc(n);
  }, z.number().int()),
});
export type EvalCriterionDto = z.infer<typeof EvalCriterionSchema>;

export const EvalRoundSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string(),
  status: EvalRoundStatusSchema,
  closesAt: NullableStringSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EvalRoundDto = z.infer<typeof EvalRoundSchema>;

export const EvalRubricResponseSchema = z.object({
  round: EvalRoundSchema,
  criteria: z.array(EvalCriterionSchema),
});
export type EvalRubricResponse = z.infer<typeof EvalRubricResponseSchema>;

/** Per-criterion score on Eval.Score. */
export const EvalScoreItemSchema = z.object({
  criterionId: z.string().min(1).max(128),
  value: z.number(),
  comment: z.string().max(2000).nullable().optional(),
});
export type EvalScoreItem = z.infer<typeof EvalScoreItemSchema>;

/** Eval.Score body. */
export const EvalScoreBodySchema = z.object({
  scores: z.array(EvalScoreItemSchema).min(1).max(50),
  comment: z.string().max(4000).nullable().optional(),
});
export type EvalScoreBody = z.infer<typeof EvalScoreBodySchema>;

export const ScoreDtoSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  criterionId: z.string().min(1),
  value: FiniteNumberSchema,
  comment: NullableStringSchema,
});
export type ScoreDto = z.infer<typeof ScoreDtoSchema>;

export const EvalAssignmentSchema = z.object({
  id: z.string().min(1),
  roundId: z.string().min(1),
  submissionId: z.string().min(1),
  evaluatorUserId: z.string().min(1),
  status: EvalAssignmentStatusSchema,
  overallComment: NullableStringSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Weighted aggregate when scored; null when pending. */
  aggregateScore: NullableFiniteNumberSchema.optional(),
  scores: z.array(ScoreDtoSchema).optional(),
});
export type EvalAssignmentDto = z.infer<typeof EvalAssignmentSchema>;

export const EvalScoreResponseSchema = z.object({
  assignment: EvalAssignmentSchema,
});
export type EvalScoreResponse = z.infer<typeof EvalScoreResponseSchema>;

/** Queue item for GET /api/me/eval-queue. */
export const EvalQueueItemSchema = z.object({
  assignment: EvalAssignmentSchema,
  submission: z.object({
    id: z.string().min(1),
    title: z.string(),
    eventId: z.string().min(1),
    category: NullableStringSchema,
    status: z.string(),
  }),
  criteria: z.array(EvalCriterionSchema),
  event: z.object({
    id: z.string().min(1),
    name: z.string(),
  }),
});
export type EvalQueueItem = z.infer<typeof EvalQueueItemSchema>;

export const EvalQueueResponseSchema = z.object({
  items: z.array(EvalQueueItemSchema),
});
export type EvalQueueResponse = z.infer<typeof EvalQueueResponseSchema>;

/** Submission.AssignEvaluators body. */
export const SubmissionAssignBodySchema = z.object({
  userIds: z.array(z.string().min(1).max(128)).min(1).max(50),
});
export type SubmissionAssignBody = z.infer<typeof SubmissionAssignBodySchema>;

export const SubmissionAssignResponseSchema = z.object({
  assignments: z.array(EvalAssignmentSchema),
});
export type SubmissionAssignResponse = z.infer<
  typeof SubmissionAssignResponseSchema
>;

/**
 * Admin rollup for a submission under an event's active round.
 * Aggregate score visible to admin (section 3.4 AC / 10.2 S-EVAL-UI).
 */
export const EvalAdminSubmissionRollupSchema = z.object({
  submissionId: z.string().min(1),
  title: z.string(),
  category: NullableStringSchema,
  status: z.string(),
  /** Mean of assignment aggregates when any scored; null otherwise. */
  aggregateScore: NullableFiniteNumberSchema,
  assignments: z.array(
    z.object({
      id: z.string().min(1),
      evaluatorUserId: z.string().min(1),
      status: EvalAssignmentStatusSchema,
      aggregateScore: NullableFiniteNumberSchema,
    }),
  ),
});
export type EvalAdminSubmissionRollup = z.infer<
  typeof EvalAdminSubmissionRollupSchema
>;

export const EvalAdminRollupResponseSchema = z.object({
  round: EvalRoundSchema.nullable(),
  criteria: z.array(EvalCriterionSchema),
  submissions: z.array(EvalAdminSubmissionRollupSchema),
});
export type EvalAdminRollupResponse = z.infer<
  typeof EvalAdminRollupResponseSchema
>;

/**
 * Weighted aggregate: sum(value * weight) / sum(weight).
 * Returns null when there are no scored criteria or result is non-finite.
 */
export function computeWeightedAggregate(
  items: ReadonlyArray<{ value: number; weight: number }>,
): number | null {
  if (items.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const item of items) {
    const value = coerceFiniteNumber(item.value);
    const weight = coerceFiniteNumber(item.weight);
    if (value === undefined || weight === undefined) continue;
    num += value * weight;
    den += weight;
  }
  if (den <= 0) return null;
  const out = num / den;
  return Number.isFinite(out) ? out : null;
}
