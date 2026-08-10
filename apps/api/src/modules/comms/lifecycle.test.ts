/**
 * Comms.SubmissionConfirmation — lifecycle enqueue unit tests (Wave 1B item 1).
 *
 * Paths under test (contract):
 * - enabled (default): durable job + direct-email recipient + rendered body
 *   snapshot + idempotency key + outbox row, all present after one call
 * - duplicate request: invoke twice → exactly-once (count durable records)
 * - disabled via event settings: no durable rows, reason "disabled"
 * - missing/uncreatable template: log + skip, never throws
 * - queue kick failure: enqueue still succeeds (outbox is SoR)
 * - store failure mid-enqueue: returns { enqueued: false, reason: "error" }
 * - sandbox drain: processCommsOutbox renders delivery_events for the job
 * - template editing: upsert changes the next rendered body (re-render)
 */
import { describe, it, expect } from "vitest";
import {
  COMMS_OUTBOX_TOPIC,
  SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
  submissionConfirmationIdempotencyKey,
} from "@speakerops/shared";
import { MemoryAuthStore } from "../auth/store.js";
import { MemoryCommsStore } from "./store.js";
import {
  enqueueSubmissionConfirmation,
  ensureSubmissionConfirmationTemplate,
} from "./lifecycle.js";
import { processCommsOutbox } from "../../workers/emailConsumer.js";
import { SandboxEmailProvider } from "./send.js";

function makeDeps(overrides?: {
  comms?: MemoryCommsStore;
  queueKick?: { send: (m: unknown) => Promise<unknown> } | null;
}) {
  const comms = overrides?.comms ?? new MemoryCommsStore();
  const auth = new MemoryAuthStore();
  return {
    deps: {
      comms,
      auth,
      queueKick: overrides?.queueKick ?? null,
      log: () => {},
    },
    comms,
    auth,
  };
}

const EVENT = {
  id: "evt_w1b",
  name: "Depth Conf",
  slug: "depth-conf",
  settingsJson: null as string | null,
};

const SUBMISSION = {
  id: "sub_w1b_1",
  title: "Signals over noise",
  category: "AI" as string | null,
};

const PRIMARY = { name: "Rae Chen", email: "Rae.Chen@Example.com" };

function baseInput(overrides?: Partial<Record<string, unknown>>) {
  return {
    event: { ...EVENT },
    submission: { ...SUBMISSION },
    primarySpeaker: { ...PRIMARY },
    correlationId: "corr-w1b-lifecycle",
    ...(overrides ?? {}),
  } as Parameters<typeof enqueueSubmissionConfirmation>[1];
}

describe("Comms.SubmissionConfirmation — enabled path", () => {
  it("creates job + recipient + outbox + idempotency + audit in one call", async () => {
    const { deps, comms, auth } = makeDeps();
    const result = await enqueueSubmissionConfirmation(deps, baseInput());
    expect(result.enqueued).toBe(true);
    if (!result.enqueued) return;

    const job = await comms.findJobById(result.jobId);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("queued");
    expect(job!.idempotencyKey).toBe(
      submissionConfirmationIdempotencyKey(SUBMISSION.id),
    );
    expect(job!.createdBy).toBe("system:submission-confirmation");

    const recipients = await comms.listRecipientsForJob(result.jobId);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.toEmail).toBe("rae.chen@example.com");
    expect(recipients[0]!.participationId).toBeNull();
    // Rendered snapshot: merge fields resolved, tokens gone.
    expect(recipients[0]!.subject).toBe(
      "We received your proposal for Depth Conf",
    );
    expect(recipients[0]!.body).toContain("Signals over noise");
    expect(recipients[0]!.body).toContain("Rae Chen");
    expect(recipients[0]!.body).not.toContain("{{");

    const outbox = await comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.processedAt).toBeNull();
    expect(outbox[0]!.payloadJson).toContain(result.jobId);

    const idem = await comms.findIdempotencyKey(
      `comms.send:${submissionConfirmationIdempotencyKey(SUBMISSION.id)}`,
    );
    expect(idem).not.toBeNull();

    const audits = (await auth.listAudits()).filter(
      (a) => a.action === "Comms.SubmissionConfirmation",
    );
    expect(audits).toHaveLength(1);
  });

  it("lazily seeds the per-event template and reuses an existing one", async () => {
    const { deps, comms } = makeDeps();
    await enqueueSubmissionConfirmation(deps, baseInput());
    const template = await comms.findTemplateByEventKey(
      EVENT.id,
      SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
    );
    expect(template).not.toBeNull();
    expect(template!.version).toBe(1);

    // ensure is idempotent — same row back, no duplicate insert.
    const again = await ensureSubmissionConfirmationTemplate(
      comms,
      EVENT.id,
      new Date().toISOString(),
    );
    expect(again!.id).toBe(template!.id);
    expect(await comms.listTemplatesForEvent(EVENT.id)).toHaveLength(1);
  });

  it("re-render reflects an admin-edited template on the next submission", async () => {
    const { deps, comms } = makeDeps();
    await enqueueSubmissionConfirmation(deps, baseInput());
    const template = (await comms.findTemplateByEventKey(
      EVENT.id,
      SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
    ))!;
    await comms.updateTemplate(template.id, {
      subject: "Got it: {{submissionTitle}}",
      bodyMd: "Cheers {{firstName}} — we have {{submissionTitle}}.",
      version: template.version + 1,
      expectedVersion: template.version,
      updatedAt: new Date().toISOString(),
    });

    const second = await enqueueSubmissionConfirmation(
      deps,
      baseInput({
        submission: { id: "sub_w1b_2", title: "Second wave", category: null },
      }),
    );
    expect(second.enqueued).toBe(true);
    if (!second.enqueued) return;
    const recipients = await comms.listRecipientsForJob(second.jobId);
    expect(recipients[0]!.subject).toBe("Got it: Second wave");
    expect(recipients[0]!.body).toBe("Cheers Rae — we have Second wave.");
  });

  it("adds deduped organizer recipients from notifySubmissionEmails", async () => {
    const { deps, comms } = makeDeps();
    const result = await enqueueSubmissionConfirmation(
      deps,
      baseInput({
        event: {
          ...EVENT,
          settingsJson: JSON.stringify({
            notifySubmissionEmails: [
              "ops@example.com",
              "Ops@Example.com",
              "rae.chen@example.com",
            ],
          }),
        },
      }),
    );
    expect(result.enqueued).toBe(true);
    if (!result.enqueued) return;
    const recipients = await comms.listRecipientsForJob(result.jobId);
    // Submitter + one organizer (case-dedup; submitter address not doubled).
    expect(recipients.map((r) => r.toEmail).sort()).toEqual([
      "ops@example.com",
      "rae.chen@example.com",
    ]);
  });
});

