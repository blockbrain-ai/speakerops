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

export const EvalAssignmentStatusSchema = z.enum([
  "pending",
  "scored",
  "abstained",
]);
export type EvalAssignmentStatus = z.infer<typeof EvalAssignmentStatusSchema>;

/**
 * Round-close check (post-11.9 depth). A round is closed for scoring when its
 * status is `closed` OR its closesAt deadline has passed. Eval.Score and
 * Eval.Abstain reject with 409 after close.
 */
export function isEvalRoundClosed(
  round: { status: string; closesAt?: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (round.status === "closed") return true;
  if (round.closesAt) {
    const closeMs = Date.parse(round.closesAt);
    if (Number.isFinite(closeMs) && nowMs > closeMs) return true;
  }
  return false;
}

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
  /** Review deadline (ISO-8601). null clears; omitted keeps current. */
  closesAt: z.string().min(1).max(64).optional().nullable(),
  /** Evaluator guidance (plain text / markdown-safe; never HTML-executed). */
  instructionsMd: z.string().max(10_000).optional().nullable(),
  /**
   * Hide speaker identities from evaluators (Wave 1B): the evaluator proposal
   * DTO omits speakers[] server-side. Omitted keeps the current value.
   * Honest scope: titles/answers may still reveal identity.
   */
  hideSpeakers: z.boolean().optional(),
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
  /** Evaluator guidance (plain text render only). */
  instructionsMd: NullableStringSchema.optional(),
  /** True when evaluator proposal DTOs omit speakers[] (0029; default false). */
  hideSpeakers: z.boolean().optional(),
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
  /** Optional evaluator-provided reason when status is abstained. */
  abstainReason: NullableStringSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Weighted aggregate when scored; null when pending/abstained. */
  aggregateScore: NullableFiniteNumberSchema.optional(),
  scores: z.array(ScoreDtoSchema).optional(),
});
export type EvalAssignmentDto = z.infer<typeof EvalAssignmentSchema>;

/** Eval.Abstain body — POST /api/me/eval-assignments/:assignmentId/abstain */
export const EvalAbstainBodySchema = z.object({
  /** Optional short reason shown to admins (conflict of interest, …). */
  reason: z.string().max(2000).optional().nullable(),
});
export type EvalAbstainBody = z.infer<typeof EvalAbstainBodySchema>;

export const EvalAbstainResponseSchema = z.object({
  assignment: EvalAssignmentSchema,
});
export type EvalAbstainResponse = z.infer<typeof EvalAbstainResponseSchema>;

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
  /** Active review round context for evaluator strip (deadline / guidance). */
  round: EvalRoundSchema.pick({
    id: true,
    name: true,
    status: true,
    closesAt: true,
    instructionsMd: true,
  }),
});
export type EvalQueueItem = z.infer<typeof EvalQueueItemSchema>;

export const EvalQueueResponseSchema = z.object({
  items: z.array(EvalQueueItemSchema),
});
export type EvalQueueResponse = z.infer<typeof EvalQueueResponseSchema>;

/**
 * Proposal payload for an assigned evaluation — answers + speakers beside the rubric.
 * GET /api/me/eval-assignments/:assignmentId/proposal (session evaluator owns assignment).
 */
export const EvalProposalAnswerSchema = z.object({
  fieldKey: z.string().min(1),
  /** Human label from pinned form version when available. */
  label: z.string().min(1).max(256).optional(),
  value: z.unknown(),
});
export type EvalProposalAnswer = z.infer<typeof EvalProposalAnswerSchema>;

export const EvalProposalSpeakerSchema = z.object({
  personId: z.string().min(1),
  name: z.string(),
  email: z.string(),
  isPrimary: z.boolean(),
  sortOrder: z.preprocess((v) => {
    const n = coerceFiniteNumber(v);
    return n === undefined ? v : Math.trunc(n);
  }, z.number().int()),
});
export type EvalProposalSpeaker = z.infer<typeof EvalProposalSpeakerSchema>;

export const EvalProposalResponseSchema = z.object({
  assignmentId: z.string().min(1),
  submission: z.object({
    id: z.string().min(1),
    title: z.string(),
    eventId: z.string().min(1),
    category: NullableStringSchema,
    status: z.string(),
  }),
  answers: z.array(EvalProposalAnswerSchema),
  /**
   * Omitted entirely when the round hides speaker identities (Wave 1B) —
   * the roster never reaches the evaluator client (server-side, not CSS).
   */
  speakers: z.array(EvalProposalSpeakerSchema).optional(),
  /** True when the round hides speaker identities (honest UI copy). */
  speakersHidden: z.boolean().optional(),
});
export type EvalProposalResponse = z.infer<typeof EvalProposalResponseSchema>;

