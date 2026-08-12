import { z } from "zod";
import {
  SubmissionStatusSchema,
  SubmissionSchema,
  SubmissionAnswerDtoSchema,
  SubmissionSpeakerDtoSchema,
} from "./submissions.js";

/**
 * Decision + program session DTOs (section 3.5 / S-EVAL accept path).
 * Commands: Decision.Record · Session.CreateDirect · Submission.List · Submission.Get
 * HTTP: POST /api/submissions/:submissionId/decision
 *       POST /api/events/:eventId/sessions/direct
 *       GET  /api/events/:eventId/submissions
 *       GET  /api/submissions/:submissionId
 */

export const DecisionValueSchema = z.enum(["accept", "reject", "waitlist"]);
export type DecisionValue = z.infer<typeof DecisionValueSchema>;

/** Decision.Record body — POST /api/submissions/:submissionId/decision */
export const DecisionRecordBodySchema = z.object({
  decision: DecisionValueSchema,
  reason: z.string().max(4000).nullable().optional(),
  /**
   * Optimistic concurrency on submissions.version (E1).
   * When provided and mismatched → 409 CONFLICT.
   */
  expectedVersion: z.number().int().positive().optional(),
});
export type DecisionRecordBody = z.infer<typeof DecisionRecordBodySchema>;

export const DecisionSchema = z.object({
  id: z.string().min(1),
  submissionId: z.string().min(1),
  decision: DecisionValueSchema,
  reason: z.string().nullable(),
  decidedBy: z.string().min(1),
  createdAt: z.string().min(1),
});
export type DecisionDto = z.infer<typeof DecisionSchema>;

export const ProgramSessionSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  sourceSubmissionId: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  trackId: z.string().nullable(),
  status: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type ProgramSessionDto = z.infer<typeof ProgramSessionSchema>;

export const EventParticipationSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  personId: z.string().min(1),
  userId: z.string().nullable(),
  roleLabel: z.string().nullable(),
  status: z.string().min(1),
  version: z.number().int().positive(),
});
export type EventParticipationDto = z.infer<typeof EventParticipationSchema>;

export const SpeakerTaskSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  participationId: z.string().min(1),
  status: z.string().min(1),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  version: z.number().int().positive(),
});
export type SpeakerTaskDto = z.infer<typeof SpeakerTaskSchema>;

export const TaskTemplateSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  trigger: z.enum(["on_accept", "manual"]),
  dueOffsetDays: z.number().int(),
  /** Optional https:// resource link shown on portal task cards (Wave 2). */
  linkUrl: z.string().nullable(),
  /** True when incomplete instantiated tasks block portal readiness (Wave 2). */
  required: z.boolean(),
  /** Optimistic concurrency version (E1 mutable aggregate). */
  version: z.number().int().positive(),
});
export type TaskTemplateDto = z.infer<typeof TaskTemplateSchema>;

/** Decision.Record response — includes materialization on accept. */
export const DecisionRecordResponseSchema = z.object({
  decision: DecisionSchema,
  submission: SubmissionSchema,
  /** Present when decision is accept (new or idempotent replay). */
  session: ProgramSessionSchema.nullable(),
  /** Tasks created (or already present on idempotent accept). */
  tasks: z.array(SpeakerTaskSchema),
  participations: z.array(EventParticipationSchema),
  /** True when accept was a no-op replay of an existing accept. */
  idempotent: z.boolean(),
});
export type DecisionRecordResponse = z.infer<
  typeof DecisionRecordResponseSchema
>;

/** Direct/sponsor session — POST /api/events/:eventId/sessions/direct (E07) */
export const DirectSessionSpeakerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  isPrimary: z.boolean().optional(),
});
export type DirectSessionSpeaker = z.infer<typeof DirectSessionSpeakerSchema>;

export const DirectSessionBodySchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(8000).nullable().optional(),
  trackId: z.string().min(1).max(128).nullable().optional(),
  speakers: z.array(DirectSessionSpeakerSchema).max(20).default([]),
});
export type DirectSessionBody = z.infer<typeof DirectSessionBodySchema>;

export const DirectSessionResponseSchema = z.object({
  session: ProgramSessionSchema,
  participations: z.array(EventParticipationSchema),
  tasks: z.array(SpeakerTaskSchema),
});
export type DirectSessionResponse = z.infer<typeof DirectSessionResponseSchema>;

/**
 * Submission.List default page size (COMMANDS.md output: page).
 * Aligns with Speakers L05 window; keeps dogfood 150+ under 5s.
 */
export const SUBMISSION_LIST_DEFAULT_LIMIT = 25 as const;
/** Hard cap for limit query param (anti-unbounded payload). */
export const SUBMISSION_LIST_MAX_LIMIT = 100 as const;

/**
 * Submission.List filters + page window — GET /api/events/:eventId/submissions
 *
 * Contract (AC-10.1-E):
 * - `status`, `category` applied **server-side** before slicing the page
 * - `limit` default 25, max 100; `offset` default 0
 * - Response includes `total` (filtered count), `limit`, `offset` so SPA pager
 *   does not drop filters when changing pages
 */
