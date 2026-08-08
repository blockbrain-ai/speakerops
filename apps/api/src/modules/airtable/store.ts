/**
 * Airtable projection persistence (section 7.3 / S-AIRTABLE).
 *
 * projection_records + outbox_events topic airtable.project.
 * Memory store for tests; D1 store for production Worker (E1 SoR).
 */
import { eq, and, isNull, or, sql } from "drizzle-orm";
import {
  AIRTABLE_OUTBOX_TOPIC,
  AIRTABLE_PROJECTION_SYSTEM,
  type AirtableEntityType,
} from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  projectionRecords,
  outboxEvents,
} from "@speakerops/db";
import { d1Changes } from "../auth/store.js";
import {
  formatOutboxClaim,
  isActiveOutboxClaim,
  OUTBOX_CLAIM_LEASE_MS,
  OUTBOX_CLAIM_PREFIX,
} from "../comms/store.js";

export { OUTBOX_CLAIM_LEASE_MS };

export type OutboxEventRow = {
  id: string;
  topic: string;
  payloadJson: string;
  createdAt: string;
  processedAt: string | null;
  attempts: number;
  lastError: string | null;
};

export type ProjectionRecordRow = {
  id: string;
  system: string;
  entityType: string;
  internalId: string;
  externalId: string | null;
  sourceVersion: number;
  updatedAt: string;
};

export type AirtableStore = {
  insertOutbox(row: OutboxEventRow): Promise<OutboxEventRow>;
  listOutboxByTopic(topic: string): Promise<OutboxEventRow[]>;
  listUnprocessedOutboxByTopic(topic: string): Promise<OutboxEventRow[]>;
  /**
   * List unprocessed airtable.project rows whose payload.eventId matches.
   * Used by Reports.AirtableStatus lag fields.
   */
  listUnprocessedAirtableForEvent(eventId: string): Promise<OutboxEventRow[]>;
  claimOutboxForProcessing(
    id: string,
    patch: {
      claimToken: string;
      claimedUntil: string;
      attempts: number;
    },
  ): Promise<OutboxEventRow | null>;
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
  /** Mark error without completing (429 / transient) — leave unprocessed. */
  markOutboxError(
    id: string,
    patch: { attempts: number; lastError: string },
  ): Promise<OutboxEventRow | null>;
  /**
   * Remove an unprocessed outbox row (E7 compensation when event write unit
   * fails after outbox insert). No-op / false when missing or already processed.
   */
  deleteUnprocessedOutbox(id: string): Promise<boolean>;

  findProjection(
    system: string,
    entityType: string,
    internalId: string,
  ): Promise<ProjectionRecordRow | null>;
  upsertProjection(row: ProjectionRecordRow): Promise<ProjectionRecordRow>;
  listProjectionsBySystem(system: string): Promise<ProjectionRecordRow[]>;
  /**
   * Count projections whose internal_id was projected for event (payload scan)
   * or all airtable rows when event filter is approximate via outbox history.
   * Status uses listProjectionsForEventInternalIds when available.
   */
  listProjectionsForInternalIds(
    system: string,
    internalIds: string[],
  ): Promise<ProjectionRecordRow[]>;
};

