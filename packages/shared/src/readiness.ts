import { z } from "zod";

/**
 * Reports.Readiness DTOs (section 6.3 / S-READY).
 *
 * Command: Reports.Readiness
 * HTTP: GET /api/events/:eventId/readiness
 *
 * outstanding[] + stats derived from speaker_tasks (no separate SoR table).
 * Overdue = incomplete task with dueAt ≤ now (or status already "overdue").
 */

/** Query for GET readiness — optional overdue-only filter (H02). */
export const ReportsReadinessQuerySchema = z.object({
  /** When true, outstanding[] includes only overdue items. */
  overdueOnly: z
    .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});
export type ReportsReadinessQuery = z.infer<typeof ReportsReadinessQuerySchema>;

export const ReadinessTaskStatusSchema = z.enum([
  "pending",
  "overdue",
  "completed",
  "cancelled",
]);
export type ReadinessTaskStatus = z.infer<typeof ReadinessTaskStatusSchema>;

/** One outstanding (incomplete) task row for the dashboard list. */
export const ReadinessOutstandingItemSchema = z.object({
  taskId: z.string().min(1),
  participationId: z.string().min(1),
  personId: z.string().min(1),
  personName: z.string().nullable(),
  personEmail: z.string().nullable(),
  taskTitle: z.string().min(1),
  templateId: z.string().min(1),
  /** Effective status for display (pending or overdue for outstanding rows). */
  status: z.enum(["pending", "overdue"]),
  dueAt: z.string().nullable(),
  isOverdue: z.boolean(),
  version: z.number().int().positive(),
});
export type ReadinessOutstandingItem = z.infer<
  typeof ReadinessOutstandingItemSchema
>;

/** Aggregate stats for H01 stat cards. */
export const ReadinessStatsSchema = z.object({
  totalSpeakers: z.number().int().nonnegative(),
  speakersWithOutstanding: z.number().int().nonnegative(),
  outstandingTasks: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  cancelledTasks: z.number().int().nonnegative(),
});
export type ReadinessStats = z.infer<typeof ReadinessStatsSchema>;

export const ReportsReadinessResponseSchema = z.object({
  eventId: z.string().min(1),
  stats: ReadinessStatsSchema,
  /**
   * Outstanding incomplete tasks (filtered when overdueOnly=true).
   * Sorted: overdue first, then dueAt ascending, then taskId.
   */
  outstanding: z.array(ReadinessOutstandingItemSchema),
  /** ISO timestamp when this report was computed (for live-poll freshness). */
  generatedAt: z.string().min(1),
});
export type ReportsReadinessResponse = z.infer<
  typeof ReportsReadinessResponseSchema
>;

/**
 * Effective overdue check used by API + UI (single source of truth).
 * Incomplete task is overdue when status is already "overdue" or dueAt ≤ now.
 */
export function isTaskOverdue(
  status: string,
  dueAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (status === "completed" || status === "cancelled") return false;
  if (status === "overdue") return true;
  if (!dueAt) return false;
  const t = Date.parse(dueAt);
  if (!Number.isFinite(t)) return false;
  return t <= nowMs;
}
