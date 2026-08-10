import { z } from "zod";

/**
 * Lifecycle comms — system-triggered sends that reuse the S-COMMS outbox
 * (Wave 1B item 1: submission confirmation email).
 *
 * Command: Comms.SubmissionConfirmation (system actor, after Submission.Create)
 * Durability: message_jobs + message_recipients + outbox_events +
 * idempotency_keys in the same enqueue; provider delivery stays on the
 * 5.2 consumer (sandbox default) — never on the request path (E7).
 */

/** email_templates.key for the per-event submission confirmation template. */
export const SUBMISSION_CONFIRMATION_TEMPLATE_KEY =
  "submission_confirmation" as const;

/**
 * Idempotency key for one submission's confirmation send.
 * Invoking the lifecycle twice for the same submission is a no-op replay.
 */
export function submissionConfirmationIdempotencyKey(
  submissionId: string,
): string {
  return `submission-confirmation:${submissionId}`;
}

/** Default template subject seeded per event (editable in Comms templates). */
export const SUBMISSION_CONFIRMATION_DEFAULT_SUBJECT =
  "We received your proposal for {{eventName}}" as const;

/** Default template body seeded per event (editable in Comms templates). */
export const SUBMISSION_CONFIRMATION_DEFAULT_BODY = `Hi {{name}},

Thanks for submitting "{{submissionTitle}}" to {{eventName}}.

Our review team will read every proposal after the call closes. You will hear from us once decisions are made — no action is needed from you right now.

If anything in your proposal changes before then, just reply to this email.

— The {{eventName}} team` as const;

/**
 * Structured event notification settings stored inside events.settings_json.
 * Unknown keys are preserved (passthrough) so other features can share the
 * same JSON blob without clobbering each other.
 */
export const EventNotificationSettingsSchema = z
  .object({
    /**
     * Send submitters a confirmation email after Submission.Create.
     * Omitted = enabled (lifecycle default-on once a template exists).
     */
    submissionConfirmationEnabled: z.boolean().optional(),
    /**
     * Additional organizer inboxes notified on every submission
     * (admin alert recipients on the same lifecycle job).
     */
    notifySubmissionEmails: z.array(z.string().email().max(320)).max(20).optional(),
  })
  .passthrough();
export type EventNotificationSettings = z.infer<
  typeof EventNotificationSettingsSchema
>;

/** Normalized view of the notification settings with defaults applied. */
export type ResolvedEventNotificationSettings = {
  submissionConfirmationEnabled: boolean;
  notifySubmissionEmails: string[];
};

/**
 * Parse events.settings_json into notification settings.
 * Malformed JSON or unexpected shapes fall back to defaults (enabled, no
 * extra recipients) — settings parsing must never break the submit path.
 */
export function parseEventNotificationSettings(
  settingsJson: string | null | undefined,
): ResolvedEventNotificationSettings {
  const defaults: ResolvedEventNotificationSettings = {
    submissionConfirmationEnabled: true,
    notifySubmissionEmails: [],
  };
  if (settingsJson == null || settingsJson.trim() === "") return defaults;
  let raw: unknown;
  try {
    raw = JSON.parse(settingsJson);
  } catch {
    return defaults;
  }
  const parsed = EventNotificationSettingsSchema.safeParse(raw);
  if (!parsed.success) return defaults;
  return {
    submissionConfirmationEnabled:
      parsed.data.submissionConfirmationEnabled !== false,
    notifySubmissionEmails: (parsed.data.notifySubmissionEmails ?? []).map((e) =>
      e.trim().toLowerCase(),
    ),
  };
}

/**
 * Merge notification settings into an existing settings_json string,
 * preserving unrelated keys. Returns the JSON string to PATCH back.
 */
export function mergeEventNotificationSettings(
  settingsJson: string | null | undefined,
  patch: Partial<
    Pick<
      EventNotificationSettings,
      "submissionConfirmationEnabled" | "notifySubmissionEmails"
    >
  >,
): string {
  let base: Record<string, unknown> = {};
  if (settingsJson != null && settingsJson.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(settingsJson);
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch });
}

/**
 * Parse a human-entered list of notification emails ("a@x.co, b@y.co" or
 * newline separated). Invalid entries are returned separately so the UI can
 * show a precise error instead of silently dropping addresses.
 */
export function parseNotifyEmailsInput(raw: string): {
  emails: string[];
  invalid: string[];
} {
  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const emails: string[] = [];
  const invalid: string[] = [];
  const emailSchema = z.string().email().max(320);
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (emailSchema.safeParse(normalized).success) {
      if (!emails.includes(normalized)) emails.push(normalized);
    } else {
      invalid.push(part);
    }
  }
  return { emails, invalid };
}
