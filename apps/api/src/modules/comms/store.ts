/**
 * Comms persistence — templates, jobs, recipients, delivery, ICS, outbox (5.1–5.2).
 *
 * MemoryCommsStore is the test / local e2e default (no D1 required).
 * D1CommsStore wraps the Worker DB binding for production (E1 SoR).
 * Event-scoped queries take eventId (E2).
 */
import { eq, and, isNull } from "drizzle-orm";
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
   * Atomic Comms.Send enqueue (E7 transactional outbox):
   * job transition + recipients + outbox + idempotency_keys + audit_events.
   * D1 uses a single batch; Memory applies all writes before returning.
   * Returns null on version conflict (job not transitioned).
   *
   * @param onAudit Memory/tests: write audit into AuthStore so listAudits works.
   *   D1 ignores this and inserts audit_events inside the same batch.
   */
  enqueueSendAtomic(
    input: EnqueueSendAtomicInput,
    onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<MessageJobRow | null>;
};

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
    return this.outbox
      .filter((r) => r.topic === topic && r.processedAt === null)
      .map((r) => ({ ...r }));
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
    this.idemKeys.set(row.key, { ...row });
    return { ...row };
  }

  async enqueueSendAtomic(
    input: EnqueueSendAtomicInput,
    onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<MessageJobRow | null> {
    // Memory: apply all writes as a single logical unit (no partial return).
    const updated = await this.updateJob(input.jobId, {
      status: input.status,
      idempotencyKey: input.idempotencyKey,
      version: input.version,
      expectedVersion: input.expectedVersion,
      updatedAt: input.updatedAt,
    });
    if (!updated) return null;

    for (const r of input.recipients) {
      await this.insertRecipient(r);
    }
    await this.insertOutbox(input.outbox);
    await this.insertIdempotencyKey(input.idempotency);
    if (onAudit) {
      await onAudit(input.audit);
    }
    return updated;
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
    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(
        and(eq(outboxEvents.topic, topic), isNull(outboxEvents.processedAt)),
      );
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
   * Single D1 batch: job update + recipients + outbox + idempotency + audit.
   * All-or-nothing for mid-request failure (E7 transactional outbox).
   */
  async enqueueSendAtomic(
    input: EnqueueSendAtomicInput,
    _onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<MessageJobRow | null> {
    const audit = buildAuditEventRow(input.audit);
    const jobUpdate = this.db
      .update(messageJobs)
      .set({
        status: input.status,
        idempotencyKey: input.idempotencyKey,
        version: input.version,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(messageJobs.id, input.jobId),
          eq(messageJobs.version, input.expectedVersion),
        ),
      );

    const recipientInserts = input.recipients.map((r) =>
      this.db.insert(messageRecipients).values({
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
      }),
    );

    const outboxInsert = this.db.insert(outboxEvents).values({
      id: input.outbox.id,
      topic: input.outbox.topic,
      payloadJson: input.outbox.payloadJson,
      createdAt: input.outbox.createdAt,
      processedAt: input.outbox.processedAt,
      attempts: input.outbox.attempts,
      lastError: input.outbox.lastError,
    });

    const idemInsert = this.db.insert(idempotencyKeys).values({
      id: input.idempotency.id,
      key: input.idempotency.key,
      requestHash: input.idempotency.requestHash,
      responseJson: input.idempotency.responseJson,
      createdAt: input.idempotency.createdAt,
    });

    const auditInsert = this.db.insert(auditEvents).values({
      id: audit.id,
      eventId: audit.eventId ?? null,
      actorType: audit.actorType,
      actorId: audit.actorId,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId,
      beforeJson: audit.beforeJson ?? null,
      afterJson: audit.afterJson ?? null,
      correlationId: audit.correlationId,
      createdAt: audit.createdAt,
    });

    // Single D1 batch = transactional multi-statement write (E7).
    const results = await this.db.batch([
      jobUpdate,
      ...recipientInserts,
      outboxInsert,
      idemInsert,
      auditInsert,
    ]);
    if (d1Changes(results[0]) === 0) {
      // Version conflict: batch may still have applied inserts on some runtimes.
      // Prefer null so the command layer can reconcile via idempotency lookup.
      return null;
    }
    return this.findJobById(input.jobId);
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

