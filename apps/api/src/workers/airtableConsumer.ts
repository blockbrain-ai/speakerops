/**
 * Airtable projection outbox consumer (section 7.3 / S-AIRTABLE).
 *
 * Drains outbox_events topic `airtable.project` via Airtable client.
 * Upsert key is always internal_id (I16 field-flow).
 *
 * **Pause survival:** when AIRTABLE_API_KEY / AIRTABLE_BASE_ID unset, drain
 * skips without crashing; outbox rows stay pending; product mutations already
 * returned 200 (request path never calls Airtable — E7).
 *
 * **429:** RateLimitedError leaves row unprocessed with last_error (no drop).
 *
 * Concurrency: exclusive per-row claim (same lease format as emailConsumer).
 */

import {
  uuidv7,
  AIRTABLE_OUTBOX_TOPIC,
  AIRTABLE_PROJECTION_SYSTEM,
  AirtableProjectPayloadSchema,
} from "@speakerops/shared";
import type { AuthStore } from "../modules/auth/store.js";
import type { AirtableStore } from "../modules/airtable/store.js";
import { OUTBOX_CLAIM_LEASE_MS } from "../modules/airtable/store.js";
import {
  createAirtableClient,
  RateLimitedError,
  type AirtableClient,
  type AirtableClientEnv,
} from "../modules/airtable/client.js";

export type AirtableConsumerDeps = {
  airtable: AirtableStore;
  auth: AuthStore;
  client?: AirtableClient;
  clientEnv?: AirtableClientEnv;
};

export type ProcessAirtableOutboxResult = {
  processed: number;
  failed: number;
  skipped: number;
  /** True when drain is paused (credentials unset). */
  paused: boolean;
  outboxIds: string[];
};

/**
 * Process unprocessed `airtable.project` outbox rows.
 * Safe to re-run: exclusive claim; upsert by internal_id is idempotent.
 */
export async function processAirtableOutbox(
  deps: AirtableConsumerDeps,
  options: { correlationId?: string; limit?: number } = {},
): Promise<ProcessAirtableOutboxResult> {
  const client =
    deps.client ?? createAirtableClient(deps.clientEnv ?? {});

  // Pause survival: no credentials → leave pending, do not crash (S-AIRTABLE).
  if (client.paused || !client.configured) {
    const pending = await deps.airtable.listUnprocessedOutboxByTopic(
      AIRTABLE_OUTBOX_TOPIC,
    );
    return {
      processed: 0,
      failed: 0,
      skipped: pending.length,
      paused: true,
      outboxIds: pending.map((r) => r.id),
    };
  }

  const pending = await deps.airtable.listUnprocessedOutboxByTopic(
    AIRTABLE_OUTBOX_TOPIC,
  );
  const limit = options.limit ?? pending.length;
  const batch = pending.slice(0, limit);

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const outboxIds: string[] = [];

  for (const row of batch) {
    const claimToken = uuidv7();
    const claimedUntil = new Date(
      Date.now() + OUTBOX_CLAIM_LEASE_MS,
    ).toISOString();
    const claimed = await deps.airtable.claimOutboxForProcessing(row.id, {
      claimToken,
      claimedUntil,
      attempts: row.attempts + 1,
    });
    if (!claimed) {
      skipped += 1;
      continue;
    }

    const parsedPayload = AirtableProjectPayloadSchema.safeParse(
      (() => {
        try {
          return JSON.parse(row.payloadJson) as unknown;
        } catch {
          return null;
        }
      })(),
    );

    if (!parsedPayload.success) {
      await deps.airtable.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: claimed.attempts,
        lastError: "invalid_payload_json",
      });
      failed += 1;
      outboxIds.push(row.id);
      continue;
    }

    const payload = parsedPayload.data;
    if (!payload.internalId || !payload.entityType) {
      await deps.airtable.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: claimed.attempts,
        lastError: "missing_internal_id_or_entity_type",
      });
      failed += 1;
      outboxIds.push(row.id);
      continue;
    }

    // Prior external_id from projection_records for PATCH path
    const existing = await deps.airtable.findProjection(
      AIRTABLE_PROJECTION_SYSTEM,
      payload.entityType,
      payload.internalId,
    );

    try {
      const result = await client.upsert({
        entityType: payload.entityType,
        internalId: payload.internalId,
        fields: payload.fields ?? {},
        externalId: existing?.externalId ?? null,
      });

      const now = new Date().toISOString();
      await deps.airtable.upsertProjection({
        id: existing?.id ?? uuidv7(),
        system: AIRTABLE_PROJECTION_SYSTEM,
        entityType: payload.entityType,
        internalId: payload.internalId,
        externalId: result.externalId,
        sourceVersion: payload.sourceVersion ?? 1,
        updatedAt: now,
      });

      await deps.airtable.markOutboxProcessed(row.id, {
        processedAt: now,
        attempts: claimed.attempts,
        lastError: null,
      });

      await deps.auth.insertAudit({
        id: uuidv7(),
        eventId: payload.eventId,
        actorType: "system",
        actorId: "airtableConsumer",
        action: "Airtable.OutboxDrain",
        entityType: "projection_record",
        entityId: payload.internalId,
        beforeJson: existing
          ? JSON.stringify({
              externalId: existing.externalId,
              sourceVersion: existing.sourceVersion,
            })
          : null,
        afterJson: JSON.stringify({
          externalId: result.externalId,
          entityType: payload.entityType,
          internalId: payload.internalId,
          sourceVersion: payload.sourceVersion ?? 1,
          created: result.created,
        }),
        correlationId:
          payload.correlationId ?? options.correlationId ?? uuidv7(),
        createdAt: now,
      });

      processed += 1;
      outboxIds.push(row.id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "airtable_upsert_failed";

      // 429: do not drop — leave unprocessed for retry (failure mode AC).
      if (err instanceof RateLimitedError) {
        await deps.airtable.markOutboxError(row.id, {
          attempts: claimed.attempts,
          lastError: "rate_limited_429",
        });
        failed += 1;
        outboxIds.push(row.id);
        continue;
      }

      // Transient / HTTP errors: leave pending with last_error
      await deps.airtable.markOutboxError(row.id, {
        attempts: claimed.attempts,
        lastError: message.slice(0, 500),
      });
      failed += 1;
      outboxIds.push(row.id);
    }
  }

  return {
    processed,
    failed,
    skipped,
    paused: false,
    outboxIds,
  };
}
