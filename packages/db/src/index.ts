/**
 * @speakerops/db — D1 + Drizzle composition root (section 1.3).
 *
 * Schema: packages/db/schema.ts (E1 path)
 * Migrations: packages/db/migrations/ (linear additive)
 * Repositories: eventId scoping helpers in repository.ts
 */
export {
  organizations,
  events,
  auditEvents,
  outboxEvents,
  idempotencyKeys,
  users,
  authSessions,
  magicLinks,
  eventMemberships,
  baselineTables,
  authTables,
  membershipTables,
  schema,
  type Organization,
  type NewOrganization,
  type Event,
  type NewEvent,
  type AuditEvent,
  type NewAuditEvent,
  type OutboxEvent,
  type NewOutboxEvent,
  type IdempotencyKey,
  type NewIdempotencyKey,
  type User,
  type NewUser,
  type AuthSession,
  type NewAuthSession,
  type MagicLink,
  type NewMagicLink,
  type EventMembership,
  type NewEventMembership,
} from "../schema.js";

export {
  createDb,
  SCHEMA_READY,
  type D1DatabaseLike,
  type SpeakerOpsDb,
} from "./client.js";

export {
  requireEventId,
  withEventScope,
  eventScoped,
  buildAuditEventRow,
  MissingEventIdError,
  type EventScopedOptions,
  type AuditWriteInput,
} from "./repository.js";

export {
  migrate,
  inspectSchema,
  defaultDbPath,
  defaultMigrationsDir,
  resolveDbPackageRoot,
  BASELINE_TABLES,
  AUTH_TABLES,
  MEMBERSHIP_TABLES,
  type MigrateOptions,
  type MigrateResult,
} from "./migrate.js";

export const DB_PACKAGE = "@speakerops/db" as const;

export type DbReady = {
  readonly packageName: typeof DB_PACKAGE;
  readonly schemaReady: true;
};

export function createDbMarker(): DbReady {
  return {
    packageName: DB_PACKAGE,
    schemaReady: true,
  };
}

/** @deprecated Use createDbMarker — kept so prior imports fail loudly if still stub-shaped. */
export function createDbPlaceholder(): DbReady {
  return createDbMarker();
}
