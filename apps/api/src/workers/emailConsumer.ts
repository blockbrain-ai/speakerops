/**
 * Email / ICS outbox consumer (section 5.2 / S-COMMS).
 *
 * Drains outbox_events topic `comms.send` via the provider adapter.
 * **Sandbox is the default** — no live Resend HTTP unless EMAIL_PROVIDER=resend
 * and RESEND_API_KEY are set (env names only, E10).
 *
 * Request path never calls this; Comms.Send only inserts outbox_events (E7).
 */

import { uuidv7, COMMS_OUTBOX_TOPIC } from "@speakerops/shared";
import type { AuthStore } from "../modules/auth/store.js";
import type { CommsStore } from "../modules/comms/store.js";
import {
  newDeliveryEventId,
} from "../modules/comms/store.js";
import {
  createEmailProvider,
  type EmailProvider,
  type EmailProviderEnv,
} from "../modules/comms/send.js";

export type EmailConsumerDeps = {
  comms: CommsStore;
  auth: AuthStore;
  provider?: EmailProvider;
  providerEnv?: EmailProviderEnv;
};

export type ProcessOutboxResult = {
  processed: number;
  failed: number;
  skipped: number;
  jobIds: string[];
};

type CommsSendPayload = {
  jobId: string;
  eventId: string;
  templateId?: string;
  idempotencyKey?: string | null;
  correlationId?: string;
};

/**
 * Process all unprocessed `comms.send` outbox rows (sandbox default).
 * Safe to re-run: already-processed rows are skipped; jobs with delivery
 * rows already present are treated as done (at-most-once delivery log).
 */
export async function processCommsOutbox(
  deps: EmailConsumerDeps,
  options: { correlationId?: string; limit?: number } = {},
): Promise<ProcessOutboxResult> {
  const provider =
    deps.provider ?? createEmailProvider(deps.providerEnv ?? {});
  const pending = await deps.comms.listUnprocessedOutboxByTopic(
    COMMS_OUTBOX_TOPIC,
  );
  const limit = options.limit ?? pending.length;
  const batch = pending.slice(0, limit);

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const jobIds: string[] = [];

  for (const row of batch) {
    let payload: CommsSendPayload;
    try {
      payload = JSON.parse(row.payloadJson) as CommsSendPayload;
    } catch {
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: row.attempts + 1,
        lastError: "invalid_payload_json",
      });
      failed += 1;
      continue;
    }

    if (!payload.jobId || !payload.eventId) {
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: row.attempts + 1,
        lastError: "missing_job_or_event",
      });
      failed += 1;
      continue;
    }

    const job = await deps.comms.findJobById(payload.jobId);
    if (!job) {
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: row.attempts + 1,
        lastError: "job_not_found",
      });
      failed += 1;
      continue;
    }

    // Idempotent drain: if delivery events already exist, mark outbox done.
    const existingDeliveries = await deps.comms.listDeliveryEventsForJob(
      job.id,
    );
    if (existingDeliveries.length > 0) {
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: row.attempts + 1,
        lastError: null,
      });
      skipped += 1;
      jobIds.push(job.id);
      continue;
    }

    const recipients = await deps.comms.listRecipientsForJob(job.id);
    const now = new Date().toISOString();
    let anyFailed = false;

    if (recipients.length === 0) {
      // Still mark job sent with empty delivery when no recipients.
      await deps.comms.updateJob(job.id, {
        status: "sent",
        version: job.version + 1,
        expectedVersion: job.version,
        updatedAt: now,
      });
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: now,
        attempts: row.attempts + 1,
        lastError: null,
      });
      processed += 1;
      jobIds.push(job.id);
      continue;
    }

    for (const recipient of recipients) {
      const result = await provider.send({
        to: recipient.toEmail,
        subject: recipient.subject ?? "",
        body: recipient.body ?? "",
        jobId: job.id,
        recipientId: recipient.id,
        correlationId: payload.correlationId ?? options.correlationId,
      });

      await deps.comms.insertDeliveryEvent({
        id: newDeliveryEventId(),
        jobId: job.id,
        recipientId: recipient.id,
        eventId: job.eventId,
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        status: result.status,
        attempt: 1,
        error: result.error ?? null,
        payloadJson: JSON.stringify({
          to: recipient.toEmail,
          // Never log full body with secrets; subject only.
          subject: recipient.subject,
          provider: result.provider,
        }),
        createdAt: now,
      });

      await deps.comms.updateRecipientStatus(
        recipient.id,
        result.ok ? (result.status === "sandbox" ? "sandbox" : "sent") : "failed",
      );

      if (!result.ok) anyFailed = true;
    }

    const terminalStatus = anyFailed ? "failed" : "sent";
    const latest = await deps.comms.findJobById(job.id);
    if (latest) {
      await deps.comms.updateJob(latest.id, {
        status: terminalStatus,
        version: latest.version + 1,
        expectedVersion: latest.version,
        updatedAt: now,
      });
    }

    await deps.comms.markOutboxProcessed(row.id, {
      processedAt: now,
      attempts: row.attempts + 1,
      lastError: anyFailed ? "partial_or_full_failure" : null,
    });

    await deps.auth.insertAudit({
      id: uuidv7(),
      eventId: job.eventId,
      actorType: "system",
      actorId: "emailConsumer",
      action: "Comms.OutboxDrain",
      entityType: "message_job",
      entityId: job.id,
      beforeJson: JSON.stringify({ status: job.status }),
      afterJson: JSON.stringify({
        status: terminalStatus,
        provider: provider.name,
        recipientCount: recipients.length,
      }),
      correlationId:
        payload.correlationId ?? options.correlationId ?? uuidv7(),
      createdAt: now,
    });

    if (anyFailed) failed += 1;
    else processed += 1;
    jobIds.push(job.id);
  }

  return { processed, failed, skipped, jobIds };
}
