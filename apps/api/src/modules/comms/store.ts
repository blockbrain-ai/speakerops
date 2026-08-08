/**
 * Comms persistence — templates, jobs, recipients, delivery, ICS, outbox (5.1–5.2).
 *
 * MemoryCommsStore is the test / local e2e default (no D1 required).
 * D1CommsStore wraps the Worker DB binding for production (E1 SoR).
 * Event-scoped queries take eventId (E2).
 */
import { eq, and, isNull, or, sql } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import {
  createDb,
  buildAuditEventRow,
  type AuditWriteInput,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  emailTemplates,
  messageJobs,
  messageRecipients,
  deliveryEvents,
  calendarInvites,
  outboxEvents,
  idempotencyKeys,
  auditEvents,
} from "@speakerops/db";
import { d1Changes } from "../auth/store.js";

/**
 * Outbox exclusive lease encoded in last_error (no schema migration).
 * Format: claim:<claimedUntilISO24>:<claimToken>
 * claimedUntil is always Date.toISOString() (fixed 24 chars) so parsers and
 * D1 substr(last_error, 7, 24) stay aligned — ISO contains colons and must
 * not be split on the first ":".
 * Active while processed_at IS NULL and claimedUntil > now.
 */
export const OUTBOX_CLAIM_PREFIX = "claim:";

/** Date.toISOString() length (YYYY-MM-DDTHH:mm:ss.sssZ). */
export const OUTBOX_CLAIM_UNTIL_LEN = 24;

/** Default exclusive-drain lease (ms). Concurrent queue + cron must not overlap. */
export const OUTBOX_CLAIM_LEASE_MS = 5 * 60 * 1000;

/**
 * Normalize claim expiry to fixed-width ISO-8601 for unambiguous parse/D1.
 */
