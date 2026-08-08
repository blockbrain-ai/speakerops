/**
 * ICS UID / SEQUENCE helpers (section 5.2 / S-COMMS / E7).
 *
 * RFC 5545: stable UID across updates; SEQUENCE increments on reschedule;
 * METHOD:REQUEST for invite/update, METHOD:CANCEL for cancel.
 * No two-way calendar OAuth (out of scope).
 */

/** Calendar METHOD values we emit. */
export type IcsMethod = "REQUEST" | "CANCEL";

/** Placement payload used to materialize a VEVENT (fixture-friendly for Phase 5). */
export type IcsPlacementInput = {
  eventId: string;
  placementId: string;
  /** Optional program session id when known. */
  sessionId?: string | null;
  summary: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  description?: string | null;
  organizerEmail?: string | null;
  attendeeEmail?: string | null;
};

export type CalendarInviteState = {
  uid: string;
  sequence: number;
  method: IcsMethod;
  icsBody: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  sessionId: string | null;
};

/**
 * Stable ICS UID for a placement within an event.
 * Same eventId + placementId always yields the same UID (J10 / S-COMMS).
 */
export function stableIcsUid(eventId: string, placementId: string): string {
  if (!eventId || !placementId) {
    throw new Error("stableIcsUid requires eventId and placementId");
  }
  // Domain-scoped UID — not a real DNS domain; clients only need uniqueness.
  return `speakerops-${eventId}-${placementId}@speakerops.local`;
}

/**
 * SEQUENCE bump helper (J10).
 * First invite uses sequence 0; each update (reschedule) increments by 1.
 */
export function bumpSequence(current: number): number {
  if (!Number.isInteger(current) || current < 0) {
    throw new Error(`bumpSequence expects non-negative integer, got ${current}`);
  }
  return current + 1;
}

/** Escape text for ICS property values (RFC 5545). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

/**
 * Format an ISO-8601 / Date string as UTC ICS DATE-TIME (YYYYMMDDTHHMMSSZ).
 */
export function toIcsUtcDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date for ICS: ${iso}`);
  }
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const h = d.getUTCHours().toString().padStart(2, "0");
  const min = d.getUTCMinutes().toString().padStart(2, "0");
  const s = d.getUTCSeconds().toString().padStart(2, "0");
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

/** Fold long ICS lines to 75 octets (simplified CRLF folding). */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let remaining = line;
  parts.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    parts.push(" " + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return parts.join("\r\n");
}

/**
 * Render a minimal RFC 5545 VCALENDAR/VEVENT for email attachment.
 */
export function renderIcs(input: {
  uid: string;
  sequence: number;
  method: IcsMethod;
  summary: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  description?: string | null;
  organizerEmail?: string | null;
  attendeeEmail?: string | null;
  dtStamp?: string;
}): string {
  const dtStamp = toIcsUtcDateTime(input.dtStamp ?? new Date().toISOString());
  const dtStart = toIcsUtcDateTime(input.startsAt);
  const dtEnd = toIcsUtcDateTime(input.endsAt);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SpeakerOps//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];
  if (input.location) {
    lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  }
  if (input.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  }
  if (input.organizerEmail) {
    lines.push(`ORGANIZER:mailto:${input.organizerEmail}`);
  }
  if (input.attendeeEmail) {
    lines.push(
      `ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${input.attendeeEmail}`,
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/**
 * Build initial or updated invite state for a placement.
 * - First call (no prior): sequence 0, METHOD:REQUEST, stable UID
 * - Reschedule (prior exists): same UID, sequence++, METHOD:REQUEST
 * - Cancel: same UID, sequence++, METHOD:CANCEL
 */
export function nextInviteState(
  prior: { uid: string; sequence: number } | null,
  placement: IcsPlacementInput,
  options: { cancel?: boolean } = {},
): CalendarInviteState {
  // UID is always derived from event + placement so reschedule keeps the same id.
  const uid = prior?.uid ?? stableIcsUid(placement.eventId, placement.placementId);
  // First invite: SEQUENCE 0. Update/cancel: bump SEQUENCE (J10).
  const sequence = prior === null ? 0 : bumpSequence(prior.sequence);
  const method: IcsMethod = options.cancel ? "CANCEL" : "REQUEST";
  const icsBody = renderIcs({
    uid,
    sequence,
    method,
    summary: placement.summary,
    startsAt: placement.startsAt,
    endsAt: placement.endsAt,
    location: placement.location,
    description: placement.description,
    organizerEmail: placement.organizerEmail,
    attendeeEmail: placement.attendeeEmail,
  });
  return {
    uid,
    sequence,
    method,
    icsBody,
    summary: placement.summary,
    startsAt: placement.startsAt,
    endsAt: placement.endsAt,
    location: placement.location ?? null,
    sessionId: placement.sessionId ?? null,
  };
}

/**
 * Comms.IcsForPlacement domain helper (COMMANDS.md — system/admin).
 * Pure function over prior invite + placement fixture; store persists the row.
 */
export function icsForPlacement(
  prior: { uid: string; sequence: number } | null,
  placement: IcsPlacementInput,
  options: { cancel?: boolean } = {},
): CalendarInviteState {
  return nextInviteState(prior, placement, options);
}
