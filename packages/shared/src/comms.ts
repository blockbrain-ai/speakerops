import { z } from "zod";
import { richTextEmailSchema, RichTextEnvelopeSchema } from "./richtext.js";

/**
 * Comms DTOs — email templates + outbox message jobs (section 5.1–5.2 / S-COMMS).
 *
 * Commands: Comms.UpsertTemplate · Comms.Preview · Comms.Send (enqueue only)
 * HTTP: PUT  /api/events/:eventId/templates/:key
 *       POST /api/comms/preview
 *       POST /api/comms/send  { previewId, idempotencyKey }
 *
 * No provider HTTP on the request path (E7). Send inserts message_jobs +
 * message_recipients + outbox_events + idempotency_keys; 5.2 consumer drains
 * with sandbox provider default. ICS UID/SEQUENCE lives in API ics helpers.
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
  /**
   * Rich body doc (F2; 0036). Server dual-read: prefers body_rich_json,
   * falls back to legacy body_md text as a paragraph doc.
   */
  bodyRich: RichTextEnvelopeSchema.optional().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type EmailTemplateDto = z.infer<typeof EmailTemplateSchema>;

/** Comms.UpsertTemplate body — subject + body (key + eventId from path). */
export const CommsUpsertTemplateBodySchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  /**
   * Rich body doc (F2) — email-context schema (inline-safe subset, no
   * images). Omitted → keep legacy-only; null → clear. Writers persist BOTH
   * body_rich_json and its plain-text serialization into body_md.
   */
  bodyRich: richTextEmailSchema.nullable().optional(),
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
    /** Filter participations by status (default: accepted when ids absent). */
    status: z.string().min(1).max(64).optional(),
    /**
     * Explicit participation ids. When the field is present (including `[]`),
     * it overrides status filter entirely — empty means zero recipients.
     * Omit the field to use status (default accepted).
     */
    participationIds: z.array(z.string().min(1).max(128)).max(500).optional(),
    /**
     * Decision hand-off audience (Wave 2): recipients are the primary
     * speakers of these submissions — including rejected/waitlisted proposals
     * that have no participation yet. When present, this takes precedence
     * over participationIds and status.
     */
    submissionIds: z.array(z.string().min(1).max(128)).max(200).optional(),
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
  /** Null for submission-derived recipients without a participation yet. */
  participationId: z.string().min(1).nullable(),
  /** Source submission when the audience came from a decision hand-off. */
  submissionId: z.string().min(1).nullable().optional(),
  email: z.string().email(),
  name: z.string(),
});
export type CommsPreviewRecipient = z.infer<typeof CommsPreviewRecipientSchema>;

