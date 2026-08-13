/**
 * Enqueue Accelevents outbox rows. Never calls AE HTTP (E7).
 */
import {
  uuidv7,
  ACCELEVENTS_PROJECT_TOPIC,
  ACCELEVENTS_VERIFY_TOPIC,
  type AcceleventsOutboxKind,
  type AcceleventsOutboxPayload,
} from "@speakerops/shared";
import type { IntegrationsStore } from "./store.js";

export async function enqueueAcceleventsJob(
  store: IntegrationsStore,
  input: {
    kind: AcceleventsOutboxKind;
    eventId: string;
    correlationId: string;
    programmeVersion?: number;
  },
): Promise<{ outboxId: string; coalesced: boolean }> {
  const topic =
    input.kind === "verify"
      ? ACCELEVENTS_VERIFY_TOPIC
      : ACCELEVENTS_PROJECT_TOPIC;
  const pending = await store.listUnprocessedForEvent(topic, input.eventId);
  if (pending.length > 0) {
    return { outboxId: pending[0]!.id, coalesced: true };
  }
  const payload: AcceleventsOutboxPayload = {
    kind: input.kind,
    eventId: input.eventId,
    programmeVersion: input.programmeVersion,
    correlationId: input.correlationId,
  };
  const outboxId = uuidv7();
  await store.insertOutbox({
    id: outboxId,
    topic,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    processedAt: null,
    attempts: 0,
    lastError: null,
  });
  return { outboxId, coalesced: false };
}
