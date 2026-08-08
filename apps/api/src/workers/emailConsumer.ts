/**
 * Email / ICS outbox consumer (section 5.2 / S-COMMS).
 *
 * Drains outbox_events topic `comms.send` via the provider adapter.
 * **Sandbox is the default** — no live Resend HTTP unless EMAIL_PROVIDER=resend
 * and RESEND_API_KEY are set (env names only, E10).
 *
 * Request path never calls this; Comms.Send only inserts outbox_events (E7).
 *
 * Concurrency: exclusive per-row claim (lease in last_error) before any
 * provider call, plus per-recipient pending→sending claim so queue consumer
 * and scheduled drain cannot double-send the same recipient.
 */

import { uuidv7, COMMS_OUTBOX_TOPIC } from "@speakerops/shared";
import type { AuthStore } from "../modules/auth/store.js";
import type { CommsStore } from "../modules/comms/store.js";
import {
  newDeliveryEventId,
  OUTBOX_CLAIM_LEASE_MS,
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
 * Process unprocessed `comms.send` outbox rows (sandbox default).
 * Safe to re-run: rows are claimed atomically; already-processed / actively
 * leased rows are skipped; recovery is tracked **per recipient** — only
 * recipients without a delivery_events row are sent. The outbox row is marked
 * processed only once every recipient has a terminal delivery record
 * (at-most-once per recipient, resume-safe for multi-recipient).
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
    // Exclusive claim before any provider work (queue + cron concurrency).
    const claimToken = uuidv7();
    const claimedUntil = new Date(
      Date.now() + OUTBOX_CLAIM_LEASE_MS,
    ).toISOString();
    const claimed = await deps.comms.claimOutboxForProcessing(row.id, {
      claimToken,
      claimedUntil,
      attempts: row.attempts + 1,
    });
    if (!claimed) {
      skipped += 1;
      continue;
    }

    let payload: CommsSendPayload;
    try {
      payload = JSON.parse(row.payloadJson) as CommsSendPayload;
    } catch {
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: claimed.attempts,
        lastError: "invalid_payload_json",
      });
      failed += 1;
      continue;
    }

    if (!payload.jobId || !payload.eventId) {
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: claimed.attempts,
        lastError: "missing_job_or_event",
      });
      failed += 1;
      continue;
    }

    const job = await deps.comms.findJobById(payload.jobId);
    if (!job) {
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: claimed.attempts,
        lastError: "job_not_found",
      });
      failed += 1;
      continue;
    }

    // Per-recipient recovery: only skip recipients that already have a
    // delivery_events row. A crash after sending recipient 1 of N must not
    // mark the whole job complete and skip remaining recipients (E7).
    const recipients = await deps.comms.listRecipientsForJob(job.id);
    const existingDeliveries = await deps.comms.listDeliveryEventsForJob(
      job.id,
    );
    const deliveredRecipientIds = new Set(
      existingDeliveries
        .map((d) => d.recipientId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );

    const now = new Date().toISOString();
    const pendingRecipients = recipients.filter(
      (r) => !deliveredRecipientIds.has(r.id),
    );

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
        attempts: claimed.attempts,
        lastError: null,
      });
      processed += 1;
      jobIds.push(job.id);
      continue;
    }

    // All recipients already have terminal delivery records → complete outbox.
    if (pendingRecipients.length === 0) {
      const anyFailedExisting = existingDeliveries.some(
        (d) => d.status === "failed",
      );
      const terminalStatus = anyFailedExisting ? "failed" : "sent";
      const latest = await deps.comms.findJobById(job.id);
      if (
        latest &&
        latest.status !== "sent" &&
        latest.status !== "failed"
      ) {
        await deps.comms.updateJob(latest.id, {
          status: terminalStatus,
          version: latest.version + 1,
          expectedVersion: latest.version,
          updatedAt: now,
        });
      }
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: now,
        attempts: claimed.attempts,
        lastError: anyFailedExisting ? "partial_or_full_failure" : null,
      });
      skipped += 1;
      jobIds.push(job.id);
      continue;
    }

    let anyFailed = existingDeliveries.some((d) => d.status === "failed");
    let newlySent = 0;

    for (const recipient of pendingRecipients) {
      // Per-recipient lock: only one drain may call the provider for a row.
      // Enqueue writes status "queued"; schema default is "pending".
      // Resume after crash: status already "sending" with no delivery → send.
      if (recipient.status === "pending" || recipient.status === "queued") {
        const claimedRecipient = await deps.comms.claimRecipientForSend(
          recipient.id,
        );
        if (!claimedRecipient) {
          // Another concurrent drain claimed this recipient — skip provider.
          continue;
        }
      } else if (recipient.status === "sending") {
        // Exclusive outbox lease + no delivery: resume mid-flight claim.
      } else {
        // Terminal status without delivery is inconsistent; do not re-send.
        continue;
      }

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

      newlySent += 1;
      if (!result.ok) anyFailed = true;
    }

    // Completing the outbox requires every recipient to have a delivery record.
    // (If this process crashed mid-loop, the next drain resumes pending only.)
    const afterDeliveries = await deps.comms.listDeliveryEventsForJob(job.id);
    const afterDeliveredIds = new Set(
      afterDeliveries
        .map((d) => d.recipientId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    const allRecipientsDone = recipients.every((r) =>
      afterDeliveredIds.has(r.id),
    );

    if (!allRecipientsDone) {
      // Release exclusive claim so a later drain can continue remaining recipients.
      await deps.comms.releaseOutboxClaim(row.id, claimToken);
      failed += 1;
      jobIds.push(job.id);
      continue;
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
      attempts: claimed.attempts,
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
        newlySent,
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
