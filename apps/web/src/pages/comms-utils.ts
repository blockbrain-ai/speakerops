/**
 * Comms admin UI helpers — trust-before-send gating (section 5.3 / S-COMMS).
 *
 * Named assertions:
 * - assert send button disabled until preview
 * - assert audience edit invalidates preview
 */

/** Whether the Send control may be enabled (J08 / J03 trust-before-send). */
export function isSendEnabled(input: {
  /** Non-null previewId from a completed Comms.Preview. */
  previewId: string | null;
  /** Preview still matches current audience + template. */
  previewValid: boolean;
  /** At least one recipient in the last preview. */
  recipientCount: number;
  /** In-flight send. */
  sending?: boolean;
}): boolean {
  if (input.sending) return false;
  if (!input.previewId) return false;
  if (!input.previewValid) return false;
  if (input.recipientCount <= 0) return false;
  return true;
}

/**
 * Segment fingerprint used to invalidate preview when audience or event
 * changes (J09 / event-scoped trust-before-send).
 * Includes activeEventId so switching events never reuses a prior preview.
 */
export function segmentFingerprint(input: {
  status: string;
  participationIds: string[];
  templateId: string | null;
  /** Active event scope — required so cross-event send is blocked. */
  eventId?: string | null;
}): string {
  const ids = [...input.participationIds].sort();
  return `${input.eventId ?? ""}|${input.templateId ?? ""}|${input.status}|${ids.join(",")}`;
}

/** Human-readable reason the send button is disabled (for status UI). */
export function sendDisabledReason(input: {
  previewId: string | null;
  previewValid: boolean;
  recipientCount: number;
  sending?: boolean;
}): string | null {
  if (input.sending) return "Sending…";
  if (!input.previewId || !input.previewValid) {
    return "Complete a preview before send";
  }
  if (input.recipientCount <= 0) {
    return "No recipients in preview";
  }
  return null;
}

/** Client-side idempotency key for a send attempt. */
export function newIdempotencyKey(prefix = "ui"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}
