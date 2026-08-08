/**
 * Comms domain commands (section 5.1–5.2 / S-COMMS).
 *
 * Comms.UpsertTemplate · Comms.Preview · Comms.Send (enqueue only — no provider HTTP)
 * Comms.IcsForPlacement — calendar_invites UID/SEQUENCE
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  TemplateKeySchema,
  COMMS_OUTBOX_TOPIC,
  renderMergeFields,
  type CommsUpsertTemplateBody,
  type CommsUpsertTemplateResponse,
  type CommsPreviewBody,
  type CommsPreviewResponse,
  type CommsSendBody,
  type CommsSendResponse,
  type EmailTemplateDto,
  type MessageJobDto,
  type CommsSegment,
  type CommsPreviewRecipient,
  type CommsPreviewBodyItem,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import {
  type CommsStore,
  type EmailTemplateRow,
  type MessageJobRow,
  type CalendarInviteRow,
  newEmailTemplateId,
  newMessageJobId,
  newOutboxEventId,
  newMessageRecipientId,
  newIdempotencyKeyId,
  newCalendarInviteId,
} from "./store.js";
import {
  hashSendRequest,
  commsSendIdempotencyStorageKey,
} from "./send.js";
import {
  icsForPlacement,
  type IcsPlacementInput,
  type CalendarInviteState,
} from "./ics.js";

export type CommsCommandDeps = {
  comms: CommsStore;
  events: EventsStore;
  auth: AuthStore;
  submissions: SubmissionsStore;
  decisions: DecisionsStore;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

function toTemplateDto(row: EmailTemplateRow): EmailTemplateDto {
  return {
    id: row.id,
    eventId: row.eventId,
    key: row.key as EmailTemplateDto["key"],
    subject: row.subject,
    body: row.bodyMd,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toJobDto(row: MessageJobRow): MessageJobDto {
  return {
    id: row.id,
    eventId: row.eventId,
    templateId: row.templateId,
    status: row.status as MessageJobDto["status"],
    idempotencyKey: row.idempotencyKey,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Build merge-field data for a participation + event context.
 */
async function mergeDataForParticipation(
  deps: CommsCommandDeps,
  input: {
    eventId: string;
    eventName: string;
    participationId: string;
    personId: string;
    bio: string | null;
    company: string | null;
    title: string | null;
  },
): Promise<Record<string, string>> {
  const person = await deps.submissions.findPersonById(input.personId);
  const name = person?.name ?? "";
  const email = person?.email ?? "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return {
    name,
    firstName,
    lastName,
    email,
    eventName: input.eventName,
    company: input.company ?? "",
    title: input.title ?? "",
    bio: input.bio ?? "",
    participationId: input.participationId,
  };
}

/**
 * Comms.UpsertTemplate — create or update email_templates by (eventId, key).
 * Never calls an email provider.
 */