export function normalizeOutboxClaimUntil(claimedUntil: string): string {
  if (claimedUntil.length === OUTBOX_CLAIM_UNTIL_LEN) return claimedUntil;
  const ms = Date.parse(claimedUntil);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid outbox claim until: ${claimedUntil}`);
  }
  return new Date(ms).toISOString();
}

export function formatOutboxClaim(
  claimedUntil: string,
  claimToken: string,
): string {
  const until = normalizeOutboxClaimUntil(claimedUntil);
  return `${OUTBOX_CLAIM_PREFIX}${until}:${claimToken}`;
}

/** Parse claim:<ISO24>:<token> into until + token, or null if malformed. */
export function parseOutboxClaim(
  lastError: string | null | undefined,
): { until: string; token: string } | null {
  if (!lastError || !lastError.startsWith(OUTBOX_CLAIM_PREFIX)) return null;
  const rest = lastError.slice(OUTBOX_CLAIM_PREFIX.length);
  // Need ISO24 + ":" + non-empty token
  if (rest.length < OUTBOX_CLAIM_UNTIL_LEN + 2) return null;
  if (rest.charAt(OUTBOX_CLAIM_UNTIL_LEN) !== ":") return null;
  const until = rest.slice(0, OUTBOX_CLAIM_UNTIL_LEN);
  const token = rest.slice(OUTBOX_CLAIM_UNTIL_LEN + 1);
  if (token.length === 0) return null;
  return { until, token };
}

/** True when lastError is an unexpired exclusive claim. */
export function isActiveOutboxClaim(
  lastError: string | null | undefined,
  nowIso: string,
): boolean {
  const parsed = parseOutboxClaim(lastError);
  if (!parsed) return false;
  // ISO-8601 timestamps compare lexicographically.
  return parsed.until > nowIso;
}

export function parseOutboxClaimToken(
  lastError: string | null | undefined,
): string | null {
  return parseOutboxClaim(lastError)?.token ?? null;
}

/** Atomic Comms.Send enqueue payload (job + recipients + outbox + idem + audit). */
export type EnqueueSendAtomicInput = {
  jobId: string;
  status: string;
  idempotencyKey: string;
  version: number;
  expectedVersion: number;
  updatedAt: string;
  recipients: MessageRecipientRow[];
  outbox: OutboxEventRow;
  idempotency: IdempotencyKeyRow;
  audit: AuditWriteInput;
};

export type EmailTemplateRow = {
  id: string;
  eventId: string;
  key: string;
  subject: string;
  bodyMd: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MessageJobRow = {
  id: string;
  eventId: string;
  templateId: string;
  status: string;
  segmentJson: string;
  recipientsJson: string | null;
  bodiesJson: string | null;
  missingFieldsJson: string | null;
  idempotencyKey: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OutboxEventRow = {
  id: string;
  topic: string;
  payloadJson: string;
  createdAt: string;
  processedAt: string | null;
  attempts: number;
  lastError: string | null;
};

export type MessageRecipientRow = {
  id: string;
  jobId: string;
  eventId: string;
  participationId: string | null;
  toEmail: string;
  name: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  createdAt: string;
};

export type DeliveryEventRow = {
  id: string;
  jobId: string;
  recipientId: string | null;
  eventId: string;
  provider: string;
  providerMessageId: string | null;
  status: string;
  attempt: number;
  error: string | null;
  payloadJson: string | null;
  createdAt: string;
};

export type CalendarInviteRow = {
  id: string;
  eventId: string;
  placementId: string;
  sessionId: string | null;
  uid: string;
  sequence: number;
  method: string;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  icsBody: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type IdempotencyKeyRow = {
  id: string;
  key: string;
  requestHash: string;
  responseJson: string | null;
  createdAt: string;
};

export type CommsStore = {
  findTemplateByEventKey(
    eventId: string,
    key: string,
  ): Promise<EmailTemplateRow | null>;
  findTemplateById(id: string): Promise<EmailTemplateRow | null>;
  listTemplatesForEvent(eventId: string): Promise<EmailTemplateRow[]>;
  insertTemplate(row: EmailTemplateRow): Promise<EmailTemplateRow>;
  /**
   * Conditional update: WHERE id AND version = expectedVersion.
   * Returns null on missing row or version conflict.
   */
  updateTemplate(
    id: string,
    patch: {
      subject: string;
      bodyMd: string;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<EmailTemplateRow | null>;

  insertJob(row: MessageJobRow): Promise<MessageJobRow>;
  findJobById(id: string): Promise<MessageJobRow | null>;
  findJobByIdempotencyKey(key: string): Promise<MessageJobRow | null>;
  /**
   * Conditional status transition for enqueue.
   * Returns null on missing / version conflict / wrong current status.
   */
  updateJob(
    id: string,
    patch: {
      status: string;
      idempotencyKey?: string | null;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<MessageJobRow | null>;
  listJobsForEvent(eventId: string): Promise<MessageJobRow[]>;

  insertOutbox(row: OutboxEventRow): Promise<OutboxEventRow>;
  listOutbox(): Promise<OutboxEventRow[]>;
  listOutboxByTopic(topic: string): Promise<OutboxEventRow[]>;
  listUnprocessedOutboxByTopic(topic: string): Promise<OutboxEventRow[]>;
  /**
   * Atomic exclusive claim for drain (queue consumer vs cron).
   * Returns null if already processed or another worker holds an unexpired lease.
   * Stores claim in last_error as claim:<ISO24>:<token>.
   */
  claimOutboxForProcessing(
    id: string,
    patch: {
      claimToken: string;
      claimedUntil: string;
      attempts: number;
    },
  ): Promise<OutboxEventRow | null>;
  /**
   * Drop an exclusive claim so another drain can resume (e.g. mid-job crash
   * recovery path after incomplete multi-recipient send). No-op if processed
   * or claim token does not match.
   */
  releaseOutboxClaim(
    id: string,
    claimToken: string,
  ): Promise<OutboxEventRow | null>;
  markOutboxProcessed(
    id: string,
    patch: {
      processedAt: string;
      attempts: number;
      lastError: string | null;
    },
  ): Promise<OutboxEventRow | null>;

  insertRecipient(row: MessageRecipientRow): Promise<MessageRecipientRow>;
  listRecipientsForJob(jobId: string): Promise<MessageRecipientRow[]>;
  /**
   * Atomic per-recipient send lock: queued|pending → sending.
   * Returns null if missing or already claimed/terminal (another drain won).
   */
  claimRecipientForSend(id: string): Promise<MessageRecipientRow | null>;
  updateRecipientStatus(
    id: string,
    status: string,
  ): Promise<MessageRecipientRow | null>;

  insertDeliveryEvent(row: DeliveryEventRow): Promise<DeliveryEventRow>;
  listDeliveryEventsForJob(jobId: string): Promise<DeliveryEventRow[]>;

  findCalendarInviteByPlacement(
    eventId: string,
    placementId: string,
  ): Promise<CalendarInviteRow | null>;
  findCalendarInviteByUid(uid: string): Promise<CalendarInviteRow | null>;
  listCalendarInvitesForEvent(eventId: string): Promise<CalendarInviteRow[]>;
  insertCalendarInvite(row: CalendarInviteRow): Promise<CalendarInviteRow>;
  updateCalendarInvite(
    id: string,
    patch: {
      sequence: number;
      method: string;
      summary: string | null;
      startsAt: string | null;
      endsAt: string | null;
      location: string | null;
      icsBody: string;
      sessionId: string | null;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<CalendarInviteRow | null>;

  findIdempotencyKey(key: string): Promise<IdempotencyKeyRow | null>;
  insertIdempotencyKey(row: IdempotencyKeyRow): Promise<IdempotencyKeyRow>;

  /**
   * Atomic Comms.Send enqueue (E7 transactional outbox + E3 audit):
   * job transition + recipients + outbox + idempotency_keys + audit_events.
   *
   * **Shared contract (Memory and D1 must both enforce — do not diverge):**
   * - Returns the job row only when *this* call performed the transition.
   * - Returns null when this call did not enqueue (lost job CAS, or same-key
   *   same-requestHash race loser) so sendComms sets enqueued: false (J04).
   * - Throws IdempotencyKeyConflictError when the key is already stored (or
   *   held on another job) with a different requestHash → HTTP 409.
   * - Losers must not leave orphan recipients / outbox / audit rows.
   * - Failure of the audit write must not leave job queued, outbox deliverable,
   *   or idempotency key stored (all-or-nothing atomic unit).
   *
   * D1: single batch + transition-token gate + unique idempotency_keys reconcile
   *     (audit_events in the same batch; onAudit ignored).
   * Memory: synchronous check+claim (no await between) so Promise.all races
   *     cannot both pass; await onAudit after claim; compensate/rollback the
   *     claim if onAudit rejects so the unit stays atomic across AuthStore.
   *
   * @param onAudit Memory/tests: write audit into AuthStore so listAudits works.
   *   D1 ignores this and inserts audit_events inside the same batch.
   */
  enqueueSendAtomic(
    input: EnqueueSendAtomicInput,
    onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<MessageJobRow | null>;
};

/**
 * Concurrent Comms.Send reused an idempotency key with a different request body
 * (requestHash mismatch). Mapped to HTTP 409 CONFLICT by sendComms.
 */
export class IdempotencyKeyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT" as const;
  constructor(public readonly key: string) {
    super("Idempotency key reused with different request");
    this.name = "IdempotencyKeyConflictError";
  }
}

export function newEmailTemplateId(): string {
  return uuidv7();
}
export function newMessageJobId(): string {
  return uuidv7();
}
export function newOutboxEventId(): string {
  return uuidv7();
}
export function newMessageRecipientId(): string {
  return uuidv7();
}
export function newDeliveryEventId(): string {
  return uuidv7();
}
export function newCalendarInviteId(): string {
  return uuidv7();
}
export function newIdempotencyKeyId(): string {
  return uuidv7();
}

/**
 * In-memory comms store — unit tests + e2e without D1.
 */
export class MemoryCommsStore implements CommsStore {
  private templates = new Map<string, EmailTemplateRow>();
  private byEventKey = new Map<string, string>();
  private jobs = new Map<string, MessageJobRow>();
  private byIdempotency = new Map<string, string>();
  private outbox: OutboxEventRow[] = [];
  private recipients = new Map<string, MessageRecipientRow>();
  private deliveries: DeliveryEventRow[] = [];
  private invites = new Map<string, CalendarInviteRow>();
  private byPlacement = new Map<string, string>();
  private byUid = new Map<string, string>();
  private idemKeys = new Map<string, IdempotencyKeyRow>();
  /**
   * In-flight enqueue chains keyed by idempotency storage key.
   * Concurrent callers await the active promise instead of reading provisional
   * claim state mid-audit (avoids false-success replay if onAudit later fails).
   */
  private inflightEnqueues = new Map<string, Promise<MessageJobRow | null>>();

  private ek(eventId: string, key: string): string {
    return `${eventId}::${key}`;
  }

  private pk(eventId: string, placementId: string): string {
    return `${eventId}::${placementId}`;
  }

  async findTemplateByEventKey(
    eventId: string,
    key: string,
  ): Promise<EmailTemplateRow | null> {
    const id = this.byEventKey.get(this.ek(eventId, key));
    if (!id) return null;
    const row = this.templates.get(id);
    return row ? { ...row } : null;
  }

  async findTemplateById(id: string): Promise<EmailTemplateRow | null> {
    const row = this.templates.get(id);
    return row ? { ...row } : null;
  }

  async listTemplatesForEvent(eventId: string): Promise<EmailTemplateRow[]> {
    return [...this.templates.values()]
      .filter((t) => t.eventId === eventId)
      .map((t) => ({ ...t }));
  }

  async insertTemplate(row: EmailTemplateRow): Promise<EmailTemplateRow> {
    this.templates.set(row.id, { ...row });
    this.byEventKey.set(this.ek(row.eventId, row.key), row.id);
    return { ...row };
  }

  async updateTemplate(
    id: string,
    patch: {
      subject: string;
      bodyMd: string;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<EmailTemplateRow | null> {
    const existing = this.templates.get(id);
    if (!existing) return null;
    if (existing.version !== patch.expectedVersion) return null;
    if (patch.version !== patch.expectedVersion + 1) return null;
    const next: EmailTemplateRow = {
      ...existing,
      subject: patch.subject,
      bodyMd: patch.bodyMd,
      version: patch.version,
      updatedAt: patch.updatedAt,
    };
    this.templates.set(id, next);
    return { ...next };
  }

  async insertJob(row: MessageJobRow): Promise<MessageJobRow> {
    this.jobs.set(row.id, { ...row });
    if (row.idempotencyKey) {
      this.byIdempotency.set(row.idempotencyKey, row.id);
    }
    return { ...row };
  }

  async findJobById(id: string): Promise<MessageJobRow | null> {
    const row = this.jobs.get(id);
    return row ? { ...row } : null;
  }

  async findJobByIdempotencyKey(key: string): Promise<MessageJobRow | null> {
    const id = this.byIdempotency.get(key);
    if (!id) return null;
    const row = this.jobs.get(id);
    return row ? { ...row } : null;
  }

  async updateJob(
    id: string,
    patch: {
      status: string;
      idempotencyKey?: string | null;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<MessageJobRow | null> {
    const existing = this.jobs.get(id);
    if (!existing) return null;
    if (existing.version !== patch.expectedVersion) return null;
    if (patch.version !== patch.expectedVersion + 1) return null;
    const next: MessageJobRow = {
      ...existing,
      status: patch.status,
      version: patch.version,
      updatedAt: patch.updatedAt,
      ...(patch.idempotencyKey !== undefined
        ? { idempotencyKey: patch.idempotencyKey }
        : {}),
    };
    this.jobs.set(id, next);
    if (next.idempotencyKey) {
      this.byIdempotency.set(next.idempotencyKey, next.id);
    }
    return { ...next };
  }

  async listJobsForEvent(eventId: string): Promise<MessageJobRow[]> {
    return [...this.jobs.values()]
      .filter((j) => j.eventId === eventId)
      .map((j) => ({ ...j }));
  }

  async insertOutbox(row: OutboxEventRow): Promise<OutboxEventRow> {
    const copy = { ...row };
    this.outbox.push(copy);
    return { ...copy };
  }

  async listOutbox(): Promise<OutboxEventRow[]> {
    return this.outbox.map((r) => ({ ...r }));
  }

  async listOutboxByTopic(topic: string): Promise<OutboxEventRow[]> {
    return this.outbox.filter((r) => r.topic === topic).map((r) => ({ ...r }));
  }

  async listUnprocessedOutboxByTopic(
    topic: string,
  ): Promise<OutboxEventRow[]> {
    const nowIso = new Date().toISOString();
    return this.outbox
      .filter(
        (r) =>
          r.topic === topic &&
          r.processedAt === null &&
          !isActiveOutboxClaim(r.lastError, nowIso),
      )
      .map((r) => ({ ...r }));
  }

  async claimOutboxForProcessing(
    id: string,
    patch: {
      claimToken: string;
      claimedUntil: string;
      attempts: number;
    },
  ): Promise<OutboxEventRow | null> {
    const idx = this.outbox.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const row = this.outbox[idx]!;
    if (row.processedAt !== null) return null;
    const nowIso = new Date().toISOString();
    if (isActiveOutboxClaim(row.lastError, nowIso)) return null;
    const next: OutboxEventRow = {
      ...row,
      attempts: patch.attempts,
      lastError: formatOutboxClaim(patch.claimedUntil, patch.claimToken),
    };
    this.outbox[idx] = next;
    return { ...next };
  }

  async releaseOutboxClaim(
    id: string,
    claimToken: string,
  ): Promise<OutboxEventRow | null> {
    const idx = this.outbox.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const row = this.outbox[idx]!;
    if (row.processedAt !== null) return null;
    if (parseOutboxClaimToken(row.lastError) !== claimToken) return null;
    const next: OutboxEventRow = {
      ...row,
      lastError: null,
    };
    this.outbox[idx] = next;
    return { ...next };
  }

  async markOutboxProcessed(
    id: string,
    patch: {
      processedAt: string;
      attempts: number;
      lastError: string | null;
    },
  ): Promise<OutboxEventRow | null> {
    const idx = this.outbox.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const next = {
      ...this.outbox[idx]!,
      processedAt: patch.processedAt,
      attempts: patch.attempts,
      lastError: patch.lastError,
    };
    this.outbox[idx] = next;
    return { ...next };
  }

  async insertRecipient(
    row: MessageRecipientRow,
  ): Promise<MessageRecipientRow> {
    this.recipients.set(row.id, { ...row });
    return { ...row };
  }

  async listRecipientsForJob(jobId: string): Promise<MessageRecipientRow[]> {
    return [...this.recipients.values()]
      .filter((r) => r.jobId === jobId)
      .map((r) => ({ ...r }));
  }

  async claimRecipientForSend(
    id: string,
  ): Promise<MessageRecipientRow | null> {
    const existing = this.recipients.get(id);
    if (!existing) return null;
    // Enqueue writes "queued"; schema default is "pending".
    if (existing.status !== "pending" && existing.status !== "queued") {
      return null;
    }
    const next: MessageRecipientRow = { ...existing, status: "sending" };
    this.recipients.set(id, next);
    return { ...next };
  }

  async updateRecipientStatus(
    id: string,
    status: string,
  ): Promise<MessageRecipientRow | null> {
    const existing = this.recipients.get(id);
    if (!existing) return null;
    const next = { ...existing, status };
    this.recipients.set(id, next);
    return { ...next };
  }

  async insertDeliveryEvent(row: DeliveryEventRow): Promise<DeliveryEventRow> {
    const copy = { ...row };
    this.deliveries.push(copy);
    return { ...copy };
  }

  async listDeliveryEventsForJob(jobId: string): Promise<DeliveryEventRow[]> {
    return this.deliveries
      .filter((d) => d.jobId === jobId)
      .map((d) => ({ ...d }));
  }

  async findCalendarInviteByPlacement(
    eventId: string,
    placementId: string,
  ): Promise<CalendarInviteRow | null> {
    const id = this.byPlacement.get(this.pk(eventId, placementId));
    if (!id) return null;
    const row = this.invites.get(id);
    return row ? { ...row } : null;
  }

  async findCalendarInviteByUid(
    uid: string,
  ): Promise<CalendarInviteRow | null> {
    const id = this.byUid.get(uid);
    if (!id) return null;
    const row = this.invites.get(id);
    return row ? { ...row } : null;
  }

  async listCalendarInvitesForEvent(
    eventId: string,
  ): Promise<CalendarInviteRow[]> {
    return [...this.invites.values()]
      .filter((i) => i.eventId === eventId)
      .map((i) => ({ ...i }));
  }

  async insertCalendarInvite(
    row: CalendarInviteRow,
  ): Promise<CalendarInviteRow> {
    this.invites.set(row.id, { ...row });
    this.byPlacement.set(this.pk(row.eventId, row.placementId), row.id);
    this.byUid.set(row.uid, row.id);
    return { ...row };
  }

  async updateCalendarInvite(
    id: string,
    patch: {
      sequence: number;
      method: string;
      summary: string | null;
      startsAt: string | null;
      endsAt: string | null;
      location: string | null;
      icsBody: string;
      sessionId: string | null;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<CalendarInviteRow | null> {
    const existing = this.invites.get(id);
    if (!existing) return null;
    if (existing.version !== patch.expectedVersion) return null;
    if (patch.version !== patch.expectedVersion + 1) return null;
    const next: CalendarInviteRow = {
      ...existing,
      sequence: patch.sequence,
      method: patch.method,
      summary: patch.summary,
      startsAt: patch.startsAt,
      endsAt: patch.endsAt,
      location: patch.location,
      icsBody: patch.icsBody,
      sessionId: patch.sessionId,
      version: patch.version,
      updatedAt: patch.updatedAt,
    };
    this.invites.set(id, next);
    return { ...next };
  }

  async findIdempotencyKey(key: string): Promise<IdempotencyKeyRow | null> {
    const row = this.idemKeys.get(key);
    return row ? { ...row } : null;
  }

  async insertIdempotencyKey(
    row: IdempotencyKeyRow,
  ): Promise<IdempotencyKeyRow> {
    // Do not silently overwrite a different requestHash (unique-key parity with D1).
    const existing = this.idemKeys.get(row.key);
    if (existing) {
      if (existing.requestHash !== row.requestHash) {
        // Storage key is `comms.send:{userKey}`; surface the row key for diagnostics.
        throw new IdempotencyKeyConflictError(row.key);
      }
      return { ...existing };
    }
    this.idemKeys.set(row.key, { ...row });
    return { ...row };
  }

  /**
   * Memory parity with D1 enqueueSendAtomic (do not diverge):
   * - J04 same key + same requestHash → only one winner enqueues; loser returns null
   * - Same key + different requestHash → IdempotencyKeyConflictError (409)
   * - Job version CAS loser → null (no orphan recipients/outbox/audit)
   * - Winner selection is synchronous within a per-key inflight chain so
   *   concurrent Promise.all callers cannot both pass.
   * - Concurrent same-key callers await the inflight promise instead of reading
   *   provisional claim maps mid-onAudit (no false-success if audit fails).
   * - onAudit is part of the atomic unit: if it rejects, compensate the claim
   *   (restore job, drop idempotency, recipients, outbox) so E7/E3 hold.
   *
   * Design note (do not flip-flop): race safety = inflight chain + claim-before-
   * await; cross-store audit (AuthStore) cannot join a Memory transaction, so
   * compensate-on-audit-failure is the Memory equivalent of D1's single batch.
   */
  async enqueueSendAtomic(
    input: EnqueueSendAtomicInput,
    onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<MessageJobRow | null> {
    const storageKey = input.idempotency.key;

    // Serialize same-key enqueues: concurrent callers await the in-flight
    // attempt so they never observe provisional claim state mid-onAudit.
    const prevFlight = this.inflightEnqueues.get(storageKey);

    const run = async (): Promise<MessageJobRow | null> => {
      if (prevFlight) {
        try {
          await prevFlight;
        } catch {
          // Prior attempt failed/compensated — fall through to re-check state.
        }
      }

      // --- Committed-state critical section (no await until claim is done) ---
      // 1) Idempotency key / requestHash (parity with D1 unique index).
      const existingIdem = this.idemKeys.get(storageKey);
      if (existingIdem) {
        if (existingIdem.requestHash !== input.idempotency.requestHash) {
          throw new IdempotencyKeyConflictError(input.idempotencyKey);
        }
        // Same request already committed — this call did not perform enqueue.
        return null;
      }

      // Partial unique on message_jobs.idempotency_key: another job holds key.
      const holderJobId = this.byIdempotency.get(input.idempotencyKey);
      if (holderJobId !== undefined && holderJobId !== input.jobId) {
        throw new IdempotencyKeyConflictError(input.idempotencyKey);
      }

      // 2) Job version CAS — must win to enqueue.
      const existing = this.jobs.get(input.jobId);
      if (!existing) return null;
      if (existing.version !== input.expectedVersion) return null;
      if (input.version !== input.expectedVersion + 1) return null;

      // Snapshot for compensate-on-audit-failure (E7/E3).
      const priorJob: MessageJobRow = { ...existing };
      const priorByIdempotencyHadKey = this.byIdempotency.has(
        input.idempotencyKey,
      );
      const priorByIdempotencyValue = this.byIdempotency.get(
        input.idempotencyKey,
      );
      const recipientIds = input.recipients.map((r) => r.id);
      const outboxId = input.outbox.id;

      // 3) Claim job + side effects before await (race-safe under JS
      // single-thread + inflight chain above).
      const next: MessageJobRow = {
        ...existing,
        status: input.status,
        version: input.version,
        updatedAt: input.updatedAt,
        idempotencyKey: input.idempotencyKey,
      };
      this.jobs.set(input.jobId, next);
      this.byIdempotency.set(input.idempotencyKey, input.jobId);
      this.idemKeys.set(storageKey, { ...input.idempotency });
      for (const r of input.recipients) {
        this.recipients.set(r.id, { ...r });
      }
      this.outbox.push({ ...input.outbox });

      // 4) Audit is part of the atomic unit. If it rejects, compensate so
      // concurrent waiters never see a durable success for a rolled-back claim.
      if (onAudit) {
        try {
          await onAudit(input.audit);
        } catch (err) {
          this.jobs.set(input.jobId, priorJob);
          if (
            priorByIdempotencyHadKey &&
            priorByIdempotencyValue !== undefined
          ) {
            this.byIdempotency.set(
              input.idempotencyKey,
              priorByIdempotencyValue,
            );
          } else {
            this.byIdempotency.delete(input.idempotencyKey);
          }
          this.idemKeys.delete(storageKey);
          for (const id of recipientIds) {
            this.recipients.delete(id);
          }
          const outIdx = this.outbox.findIndex((r) => r.id === outboxId);
          if (outIdx >= 0) this.outbox.splice(outIdx, 1);
          throw err;
        }
      }
      return { ...next };
    };

    const flight = run();
    this.inflightEnqueues.set(storageKey, flight);
    try {
      return await flight;
    } finally {
      if (this.inflightEnqueues.get(storageKey) === flight) {
        this.inflightEnqueues.delete(storageKey);
      }
    }
  }
}

/**
 * D1-backed comms store (production Worker).
 */
export class D1CommsStore implements CommsStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async findTemplateByEventKey(
    eventId: string,
    key: string,
  ): Promise<EmailTemplateRow | null> {
    const rows = await this.db
      .select()
      .from(emailTemplates)
      .where(
        and(eq(emailTemplates.eventId, eventId), eq(emailTemplates.key, key)),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      eventId: r.eventId,
      key: r.key,
      subject: r.subject,
      bodyMd: r.bodyMd,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async findTemplateById(id: string): Promise<EmailTemplateRow | null> {
    const rows = await this.db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      eventId: r.eventId,
      key: r.key,
      subject: r.subject,
      bodyMd: r.bodyMd,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async listTemplatesForEvent(eventId: string): Promise<EmailTemplateRow[]> {
    const rows = await this.db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.eventId, eventId));
    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      key: r.key,
      subject: r.subject,
      bodyMd: r.bodyMd,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async insertTemplate(row: EmailTemplateRow): Promise<EmailTemplateRow> {
    await this.db.insert(emailTemplates).values({
      id: row.id,
      eventId: row.eventId,
      key: row.key,
      subject: row.subject,
      bodyMd: row.bodyMd,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return { ...row };
  }

  async updateTemplate(
    id: string,
    patch: {
      subject: string;
      bodyMd: string;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<EmailTemplateRow | null> {
    const result = await this.db
      .update(emailTemplates)
      .set({
        subject: patch.subject,
        bodyMd: patch.bodyMd,
        version: patch.version,
        updatedAt: patch.updatedAt,
      })
      .where(
        and(
          eq(emailTemplates.id, id),
          eq(emailTemplates.version, patch.expectedVersion),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return this.findTemplateById(id);
  }

  async insertJob(row: MessageJobRow): Promise<MessageJobRow> {
    await this.db.insert(messageJobs).values({
      id: row.id,
      eventId: row.eventId,
      templateId: row.templateId,
      status: row.status,
      segmentJson: row.segmentJson,
      recipientsJson: row.recipientsJson,
      bodiesJson: row.bodiesJson,
      missingFieldsJson: row.missingFieldsJson,
      idempotencyKey: row.idempotencyKey,
      createdBy: row.createdBy,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return { ...row };
  }

  async findJobById(id: string): Promise<MessageJobRow | null> {
    const rows = await this.db
      .select()
      .from(messageJobs)
      .where(eq(messageJobs.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return mapJob(r);
  }

  async findJobByIdempotencyKey(key: string): Promise<MessageJobRow | null> {
    const rows = await this.db
      .select()
      .from(messageJobs)
      .where(eq(messageJobs.idempotencyKey, key))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return mapJob(r);
  }

  async updateJob(
    id: string,
    patch: {
      status: string;
      idempotencyKey?: string | null;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<MessageJobRow | null> {
    const set: {
      status: string;
      version: number;
      updatedAt: string;
      idempotencyKey?: string | null;
    } = {
      status: patch.status,
      version: patch.version,
      updatedAt: patch.updatedAt,
    };
    if (patch.idempotencyKey !== undefined) {
      set.idempotencyKey = patch.idempotencyKey;
    }
    const result = await this.db
      .update(messageJobs)
      .set(set)
      .where(
        and(
          eq(messageJobs.id, id),
          eq(messageJobs.version, patch.expectedVersion),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return this.findJobById(id);
  }

  async listJobsForEvent(eventId: string): Promise<MessageJobRow[]> {
    const rows = await this.db
      .select()
      .from(messageJobs)
      .where(eq(messageJobs.eventId, eventId));
    return rows.map(mapJob);
  }

  async insertOutbox(row: OutboxEventRow): Promise<OutboxEventRow> {
    await this.db.insert(outboxEvents).values({
      id: row.id,
      topic: row.topic,
      payloadJson: row.payloadJson,
      createdAt: row.createdAt,
      processedAt: row.processedAt,
      attempts: row.attempts,
      lastError: row.lastError,
    });
    return { ...row };
  }

  async listOutbox(): Promise<OutboxEventRow[]> {
    const rows = await this.db.select().from(outboxEvents);
    return rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      payloadJson: r.payloadJson,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
      attempts: r.attempts,
      lastError: r.lastError,
    }));
  }

  async listOutboxByTopic(topic: string): Promise<OutboxEventRow[]> {
    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.topic, topic));
    return rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      payloadJson: r.payloadJson,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
      attempts: r.attempts,
      lastError: r.lastError,
    }));
  }

  async listUnprocessedOutboxByTopic(
    topic: string,
  ): Promise<OutboxEventRow[]> {
    const nowIso = new Date().toISOString();
    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(
        and(eq(outboxEvents.topic, topic), isNull(outboxEvents.processedAt)),
      );
    // Filter expired/absent claims in app (D1 WHERE for claim shape is fragile).
    return rows
      .filter((r) => !isActiveOutboxClaim(r.lastError, nowIso))
      .map((r) => ({
        id: r.id,
        topic: r.topic,
        payloadJson: r.payloadJson,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
        attempts: r.attempts,
        lastError: r.lastError,
      }));
  }

  async claimOutboxForProcessing(
    id: string,
    patch: {
      claimToken: string;
      claimedUntil: string;
      attempts: number;
    },
  ): Promise<OutboxEventRow | null> {
    const nowIso = new Date().toISOString();
    const claimValue = formatOutboxClaim(patch.claimedUntil, patch.claimToken);
    // Atomic CAS: only one concurrent drain wins.
    // Claimable when unprocessed and (no claim marker OR expired lease).
    // claim:<ISO24>:<token> — ISO length 24 so substr positions are fixed.
    const result = await this.db
      .update(outboxEvents)
      .set({
        attempts: patch.attempts,
        lastError: claimValue,
      })
      .where(
        and(
          eq(outboxEvents.id, id),
          isNull(outboxEvents.processedAt),
          or(
            isNull(outboxEvents.lastError),
            sql`${outboxEvents.lastError} NOT LIKE ${OUTBOX_CLAIM_PREFIX + "%"}`,
            sql`substr(${outboxEvents.lastError}, 7, 24) <= ${nowIso}`,
          ),
        ),
      );
    if (d1Changes(result) === 0) return null;
    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      topic: r.topic,
      payloadJson: r.payloadJson,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
      attempts: r.attempts,
      lastError: r.lastError,
    };
  }

  async releaseOutboxClaim(
    id: string,
    claimToken: string,
  ): Promise<OutboxEventRow | null> {
    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.processedAt !== null) return null;
    if (parseOutboxClaimToken(existing.lastError) !== claimToken) return null;
    const priorClaim = existing.lastError;
    if (priorClaim == null) return null;
    const result = await this.db
      .update(outboxEvents)
      .set({ lastError: null })
      .where(
        and(
          eq(outboxEvents.id, id),
          isNull(outboxEvents.processedAt),
          eq(outboxEvents.lastError, priorClaim),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return {
      id: existing.id,
      topic: existing.topic,
      payloadJson: existing.payloadJson,
      createdAt: existing.createdAt,
      processedAt: existing.processedAt,
      attempts: existing.attempts,
      lastError: null,
    };
  }

  async markOutboxProcessed(
    id: string,
    patch: {
      processedAt: string;
      attempts: number;
      lastError: string | null;
    },
  ): Promise<OutboxEventRow | null> {
    const result = await this.db
      .update(outboxEvents)
      .set({
        processedAt: patch.processedAt,
        attempts: patch.attempts,
        lastError: patch.lastError,
      })
      .where(eq(outboxEvents.id, id));
    if (d1Changes(result) === 0) return null;
    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      topic: r.topic,
      payloadJson: r.payloadJson,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
      attempts: r.attempts,
      lastError: r.lastError,
    };
  }

  async insertRecipient(
    row: MessageRecipientRow,
  ): Promise<MessageRecipientRow> {
    await this.db.insert(messageRecipients).values({
      id: row.id,
      jobId: row.jobId,
      eventId: row.eventId,
      participationId: row.participationId,
      toEmail: row.toEmail,
      name: row.name,
      subject: row.subject,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt,
    });
    return { ...row };
  }

  async listRecipientsForJob(jobId: string): Promise<MessageRecipientRow[]> {
    const rows = await this.db
      .select()
      .from(messageRecipients)
      .where(eq(messageRecipients.jobId, jobId));
    return rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      eventId: r.eventId,
      participationId: r.participationId,
      toEmail: r.toEmail,
      name: r.name,
      subject: r.subject,
      body: r.body,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  async claimRecipientForSend(
    id: string,
  ): Promise<MessageRecipientRow | null> {
    // Claim when still pre-send (enqueue uses "queued"; schema default "pending").
    const result = await this.db
      .update(messageRecipients)
      .set({ status: "sending" })
      .where(
        and(
          eq(messageRecipients.id, id),
          or(
            eq(messageRecipients.status, "pending"),
            eq(messageRecipients.status, "queued"),
          ),
        ),
      );
    if (d1Changes(result) === 0) return null;
    const rows = await this.db
      .select()
      .from(messageRecipients)
      .where(eq(messageRecipients.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      jobId: r.jobId,
      eventId: r.eventId,
      participationId: r.participationId,
      toEmail: r.toEmail,
      name: r.name,
      subject: r.subject,
      body: r.body,
      status: r.status,
      createdAt: r.createdAt,
    };
  }

  async updateRecipientStatus(
    id: string,
    status: string,
  ): Promise<MessageRecipientRow | null> {
    const result = await this.db
      .update(messageRecipients)
      .set({ status })
      .where(eq(messageRecipients.id, id));
    if (d1Changes(result) === 0) return null;
    const rows = await this.db
      .select()
      .from(messageRecipients)
      .where(eq(messageRecipients.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      jobId: r.jobId,
      eventId: r.eventId,
      participationId: r.participationId,
      toEmail: r.toEmail,
      name: r.name,
      subject: r.subject,
      body: r.body,
      status: r.status,
      createdAt: r.createdAt,
    };
  }

  async insertDeliveryEvent(row: DeliveryEventRow): Promise<DeliveryEventRow> {
    await this.db.insert(deliveryEvents).values({
      id: row.id,
      jobId: row.jobId,
      recipientId: row.recipientId,
      eventId: row.eventId,
      provider: row.provider,
      providerMessageId: row.providerMessageId,
      status: row.status,
      attempt: row.attempt,
      error: row.error,
      payloadJson: row.payloadJson,
      createdAt: row.createdAt,
    });
    return { ...row };
  }

  async listDeliveryEventsForJob(jobId: string): Promise<DeliveryEventRow[]> {
    const rows = await this.db
      .select()
      .from(deliveryEvents)
      .where(eq(deliveryEvents.jobId, jobId));
    return rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      recipientId: r.recipientId,
      eventId: r.eventId,
      provider: r.provider,
      providerMessageId: r.providerMessageId,
      status: r.status,
      attempt: r.attempt,
      error: r.error,
      payloadJson: r.payloadJson,
      createdAt: r.createdAt,
    }));
  }

  async findCalendarInviteByPlacement(
    eventId: string,
    placementId: string,
  ): Promise<CalendarInviteRow | null> {
    const rows = await this.db
      .select()
      .from(calendarInvites)
      .where(
        and(
          eq(calendarInvites.eventId, eventId),
          eq(calendarInvites.placementId, placementId),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return mapInvite(r);
  }

  async findCalendarInviteByUid(
    uid: string,
  ): Promise<CalendarInviteRow | null> {
    const rows = await this.db
      .select()
      .from(calendarInvites)
      .where(eq(calendarInvites.uid, uid))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return mapInvite(r);
  }

  async listCalendarInvitesForEvent(
    eventId: string,
  ): Promise<CalendarInviteRow[]> {
    const rows = await this.db
      .select()
      .from(calendarInvites)
      .where(eq(calendarInvites.eventId, eventId));
    return rows.map(mapInvite);
  }

  async insertCalendarInvite(
    row: CalendarInviteRow,
  ): Promise<CalendarInviteRow> {
    await this.db.insert(calendarInvites).values({
      id: row.id,
      eventId: row.eventId,
      placementId: row.placementId,
      sessionId: row.sessionId,
      uid: row.uid,
      sequence: row.sequence,
      method: row.method,
      summary: row.summary,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      location: row.location,
      icsBody: row.icsBody,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return { ...row };
  }

  async updateCalendarInvite(
    id: string,
    patch: {
      sequence: number;
      method: string;
      summary: string | null;
      startsAt: string | null;
      endsAt: string | null;
      location: string | null;
      icsBody: string;
      sessionId: string | null;
      version: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<CalendarInviteRow | null> {
    const result = await this.db
      .update(calendarInvites)
      .set({
        sequence: patch.sequence,
        method: patch.method,
        summary: patch.summary,
        startsAt: patch.startsAt,
        endsAt: patch.endsAt,
        location: patch.location,
        icsBody: patch.icsBody,
        sessionId: patch.sessionId,
        version: patch.version,
        updatedAt: patch.updatedAt,
      })
      .where(
        and(
          eq(calendarInvites.id, id),
          eq(calendarInvites.version, patch.expectedVersion),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return this.findCalendarInviteById(id);
  }

  private async findCalendarInviteById(
    id: string,
  ): Promise<CalendarInviteRow | null> {
    const rows = await this.db
      .select()
      .from(calendarInvites)
      .where(eq(calendarInvites.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return mapInvite(r);
  }

  async findIdempotencyKey(key: string): Promise<IdempotencyKeyRow | null> {
    const rows = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      key: r.key,
      requestHash: r.requestHash,
      responseJson: r.responseJson,
      createdAt: r.createdAt,
    };
  }

  async insertIdempotencyKey(
    row: IdempotencyKeyRow,
  ): Promise<IdempotencyKeyRow> {
    await this.db.insert(idempotencyKeys).values({
      id: row.id,
      key: row.key,
      requestHash: row.requestHash,
      responseJson: row.responseJson,
      createdAt: row.createdAt,
    });
    return { ...row };
  }

  /**
   * Atomic Comms.Send enqueue (E7 transactional outbox):
   * Single D1 batch = job transition + recipients + outbox + idempotency + audit.
   * All-or-nothing on statement failure (job never left queued without outbox).
   *
   * Design (do not flip-flop):
   * - Claim-then-insert (separate round-trips) avoids orphans but can leave a
   *   queued job without an outbox row if the insert batch fails — breaks E7.
   * - Single batch with INSERT…SELECT gated only on post-update version shares
   *   that version with concurrent losers (winner N→N+1; loser UPDATE 0 rows
   *   still sees version N+1) and commits orphan side effects under different
   *   idempotency keys.
   * - Single batch + gate on a *per-attempt transition token* (uuid stamped into
   *   updated_at for INSERT…SELECT only) satisfies both: atomicity and no
   *   orphans. Concurrent same idempotencyKey retries never share the gate
   *   marker even at identical ms. After gated inserts, restore canonical
   *   input.updatedAt so MessageJobDto stays ISO-8601.
   * - If a batch still races the unique idempotency_keys index, validate the
   *   stored requestHash: match → null (command replay, enqueued:false);
   *   mismatch → IdempotencyKeyConflictError (409). Never return the winner's
   *   row as if this call performed the enqueue.
   */
  async enqueueSendAtomic(
    input: EnqueueSendAtomicInput,
    _onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<MessageJobRow | null> {
    const audit = buildAuditEventRow(input.audit);

    // Guaranteed-unique per attempt — not wall-clock ms (J04 same-key race).
    // Used only as an INSERT…SELECT gate; restored to input.updatedAt below.
    const transitionToken = uuidv7();
    const transitionStamp = `${input.updatedAt}#${transitionToken}`;

    const jobUpdate = this.db
      .update(messageJobs)
      .set({
        status: input.status,
        idempotencyKey: input.idempotencyKey,
        version: input.version,
        updatedAt: transitionStamp,
      })
      .where(
        and(
          eq(messageJobs.id, input.jobId),
          eq(messageJobs.version, input.expectedVersion),
        ),
      );

    // Transition-unique gate: only *this* UPDATE stamp is visible to inserts.
    const jobWon = and(
      eq(messageJobs.id, input.jobId),
      eq(messageJobs.version, input.version),
      eq(messageJobs.idempotencyKey, input.idempotencyKey),
      eq(messageJobs.updatedAt, transitionStamp),
    );

    const recipientInserts = input.recipients.map((r) =>
      this.db.insert(messageRecipients).select(
        this.db
          .select({
            id: sql<string>`${r.id}`.as("id"),
            jobId: sql<string>`${r.jobId}`.as("job_id"),
            eventId: sql<string>`${r.eventId}`.as("event_id"),
            participationId: sql<string | null>`${r.participationId}`.as(
              "participation_id",
            ),
            toEmail: sql<string>`${r.toEmail}`.as("to_email"),
            name: sql<string | null>`${r.name}`.as("name"),
            subject: sql<string | null>`${r.subject}`.as("subject"),
            body: sql<string | null>`${r.body}`.as("body"),
            status: sql<string>`${r.status}`.as("status"),
            createdAt: sql<string>`${r.createdAt}`.as("created_at"),
          })
          .from(messageJobs)
          .where(jobWon)
          .limit(1),
      ),
    );

    const outboxInsert = this.db.insert(outboxEvents).select(
      this.db
        .select({
          id: sql<string>`${input.outbox.id}`.as("id"),
          topic: sql<string>`${input.outbox.topic}`.as("topic"),
          payloadJson: sql<string>`${input.outbox.payloadJson}`.as(
            "payload_json",
          ),
          createdAt: sql<string>`${input.outbox.createdAt}`.as("created_at"),
          processedAt: sql<string | null>`${input.outbox.processedAt}`.as(
            "processed_at",
          ),
          attempts: sql<number>`${input.outbox.attempts}`.as("attempts"),
          lastError: sql<string | null>`${input.outbox.lastError}`.as(
            "last_error",
          ),
        })
        .from(messageJobs)
        .where(jobWon)
        .limit(1),
    );

    const idemInsert = this.db.insert(idempotencyKeys).select(
      this.db
        .select({
          id: sql<string>`${input.idempotency.id}`.as("id"),
          key: sql<string>`${input.idempotency.key}`.as("key"),
          requestHash: sql<string>`${input.idempotency.requestHash}`.as(
            "request_hash",
          ),
          responseJson: sql<string | null>`${input.idempotency.responseJson}`.as(
            "response_json",
          ),
          createdAt: sql<string>`${input.idempotency.createdAt}`.as(
            "created_at",
          ),
        })
        .from(messageJobs)
        .where(jobWon)
        .limit(1),
    );

    const auditInsert = this.db.insert(auditEvents).select(
      this.db
        .select({
          id: sql<string>`${audit.id}`.as("id"),
          eventId: sql<string | null>`${audit.eventId ?? null}`.as("event_id"),
          actorType: sql<string>`${audit.actorType}`.as("actor_type"),
          actorId: sql<string>`${audit.actorId}`.as("actor_id"),
          action: sql<string>`${audit.action}`.as("action"),
          entityType: sql<string>`${audit.entityType}`.as("entity_type"),
          entityId: sql<string>`${audit.entityId}`.as("entity_id"),
          beforeJson: sql<string | null>`${audit.beforeJson ?? null}`.as(
            "before_json",
          ),
          afterJson: sql<string | null>`${audit.afterJson ?? null}`.as(
            "after_json",
          ),
          correlationId: sql<string>`${audit.correlationId}`.as(
            "correlation_id",
          ),
          createdAt: sql<string>`${audit.createdAt}`.as("created_at"),
        })
        .from(messageJobs)
        .where(jobWon)
        .limit(1),
    );

    // After token-gated inserts, restore canonical ISO updatedAt (do not leak
    // the internal transition marker through MessageJobDto).
    const restoreUpdatedAt = this.db
      .update(messageJobs)
      .set({ updatedAt: input.updatedAt })
      .where(jobWon);

    // Single D1 batch: job + side effects commit or roll back together (E7).
    // D1 batch requires a non-empty tuple type.
    let results: unknown[];
    try {
      if (recipientInserts.length === 0) {
        results = await this.db.batch([
          jobUpdate,
          outboxInsert,
          idemInsert,
          auditInsert,
          restoreUpdatedAt,
        ]);
      } else {
        results = await this.db.batch([
          jobUpdate,
          recipientInserts[0]!,
          ...recipientInserts.slice(1),
          outboxInsert,
          idemInsert,
          auditInsert,
          restoreUpdatedAt,
        ]);
      }
    } catch (err) {
      // Duplicate-key batch race: winner committed. Validate requestHash —
      // never return the winner's job as created-by-this-call.
      await this.reconcileEnqueueBatchError(input, err);
      return null;
    }
    if (d1Changes(results[0]) === 0) {
      // Lost version CAS. Null so sendComms fallback returns enqueued: false
      // (do not return the concurrent winner's row as enqueued: true).
      return null;
    }
    return this.findJobById(input.jobId);
  }

  /**
   * After a failed enqueue batch, classify concurrent winner vs hard error.
   * Same requestHash → silent null (J04 replay). Different hash → 409 conflict.
   * Unknown failure with no winner row → rethrow.
   */
  private async reconcileEnqueueBatchError(
    input: EnqueueSendAtomicInput,
    err: unknown,
  ): Promise<void> {
    const existingIdem = await this.findIdempotencyKey(input.idempotency.key);
    if (existingIdem) {
      if (existingIdem.requestHash !== input.idempotency.requestHash) {
        throw new IdempotencyKeyConflictError(input.idempotencyKey);
      }
      // Same request — command re-reads job and returns enqueued: false.
      return;
    }
    // Winner may have set message_jobs.idempotency_key without a visible
    // idempotency_keys row yet (unlikely in same-batch atomic path); still
    // do not claim this call enqueued.
    const existingJob = await this.findJobByIdempotencyKey(input.idempotencyKey);
    if (existingJob) {
      // Different preview under same key without idem row: job id ≠ this preview.
      if (existingJob.id !== input.jobId) {
        throw new IdempotencyKeyConflictError(input.idempotencyKey);
      }
      return;
    }
    throw err;
  }
}

function mapInvite(r: {
  id: string;
  eventId: string;
  placementId: string;
  sessionId: string | null;
  uid: string;
  sequence: number;
  method: string;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  icsBody: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}): CalendarInviteRow {
  return {
    id: r.id,
    eventId: r.eventId,
    placementId: r.placementId,
    sessionId: r.sessionId,
    uid: r.uid,
    sequence: r.sequence,
    method: r.method,
    summary: r.summary,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    location: r.location,
    icsBody: r.icsBody,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapJob(r: {
  id: string;
  eventId: string;
  templateId: string;
  status: string;
  segmentJson: string;
  recipientsJson: string | null;
  bodiesJson: string | null;
  missingFieldsJson: string | null;
  idempotencyKey: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}): MessageJobRow {
  return {
    id: r.id,
    eventId: r.eventId,
    templateId: r.templateId,
    status: r.status,
    segmentJson: r.segmentJson,
    recipientsJson: r.recipientsJson,
    bodiesJson: r.bodiesJson,
    missingFieldsJson: r.missingFieldsJson,
    idempotencyKey: r.idempotencyKey,
    createdBy: r.createdBy,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

