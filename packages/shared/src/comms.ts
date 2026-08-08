import { z } from "zod";

/**
 * Comms DTOs — email templates + outbox message jobs (section 5.1 / S-COMMS).
 *
 * Commands: Comms.UpsertTemplate · Comms.Preview · Comms.Send (enqueue only)
 * HTTP: PUT  /api/events/:eventId/templates/:key
 *       POST /api/comms/preview
 *       POST /api/comms/send
 *
 * No provider HTTP on the request path (E7). Send inserts message_jobs + outbox_events.
 */

/** Stable template key within an event (e.g. accept-reminder). */
export const TemplateKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    "key must be lowercase alphanumeric with hyphens/underscores",
  );
export type TemplateKey = z.infer<typeof TemplateKeySchema>;

/** Email template DTO (email_templates). */
export const EmailTemplateSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  key: TemplateKeySchema,
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type EmailTemplateDto = z.infer<typeof EmailTemplateSchema>;

/** Comms.UpsertTemplate body — subject + body (key + eventId from path). */
export const CommsUpsertTemplateBodySchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  /** Optional optimistic concurrency on update (omit on first create). */
  expectedVersion: z.number().int().positive().optional(),
});
export type CommsUpsertTemplateBody = z.infer<
  typeof CommsUpsertTemplateBodySchema
>;

export const CommsUpsertTemplateResponseSchema = z.object({
  template: EmailTemplateSchema,
});
export type CommsUpsertTemplateResponse = z.infer<
  typeof CommsUpsertTemplateResponseSchema
>;

/** Audience segment for preview/send. */
export const CommsSegmentSchema = z
  .object({
    /** Filter participations by status (default: accepted). */
    status: z.string().min(1).max(64).optional(),
    /** Explicit participation ids (overrides status filter when non-empty). */
    participationIds: z.array(z.string().min(1).max(128)).max(500).optional(),
  })
  .default({});
export type CommsSegment = z.infer<typeof CommsSegmentSchema>;

/** Comms.Preview body. */
export const CommsPreviewBodySchema = z.object({
  templateId: z.string().min(1).max(128),
  segment: CommsSegmentSchema.optional(),
});
export type CommsPreviewBody = z.infer<typeof CommsPreviewBodySchema>;

export const CommsPreviewRecipientSchema = z.object({
  participationId: z.string().min(1),
  email: z.string().email(),
  name: z.string(),
});
export type CommsPreviewRecipient = z.infer<typeof CommsPreviewRecipientSchema>;

export const CommsPreviewBodyItemSchema = z.object({
  participationId: z.string().min(1),
  subject: z.string(),
  body: z.string(),
});
export type CommsPreviewBodyItem = z.infer<typeof CommsPreviewBodyItemSchema>;

export const CommsPreviewResponseSchema = z.object({
  previewId: z.string().min(1),
  templateId: z.string().min(1),
  eventId: z.string().min(1),
  recipients: z.array(CommsPreviewRecipientSchema),
  bodies: z.array(CommsPreviewBodyItemSchema),
  missingFields: z.array(z.string()),
  recipientCount: z.number().int().nonnegative(),
});
export type CommsPreviewResponse = z.infer<typeof CommsPreviewResponseSchema>;

/** Comms.Send body — enqueue only (no provider HTTP). */
export const CommsSendBodySchema = z.object({
  previewId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(200),
});
export type CommsSendBody = z.infer<typeof CommsSendBodySchema>;

export const MessageJobStatusSchema = z.enum([
  "preview",
  "queued",
  "sending",
  "sent",
  "failed",
  "cancelled",
]);
export type MessageJobStatus = z.infer<typeof MessageJobStatusSchema>;

export const MessageJobSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  templateId: z.string().min(1),
  status: MessageJobStatusSchema,
  idempotencyKey: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type MessageJobDto = z.infer<typeof MessageJobSchema>;

export const CommsSendResponseSchema = z.object({
  job: MessageJobSchema,
  /** True when this request created the enqueue; false on idempotent replay. */
  enqueued: z.boolean(),
});
export type CommsSendResponse = z.infer<typeof CommsSendResponseSchema>;

/** Outbox topic written by Comms.Send (drained in 5.2). */
export const COMMS_OUTBOX_TOPIC = "comms.send" as const;

/**
 * Extract unique merge field names from `{{fieldName}}` tokens.
 * Order is first-appearance order in the combined text.
 */
export function extractMergeFields(...texts: string[]): string[] {
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const text of texts) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1]!;
      if (!seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
  }
  return ordered;
}

/**
 * Render merge fields in a template string.
 * Missing keys are left as `{{name}}` and listed in missingFields.
 */
export function renderMergeFields(
  template: string,
  data: Record<string, string | null | undefined>,
): { rendered: string; missingFields: string[] } {
  const missing = new Set<string>();
  const rendered = template.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_full, name: string) => {
      const value = data[name];
      if (value === undefined || value === null || value === "") {
        missing.add(name);
        return `{{${name}}}`;
      }
      return value;
    },
  );
  return { rendered, missingFields: [...missing] };
}
