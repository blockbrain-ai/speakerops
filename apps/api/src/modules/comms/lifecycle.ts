/**
 * Lifecycle comms — Comms.SubmissionConfirmation (Wave 1B item 1).
 *
 * After a successful public Submission.Create, enqueue a confirmation email
 * to the submitter's primary address through the standard S-COMMS outbox:
 * message_jobs (status queued) + message_recipients (participation_id NULL —
 * direct email) + rendered subject/body snapshot + idempotency key
 * `submission-confirmation:<submissionId>` + outbox_events row — committed as
 * ONE atomic unit via the store's enqueueLifecycleAtomic primitive (a failure
 * anywhere leaves zero rows; retries start clean). Provider delivery stays on
 * the 5.2 consumer (sandbox default) — never here (E7).
 *
 * Failure law: a missing/disabled template, malformed settings, or any store
 * error must NEVER fail the submission — log + skip, return a reason.
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  renderMergeFields,
  mergeRichTextValues,
  readRichTextValue,
  richTextToPlainText,
  richTextToEmailHtml,
  parseEventNotificationSettings,
  submissionConfirmationIdempotencyKey,
  SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
  SUBMISSION_CONFIRMATION_DEFAULT_SUBJECT,
  SUBMISSION_CONFIRMATION_DEFAULT_BODY,
  COMMS_OUTBOX_TOPIC,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import {
  type CommsStore,
  type EmailTemplateRow,
  type MessageJobRow,
  type MessageRecipientRow,
  newEmailTemplateId,
  newMessageJobId,
  newMessageRecipientId,
  newOutboxEventId,
  newIdempotencyKeyId,
} from "./store.js";
import { commsSendIdempotencyStorageKey } from "./send.js";

export type SubmissionConfirmationDeps = {
  comms: CommsStore;
  auth: AuthStore;
  /**
   * Best-effort queue kick after enqueue (production JOBS_QUEUE). Failure is
   * swallowed — the outbox row is SoR and the scheduled drain picks it up.
   */
  queueKick?: { send: (message: unknown) => Promise<unknown> } | null;
  /** Structured skip/error logger (default console.warn; never throws). */
  log?: (message: string, data?: Record<string, unknown>) => void;
};

export type SubmissionConfirmationInput = {
  event: {
    id: string;
    name: string;
    slug: string;
    settingsJson: string | null;
  };
  submission: {
    id: string;
    title: string;
    category: string | null;
  };
  /** Submitter identity — primary speaker on the created submission. */
  primarySpeaker: {
    name: string;
    email: string;
  };
  correlationId: string;
};

export type SubmissionConfirmationResult =
  | { enqueued: true; jobId: string; recipientCount: number }
  | {
      enqueued: false;
      reason: "disabled" | "duplicate" | "template_unavailable" | "error";
      jobId?: string;
    };

function safeLog(
  log: SubmissionConfirmationDeps["log"],
  message: string,
  data?: Record<string, unknown>,
): void {
  try {
    (log ?? ((m: string, d?: Record<string, unknown>) => console.warn(m, d ?? {})))(
      message,
      data,
    );
  } catch {
    /* logging must never throw into the submit path */
  }
}

/**
 * Lazily ensure the event has a `submission_confirmation` template so the
 * lifecycle works out of the box and stays editable in Comms templates.
 */