/**
 * Eval.BulkAssign — cohort assignment wizard (Wave 2).
 * POST /api/events/:eventId/eval/bulk-assign
 * Preview (dryRun=true) computes a deterministic plan and a previewId
 * (SHA-256 over the round version surrogate + matched estate + knobs).
 * Commit (dryRun=false) requires that previewId; estate drift → 409.
 */
export const EvalBulkAssignModeSchema = z.enum(["all_to_all", "round_robin"]);
export type EvalBulkAssignMode = z.infer<typeof EvalBulkAssignModeSchema>;

export const EvalBulkAssignExistingSchema = z.enum(["preserve", "replace"]);
export type EvalBulkAssignExisting = z.infer<
  typeof EvalBulkAssignExistingSchema
>;

export const EvalBulkAssignSubmissionFilterSchema = z.object({
  /** Exact submission status match (e.g. submitted | in_review). */
  status: z.string().min(1).max(64).optional(),
  /** Exact category match. */
  category: z.string().min(1).max(200).optional(),
});
export type EvalBulkAssignSubmissionFilter = z.infer<
  typeof EvalBulkAssignSubmissionFilterSchema
>;

export const EvalBulkAssignBodySchema = z
  .object({
    roundId: z.string().min(1).max(128),
    evaluatorIds: z.array(z.string().min(1).max(128)).min(1).max(100),
    submissionFilter: EvalBulkAssignSubmissionFilterSchema.optional().default(
      {},
    ),
    mode: EvalBulkAssignModeSchema,
    /** round_robin only — reviewers picked per submission (default 1). */
    reviewersPerSubmission: z.number().int().min(1).max(20).optional(),
    /** Cap per evaluator (pre-existing assignments count when preserving). */
    maxPerEvaluator: z.number().int().min(1).max(500).optional(),
    existing: EvalBulkAssignExistingSchema,
    dryRun: z.boolean(),
    /** Required when dryRun=false — the hash returned by the preview. */
    previewId: z.string().min(1).max(128).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "all_to_all" && v.reviewersPerSubmission != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewersPerSubmission"],
        message: "reviewersPerSubmission only applies to round-robin",
      });
    }
    if (!v.dryRun && (v.previewId == null || v.previewId === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["previewId"],
        message: "previewId is required to apply a plan — preview first",
      });
    }
  });
export type EvalBulkAssignBody = z.infer<typeof EvalBulkAssignBodySchema>;

/** One (submission, evaluator) pair in additions[] / removals[]. */
export const EvalBulkAssignPairSchema = z.object({
  submissionId: z.string().min(1),
  evaluatorUserId: z.string().min(1),
});
export type EvalBulkAssignPair = z.infer<typeof EvalBulkAssignPairSchema>;

/** Skipped entry — human reason ("already assigned", "has a score — kept", …). */
export const EvalBulkAssignSkipSchema = z.object({
  submissionId: z.string().min(1).optional(),
  evaluatorUserId: z.string().min(1).optional(),
  reason: z.string().min(1),
});
export type EvalBulkAssignSkip = z.infer<typeof EvalBulkAssignSkipSchema>;

/**
 * Capacity shortfall: round_robin reports {submissionId, needed, got};
 * all_to_all reports the capped pair {submissionId, evaluatorUserId}.
 */
export const EvalBulkAssignCapacityFailureSchema = z.object({
  submissionId: z.string().min(1).optional(),
  evaluatorUserId: z.string().min(1).optional(),
  needed: z.number().int().min(0).optional(),
  got: z.number().int().min(0).optional(),
  reason: z.string().min(1),
});
export type EvalBulkAssignCapacityFailure = z.infer<
  typeof EvalBulkAssignCapacityFailureSchema
>;

export const EvalBulkAssignPerEvaluatorSchema = z.object({
  userId: z.string().min(1),
  email: z.string(),
  /** Assignments already on the round before this plan. */
  current: z.number().int().min(0),
  /** Assignments after the plan applies (current + additions − removals). */
  planned: z.number().int().min(0),
});
export type EvalBulkAssignPerEvaluator = z.infer<
  typeof EvalBulkAssignPerEvaluatorSchema
>;

