/**
 * SpeakerOps D1 schema (Drizzle) — section 1.3 baseline + 2.1 auth + 2.2 memberships
 * + 2.3 rooms/tracks.
 *
 * Columns match KMS-competition/initiative/contracts/SCHEMA.md for tables
 * owned by 1.3 / 2.1 / 2.2 / 2.3. Later sections add domain tables via additive migrations.
 *
 * Path locked by E1: packages/db/schema.ts
 */
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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

/**
 * users — auth identity (section 2.1). Person ≠ Speaker (people table is separate).
 * Email is unique for magic-link lookup; tokens never stored on this row.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey().notNull(),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("idx_users_email").on(t.email)],
);

/**
 * auth_sessions — HttpOnly cookie session material (section 2.1).
 * token_hash only — plaintext session token never persists (E10).
 */
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_auth_sessions_user_id").on(t.userId),
    index("idx_auth_sessions_token_hash").on(t.tokenHash),
  ],
);

/**
 * magic_links — single-use exchange tokens (section 2.1).
 * token_hash only; used_at marks consumption (replay → 401).
 */
export const magicLinks = sqliteTable(
  "magic_links",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    eventId: text("event_id"),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_magic_links_user_id").on(t.userId),
    index("idx_magic_links_token_hash").on(t.tokenHash),
    index("idx_magic_links_event_id").on(t.eventId),
  ],
);

/** Named baseline table set for exports and gate assertions (1.3). */
export const baselineTables = {
  organizations,
  events,
  auditEvents,
  outboxEvents,
  idempotencyKeys,
} as const;

/**
 * event_memberships — event-scoped roles admin|evaluator|speaker (section 2.2).
 * UNIQUE(event_id, user_id). Server-side requireRole reads this table (E2).
 */
export const eventMemberships = sqliteTable(
  "event_memberships",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_event_memberships_event_user").on(t.eventId, t.userId),
    index("idx_event_memberships_user_id").on(t.userId),
    index("idx_event_memberships_event_id").on(t.eventId),
  ],
);

/** Auth tables owned by section 2.1. */
export const authTables = {
  users,
  authSessions,
  magicLinks,
} as const;

/** Membership tables owned by section 2.2. */
export const membershipTables = {
  eventMemberships,
} as const;

/**
 * rooms — event-scoped venues (section 2.3).
 * Queries must filter by event_id at repository layer (E2).
 */
export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_rooms_event_id").on(t.eventId)],
);

/**
 * tracks — event-scoped programme tracks (section 2.3).
 * Queries must filter by event_id at repository layer (E2).
 */
export const tracks = sqliteTable(
  "tracks",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_tracks_event_id").on(t.eventId)],
);

/** Rooms/tracks tables owned by section 2.3. */
export const eventSettingsTables = {
  rooms,
  tracks,
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
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type MagicLink = typeof magicLinks.$inferSelect;
export type NewMagicLink = typeof magicLinks.$inferInsert;
export type EventMembership = typeof eventMemberships.$inferSelect;
export type NewEventMembership = typeof eventMemberships.$inferInsert;
export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;

/** Full schema object for drizzle(..., { schema }). */
export const schema = {
  organizations,
  events,
  auditEvents,
  outboxEvents,
  idempotencyKeys,
  users,
  authSessions,
  magicLinks,
  eventMemberships,
  rooms,
  tracks,
} as const;
