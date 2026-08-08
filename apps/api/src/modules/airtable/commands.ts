/**
 * Reports.AirtableStatus command (section 7.3 / S-AIRTABLE).
 *
 * Lag + errors from outbox_events; projectedCount from projection_records.
 * Never calls Airtable HTTP (read-only status of local SoR projection state).
 */

import {
  AIRTABLE_OUTBOX_TOPIC,
  AIRTABLE_PROJECTION_SYSTEM,
  type ReportsAirtableStatusResponse,
} from "@speakerops/shared";
import type { EventsStore } from "../events/store.js";
import type { AirtableStore } from "./store.js";
import {
  resolveAirtableConfigured,
  type AirtableClientEnv,
} from "./client.js";

export type AirtableCommandDeps = {
  airtable: AirtableStore;
  events: EventsStore;
  /** Worker env for configured/paused (names only; never log values). */
  clientEnv?: AirtableClientEnv;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

/**
 * Reports.AirtableStatus — lag fields for O06 UI.
 * Status is derived from D1 outbox + projection_records only (no request-path Airtable).
 */
export async function getAirtableStatus(
  deps: AirtableCommandDeps,
  input: { eventId: string },
): Promise<CommandOk<ReportsAirtableStatusResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Not found",
      code: "NOT_FOUND",
    };
  }

  const configured = resolveAirtableConfigured(deps.clientEnv ?? {});
  const paused = !configured;

  const pending = await deps.airtable.listUnprocessedAirtableForEvent(
    input.eventId,
  );

  // Sort oldest first for lag
  const sorted = [...pending].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const oldestPendingAt = sorted[0]?.createdAt ?? null;
  const maxAttempts = sorted.reduce(
    (m, r) => (r.attempts > m ? r.attempts : m),
    0,
  );

  // Collect internal ids from all outbox rows (processed + pending) for this event
  const allOutbox = await deps.airtable.listOutboxByTopic(AIRTABLE_OUTBOX_TOPIC);
  const internalIds = new Set<string>();
  const recentErrors: ReportsAirtableStatusResponse["recentErrors"] = [];

  for (const row of allOutbox) {
    let eventId: string | null = null;
    let internalId: string | null = null;
    let entityType: string | null = null;
    try {
      const p = JSON.parse(row.payloadJson) as {
        eventId?: string;
        internalId?: string;
        entityType?: string;
      };
      eventId = typeof p.eventId === "string" ? p.eventId : null;
      internalId = typeof p.internalId === "string" ? p.internalId : null;
      entityType = typeof p.entityType === "string" ? p.entityType : null;
    } catch {
      /* ignore */
    }
    if (eventId !== input.eventId) continue;
    if (internalId) internalIds.add(internalId);

    // Surface non-claim errors on unprocessed rows
    const err = row.lastError;
    const isClaim = typeof err === "string" && err.startsWith("claim:");
    if (
      row.processedAt === null &&
      err &&
      !isClaim &&
      recentErrors.length < 20
    ) {
      recentErrors.push({
        outboxId: row.id,
        lastError: err,
        attempts: row.attempts,
        createdAt: row.createdAt,
        internalId,
        entityType,
      });
    }
  }

  const projections = await deps.airtable.listProjectionsForInternalIds(
    AIRTABLE_PROJECTION_SYSTEM,
    [...internalIds],
  );
  let lastSuccessAt: string | null = null;
  for (const p of projections) {
    if (!lastSuccessAt || p.updatedAt > lastSuccessAt) {
      lastSuccessAt = p.updatedAt;
    }
  }

  return {
    ok: true,
    value: {
      eventId: input.eventId,
      configured,
      paused,
      lag: {
        pendingCount: pending.length,
        oldestPendingAt,
        maxAttempts,
      },
      lastSuccessAt,
      projectedCount: projections.length,
      recentErrors,
      generatedAt: new Date().toISOString(),
    },
  };
}