/** Allowlisted sort fields for Submission.List (F3 server sort). */
export const SUBMISSION_LIST_SORT_FIELDS = [
  "title",
  "status",
  "category",
  "submittedAt",
  "primarySpeakerName",
] as const;
export type SubmissionListSortField =
  (typeof SUBMISSION_LIST_SORT_FIELDS)[number];

export const SubmissionListQuerySchema = z.object({
  status: SubmissionStatusSchema.optional(),
  category: z.string().min(1).max(128).optional(),
  /**
   * Search on title or primary speaker name.
   * F3: prefer prefix matching for index-usable scans; legacy contains kept
   * for existing e2e (q=talk) until F5 FTS.
   */
  q: z.string().min(1).max(200).optional(),
  /** Server-side sort field (allowlist). Default: submittedAt. */
  sort: z.enum(SUBMISSION_LIST_SORT_FIELDS).optional(),
  /** Sort direction. Default: desc for submittedAt, asc otherwise. */
  sortDir: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SUBMISSION_LIST_MAX_LIMIT)
    .optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type SubmissionListQuery = z.infer<typeof SubmissionListQuerySchema>;

export const SubmissionListItemSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  formVersionId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().nullable(),
  status: SubmissionStatusSchema,
  submittedAt: z.string().min(1),
  version: z.number().int().positive(),
  /** Primary speaker name when available. */
  primarySpeakerName: z.string().nullable().optional(),
});
export type SubmissionListItem = z.infer<typeof SubmissionListItemSchema>;

export const SubmissionListResponseSchema = z.object({
  submissions: z.array(SubmissionListItemSchema),
  /** Filtered row count (server-side status/category), independent of page window. */
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  /**
   * Distinct non-null categories for the event (status filter applied when set).
   * Lets SPA keep the category dropdown complete without fetching every page.
   */
  categories: z.array(z.string()).default([]),
  /**
   * F4: status histogram for the event (before status/category/q filters).
   * Enables Overview donut without fetching every row.
   */
  statusCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export type SubmissionListResponse = z.infer<
  typeof SubmissionListResponseSchema
>;

/** Submission.Get detail — GET /api/submissions/:submissionId */
export const SubmissionDetailResponseSchema = z.object({
  submission: SubmissionSchema,
  answers: z.array(SubmissionAnswerDtoSchema),
  speakers: z.array(SubmissionSpeakerDtoSchema),
  decision: DecisionSchema.nullable(),
  session: ProgramSessionSchema.nullable(),
});
export type SubmissionDetailResponse = z.infer<
  typeof SubmissionDetailResponseSchema
>;

/**
 * Bulk decision preview (E08) — client or API may use this shape.
 * Apply still goes through Decision.Record per submission.
 */
export const BulkDecisionPreviewBodySchema = z.object({
  submissionIds: z.array(z.string().min(1).max(128)).min(1).max(200),
  decision: DecisionValueSchema,
  reason: z.string().max(4000).nullable().optional(),
});
export type BulkDecisionPreviewBody = z.infer<
  typeof BulkDecisionPreviewBodySchema
>;

export const BulkDecisionPreviewItemSchema = z.object({
  submissionId: z.string().min(1),
  title: z.string(),
  currentStatus: SubmissionStatusSchema,
  nextStatus: SubmissionStatusSchema,
});
export type BulkDecisionPreviewItem = z.infer<
  typeof BulkDecisionPreviewItemSchema
>;

export const BulkDecisionPreviewResponseSchema = z.object({
  decision: DecisionValueSchema,
  items: z.array(BulkDecisionPreviewItemSchema),
  count: z.number().int().nonnegative(),
});
export type BulkDecisionPreviewResponse = z.infer<
  typeof BulkDecisionPreviewResponseSchema
>;

/**
 * Bulk decision commit — loops Decision.Record per submission.
 * Partial success allowed; each item reports ok/error.
 */
export const BulkDecisionCommitBodySchema = z.object({
  submissionIds: z.array(z.string().min(1).max(128)).min(1).max(200),
  decision: DecisionValueSchema,
  reason: z.string().max(4000).nullable().optional(),
  /** Optional per-submission expectedVersion for optimistic concurrency. */
  expectedVersions: z
    .record(z.string().min(1), z.number().int().positive())
    .optional(),
});
export type BulkDecisionCommitBody = z.infer<
  typeof BulkDecisionCommitBodySchema
>;

export const BulkDecisionCommitItemSchema = z.object({
  submissionId: z.string().min(1),
  ok: z.boolean(),
  error: z.string().optional(),
  code: z.string().optional(),
});
export type BulkDecisionCommitItem = z.infer<
  typeof BulkDecisionCommitItemSchema
>;

export const BulkDecisionCommitResponseSchema = z.object({
  decision: DecisionValueSchema,
  items: z.array(BulkDecisionCommitItemSchema),
  applied: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type BulkDecisionCommitResponse = z.infer<
  typeof BulkDecisionCommitResponseSchema
>;