export async function upsertTemplate(
  deps: CommsCommandDeps,
  input: {
    eventId: string;
    key: string;
    body: CommsUpsertTemplateBody;
    actorUserId: string;
    correlationId: string;
  },
): Promise<CommandOk<CommsUpsertTemplateResponse> | CommandErr> {
  const keyParsed = TemplateKeySchema.safeParse(input.key);
  if (!keyParsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid template key",
      code: "VALIDATION_ERROR",
      details: keyParsed.error.flatten(),
    };
  }

  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }

  const now = new Date().toISOString();
  const existing = await deps.comms.findTemplateByEventKey(
    input.eventId,
    keyParsed.data,
  );

  if (existing) {
    const expected = input.body.expectedVersion ?? existing.version;
    if (existing.version !== expected) {
      return {
        ok: false,
        status: 409,
        error: "Template version conflict",
        code: "CONFLICT",
        details: {
          expectedVersion: expected,
          version: existing.version,
        },
      };
    }

    const before = {
      subject: existing.subject,
      body: existing.bodyMd,
      version: existing.version,
    };

    const updated = await deps.comms.updateTemplate(existing.id, {
      subject: input.body.subject,
      bodyMd: input.body.body,
      version: existing.version + 1,
      expectedVersion: existing.version,
      updatedAt: now,
    });
    if (!updated) {
      return {
        ok: false,
        status: 409,
        error: "Template version conflict",
        code: "CONFLICT",
      };
    }

    await deps.auth.insertAudit({
      id: uuidv7(),
      eventId: input.eventId,
      actorType: "user",
      actorId: input.actorUserId,
      action: "Comms.UpsertTemplate",
      entityType: "email_template",
      entityId: updated.id,
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify({
        subject: updated.subject,
        body: updated.bodyMd,
        version: updated.version,
        key: updated.key,
      }),
      correlationId: input.correlationId,
      createdAt: now,
    });

    return { ok: true, value: { template: toTemplateDto(updated) } };
  }

  const row = await deps.comms.insertTemplate({
    id: newEmailTemplateId(),
    eventId: input.eventId,
    key: keyParsed.data,
    subject: input.body.subject,
    bodyMd: input.body.body,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Comms.UpsertTemplate",
    entityType: "email_template",
    entityId: row.id,
    beforeJson: null,
    afterJson: JSON.stringify({
      subject: row.subject,
      body: row.bodyMd,
      version: row.version,
      key: row.key,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { template: toTemplateDto(row) } };
}

/**
 * Comms.Preview — render merge fields for a segment; store draft job (status=preview).
 * No provider HTTP.
 */
export async function previewComms(
  deps: CommsCommandDeps,
  input: {
    body: CommsPreviewBody;
    actorUserId: string;
    correlationId: string;
  },
): Promise<CommandOk<CommsPreviewResponse> | CommandErr> {
  const template = await deps.comms.findTemplateById(input.body.templateId);
  if (!template) {
    return {
      ok: false,
      status: 404,
      error: "Template not found",
      code: "NOT_FOUND",
    };
  }

  const event = await deps.events.findEventById(template.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }

  // Membership is enforced at route layer for event; double-check event scope.
  const segment: CommsSegment = input.body.segment ?? {};
  const allParts = await deps.decisions.listParticipationsForEvent(
    template.eventId,
  );

  let selected = allParts;
  if (segment.participationIds && segment.participationIds.length > 0) {
    const want = new Set(segment.participationIds);
    selected = allParts.filter((p) => want.has(p.id));
  } else {
    const statusFilter = segment.status ?? "accepted";
    selected = allParts.filter((p) => p.status === statusFilter);
  }

  const recipients: CommsPreviewResponse["recipients"] = [];
  const bodies: CommsPreviewResponse["bodies"] = [];
  const missingAll = new Set<string>();

  for (const part of selected) {
    const data = await mergeDataForParticipation(deps, {
      eventId: template.eventId,
      eventName: event.name,
      participationId: part.id,
      personId: part.personId,
      bio: part.bio,
      company: part.company,
      title: part.title,
    });
    if (!data.email) continue;

    const subj = renderMergeFields(template.subject, data);
    const body = renderMergeFields(template.bodyMd, data);
    for (const m of subj.missingFields) missingAll.add(m);
    for (const m of body.missingFields) missingAll.add(m);

    recipients.push({
      participationId: part.id,
      email: data.email,
      name: data.name || data.email,
    });
    bodies.push({
      participationId: part.id,
      subject: subj.rendered,
      body: body.rendered,
    });
  }

  const now = new Date().toISOString();
  const missingFields = [...missingAll];
  const job = await deps.comms.insertJob({
    id: newMessageJobId(),
    eventId: template.eventId,
    templateId: template.id,
    status: "preview",
    segmentJson: JSON.stringify(segment),
    recipientsJson: JSON.stringify(recipients),
    bodiesJson: JSON.stringify(bodies),
    missingFieldsJson: JSON.stringify(missingFields),
    idempotencyKey: null,
    createdBy: input.actorUserId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: template.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Comms.Preview",
    entityType: "message_job",
    entityId: job.id,
    beforeJson: null,
    afterJson: JSON.stringify({
      status: job.status,
      templateId: template.id,
      recipientCount: recipients.length,
      missingFields,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      previewId: job.id,
      templateId: template.id,
      eventId: template.eventId,
      recipients,
      bodies,
      missingFields,
      recipientCount: recipients.length,
    },
  };
}

/**
 * Comms.Send — enqueue only: mark job queued + materialize recipients +
 * insert outbox_events + idempotency_keys.
 * **Never** calls an email provider HTTP API (emailConsumer drains outbox).
 *
 * J08: requires completed preview (previewId of a status=preview job).
 * J04: same idempotencyKey returns same job id (idempotency_keys + job key).
 */
export async function sendComms(
  deps: CommsCommandDeps,
  input: {
    body: CommsSendBody;
    actorUserId: string;
    correlationId: string;
  },
): Promise<CommandOk<CommsSendResponse> | CommandErr> {
  const storageKey = commsSendIdempotencyStorageKey(input.body.idempotencyKey);
  const requestHash = await hashSendRequest({
    previewId: input.body.previewId,
    idempotencyKey: input.body.idempotencyKey,
  });

  // Primary idempotency replay via idempotency_keys (SCHEMA / E7).
  const existingIdem = await deps.comms.findIdempotencyKey(storageKey);
  if (existingIdem) {
    if (existingIdem.requestHash !== requestHash) {
      return {
        ok: false,
        status: 409,
        error: "Idempotency key reused with different request",
        code: "CONFLICT",
        details: { key: input.body.idempotencyKey },
      };
    }
    if (existingIdem.responseJson) {
      try {
        const cached = JSON.parse(existingIdem.responseJson) as CommsSendResponse;
        return { ok: true, value: { ...cached, enqueued: false } };
      } catch {
        // Fall through to job lookup
      }
    }
  }

  // Secondary: message_jobs.idempotency_key (partial unique).
  const existingByKey = await deps.comms.findJobByIdempotencyKey(
    input.body.idempotencyKey,
  );
  if (existingByKey) {
    const value: CommsSendResponse = {
      job: toJobDto(existingByKey),
      enqueued: false,
    };
    if (!existingIdem) {
      await deps.comms.insertIdempotencyKey({
        id: newIdempotencyKeyId(),
        key: storageKey,
        requestHash,
        responseJson: JSON.stringify(value),
        createdAt: new Date().toISOString(),
      });
    }
    return { ok: true, value };
  }

  // J08 preview required — missing/unknown previewId fails (Zod 400 at route;
  // unknown id → 404; wrong status → 400).
  const job = await deps.comms.findJobById(input.body.previewId);
  if (!job) {
    return {
      ok: false,
      status: 404,
      error: "Preview not found",
      code: "NOT_FOUND",
    };
  }

  if (job.status !== "preview") {
    return {
      ok: false,
      status: 400,
      error: "Preview is not in a sendable state",
      code: "VALIDATION_ERROR",
      details: { status: job.status },
    };
  }

  if (job.idempotencyKey) {
    // Already enqueued under another key path
    return {
      ok: true,
      value: { job: toJobDto(job), enqueued: false },
    };
  }

  const now = new Date().toISOString();
  const updated = await deps.comms.updateJob(job.id, {
    status: "queued",
    idempotencyKey: input.body.idempotencyKey,
    version: job.version + 1,
    expectedVersion: job.version,
    updatedAt: now,
  });
  if (!updated) {
    // Race: another request may have claimed this preview
    const again = await deps.comms.findJobByIdempotencyKey(
      input.body.idempotencyKey,
    );
    if (again) {
      return { ok: true, value: { job: toJobDto(again), enqueued: false } };
    }
    return {
      ok: false,
      status: 409,
      error: "Message job version conflict",
      code: "CONFLICT",
    };
  }

  // Materialize message_recipients from preview snapshot (I16: to_email).
  await materializeRecipients(deps.comms, updated);

  // Transactional outbox: request path never waits on provider (E7).
  // No fetch / Resend / SES / SMTP call here — intentionally absent.
  await deps.comms.insertOutbox({
    id: newOutboxEventId(),
    topic: COMMS_OUTBOX_TOPIC,
    payloadJson: JSON.stringify({
      jobId: updated.id,
      eventId: updated.eventId,
      templateId: updated.templateId,
      idempotencyKey: updated.idempotencyKey,
      correlationId: input.correlationId,
    }),
    createdAt: now,
    processedAt: null,
    attempts: 0,
    lastError: null,
  });

  const response: CommsSendResponse = {
    job: toJobDto(updated),
    enqueued: true,
  };

  await deps.comms.insertIdempotencyKey({
    id: newIdempotencyKeyId(),
    key: storageKey,
    requestHash,
    responseJson: JSON.stringify(response),
    createdAt: now,
  });

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: updated.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Comms.Send",
    entityType: "message_job",
    entityId: updated.id,
    beforeJson: JSON.stringify({ status: job.status, version: job.version }),
    afterJson: JSON.stringify({
      status: updated.status,
      version: updated.version,
      idempotencyKey: updated.idempotencyKey,
      outboxTopic: COMMS_OUTBOX_TOPIC,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: response };
}

async function materializeRecipients(
  store: CommsStore,
  job: MessageJobRow,
): Promise<void> {
  const existing = await store.listRecipientsForJob(job.id);
  if (existing.length > 0) return;

  let recipients: CommsPreviewRecipient[] = [];
  let bodies: CommsPreviewBodyItem[] = [];
  try {
    recipients = JSON.parse(job.recipientsJson ?? "[]") as CommsPreviewRecipient[];
  } catch {
    recipients = [];
  }
  try {
    bodies = JSON.parse(job.bodiesJson ?? "[]") as CommsPreviewBodyItem[];
  } catch {
    bodies = [];
  }
  const bodyByPart = new Map(bodies.map((b) => [b.participationId, b]));
  const now = new Date().toISOString();

  for (const r of recipients) {
    const body = bodyByPart.get(r.participationId);
    await store.insertRecipient({
      id: newMessageRecipientId(),
      jobId: job.id,
      eventId: job.eventId,
      participationId: r.participationId,
      toEmail: r.email,
      name: r.name,
      subject: body?.subject ?? null,
      body: body?.body ?? null,
      status: "queued",
      createdAt: now,
    });
  }
}

/**
 * Comms.IcsForPlacement — create or update calendar_invites with stable UID
 * and SEQUENCE bump on reschedule (J10 / S-COMMS).
 */
export async function icsForPlacementCommand(
  deps: CommsCommandDeps,
  input: {
    placement: IcsPlacementInput;
    actorUserId: string;
    correlationId: string;
    cancel?: boolean;
  },
): Promise<
  | CommandOk<{ invite: CalendarInviteRow; state: CalendarInviteState }>
  | CommandErr
> {
  const event = await deps.events.findEventById(input.placement.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }

  const prior = await deps.comms.findCalendarInviteByPlacement(
    input.placement.eventId,
    input.placement.placementId,
  );
  const state = icsForPlacement(
    prior
      ? { uid: prior.uid, sequence: prior.sequence }
      : null,
    input.placement,
    { cancel: input.cancel },
  );

  const now = new Date().toISOString();

  if (!prior) {
    const row = await deps.comms.insertCalendarInvite({
      id: newCalendarInviteId(),
      eventId: input.placement.eventId,
      placementId: input.placement.placementId,
      sessionId: state.sessionId,
      uid: state.uid,
      sequence: state.sequence,
      method: state.method,
      summary: state.summary,
      startsAt: state.startsAt,
      endsAt: state.endsAt,
      location: state.location,
      icsBody: state.icsBody,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    await deps.auth.insertAudit({
      id: uuidv7(),
      eventId: input.placement.eventId,
      actorType: "user",
      actorId: input.actorUserId,
      action: "Comms.IcsForPlacement",
      entityType: "calendar_invite",
      entityId: row.id,
      beforeJson: null,
      afterJson: JSON.stringify({
        uid: row.uid,
        sequence: row.sequence,
        method: row.method,
      }),
      correlationId: input.correlationId,
      createdAt: now,
    });

    return { ok: true, value: { invite: row, state } };
  }

  const updated = await deps.comms.updateCalendarInvite(prior.id, {
    sequence: state.sequence,
    method: state.method,
    summary: state.summary,
    startsAt: state.startsAt,
    endsAt: state.endsAt,
    location: state.location,
    icsBody: state.icsBody,
    sessionId: state.sessionId,
    version: prior.version + 1,
    expectedVersion: prior.version,
    updatedAt: now,
  });
  if (!updated) {
    return {
      ok: false,
      status: 409,
      error: "Calendar invite version conflict",
      code: "CONFLICT",
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.placement.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Comms.IcsForPlacement",
    entityType: "calendar_invite",
    entityId: updated.id,
    beforeJson: JSON.stringify({
      uid: prior.uid,
      sequence: prior.sequence,
      method: prior.method,
    }),
    afterJson: JSON.stringify({
      uid: updated.uid,
      sequence: updated.sequence,
      method: updated.method,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { invite: updated, state } };
}
