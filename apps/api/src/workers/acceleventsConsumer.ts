/**
 * Drain accelevents.verify + accelevents.project (E7 — never request path).
 * Missing key: verify jobs complete as paused; project jobs stay pending.
 * Sandbox / paused clients never persist verificationState=verified.
 */
import {
  uuidv7,
  ACCELEVENTS_PROJECT_TOPIC,
  ACCELEVENTS_VERIFY_TOPIC,
  AcceleventsOutboxPayloadSchema,
} from "@speakerops/shared";
import {
  createAcceleventsClient,
  type AcceleventsClient,
  type AcceleventsEnv,
} from "../modules/accelevents/client.js";
import {
  projectPublishedSnapshot,
  type ProjectSnapshot,
} from "../modules/accelevents/project.js";
import {
  OUTBOX_CLAIM_LEASE_MS,
  type IntegrationsStore,
} from "../modules/accelevents/store.js";

export type AcceleventsConsumerDeps = {
  integrations: IntegrationsStore;
  client?: AcceleventsClient;
  clientEnv?: AcceleventsEnv;
  loadSnapshot?: (eventId: string) => Promise<ProjectSnapshot | null>;
};

export type ProcessAcceleventsOutboxResult = {
  processed: number;
  failed: number;
  skipped: number;
  paused: boolean;
  outboxIds: string[];
};

export async function processAcceleventsOutbox(
  deps: AcceleventsConsumerDeps,
  options: { limit?: number } = {},
): Promise<ProcessAcceleventsOutboxResult> {
  const client =
    deps.client ?? createAcceleventsClient(deps.clientEnv ?? {});
  const paused = client.mode === "paused";

  const verify = await deps.integrations.listUnprocessedOutboxByTopic(
    ACCELEVENTS_VERIFY_TOPIC,
  );
  const project = await deps.integrations.listUnprocessedOutboxByTopic(
    ACCELEVENTS_PROJECT_TOPIC,
  );
  const pending = [...verify, ...project];
  const limit = options.limit ?? pending.length;
  const batch = pending.slice(0, limit);

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const outboxIds: string[] = [];

  for (const row of batch) {
    const claimToken = uuidv7();
    const claimedUntil = new Date(Date.now() + OUTBOX_CLAIM_LEASE_MS).toISOString();
    const claimed = await deps.integrations.claimOutboxForProcessing(row.id, {
      claimToken,
      claimedUntil,
      attempts: row.attempts + 1,
    });
    if (!claimed) {
      skipped += 1;
      continue;
    }

    let payloadJson: unknown = null;
    try {
      payloadJson = JSON.parse(row.payloadJson) as unknown;
    } catch {
      payloadJson = null;
    }
    const parsed = AcceleventsOutboxPayloadSchema.safeParse(payloadJson);
    if (!parsed.success) {
      await deps.integrations.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: claimed.attempts,
        lastError: "invalid_payload_json",
      });
      failed += 1;
      outboxIds.push(row.id);
      continue;
    }

    const eventId = parsed.data.eventId;
    try {
      if (parsed.data.kind === "verify") {
        await runVerify(deps.integrations, client, eventId);
        await deps.integrations.markOutboxProcessed(row.id, {
          processedAt: new Date().toISOString(),
          attempts: claimed.attempts,
          lastError: null,
        });
        processed += 1;
      } else if (client.mode === "paused") {
        skipped += 1;
        await deps.integrations.markOutboxError(row.id, {
          attempts: claimed.attempts,
          lastError: "paused — no API key",
        });
      } else {
        const conn = await deps.integrations.getConnection(eventId, "accelevents");
        if (!conn?.enabled || !conn.eventUrl || !conn.externalEventId) {
          await deps.integrations.markOutboxProcessed(row.id, {
            processedAt: new Date().toISOString(),
            attempts: claimed.attempts,
            lastError: "connection not ready",
          });
          failed += 1;
        } else {
          const snap = deps.loadSnapshot
            ? await deps.loadSnapshot(eventId)
            : null;
          if (!snap) {
            await deps.integrations.markOutboxProcessed(row.id, {
              processedAt: new Date().toISOString(),
              attempts: claimed.attempts,
              lastError: "no published programme",
            });
            failed += 1;
          } else {
            const result = await projectPublishedSnapshot(
              deps.integrations,
              client,
              conn,
              snap,
            );
            await deps.integrations.markOutboxProcessed(row.id, {
              processedAt: new Date().toISOString(),
              attempts: claimed.attempts,
              lastError: result.errors.length ? result.errors.join("; ") : null,
            });
            processed += 1;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "drain failed";
      const name = err instanceof Error ? err.name : "";
      if (name === "AE_AMBIGUOUS") {
        await deps.integrations.markOutboxProcessed(row.id, {
          processedAt: new Date().toISOString(),
          attempts: claimed.attempts,
          lastError: `ambiguous: ${msg}`,
        });
        failed += 1;
      } else {
        await deps.integrations.markOutboxError(row.id, {
          attempts: claimed.attempts,
          lastError: msg,
        });
        failed += 1;
      }
    }
    outboxIds.push(row.id);
  }

  return { processed, failed, skipped, paused, outboxIds };
}

async function runVerify(
  store: IntegrationsStore,
  client: AcceleventsClient,
  eventId: string,
): Promise<void> {
  const conn = await store.getConnection(eventId, "accelevents");
  if (!conn) return;
  const now = new Date().toISOString();
  if (client.mode !== "http") {
    await store.upsertConnection({
      ...conn,
      verificationState: client.mode === "paused" ? "paused" : "never",
      lastAttemptAt: now,
      lastError:
        client.mode === "paused"
          ? "paused — no API key"
          : "sandbox — not live-verified",
      version: conn.version + 1,
      updatedAt: now,
    });
    return;
  }
  if (!conn.eventUrl || !conn.externalEventId) {
    await store.upsertConnection({
      ...conn,
      verificationState: "failed",
      lastAttemptAt: now,
      lastError: "event URL and numeric event id required",
      version: conn.version + 1,
      updatedAt: now,
    });
    return;
  }
  const ping = await client.pingSpeakers(conn.eventUrl, conn.externalEventId);
  await store.upsertConnection({
    ...conn,
    verificationState: ping.ok ? "verified" : "failed",
    lastAttemptAt: now,
    lastVerifiedAt: ping.ok ? now : conn.lastVerifiedAt,
    lastError: ping.ok ? null : (ping.error ?? "verify failed"),
    version: conn.version + 1,
    updatedAt: now,
  });
}
