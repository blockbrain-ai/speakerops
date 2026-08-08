/**
 * SpeakerOps D1 schema (Drizzle) — section 1.3 baseline.
 *
 * Columns match KMS-competition/initiative/contracts/SCHEMA.md for tables
 * owned by 1.3. Later sections add domain tables via additive migrations.
 *
 * Path locked by E1: packages/db/schema.ts
 */
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/** organizations — multi-tenant org shell (single-org dogfood still uses this). */
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * events — mutable aggregate; optimistic `version` required (E1).
 * Repository queries that touch event-owned data must scope by event id.
 */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey().notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull(),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    settingsJson: text("settings_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_events_org_id").on(t.orgId)],
);

/**
 * audit_events — consequential writes (E3).
 * correlation_id is required so request/CLI entry can be traced.
 */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    correlationId: text("correlation_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_audit_events_event_id").on(t.eventId),
    index("idx_audit_events_correlation_id").on(t.correlationId),
  ],
);

/**
 * outbox_events — transactional outbox for email / Airtable / side effects (E7).
 * Workers drain rows; request path never waits on external systems.
 */
export const outboxEvents = sqliteTable(
  "outbox_events",
  {
    id: text("id").primaryKey().notNull(),
    topic: text("topic").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("idx_outbox_events_processed_at").on(t.processedAt)],
);

/**
 * idempotency_keys — replay-safe writes for sends/imports (E7).
 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey().notNull(),
    key: text("key").notNull().unique(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_idempotency_keys_key").on(t.key)],
);

/** Named baseline table set for exports and gate assertions. */
export const baselineTables = {
  organizations,
  events,
  auditEvents,
  outboxEvents,
  idempotencyKeys,
} as const;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;

/** Full schema object for drizzle(..., { schema }). */
export const schema = {
  organizations,
  events,
  auditEvents,
  outboxEvents,
  idempotencyKeys,
} as const;