export const CommsPreviewBodyItemSchema = z.object({
  /** Null for submission-derived recipients without a participation yet. */
  participationId: z.string().min(1).nullable(),
  submissionId: z.string().min(1).nullable().optional(),
  subject: z.string(),
  body: z.string(),
  /**
   * Email-HTML part (F2): merged doc serialized AFTER merge values were
   * applied in doc-space, so recipient data is escaped like any text.
   */
  bodyHtml: z.string().optional(),
  /**
   * Merged rich doc for safe client-side preview rendering (<RichText>) —
   * no dangerouslySetInnerHTML anywhere (E10).
   */
  bodyDoc: RichTextEnvelopeSchema.optional().nullable(),
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

/**
 * Comms.Send body — enqueue only (no provider HTTP).
 * previewId is mandatory (J08); missing → 400 VALIDATION_ERROR.
 * idempotencyKey is mandatory (J04); same key returns same job id.
 */
export const CommsSendBodySchema = z.object({
  previewId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(200),
  /** Optional calendar invite to attach as invite.ics on send. */
  calendarInviteId: z.string().min(1).max(128).optional().nullable(),
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

// ---------------------------------------------------------------------------
// Section 5.3 — admin UI read models + ICS HTTP (trust-before-send SPA)
// ---------------------------------------------------------------------------

/** GET /api/events/:eventId/templates — Comms.ListTemplates */
export const CommsListTemplatesResponseSchema = z.object({
  templates: z.array(EmailTemplateSchema),
  eventId: z.string().min(1),
});
export type CommsListTemplatesResponse = z.infer<
  typeof CommsListTemplatesResponseSchema
>;

/** Delivery-log job summary (list). */
export const CommsJobSummarySchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  templateId: z.string().min(1),
  status: MessageJobStatusSchema,
  idempotencyKey: z.string().nullable(),
  recipientCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type CommsJobSummary = z.infer<typeof CommsJobSummarySchema>;

/** GET /api/events/:eventId/comms/jobs — Comms.ListJobs */
export const CommsListJobsResponseSchema = z.object({
  jobs: z.array(CommsJobSummarySchema),
  eventId: z.string().min(1),
});
export type CommsListJobsResponse = z.infer<typeof CommsListJobsResponseSchema>;

export const MessageRecipientSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  eventId: z.string().min(1),
  participationId: z.string().nullable(),
  toEmail: z.string().email(),
  name: z.string().nullable(),
  subject: z.string().nullable(),
  status: z.string().min(1),
  createdAt: z.string().min(1),
});
export type MessageRecipientDto = z.infer<typeof MessageRecipientSchema>;

export const DeliveryEventSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  recipientId: z.string().nullable(),
  eventId: z.string().min(1),
  provider: z.string().min(1),
  providerMessageId: z.string().nullable(),
  status: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.string().min(1),
});
export type DeliveryEventDto = z.infer<typeof DeliveryEventSchema>;

/** GET /api/events/:eventId/comms/jobs/:jobId — Comms.GetJob */
export const CommsGetJobResponseSchema = z.object({
  job: MessageJobSchema,
  recipients: z.array(MessageRecipientSchema),
  deliveryEvents: z.array(DeliveryEventSchema),
});
export type CommsGetJobResponse = z.infer<typeof CommsGetJobResponseSchema>;

/** Calendar invite DTO for ICS attach display (J06/J10). */
export const CalendarInviteSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  placementId: z.string().min(1),
  sessionId: z.string().nullable(),
  uid: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  method: z.enum(["REQUEST", "CANCEL"]),
  summary: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  location: z.string().nullable(),
  /** ICS body present for attach display (admin only). */
  icsBody: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type CalendarInviteDto = z.infer<typeof CalendarInviteSchema>;

/** GET /api/events/:eventId/comms/ics — Comms.ListIcs */
export const CommsListIcsResponseSchema = z.object({
  invites: z.array(CalendarInviteSchema),
  eventId: z.string().min(1),
});
export type CommsListIcsResponse = z.infer<typeof CommsListIcsResponseSchema>;

/**
 * ISO-8601 date-time string that Date.parse accepts (route → 400, not 500).
 */
export const IsoDateTimeStringSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be a valid ISO-8601 date-time",
  });

/**
 * POST /api/events/:eventId/comms/ics — Comms.IcsForPlacement
 * Fixture-friendly placement body (Phase 5; full schedule in 6.x).
 * Invalid dates and endsAt ≤ startsAt → 400 VALIDATION_ERROR (not 500).
 */
export const CommsIcsForPlacementBodySchema = z
  .object({
    placementId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128).nullable().optional(),
    summary: z.string().min(1).max(500),
    startsAt: IsoDateTimeStringSchema,
    endsAt: IsoDateTimeStringSchema,
    location: z.string().max(500).nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
    organizerEmail: z.string().email().nullable().optional(),
    attendeeEmail: z.string().email().nullable().optional(),
    /** When true, emit METHOD:CANCEL and bump SEQUENCE. */
    cancel: z.boolean().optional(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type CommsIcsForPlacementBody = z.infer<
  typeof CommsIcsForPlacementBodySchema
>;

export const CommsIcsForPlacementResponseSchema = z.object({
  invite: CalendarInviteSchema,
});
export type CommsIcsForPlacementResponse = z.infer<
  typeof CommsIcsForPlacementResponseSchema
>;

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