export async function ensureSubmissionConfirmationTemplate(
  comms: CommsStore,
  eventId: string,
  now: string,
): Promise<EmailTemplateRow | null> {
  const existing = await comms.findTemplateByEventKey(
    eventId,
    SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
  );
  if (existing) return existing;
  try {
    return await comms.insertTemplate({
      id: newEmailTemplateId(),
      eventId,
      key: SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
      subject: SUBMISSION_CONFIRMATION_DEFAULT_SUBJECT,
      bodyMd: SUBMISSION_CONFIRMATION_DEFAULT_BODY,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    // Unique (event_id, key) race or store failure — re-read; null skips send.
    return comms.findTemplateByEventKey(
      eventId,
      SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
    );
  }
}

/**
 * Comms.SubmissionConfirmation — durable lifecycle enqueue.
 * Never throws; every failure path returns { enqueued: false, reason }.
 */
export async function enqueueSubmissionConfirmation(
  deps: SubmissionConfirmationDeps,
  input: SubmissionConfirmationInput,
): Promise<SubmissionConfirmationResult> {
  try {
    const settings = parseEventNotificationSettings(input.event.settingsJson);
    if (!settings.submissionConfirmationEnabled) {
      return { enqueued: false, reason: "disabled" };
    }

    const idempotencyKey = submissionConfirmationIdempotencyKey(
      input.submission.id,
    );
    const storageKey = commsSendIdempotencyStorageKey(idempotencyKey);

    // Exactly-once: a stored key or an existing job under the same key means a
    // previous invocation already enqueued — replay without new durable rows.
    const existingIdem = await deps.comms.findIdempotencyKey(storageKey);
    if (existingIdem) {
      let jobId: string | undefined;
      if (existingIdem.responseJson) {
        try {
          const cached = JSON.parse(existingIdem.responseJson) as {
            jobId?: string;
          };
          jobId = cached.jobId;
        } catch {
          /* replay without job id */
        }
      }
      return { enqueued: false, reason: "duplicate", jobId };
    }
    const existingJob = await deps.comms.findJobByIdempotencyKey(idempotencyKey);
    if (existingJob) {
      return { enqueued: false, reason: "duplicate", jobId: existingJob.id };
    }

    const now = new Date().toISOString();
    const template = await ensureSubmissionConfirmationTemplate(
      deps.comms,
      input.event.id,
      now,
    );
    if (!template) {
      safeLog(deps.log, "submission_confirmation_skipped", {
        reason: "template_unavailable",
        eventId: input.event.id,
        submissionId: input.submission.id,
        correlationId: input.correlationId,
      });
      return { enqueued: false, reason: "template_unavailable" };
    }

    const primaryEmail = input.primarySpeaker.email.toLowerCase().trim();
    const primaryName = input.primarySpeaker.name.trim();
    const nameParts = primaryName.split(/\s+/).filter(Boolean);
    const mergeData: Record<string, string> = {
      name: primaryName,
      speakerName: primaryName,
      firstName: nameParts[0] ?? "",
      lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : "",
      email: primaryEmail,
      eventName: input.event.name,
      submissionTitle: input.submission.title,
      submissionId: input.submission.id,
      category: input.submission.category ?? "",
    };
    const subject = renderMergeFields(template.subject, mergeData);
    // F2 dual-part: merge values in doc-space, then serialize BOTH parts from
    // the one merged doc (HTML serializer escapes recipient data).
    const bodySource = readRichTextValue(
      template.bodyRichJson ?? null,
      template.bodyMd,
    );
    const bodyMerged = bodySource
      ? mergeRichTextValues(bodySource, mergeData)
      : null;
    const body = bodyMerged
      ? {
          rendered: richTextToPlainText(bodyMerged.envelope),
          html: richTextToEmailHtml(bodyMerged.envelope),
          missingFields: bodyMerged.missingFields,
        }
      : { ...renderMergeFields(template.bodyMd, mergeData), html: null };
    const missingFields = [
      ...new Set([...subject.missingFields, ...body.missingFields]),
    ];

    const jobId = newMessageJobId();

    // Recipients: submitter first, then event-level notify list (dedup, no
    // double-send when an organizer address equals the submitter address).
    const recipientRows: MessageRecipientRow[] = [
      {
        id: newMessageRecipientId(),
        jobId,
        eventId: input.event.id,
        participationId: null,
        toEmail: primaryEmail,
        name: primaryName || primaryEmail,
        subject: subject.rendered,
        body: body.rendered,
        bodyHtml: body.html ?? null,
        status: "queued",
        createdAt: now,
      },
    ];
    for (const notify of settings.notifySubmissionEmails) {
      if (notify === primaryEmail) continue;
      if (recipientRows.some((r) => r.toEmail === notify)) continue;
      recipientRows.push({
        id: newMessageRecipientId(),
        jobId,
        eventId: input.event.id,
        participationId: null,
        toEmail: notify,
        name: null,
        subject: `New proposal for ${input.event.name}: ${input.submission.title}`,
        body: [
          `A new proposal was submitted to ${input.event.name}.`,
          "",
          `Title: ${input.submission.title}`,
          `Submitted by: ${primaryName || primaryEmail} <${primaryEmail}>`,
          input.submission.category
            ? `Category: ${input.submission.category}`
            : null,
          "",
          "Open SpeakerOps → Submissions to review it.",
        ]
          .filter((line): line is string => line != null)
          .join("\n"),
        status: "queued",
        createdAt: now,
      });
    }

    const job: MessageJobRow = {
      id: jobId,
      eventId: input.event.id,
      templateId: template.id,
      status: "queued",
      segmentJson: JSON.stringify({
        lifecycle: "submission_confirmation",
        submissionId: input.submission.id,
      }),
      recipientsJson: JSON.stringify(
        recipientRows.map((r) => ({
          email: r.toEmail,
          name: r.name,
          kind: r.toEmail === primaryEmail ? "submitter" : "organizer",
        })),
      ),
      bodiesJson: JSON.stringify(
        recipientRows.map((r) => ({
          email: r.toEmail,
          subject: r.subject,
          body: r.body,
        })),
      ),
      missingFieldsJson: JSON.stringify(missingFields),
      idempotencyKey,
      calendarInviteId: null,
      createdBy: "system:submission-confirmation",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    // Durable enqueue — ONE atomic unit (E7): job + recipients + outbox +
    // idempotency key + audit commit or roll back together (D1 batch; Memory
    // all-or-nothing). A mid-operation failure leaves zero rows, so the retry
    // path enqueues cleanly instead of finding an orphan job that replays as
    // `duplicate` forever.
    const outcome = await deps.comms.enqueueLifecycleAtomic(
      {
        job,
        recipients: recipientRows,
        outbox: {
          id: newOutboxEventId(),
          topic: COMMS_OUTBOX_TOPIC,
          payloadJson: JSON.stringify({
            jobId,
            eventId: input.event.id,
            templateId: template.id,
            idempotencyKey,
            correlationId: input.correlationId,
            lifecycle: "submission_confirmation",
          }),
          createdAt: now,
          processedAt: null,
          attempts: 0,
          lastError: null,
        },
        idempotency: {
          id: newIdempotencyKeyId(),
          key: storageKey,
          requestHash: `submission-confirmation:${input.submission.id}:${primaryEmail}`,
          responseJson: JSON.stringify({ jobId }),
          createdAt: now,
        },
        audit: {
          id: uuidv7(),
          eventId: input.event.id,
          actorType: "system",
          actorId: "submission-confirmation",
          action: "Comms.SubmissionConfirmation",
          entityType: "message_job",
          entityId: jobId,
          afterJson: JSON.stringify({
            submissionId: input.submission.id,
            templateKey: SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
            recipientCount: recipientRows.length,
            idempotencyKey,
          }),
          correlationId: input.correlationId,
          createdAt: now,
        },
      },
      (row) => deps.auth.insertAudit(row),
    );

    if (outcome === "duplicate") {
      // Concurrent duplicate committed first — surface its job id when stored.
      const winner = await deps.comms.findIdempotencyKey(storageKey);
      let winnerJobId: string | undefined;
      if (winner?.responseJson) {
        try {
          const cached = JSON.parse(winner.responseJson) as { jobId?: string };
          winnerJobId = cached.jobId;
        } catch {
          /* replay without job id */
        }
      }
      if (!winnerJobId) {
        winnerJobId =
          (await deps.comms.findJobByIdempotencyKey(idempotencyKey))?.id;
      }
      return { enqueued: false, reason: "duplicate", jobId: winnerJobId };
    }

    // Best-effort queue kick — outbox row is SoR; cron drain is the backstop.
    if (deps.queueKick && typeof deps.queueKick.send === "function") {
      try {
        await deps.queueKick.send({
          topic: COMMS_OUTBOX_TOPIC,
          jobId,
          eventId: input.event.id,
          correlationId: input.correlationId,
        });
      } catch {
        /* scheduled drain picks the row up */
      }
    }

    return { enqueued: true, jobId, recipientCount: recipientRows.length };
  } catch (err) {
    safeLog(deps.log, "submission_confirmation_failed", {
      reason: "error",
      eventId: input.event.id,
      submissionId: input.submission.id,
      correlationId: input.correlationId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return { enqueued: false, reason: "error" };
  }
}
