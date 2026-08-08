/**
 * Airtable one-way projection DTOs (section 7.3 / S-AIRTABLE).
 *
 * Command: Reports.AirtableStatus
 * HTTP: GET /api/events/:eventId/airtable/status
 *
 * Outbox topic airtable.project is drained by airtableConsumer — never on
 * the request path (E7). Upsert key is internal_id (I16 field-flow).
 */
import { z } from "zod";

/** Outbox topic for Airtable projection (worker drain only). */
export const AIRTABLE_OUTBOX_TOPIC = "airtable.project" as const;

/** projection_records.system value for Airtable. */
export const AIRTABLE_PROJECTION_SYSTEM = "airtable" as const;

/**
 * Entity types projected to Airtable tables (env table names in docs/SECRETS.md).
 * internal_id is the stable upsert key in every table.
 */
export const AirtableEntityTypeSchema = z.enum([
  "event",
  "submission",
  "speaker",
  "session",
  "task",
  "schedule",
]);
export type AirtableEntityType = z.infer<typeof AirtableEntityTypeSchema>;

/** Default Airtable table names when env AIRTABLE_TABLE_* is unset. */
export const DEFAULT_AIRTABLE_TABLES: Record<AirtableEntityType, string> = {
  event: "SpeakerOps_Events",
  submission: "SpeakerOps_Submissions",
  speaker: "SpeakerOps_Speakers",
  session: "SpeakerOps_Sessions",
  task: "SpeakerOps_Tasks",
  schedule: "SpeakerOps_Schedule",
};

/**
 * Outbox payload for topic airtable.project.
 * Worker upserts by internalId; request path never calls Airtable HTTP.
 */
export const AirtableProjectPayloadSchema = z.object({
  eventId: z.string().min(1),
  entityType: AirtableEntityTypeSchema,
  internalId: z.string().min(1),
  sourceVersion: z.number().int().positive().default(1),
  /** Projected field map (always includes internal_id on the wire). */
  fields: z.record(z.unknown()).default({}),
  correlationId: z.string().min(1).optional(),
});
export type AirtableProjectPayload = z.infer<
  typeof AirtableProjectPayloadSchema
>;

/** Lag counters for admin status (O06 / S-AIRTABLE pause survival). */
export const AirtableLagSchema = z.object({
  /** Unprocessed airtable.project outbox rows for this event. */
  pendingCount: z.number().int().nonnegative(),
  /** Oldest pending outbox createdAt (ISO) or null when none. */
  oldestPendingAt: z.string().nullable(),
  /** Max attempts among pending rows. */
  maxAttempts: z.number().int().nonnegative(),
});
export type AirtableLag = z.infer<typeof AirtableLagSchema>;

export const AirtableStatusErrorSchema = z.object({
  outboxId: z.string().min(1),
  lastError: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  internalId: z.string().nullable(),
  entityType: z.string().nullable(),
});
export type AirtableStatusError = z.infer<typeof AirtableStatusErrorSchema>;

/**
 * Reports.AirtableStatus response.
 * configured=false / paused=true when AIRTABLE_API_KEY or AIRTABLE_BASE_ID unset
 * (product mutations still succeed; outbox lags — S-AIRTABLE).
 */
export const ReportsAirtableStatusResponseSchema = z.object({
  eventId: z.string().min(1),
  /** True when AIRTABLE_API_KEY and AIRTABLE_BASE_ID are both set (env names only). */
  configured: z.boolean(),
  /**
   * True when projection drain is paused (missing credentials or explicit pause).
   * Request path never blocks on Airtable when paused.
   */
  paused: z.boolean(),
  lag: AirtableLagSchema,
  /** Most recent successful projection_records.updated_at for this event's rows. */
  lastSuccessAt: z.string().nullable(),
  /** Count of projection_records for this event (via outbox history / store). */
  projectedCount: z.number().int().nonnegative(),
  /** Recent outbox errors (last_error set, unprocessed or failed attempts). */
  recentErrors: z.array(AirtableStatusErrorSchema),
  generatedAt: z.string().min(1),
});
export type ReportsAirtableStatusResponse = z.infer<
  typeof ReportsAirtableStatusResponseSchema
>;