function payloadEventId(payloadJson: string): string | null {
  try {
    const p = JSON.parse(payloadJson) as { eventId?: unknown };
    return typeof p.eventId === "string" && p.eventId.length > 0
      ? p.eventId
      : null;
  } catch {
    return null;
  }
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export class MemoryAirtableStore implements AirtableStore {
  private outbox: OutboxEventRow[] = [];
  private projections: ProjectionRecordRow[] = [];

  async insertOutbox(row: OutboxEventRow): Promise<OutboxEventRow> {
    const copy = { ...row };
    this.outbox.push(copy);
    return { ...copy };
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

  async listUnprocessedAirtableForEvent(
    eventId: string,
  ): Promise<OutboxEventRow[]> {
    const nowIso = new Date().toISOString();
    return this.outbox
      .filter(
        (r) =>
          r.topic === AIRTABLE_OUTBOX_TOPIC &&
          r.processedAt === null &&
          payloadEventId(r.payloadJson) === eventId &&
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
    const claim = row.lastError;
    if (!claim || !claim.includes(`:${claimToken}`)) return null;
    const next: OutboxEventRow = { ...row, lastError: null };
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

  async markOutboxError(
    id: string,
    patch: { attempts: number; lastError: string },
  ): Promise<OutboxEventRow | null> {
    const idx = this.outbox.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const next = {
      ...this.outbox[idx]!,
      attempts: patch.attempts,
      lastError: patch.lastError,
    };
    this.outbox[idx] = next;
    return { ...next };
  }

  async deleteUnprocessedOutbox(id: string): Promise<boolean> {
    const idx = this.outbox.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    if (this.outbox[idx]!.processedAt !== null) return false;
    this.outbox.splice(idx, 1);
    return true;
  }

  async findProjection(
    system: string,
    entityType: string,
    internalId: string,
  ): Promise<ProjectionRecordRow | null> {
    const row = this.projections.find(
      (r) =>
        r.system === system &&
        r.entityType === entityType &&
        r.internalId === internalId,
    );
    return row ? { ...row } : null;
  }

  async upsertProjection(row: ProjectionRecordRow): Promise<ProjectionRecordRow> {
    const idx = this.projections.findIndex(
      (r) =>
        r.system === row.system &&
        r.entityType === row.entityType &&
        r.internalId === row.internalId,
    );
    if (idx >= 0) {
      const next = {
        ...row,
        id: this.projections[idx]!.id,
      };
      this.projections[idx] = next;
      return { ...next };
    }
    const copy = { ...row };
    this.projections.push(copy);
    return { ...copy };
  }

  async listProjectionsBySystem(system: string): Promise<ProjectionRecordRow[]> {
    return this.projections
      .filter((r) => r.system === system)
      .map((r) => ({ ...r }));
  }

  async listProjectionsForInternalIds(
    system: string,
    internalIds: string[],
  ): Promise<ProjectionRecordRow[]> {
    const set = new Set(internalIds);
    return this.projections
      .filter((r) => r.system === system && set.has(r.internalId))
      .map((r) => ({ ...r }));
  }

  /** Test helper: all internal ids ever enqueued for an event. */
  listInternalIdsForEvent(eventId: string): string[] {
    const ids = new Set<string>();
    for (const r of this.outbox) {
      if (r.topic !== AIRTABLE_OUTBOX_TOPIC) continue;
      if (payloadEventId(r.payloadJson) !== eventId) continue;
      try {
        const p = JSON.parse(r.payloadJson) as { internalId?: string };
        if (p.internalId) ids.add(p.internalId);
      } catch {
        /* ignore */
      }
    }
    return [...ids];
  }
}

// ─── D1 ──────────────────────────────────────────────────────────────────────

export class D1AirtableStore implements AirtableStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
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
      processedAt: r.processedAt ?? null,
      attempts: r.attempts,
      lastError: r.lastError ?? null,
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
    return rows
      .filter((r) => !isActiveOutboxClaim(r.lastError, nowIso))
      .map((r) => ({
        id: r.id,
        topic: r.topic,
        payloadJson: r.payloadJson,
        createdAt: r.createdAt,
        processedAt: r.processedAt ?? null,
        attempts: r.attempts,
        lastError: r.lastError ?? null,
      }));
  }

  async listUnprocessedAirtableForEvent(
    eventId: string,
  ): Promise<OutboxEventRow[]> {
    const pending = await this.listUnprocessedOutboxByTopic(
      AIRTABLE_OUTBOX_TOPIC,
    );
    return pending.filter((r) => payloadEventId(r.payloadJson) === eventId);
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
    // Atomic exclusive CAS (parity with D1CommsStore): only one concurrent
    // queue/cron drain wins. Claimable when unprocessed and (no claim marker
    // OR expired lease). Compare previous claim in the UPDATE WHERE — do not
    // read-then-update by id alone (race → duplicate Airtable records).
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
      processedAt: r.processedAt ?? null,
      attempts: r.attempts,
      lastError: r.lastError ?? null,
    };
  }

  async releaseOutboxClaim(
    id: string,
    claimToken: string,
  ): Promise<OutboxEventRow | null> {
    const existing = await this.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .limit(1);
    const row = existing[0];
    if (!row || row.processedAt != null) return null;
    if (!row.lastError || !row.lastError.includes(`:${claimToken}`)) {
      return null;
    }
    await this.db
      .update(outboxEvents)
      .set({ lastError: null })
      .where(eq(outboxEvents.id, id));
    return {
      id: row.id,
      topic: row.topic,
      payloadJson: row.payloadJson,
      createdAt: row.createdAt,
      processedAt: null,
      attempts: row.attempts,
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
      processedAt: r.processedAt ?? null,
      attempts: r.attempts,
      lastError: r.lastError ?? null,
    };
  }

  async markOutboxError(
    id: string,
    patch: { attempts: number; lastError: string },
  ): Promise<OutboxEventRow | null> {
    const result = await this.db
      .update(outboxEvents)
      .set({
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
      processedAt: r.processedAt ?? null,
      attempts: r.attempts,
      lastError: r.lastError ?? null,
    };
  }

  async deleteUnprocessedOutbox(id: string): Promise<boolean> {
    const result = await this.db
      .delete(outboxEvents)
      .where(
        and(eq(outboxEvents.id, id), isNull(outboxEvents.processedAt)),
      );
    return d1Changes(result) > 0;
  }

  async findProjection(
    system: string,
    entityType: string,
    internalId: string,
  ): Promise<ProjectionRecordRow | null> {
    const rows = await this.db
      .select()
      .from(projectionRecords)
      .where(
        and(
          eq(projectionRecords.system, system),
          eq(projectionRecords.entityType, entityType),
          eq(projectionRecords.internalId, internalId),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      system: r.system,
      entityType: r.entityType,
      internalId: r.internalId,
      externalId: r.externalId ?? null,
      sourceVersion: r.sourceVersion,
      updatedAt: r.updatedAt,
    };
  }

  async upsertProjection(row: ProjectionRecordRow): Promise<ProjectionRecordRow> {
    const existing = await this.findProjection(
      row.system,
      row.entityType,
      row.internalId,
    );
    if (existing) {
      await this.db
        .update(projectionRecords)
        .set({
          externalId: row.externalId,
          sourceVersion: row.sourceVersion,
          updatedAt: row.updatedAt,
        })
        .where(eq(projectionRecords.id, existing.id));
      return {
        ...existing,
        externalId: row.externalId,
        sourceVersion: row.sourceVersion,
        updatedAt: row.updatedAt,
      };
    }
    await this.db.insert(projectionRecords).values({
      id: row.id,
      system: row.system,
      entityType: row.entityType,
      internalId: row.internalId,
      externalId: row.externalId,
      sourceVersion: row.sourceVersion,
      updatedAt: row.updatedAt,
    });
    return { ...row };
  }

  async listProjectionsBySystem(system: string): Promise<ProjectionRecordRow[]> {
    const rows = await this.db
      .select()
      .from(projectionRecords)
      .where(eq(projectionRecords.system, system));
    return rows.map((r) => ({
      id: r.id,
      system: r.system,
      entityType: r.entityType,
      internalId: r.internalId,
      externalId: r.externalId ?? null,
      sourceVersion: r.sourceVersion,
      updatedAt: r.updatedAt,
    }));
  }

  async listProjectionsForInternalIds(
    system: string,
    internalIds: string[],
  ): Promise<ProjectionRecordRow[]> {
    if (internalIds.length === 0) return [];
    const all = await this.listProjectionsBySystem(system);
    const set = new Set(internalIds);
    return all.filter((r) => set.has(r.internalId));
  }
}

/** Type guard helper for entity types. */
export function isAirtableEntityType(v: string): v is AirtableEntityType {
  return (
    v === "event" ||
    v === "submission" ||
    v === "speaker" ||
    v === "session" ||
    v === "task" ||
    v === "schedule"
  );
}

export { AIRTABLE_PROJECTION_SYSTEM, AIRTABLE_OUTBOX_TOPIC };
