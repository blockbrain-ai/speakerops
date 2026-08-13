/**
 * Integrations + Accelevents identity — Memory + D1.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  createDb,
  type D1DatabaseLike,
  integrationConnections,
  acceleventsIdentities,
  outboxEvents,
} from "@speakerops/db";
import type {
  IntegrationProvider,
  VerificationState,
} from "@speakerops/shared";
import { d1Changes } from "../auth/store.js";
import {
  formatOutboxClaim,
  isActiveOutboxClaim,
  OUTBOX_CLAIM_LEASE_MS,
  OUTBOX_CLAIM_PREFIX,
} from "../comms/store.js";

export { OUTBOX_CLAIM_LEASE_MS };

export type ConnectionRow = {
  id: string;
  eventId: string;
  provider: IntegrationProvider;
  enabled: boolean;
  eventUrl: string | null;
  externalEventId: string | null;
  connectionGeneration: number;
  verificationState: VerificationState;
  lastAttemptAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type IdentityRow = {
  id: string;
  eventId: string;
  connectionGeneration: number;
  entityType: "speaker" | "session";
  internalId: string;
  externalId: string;
  createdAt: string;
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

export type IntegrationsStore = {
  getConnection(
    eventId: string,
    provider: IntegrationProvider,
  ): Promise<ConnectionRow | null>;
  listConnections(eventId: string): Promise<ConnectionRow[]>;
  upsertConnection(row: ConnectionRow): Promise<ConnectionRow>;
  getIdentity(
    eventId: string,
    generation: number,
    entityType: "speaker" | "session",
    internalId: string,
  ): Promise<IdentityRow | null>;
  putIdentity(row: IdentityRow): Promise<void>;
  listIdentities(
    eventId: string,
    generation: number,
    entityType: "speaker" | "session",
  ): Promise<IdentityRow[]>;
  insertOutbox(row: OutboxEventRow): Promise<OutboxEventRow>;
  listUnprocessedOutboxByTopic(topic: string): Promise<OutboxEventRow[]>;
  listUnprocessedForEvent(topic: string, eventId: string): Promise<OutboxEventRow[]>;
  claimOutboxForProcessing(
    id: string,
    patch: { claimToken: string; claimedUntil: string; attempts: number },
  ): Promise<OutboxEventRow | null>;
  markOutboxProcessed(
    id: string,
    patch: { processedAt: string; attempts: number; lastError: string | null },
  ): Promise<OutboxEventRow | null>;
  markOutboxError(
    id: string,
    patch: { attempts: number; lastError: string },
  ): Promise<OutboxEventRow | null>;
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

export class MemoryIntegrationsStore implements IntegrationsStore {
  private connections = new Map<string, ConnectionRow>();
  private identities = new Map<string, IdentityRow>();
  private outbox: OutboxEventRow[] = [];

  private ck(eventId: string, provider: string) {
    return `${eventId}:${provider}`;
  }
  private ik(
    eventId: string,
    gen: number,
    type: string,
    internalId: string,
  ) {
    return `${eventId}:${gen}:${type}:${internalId}`;
  }

  async getConnection(eventId: string, provider: IntegrationProvider) {
    return this.connections.get(this.ck(eventId, provider)) ?? null;
  }
  async listConnections(eventId: string) {
    return [...this.connections.values()].filter((c) => c.eventId === eventId);
  }
  async upsertConnection(row: ConnectionRow) {
    this.connections.set(this.ck(row.eventId, row.provider), { ...row });
    return row;
  }
  async getIdentity(
    eventId: string,
    generation: number,
    entityType: "speaker" | "session",
    internalId: string,
  ) {
    return (
      this.identities.get(this.ik(eventId, generation, entityType, internalId)) ??
      null
    );
  }
  async putIdentity(row: IdentityRow) {
    this.identities.set(
      this.ik(row.eventId, row.connectionGeneration, row.entityType, row.internalId),
      { ...row },
    );
  }
  async listIdentities(
    eventId: string,
    generation: number,
    entityType: "speaker" | "session",
  ) {
    return [...this.identities.values()].filter(
      (r) =>
        r.eventId === eventId &&
        r.connectionGeneration === generation &&
        r.entityType === entityType,
    );
  }
  async insertOutbox(row: OutboxEventRow) {
    const copy = { ...row };
    this.outbox.push(copy);
    return { ...copy };
  }
  async listUnprocessedOutboxByTopic(topic: string) {
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
  async listUnprocessedForEvent(topic: string, eventId: string) {
    const rows = await this.listUnprocessedOutboxByTopic(topic);
    return rows.filter((r) => payloadEventId(r.payloadJson) === eventId);
  }
  async claimOutboxForProcessing(
    id: string,
    patch: { claimToken: string; claimedUntil: string; attempts: number },
  ) {
    const nowIso = new Date().toISOString();
    const row = this.outbox.find((r) => r.id === id);
    if (!row || row.processedAt !== null) return null;
    if (isActiveOutboxClaim(row.lastError, nowIso)) return null;
    row.attempts = patch.attempts;
    row.lastError = formatOutboxClaim(patch.claimedUntil, patch.claimToken);
    return { ...row };
  }
  async markOutboxProcessed(
    id: string,
    patch: { processedAt: string; attempts: number; lastError: string | null },
  ) {
    const row = this.outbox.find((r) => r.id === id);
    if (!row) return null;
    row.processedAt = patch.processedAt;
    row.attempts = patch.attempts;
    row.lastError = patch.lastError;
    return { ...row };
  }
  async markOutboxError(
    id: string,
    patch: { attempts: number; lastError: string },
  ) {
    const row = this.outbox.find((r) => r.id === id);
    if (!row) return null;
    row.attempts = patch.attempts;
    row.lastError = patch.lastError;
    return { ...row };
  }
}

export class D1IntegrationsStore implements IntegrationsStore {
  private readonly db;
  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async getConnection(eventId: string, provider: IntegrationProvider) {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.eventId, eventId),
          eq(integrationConnections.provider, provider),
        ),
      )
      .all();
    return rows[0] ? mapConn(rows[0]) : null;
  }

  async listConnections(eventId: string) {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.eventId, eventId))
      .all();
    return rows.map(mapConn);
  }

  async upsertConnection(row: ConnectionRow) {
    await this.db
      .insert(integrationConnections)
      .values({
        id: row.id,
        eventId: row.eventId,
        provider: row.provider,
        enabled: row.enabled ? 1 : 0,
        eventUrl: row.eventUrl,
        externalEventId: row.externalEventId,
        connectionGeneration: row.connectionGeneration,
        verificationState: row.verificationState,
        lastAttemptAt: row.lastAttemptAt,
        lastVerifiedAt: row.lastVerifiedAt,
        lastError: row.lastError,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
      .onConflictDoUpdate({
        target: [integrationConnections.eventId, integrationConnections.provider],
        set: {
          enabled: row.enabled ? 1 : 0,
          eventUrl: row.eventUrl,
          externalEventId: row.externalEventId,
          connectionGeneration: row.connectionGeneration,
          verificationState: row.verificationState,
          lastAttemptAt: row.lastAttemptAt,
          lastVerifiedAt: row.lastVerifiedAt,
          lastError: row.lastError,
          version: row.version,
          updatedAt: row.updatedAt,
        },
      })
      .run();
    return row;
  }

  async getIdentity(
    eventId: string,
    generation: number,
    entityType: "speaker" | "session",
    internalId: string,
  ) {
    const rows = await this.db
      .select()
      .from(acceleventsIdentities)
      .where(
        and(
          eq(acceleventsIdentities.eventId, eventId),
          eq(acceleventsIdentities.connectionGeneration, generation),
          eq(acceleventsIdentities.entityType, entityType),
          eq(acceleventsIdentities.internalId, internalId),
        ),
      )
      .all();
    const r = rows[0];
    if (!r) return null;
    return mapIdent(r);
  }

  async putIdentity(row: IdentityRow) {
    await this.db
      .insert(acceleventsIdentities)
      .values(row)
      .onConflictDoUpdate({
        target: [
          acceleventsIdentities.eventId,
          acceleventsIdentities.connectionGeneration,
          acceleventsIdentities.entityType,
          acceleventsIdentities.internalId,
        ],
        set: { externalId: row.externalId },
      })
      .run();
  }

  async listIdentities(
    eventId: string,
    generation: number,
    entityType: "speaker" | "session",
  ) {
    const rows = await this.db
      .select()
      .from(acceleventsIdentities)
      .where(
        and(
          eq(acceleventsIdentities.eventId, eventId),
          eq(acceleventsIdentities.connectionGeneration, generation),
          eq(acceleventsIdentities.entityType, entityType),
        ),
      )
      .all();
    return rows.map(mapIdent);
  }

  async insertOutbox(row: OutboxEventRow) {
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

  async listUnprocessedOutboxByTopic(topic: string) {
    const nowIso = new Date().toISOString();
    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.topic, topic), isNull(outboxEvents.processedAt)));
    return rows
      .filter((r) => !isActiveOutboxClaim(r.lastError, nowIso))
      .map(mapOutbox);
  }

  async listUnprocessedForEvent(topic: string, eventId: string) {
    const rows = await this.listUnprocessedOutboxByTopic(topic);
    return rows.filter((r) => payloadEventId(r.payloadJson) === eventId);
  }

  async claimOutboxForProcessing(
    id: string,
    patch: { claimToken: string; claimedUntil: string; attempts: number },
  ) {
    const nowIso = new Date().toISOString();
    const claimValue = formatOutboxClaim(patch.claimedUntil, patch.claimToken);
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
    return rows[0] ? mapOutbox(rows[0]) : null;
  }

  async markOutboxProcessed(
    id: string,
    patch: { processedAt: string; attempts: number; lastError: string | null },
  ) {
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
    return rows[0] ? mapOutbox(rows[0]) : null;
  }

  async markOutboxError(
    id: string,
    patch: { attempts: number; lastError: string },
  ) {
    const result = await this.db
      .update(outboxEvents)
      .set({
        attempts: patch.attempts,
        lastError: patch.lastError,
      })
      .where(and(eq(outboxEvents.id, id), isNull(outboxEvents.processedAt)));
    if (d1Changes(result) === 0) return null;
    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .limit(1);
    return rows[0] ? mapOutbox(rows[0]) : null;
  }
}

function mapConn(r: typeof integrationConnections.$inferSelect): ConnectionRow {
  return {
    id: r.id,
    eventId: r.eventId,
    provider: r.provider as IntegrationProvider,
    enabled: r.enabled === 1,
    eventUrl: r.eventUrl ?? null,
    externalEventId: r.externalEventId ?? null,
    connectionGeneration: r.connectionGeneration,
    verificationState: r.verificationState as VerificationState,
    lastAttemptAt: r.lastAttemptAt ?? null,
    lastVerifiedAt: r.lastVerifiedAt ?? null,
    lastError: r.lastError ?? null,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapIdent(r: typeof acceleventsIdentities.$inferSelect): IdentityRow {
  return {
    id: r.id,
    eventId: r.eventId,
    connectionGeneration: r.connectionGeneration,
    entityType: r.entityType as "speaker" | "session",
    internalId: r.internalId,
    externalId: r.externalId,
    createdAt: r.createdAt,
  };
}

function mapOutbox(r: typeof outboxEvents.$inferSelect): OutboxEventRow {
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
