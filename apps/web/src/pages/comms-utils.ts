/**
 * Comms admin UI helpers — trust-before-send gating (section 5.3 / S-COMMS)
 * + campaign audience scale (section 11.2 / S-L2-COMMS).
 *
 * Named assertions:
 * - assert send button disabled until preview
 * - assert audience edit invalidates preview
 * - unit audience filter (AC-11.2-SEL / AC-11.2-SCALE)
 */

/** Max audience rows rendered at once (page or virtual window). */
export const AUDIENCE_PAGE_SIZE = 25;

/** Four-step campaign flow (page-atlas /admin/comms · AC-11.2-UI). */
export const CAMPAIGN_STEPS = [
  { id: "audience", label: "Audience", index: 1 },
  { id: "message", label: "Message", index: 2 },
  { id: "review", label: "Review", index: 3 },
  { id: "send", label: "Send", index: 4 },
] as const;

export type CampaignStepId = (typeof CAMPAIGN_STEPS)[number]["id"];

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
 * Includes search query so a narrowed audience cannot keep a status-only
 * preview valid (AC-11.2-SEL / field-flow audienceRules).
 */
export function segmentFingerprint(input: {
  status: string;
  participationIds: string[];
  templateId: string | null;
  /** Active event scope — required so cross-event send is blocked. */
  eventId?: string | null;
  /**
   * Audience search text. Part of the fingerprint whenever it contributes to
   * the effective segment (status-mode with search, or explicit selection
   * still records "" so edits that only change search under selection do not
   * need to match query — callers pass "" when selection wins).
   */
  query?: string;
}): string {
  const ids = [...input.participationIds].sort();
  const q = (input.query ?? "").trim().toLowerCase();
  return `${input.eventId ?? ""}|${input.templateId ?? ""}|${input.status}|${q}|${ids.join(",")}`;
}

/**
 * Effective audience segment for POST /api/comms/preview (and count parity).
 *
 * Explicit selection wins. Otherwise a non-empty search is resolved to the
 * filtered participation ids (server segment has no `query` field) so the
 * displayed recipient count matches preview/send. An empty filtered list under
 * search yields `{ participationIds: [] }` — an explicit empty audience; the
 * API must not treat that as "absent" and fall back to accepted-status.
 * Status filter alone is used when there is no selection and no search.
 */
export function buildCommsSegment(input: {
  selectedParticipationIds: readonly string[];
  segmentStatus: string;
  audienceQuery: string;
  /** participationIds of the client-filtered audience (status + search). */
  filteredParticipationIds: readonly string[];
}): { status?: string; participationIds?: string[] } {
  if (input.selectedParticipationIds.length > 0) {
    return { participationIds: [...input.selectedParticipationIds] };
  }
  if (input.audienceQuery.trim().length > 0) {
    // Explicit list including [] so zero search matches never expand to
    // status-default audience on the server (AC-11.2-SEL / trust-before-send).
    return { participationIds: [...input.filteredParticipationIds] };
  }
  return { status: input.segmentStatus };
}

/**
 * Whether preview may run for the current effective segment.
 * Blocks zero-match search / empty selection so the UI cannot show count 0
 * while the server would (historically) expand to all accepted speakers.
 */
export function canRunCommsPreview(input: {
  templateId: string | null;
  /** Displayed audience count (selection or filtered total). */
  segmentCount: number;
  previewing?: boolean;
}): boolean {
  if (input.previewing) return false;
  if (!input.templateId) return false;
  if (input.segmentCount <= 0) return false;
  return true;
}

/** Human-readable reason preview is blocked (for status UI). */
export function previewDisabledReason(input: {
  templateId: string | null;
  segmentCount: number;
  previewing?: boolean;
}): string | null {
  if (input.previewing) return "Previewing…";
  if (!input.templateId) return "Save a template first to obtain a template id";
  if (input.segmentCount <= 0) {
    return "No recipients match this audience — adjust search or status";
  }
  return null;
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

/** Lightweight speaker row used by audience filter/pagination (no React deps). */
export type AudienceSpeakerRow = {
  participationId: string;
  name: string;
  email: string | null;
  status: string;
};

/**
 * Filter audience for search + status segment (AC-11.2-SEL).
 * Status `"all"` keeps every row (still searchable).
 */
export function filterAudienceSpeakers(
  speakers: readonly AudienceSpeakerRow[],
  opts: { status: string; query: string },
): AudienceSpeakerRow[] {
  const q = opts.query.trim().toLowerCase();
  const status = opts.status.trim().toLowerCase();
  return speakers.filter((s) => {
    if (status && status !== "all" && s.status.toLowerCase() !== status) {
      return false;
    }
    if (!q) return true;
    const name = s.name.toLowerCase();
    const email = (s.email ?? "").toLowerCase();
    const id = s.participationId.toLowerCase();
    return name.includes(q) || email.includes(q) || id.includes(q);
  });
}

export type AudiencePage<T> = {
  pageItems: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/**
 * Paginate audience so at most `pageSize` (default 25) rows are primary-visible
 * (AC-11.2-SCALE). Clamps page into [1, totalPages].
 */
export function paginateAudience<T>(
  items: readonly T[],
  page: number,
  pageSize: number = AUDIENCE_PAGE_SIZE,
): AudiencePage<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * size;
  return {
    pageItems: items.slice(start, start + size),
    page: safePage,
    pageSize: size,
    total,
    totalPages,
  };
}

/**
 * Audience count for the sticky summary rail.
 * Explicit selection wins; otherwise count filtered status segment.
 */
export function audienceCount(input: {
  selectedParticipationIds: readonly string[];
  filteredTotal: number;
}): number {
  if (input.selectedParticipationIds.length > 0) {
    return input.selectedParticipationIds.length;
  }
  return input.filteredTotal;
}

/**
 * Selection remains stable across filter/page when the id set is unchanged
 * (order-independent). Used by unit tests for AC-11.2-SEL.
 */
export function selectionKey(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

/** Whether selection survived a filter/page change (same multiset of ids). */
export function isSelectionStable(
  before: readonly string[],
  after: readonly string[],
): boolean {
  return selectionKey(before) === selectionKey(after);
}