describe("Comms.SubmissionConfirmation — exactly-once", () => {
  it("invoking twice creates durable records exactly once", async () => {
    const { deps, comms, auth } = makeDeps();
    const first = await enqueueSubmissionConfirmation(deps, baseInput());
    const second = await enqueueSubmissionConfirmation(deps, baseInput());
    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    if (second.enqueued) return;
    expect(second.reason).toBe("duplicate");
    expect(second.jobId).toBe(first.enqueued ? first.jobId : undefined);

    // Count durable records — the exactly-once proof.
    const jobs = await comms.listJobsForEvent(EVENT.id);
    expect(jobs).toHaveLength(1);
    const outbox = await comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    expect(outbox).toHaveLength(1);
    const recipients = await comms.listRecipientsForJob(jobs[0]!.id);
    expect(recipients).toHaveLength(1);
    const audits = (await auth.listAudits()).filter(
      (a) => a.action === "Comms.SubmissionConfirmation",
    );
    expect(audits).toHaveLength(1);
  });
});

describe("Comms.SubmissionConfirmation — skip paths (never fail the submission)", () => {
  it("disabled via event settings → no durable rows", async () => {
    const { deps, comms } = makeDeps();
    const result = await enqueueSubmissionConfirmation(
      deps,
      baseInput({
        event: {
          ...EVENT,
          settingsJson: JSON.stringify({
            submissionConfirmationEnabled: false,
          }),
        },
      }),
    );
    expect(result).toEqual({ enqueued: false, reason: "disabled" });
    expect(await comms.listJobsForEvent(EVENT.id)).toHaveLength(0);
    expect(await comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC)).toHaveLength(0);
  });

  it("template unavailable (create fails, none exists) → log + skip", async () => {
    const comms = new MemoryCommsStore();
    comms.insertTemplate = (() => {
      throw new Error("template write failed");
    }) as never;
    const { deps } = makeDeps({ comms });
    const result = await enqueueSubmissionConfirmation(deps, baseInput());
    expect(result).toEqual({
      enqueued: false,
      reason: "template_unavailable",
    });
    expect(await comms.listJobsForEvent(EVENT.id)).toHaveLength(0);
  });

  it("queue kick failure does not undo the enqueue", async () => {
    const { deps, comms } = makeDeps({
      queueKick: {
        send: () => Promise.reject(new Error("queue down")),
      },
    });
    const result = await enqueueSubmissionConfirmation(deps, baseInput());
    expect(result.enqueued).toBe(true);
    expect(await comms.listJobsForEvent(EVENT.id)).toHaveLength(1);
    expect(await comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC)).toHaveLength(1);
  });

  it("store failure mid-enqueue returns error without throwing", async () => {
    const comms = new MemoryCommsStore();
    comms.insertOutbox = (() => {
      throw new Error("outbox down");
    }) as never;
    const { deps } = makeDeps({ comms });
    const result = await enqueueSubmissionConfirmation(deps, baseInput());
    expect(result).toEqual({ enqueued: false, reason: "error" });
  });
});

describe("Comms.SubmissionConfirmation — sandbox drain", () => {
  it("processCommsOutbox delivers the lifecycle job via the sandbox provider", async () => {
    const { deps, comms, auth } = makeDeps();
    const result = await enqueueSubmissionConfirmation(deps, baseInput());
    expect(result.enqueued).toBe(true);
    if (!result.enqueued) return;

    const sandbox = new SandboxEmailProvider();
    const drain = await processCommsOutbox({
      comms,
      auth,
      provider: sandbox,
    });
    expect(drain.processed).toBe(1);
    expect(drain.jobIds).toContain(result.jobId);

    // Provider saw the rendered message; delivery_events recorded per recipient.
    expect(sandbox.sent).toHaveLength(1);
    expect(sandbox.sent[0]!.to).toBe("rae.chen@example.com");
    expect(sandbox.sent[0]!.subject).toContain("Depth Conf");
    const deliveries = await comms.listDeliveryEventsForJob(result.jobId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.provider).toBe("sandbox");

    const job = await comms.findJobById(result.jobId);
    expect(job!.status).toBe("sent");
  });
});