export const EvalBulkAssignResponseSchema = z.object({
  previewId: z.string().min(1),
  dryRun: z.boolean(),
  roundId: z.string().min(1),
  mode: EvalBulkAssignModeSchema,
  existing: EvalBulkAssignExistingSchema,
  matchedSubmissionCount: z.number().int().min(0),
  additions: z.array(EvalBulkAssignPairSchema),
  removals: z.array(EvalBulkAssignPairSchema),
  skipped: z.array(EvalBulkAssignSkipSchema),
  perEvaluator: z.array(EvalBulkAssignPerEvaluatorSchema),
  capacityFailures: z.array(EvalBulkAssignCapacityFailureSchema),
  counts: z.object({
    additions: z.number().int().min(0),
    removals: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  /** True when a commit replayed the stored response (no new rows). */
  idempotent: z.boolean().optional(),
});
export type EvalBulkAssignResponse = z.infer<
  typeof EvalBulkAssignResponseSchema
>;

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
 * Per-criterion score summary on admin rollup / peer reviews (value only).
 */
export const EvalReviewScoreSchema = z.object({
  criterionId: z.string().min(1),
  value: FiniteNumberSchema,
});
export type EvalReviewScore = z.infer<typeof EvalReviewScoreSchema>;

/**
 * Admin rollup for a submission under an event's active round.
 * Aggregate score + individual review visibility (deliberation / Area 3).
 */
export const EvalAdminSubmissionRollupSchema = z.object({
  submissionId: z.string().min(1),
  title: z.string(),
  category: NullableStringSchema,
  status: z.string(),
  /** Mean of assignment aggregates when any scored; null otherwise. */
  aggregateScore: NullableFiniteNumberSchema,
  /**
   * Largest max−min spread across scored assignment aggregates (divergence).
   * null when fewer than two scored assignments. Abstentions excluded.
   */
  scoreSpread: NullableFiniteNumberSchema.optional(),
  /** Count of abstained assignments (excluded from aggregates). */
  abstainedCount: z.number().int().min(0).optional(),
  assignments: z.array(
    z.object({
      id: z.string().min(1),
      evaluatorUserId: z.string().min(1),
      /** Resolved from users store when available. */
      evaluatorEmail: NullableStringSchema.optional(),
      status: EvalAssignmentStatusSchema,
      aggregateScore: NullableFiniteNumberSchema,
      overallComment: NullableStringSchema.optional(),
      abstainReason: NullableStringSchema.optional(),
      scores: z.array(EvalReviewScoreSchema).optional(),
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
 * Individual reviews for a submission (admin always; evaluator peers after scored).
 * GET /api/submissions/:submissionId/eval-reviews
 */
export const EvalReviewItemSchema = z.object({
  assignmentId: z.string().min(1),
  evaluatorUserId: z.string().min(1),
  evaluatorEmail: NullableStringSchema,
  status: EvalAssignmentStatusSchema,
  overallComment: NullableStringSchema,
  abstainReason: NullableStringSchema.optional(),
  aggregateScore: NullableFiniteNumberSchema,
  scores: z.array(EvalReviewScoreSchema),
  /** True when this assignment belongs to the requesting evaluator. */
  isSelf: z.boolean().optional(),
});
export type EvalReviewItem = z.infer<typeof EvalReviewItemSchema>;

export const EvalReviewsResponseSchema = z.object({
  submissionId: z.string().min(1),
  reviews: z.array(EvalReviewItemSchema),
});
export type EvalReviewsResponse = z.infer<typeof EvalReviewsResponseSchema>;

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

/**
 * Divergence spread: max−min across scored assignment aggregates.
 * Returns null when fewer than two finite values (no meaningful spread).
 */
export function computeScoreSpread(
  aggregates: ReadonlyArray<number | null | undefined>,
): number | null {
  const finite = aggregates.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (finite.length < 2) return null;
  return Math.max(...finite) - Math.min(...finite);
}

/**
 * Single-round admin eval sort keys (section 10.6 / S-EVAL-EXPORT / ABS-13-class).
 * Default score_desc puts highest aggregates first; unscored (null) last.
 */
export const EvalScoreSortSchema = z.enum([
  "score_desc",
  "score_asc",
  "title",
]);
export type EvalScoreSort = z.infer<typeof EvalScoreSortSchema>;

export type EvalSortableSubmission = {
  submissionId: string;
  title: string;
  aggregateScore: number | null;
};

/**
 * Sort rollup rows by aggregate score or title.
 * - score_desc: highest first; null aggregates last; stable by title then id
 * - score_asc: lowest first; null aggregates last
 * - title: case-insensitive title, then submissionId
 */
export function sortEvalSubmissionsByScore<T extends EvalSortableSubmission>(
  rows: readonly T[],
  sort: EvalScoreSort = "score_desc",
): T[] {
  const copy = [...rows];
  const titleCmp = (a: T, b: T) => {
    const t = a.title.localeCompare(b.title, undefined, {
      sensitivity: "base",
    });
    if (t !== 0) return t;
    return a.submissionId.localeCompare(b.submissionId);
  };
  if (sort === "title") {
    copy.sort(titleCmp);
    return copy;
  }
  const desc = sort === "score_desc";
  copy.sort((a, b) => {
    const aNull = a.aggregateScore == null || !Number.isFinite(a.aggregateScore);
    const bNull = b.aggregateScore == null || !Number.isFinite(b.aggregateScore);
    if (aNull && bNull) return titleCmp(a, b);
    if (aNull) return 1;
    if (bNull) return -1;
    const av = a.aggregateScore as number;
    const bv = b.aggregateScore as number;
    if (av !== bv) return desc ? bv - av : av - bv;
    return titleCmp(a, b);
  });
  return copy;
}

/**
 * Neutralize spreadsheet formula injection (CSV/formula injection).
 * Cells beginning with =, +, -, @ (or tab/CR before those) are treated as
 * formulas by Excel/LibreOffice when admins open eval exports.
 * Prefix with a single quote so the value is forced to text.
 */
export function neutralizeCsvFormula(value: string): string {
  if (/^[\t\r\n ]*[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/** Escape one CSV field (RFC 4180-ish: quote when needed + formula-safe). */
export function csvEscapeField(value: string): string {
  const safe = neutralizeCsvFormula(value);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export type EvalCsvRow = {
  submissionId: string;
  title: string;
  status: string;
  category?: string | null;
  aggregateScore: number | null;
  assignments: readonly {
    status: string;
    overallComment?: string | null;
    evaluatorEmail?: string | null;
    abstainReason?: string | null;
  }[];
};

/**
 * Build CSV of scores/status for an event (single-round admin export).
 * Columns: submissionId,title,status,category,aggregateScore,assignmentCount,scoredCount,
 *          abstainedCount,evaluatorEmails,overallComments,abstainReasons
 * Abstained assignments count distinctly and never contribute to aggregates.
 */
export function evalRollupToCsv(
  rows: readonly EvalCsvRow[],
  options?: { sort?: EvalScoreSort },
): string {
  const sorted = sortEvalSubmissionsByScore(
    rows.map((r) => ({
      submissionId: r.submissionId,
      title: r.title,
      aggregateScore: r.aggregateScore,
    })),
    options?.sort ?? "score_desc",
  );
  const byId = new Map(rows.map((r) => [r.submissionId, r]));
  const header = [
    "submissionId",
    "title",
    "status",
    "category",
    "aggregateScore",
    "assignmentCount",
    "scoredCount",
    "abstainedCount",
    "evaluatorEmails",
    "overallComments",
    "abstainReasons",
  ].join(",");
  const lines = [header];
  for (const key of sorted) {
    const r = byId.get(key.submissionId);
    if (!r) continue;
    const scoredCount = r.assignments.filter((a) => a.status === "scored")
      .length;
    const abstainedCount = r.assignments.filter(
      (a) => a.status === "abstained",
    ).length;
    const score =
      r.aggregateScore != null && Number.isFinite(r.aggregateScore)
        ? String(r.aggregateScore)
        : "";
    const emails = r.assignments
      .map((a) => (a.evaluatorEmail ?? "").trim())
      .filter((e) => e.length > 0)
      .join(" | ");
    const comments = r.assignments
      .map((a) => (a.overallComment ?? "").trim())
      .filter((c) => c.length > 0)
      .join(" | ");
    const abstainReasons = r.assignments
      .filter((a) => a.status === "abstained")
      .map((a) => (a.abstainReason ?? "").trim())
      .filter((c) => c.length > 0)
      .join(" | ");
    lines.push(
      [
        csvEscapeField(r.submissionId),
        csvEscapeField(r.title),
        csvEscapeField(r.status),
        csvEscapeField(r.category ?? ""),
        score,
        String(r.assignments.length),
        String(scoredCount),
        String(abstainedCount),
        csvEscapeField(emails),
        csvEscapeField(comments),
        csvEscapeField(abstainReasons),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
