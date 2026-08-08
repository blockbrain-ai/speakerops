/**
 * Enqueue Airtable projection outbox rows (section 7.3 / S-AIRTABLE).
 *
 * Called from domain commands after D1 SoR writes.
 * Never calls Airtable HTTP (E7) — consumer drains airtable.project.
 * Safe when AIRTABLE_API_KEY is unset: outbox stays pending (pause survival).
 */

import {
  uuidv7,
  AIRTABLE_OUTBOX_TOPIC,
  type AirtableEntityType,
  type AirtableProjectPayload,
} from "@speakerops/shared";
import type { AirtableStore } from "./store.js";

export type EnqueueAirtableProjectionInput = {
  eventId: string;
  entityType: AirtableEntityType;
  internalId: string;
  sourceVersion?: number;
  fields?: Record<string, unknown>;
  correlationId: string;
};

/**
 * Insert one outbox_events row (topic airtable.project).
 * Request path completes regardless of Airtable credentials.
 */
export async function enqueueAirtableProjection(
  store: AirtableStore,
  input: EnqueueAirtableProjectionInput,
): Promise<{ outboxId: string }> {
  const payload: AirtableProjectPayload = {
    eventId: input.eventId,
    entityType: input.entityType,
    internalId: input.internalId,
    sourceVersion: input.sourceVersion ?? 1,
    fields: {
      ...(input.fields ?? {}),
      // I16: internal_id always present in projected fields
      internal_id: input.internalId,
    },
    correlationId: input.correlationId,
  };

  const outboxId = uuidv7();
  await store.insertOutbox({
    id: outboxId,
    topic: AIRTABLE_OUTBOX_TOPIC,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    processedAt: null,
    attempts: 0,
    lastError: null,
  });
  return { outboxId };
}
