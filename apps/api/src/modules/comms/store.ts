/**
 * Comms persistence — email_templates, message_jobs, outbox_events (section 5.1).
 *
 * MemoryCommsStore is the test / local e2e default (no D1 required).
 * D1CommsStore wraps the Worker DB binding for production (E1 SoR).
 * Event-scoped queries take eventId (E2).
 */
import { eq, and } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  emailTemplates,
  messageJobs,
  outboxEvents,
} from "@speakerops/db";
import { d1Changes } from "../auth/store.js";

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

/**
 * In-memory comms store — unit tests + e2e without D1.
 */
export class MemoryCommsStore implements CommsStore {
  private templates = new Map<string, EmailTemplateRow>();
  private byEventKey = new Map<string, string>();
  private jobs = new Map<string, MessageJobRow>();
  private byIdempotency = new Map<string, string>();
  private outbox: OutboxEventRow[] = [];

  private ek(eventId: string, key: string): string {
    return `${eventId}::${key}`;
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

