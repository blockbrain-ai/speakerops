/**
 * Repository helpers — eventId scoping pattern (E2).
 *
 * Every event-owned query must take `eventId` at the repository layer.
 * This module is the stub pattern domain repositories extend in later sections.
 * No invented product tables here — only helpers + types.
 */

/** Marker error when a repository is called without a valid event scope. */
export class MissingEventIdError extends Error {
  readonly code = "MISSING_EVENT_ID" as const;

  constructor(message = "eventId is required for event-scoped repository queries") {
    super(message);
    this.name = "MissingEventIdError";
  }
}

/**
 * Require a non-empty eventId string.
 * Call at the top of every event-owned repository method.
 */
export function requireEventId(eventId: string | null | undefined): string {
  if (typeof eventId !== "string" || eventId.trim().length === 0) {
    throw new MissingEventIdError();
  }
  return eventId.trim();
}

/**
 * Base options for event-scoped repository methods.
 * Domain repos extend this rather than accepting bare free-form filters.
 */
export type EventScopedOptions = {
  readonly eventId: string;
};

/**
 * Assert options include eventId and return the narrowed options.
 */
export function withEventScope<T extends EventScopedOptions>(
  options: T,
): T & { eventId: string } {
  requireEventId(options.eventId);
  return options;
}

/**
 * Wrap a repository function so the first argument is always a validated eventId.
 * Pattern:
 *   const listByEvent = eventScoped((eventId, db) => db.select()...where(eq(t.eventId, eventId)))
 */
export function eventScoped<TArgs extends unknown[], TResult>(
  fn: (eventId: string, ...args: TArgs) => TResult,
): (eventId: string | null | undefined, ...args: TArgs) => TResult {
  return (eventId, ...args) => fn(requireEventId(eventId), ...args);
}

/**
 * Audit row shape for consequential writes (E3).
 * Handlers insert into audit_events with correlationId from request middleware.
 * This type documents the contract; actual inserts land with domain commands.
 */
export type AuditWriteInput = {
  readonly id: string;
  readonly eventId?: string | null;
  readonly actorType: "user" | "api_key" | "system";
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly beforeJson?: string | null;
  readonly afterJson?: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
};

/**
 * Stub audit helper — validates required audit fields including correlationId.
 * Domain write paths call this (or insert audit_events directly) on consequential writes.
 * Returns a row ready for insert into audit_events.
 */
export function buildAuditEventRow(input: AuditWriteInput): AuditWriteInput {
  if (!input.correlationId || input.correlationId.trim().length === 0) {
    throw new Error("correlationId is required on audit_events (E3)");
  }
  if (!input.id || !input.actorType || !input.actorId || !input.action) {
    throw new Error("audit_events requires id, actorType, actorId, action");
  }
  if (!input.entityType || !input.entityId || !input.createdAt) {
    throw new Error("audit_events requires entityType, entityId, createdAt");
  }
  return {
    ...input,
    eventId: input.eventId ?? null,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    correlationId: input.correlationId.trim(),
  };
}
