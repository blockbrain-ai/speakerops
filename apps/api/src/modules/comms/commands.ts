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
  mergeRichTextValues,
  readRichTextValue,
  richTextIsEmpty,
  richTextToPlainText,
  richTextToEmailHtml,
  type RichTextEnvelope,
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
  type CommsListTemplatesResponse,
  type CommsListJobsResponse,
  type CommsGetJobResponse,
  type CommsListIcsResponse,
  type CommsIcsForPlacementResponse,
  type CalendarInviteDto,
  type MessageRecipientDto,
  type DeliveryEventDto,
  type MessageJobStatus,
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
  IdempotencyKeyConflictError,
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
    // Dual-read (F2): prefer body_rich_json, fall back to legacy body_md as
    // a paragraph doc AT READ TIME — never writes.
    bodyRich: readRichTextValue(row.bodyRichJson ?? null, row.bodyMd),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Rich body column value from an upsert body (F2 dual-write). When the
 * client omits bodyRich (legacy client), the rich column CLEARS so the
 * freshly-sent legacy body text stays authoritative on next read.
 */
function bodyRichJsonFromUpsert(body: CommsUpsertTemplateBody): string | null {
  return body.bodyRich != null && !richTextIsEmpty(body.bodyRich)
    ? JSON.stringify(body.bodyRich)
    : null;
}

function toJobDto(row: MessageJobRow): MessageJobDto {
  return {
    id: row.id,
    eventId: row.eventId,
    templateId: row.templateId,
    status: row.status as MessageJobStatus,
    idempotencyKey: row.idempotencyKey,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toInviteDto(row: CalendarInviteRow): CalendarInviteDto {
  const method =
    row.method === "CANCEL" ? ("CANCEL" as const) : ("REQUEST" as const);
  return {
    id: row.id,
    eventId: row.eventId,
    placementId: row.placementId,
    sessionId: row.sessionId,
    uid: row.uid,
    sequence: row.sequence,
    method,
    summary: row.summary,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    location: row.location,
    icsBody: row.icsBody,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecipientDto(
  row: import("./store.js").MessageRecipientRow,
): MessageRecipientDto {
  return {
    id: row.id,
    jobId: row.jobId,
    eventId: row.eventId,
    participationId: row.participationId,
    toEmail: row.toEmail,
    name: row.name,
    subject: row.subject,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function toDeliveryDto(
  row: import("./store.js").DeliveryEventRow,
): DeliveryEventDto {
  return {
    id: row.id,
    jobId: row.jobId,
    recipientId: row.recipientId,
    eventId: row.eventId,
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    status: row.status,
    attempt: row.attempt,
    error: row.error,
    createdAt: row.createdAt,
  };
}

/**
 * Comms.ListTemplates — admin read for template picker (5.3 UI).
 */
export async function listTemplates(
  deps: CommsCommandDeps,
  input: { eventId: string },
): Promise<CommandOk<CommsListTemplatesResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
  }
  const rows = await deps.comms.listTemplatesForEvent(input.eventId);
  return {
    ok: true,
    value: {
      eventId: input.eventId,
      templates: rows.map(toTemplateDto),
    },
  };
}

/**
 * Comms.ListJobs — delivery log list (5.3 UI / J05).
 */
export async function listJobs(
  deps: CommsCommandDeps,
  input: { eventId: string },
): Promise<CommandOk<CommsListJobsResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
  }
  const rows = await deps.comms.listJobsForEvent(input.eventId);
  // Newest first for admin log
  const sorted = [...rows].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  const jobs = await Promise.all(
    sorted.map(async (j) => {
      const recipients = await deps.comms.listRecipientsForJob(j.id);
      let recipientCount = recipients.length;
      if (recipientCount === 0 && j.recipientsJson) {
        try {
          const snap = JSON.parse(j.recipientsJson) as unknown[];
          if (Array.isArray(snap)) recipientCount = snap.length;
        } catch {
          /* ignore */
        }
      }
      return {
        id: j.id,
        eventId: j.eventId,
        templateId: j.templateId,
        status: j.status as MessageJobStatus,
        idempotencyKey: j.idempotencyKey,
        recipientCount,
        version: j.version,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
      };
    }),
  );
  return { ok: true, value: { eventId: input.eventId, jobs } };
}

/**
 * Comms.GetJob — job detail with recipients + delivery_events (J05).
 */
export async function getJob(
  deps: CommsCommandDeps,
  input: { eventId: string; jobId: string },
): Promise<CommandOk<CommsGetJobResponse> | CommandErr> {
  const job = await deps.comms.findJobById(input.jobId);
  if (!job || job.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Message job not found",
      code: "NOT_FOUND",
    };
  }
  const recipients = await deps.comms.listRecipientsForJob(job.id);
  const deliveryEvents = await deps.comms.listDeliveryEventsForJob(job.id);
  return {
    ok: true,
    value: {
      job: toJobDto(job),
      recipients: recipients.map(toRecipientDto),
      deliveryEvents: deliveryEvents.map(toDeliveryDto),
    },
  };
}

/**
 * Comms.ListIcs — calendar invites for event (J06 ICS attach display).
 */
export async function listIcs(
  deps: CommsCommandDeps,
  input: { eventId: string },
): Promise<CommandOk<CommsListIcsResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
  }
  const rows = await deps.comms.listCalendarInvitesForEvent(input.eventId);
  return {
    ok: true,
    value: {
      eventId: input.eventId,
      invites: rows.map(toInviteDto),
    },
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
  const base =
    (typeof process !== "undefined" &&
      process.env &&
      typeof process.env.APP_PUBLIC_BASE_URL === "string" &&
      process.env.APP_PUBLIC_BASE_URL.trim()) ||
    "";
  const portalUrl = base
    ? `${base.replace(/\/$/, "")}/login?purpose=speaker&eventId=${encodeURIComponent(input.eventId)}`
    : `/login?purpose=speaker&eventId=${encodeURIComponent(input.eventId)}`;
  return {
    name,
    // Alias used by some templates / UI copy (Fable live-visual F2).
    speakerName: name,
    firstName,
    lastName,
    email,
    eventName: input.eventName,
    company: input.company ?? "",
    title: input.title ?? "",
    bio: input.bio ?? "",
    participationId: input.participationId,
    portalUrl,
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
    actorType?: "user" | "api_key";
    actorId?: string;
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
      bodyRichJson: bodyRichJsonFromUpsert(input.body),
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
      actorType: input.actorType ?? "user",
      actorId: input.actorId ?? input.actorUserId,
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
    bodyRichJson: bodyRichJsonFromUpsert(input.body),
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
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
 * Render a template body for one recipient (F2 text + HTML dual-part).
 *
 * Order is load-bearing: merge values are applied IN DOC-SPACE (text nodes)
 * FIRST, then the merged doc is serialized to the plain-text part and the
 * email-HTML part. The HTML serializer escapes every text node, so recipient
 * data (names, bios) can never become markup. Legacy templates without a
 * rich doc dual-read body_md into a paragraph doc — byte-identical text
 * output to the old renderMergeFields path.
 */
function renderTemplateBody(
  template: EmailTemplateRow,
  data: Record<string, string>,
): {
  text: string;
  html: string;
  doc: RichTextEnvelope;
  missingFields: string[];
} {
  const source =
    readRichTextValue(template.bodyRichJson ?? null, template.bodyMd) ??
    // bodyMd is NOT NULL, but keep a total fallback for safety.
    ({ schema: "v1", doc: { type: "doc", content: [] } } as RichTextEnvelope);
  const merged = mergeRichTextValues(source, data);
  return {
    text: richTextToPlainText(merged.envelope),
    html: richTextToEmailHtml(merged.envelope),
    doc: merged.envelope,
    missingFields: merged.missingFields,
  };
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
    actorType?: "user" | "api_key";
    actorId?: string;
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

  const recipients: CommsPreviewResponse["recipients"] = [];
  const bodies: CommsPreviewResponse["bodies"] = [];
  const missingAll = new Set<string>();

  // Decision hand-off audience (Wave 2): recipients are the primary speakers
  // of the exact decision result set — including rejected/waitlisted
  // proposals with no participation yet (participationId stays null).
  if (Array.isArray(segment.submissionIds)) {
    const byId = await deps.submissions.listSubmissionsByIds(
      segment.submissionIds,
    );
    for (const submissionId of segment.submissionIds) {
      const sub = byId.get(submissionId);
      // Event scope: silently drop ids from other events (never leak).
      if (!sub || sub.eventId !== template.eventId) continue;
      const speakerRows = await deps.submissions.listSpeakers(sub.id);
      const primary =
        speakerRows.find((sp) => sp.isPrimary) ?? speakerRows[0] ?? null;
      if (!primary) continue;
      const person = await deps.submissions.findPersonById(primary.personId);
      if (!person?.email) continue;
      const participation = await deps.decisions.findParticipation(
        template.eventId,
        primary.personId,
      );

      const name = person.name ?? "";
      const parts = name.trim().split(/\s+/).filter(Boolean);
      const base =
        (typeof process !== "undefined" &&
          process.env &&
          typeof process.env.APP_PUBLIC_BASE_URL === "string" &&
          process.env.APP_PUBLIC_BASE_URL.trim()) ||
        "";
      const portalUrl = base
        ? `${base.replace(/\/$/, "")}/login?purpose=speaker&eventId=${encodeURIComponent(template.eventId)}`
        : `/login?purpose=speaker&eventId=${encodeURIComponent(template.eventId)}`;
      const data: Record<string, string> = {
        name,
        speakerName: name,
        firstName: parts[0] ?? "",
        lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
        email: person.email,
        eventName: event.name,
        submissionTitle: sub.title,
        company: participation?.company ?? "",
        title: participation?.title ?? "",
        bio: participation?.bio ?? "",
        participationId: participation?.id ?? "",
        portalUrl,
      };

      const subj = renderMergeFields(template.subject, data);
      const body = renderTemplateBody(template, data);
      for (const m of subj.missingFields) missingAll.add(m);
      for (const m of body.missingFields) missingAll.add(m);

      recipients.push({
        participationId: participation?.id ?? null,
        submissionId: sub.id,
        email: person.email,
        name: name || person.email,
      });
      bodies.push({
        participationId: participation?.id ?? null,
        submissionId: sub.id,
        subject: subj.rendered,
        body: body.text,
        bodyHtml: body.html,
        bodyDoc: body.doc,
      });
    }
    return finalizePreview(deps, input, template, segment, {
      recipients,
      bodies,
      missingAll,
    });
  }

  const allParts = await deps.decisions.listParticipationsForEvent(
    template.eventId,
  );

  // Explicit participationIds (including []) overrides status filter.
  // Empty array = intentional empty audience (UI search with zero matches).
  // Absent / undefined = fall back to status (default accepted).
  let selected = allParts;
  if (Array.isArray(segment.participationIds)) {
    const want = new Set(segment.participationIds);
    selected = allParts.filter((p) => want.has(p.id));
  } else {
    const statusFilter = segment.status ?? "accepted";
    selected = allParts.filter((p) => p.status === statusFilter);
  }

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
    const body = renderTemplateBody(template, data);
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
      body: body.text,
      bodyHtml: body.html,
      bodyDoc: body.doc,
    });
  }

  return finalizePreview(deps, input, template, segment, {
    recipients,
    bodies,
    missingAll,
  });
}

/**
 * Shared preview tail — persist the draft job (status=preview) + audit and
 * shape the response. Used by both participation- and submission-derived
 * audiences so trust-before-send stays a single path.
 */
async function finalizePreview(
  deps: CommsCommandDeps,
  input: {
    actorUserId: string;
    actorType?: "user" | "api_key";
    actorId?: string;
    correlationId: string;
  },
  template: EmailTemplateRow,
  segment: CommsSegment,
  computed: {
    recipients: CommsPreviewResponse["recipients"];
    bodies: CommsPreviewResponse["bodies"];
    missingAll: Set<string>;
  },
): Promise<CommandOk<CommsPreviewResponse> | CommandErr> {
  const { recipients, bodies, missingAll } = computed;
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
    calendarInviteId: null,
    createdBy: input.actorUserId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: template.eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
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
    actorType?: "user" | "api_key";
    actorId?: string;
    correlationId: string;
  },
): Promise<CommandOk<CommsSendResponse> | CommandErr> {
  const storageKey = commsSendIdempotencyStorageKey(input.body.idempotencyKey);
  const calendarInviteId = input.body.calendarInviteId ?? null;
  const requestHash = await hashSendRequest({
    previewId: input.body.previewId,
    idempotencyKey: input.body.idempotencyKey,
    calendarInviteId,
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

  if (calendarInviteId) {
    const invites = await deps.comms.listCalendarInvitesForEvent(job.eventId);
    const inviteRow = invites.find((i) => i.id === calendarInviteId) ?? null;
    if (!inviteRow) {
      return {
        ok: false,
        status: 400,
        error: "Calendar invite not found for event",
        code: "VALIDATION_ERROR",
        details: { calendarInviteId },
      };
    }
  }

  const now = new Date().toISOString();
  const nextVersion = job.version + 1;

  // AC-11.2 field-flow / J08: never enqueue a zero-recipient campaign.
  // Preview may intentionally materialize an empty audience (explicit [] or
  // zero search matches); UI blocks send, and the API must too so CLI/API
  // callers cannot create empty outbox jobs.
  const existingRecipients = await deps.comms.listRecipientsForJob(job.id);
  const recipientRows =
    existingRecipients.length > 0
      ? []
      : buildRecipientRows(job, now);
  const effectiveRecipientCount =
    existingRecipients.length > 0
      ? existingRecipients.length
      : recipientRows.length;
  if (effectiveRecipientCount === 0) {
    return {
      ok: false,
      status: 400,
      error: "Cannot send to an empty audience",
      code: "VALIDATION_ERROR",
      details: { recipientCount: 0, previewId: job.id },
    };
  }

  // Provisional DTO for idempotency response payload (status after enqueue).
  const provisionalJob: MessageJobRow = {
    ...job,
    status: "queued",
    idempotencyKey: input.body.idempotencyKey,
    calendarInviteId: calendarInviteId ?? job.calendarInviteId ?? null,
    version: nextVersion,
    updatedAt: now,
  };
  const response: CommsSendResponse = {
    job: toJobDto(provisionalJob),
    enqueued: true,
  };

  // Single transactional unit (E7): job transition + recipients + outbox +
  // idempotency_keys + audit_events. No provider HTTP here.
  // Only a non-null return means *this* call performed the enqueue.
  let updated: MessageJobRow | null;
  try {
    updated = await deps.comms.enqueueSendAtomic(
      {
        jobId: job.id,
        status: "queued",
        idempotencyKey: input.body.idempotencyKey,
        calendarInviteId: calendarInviteId ?? undefined,
        version: nextVersion,
        expectedVersion: job.version,
        updatedAt: now,
        recipients: recipientRows,
        outbox: {
          id: newOutboxEventId(),
          topic: COMMS_OUTBOX_TOPIC,
          payloadJson: JSON.stringify({
            jobId: job.id,
            eventId: job.eventId,
            templateId: job.templateId,
            idempotencyKey: input.body.idempotencyKey,
            correlationId: input.correlationId,
            calendarInviteId: calendarInviteId,
          }),
          createdAt: now,
          processedAt: null,
          attempts: 0,
          lastError: null,
        },
        idempotency: {
          id: newIdempotencyKeyId(),
          key: storageKey,
          requestHash,
          responseJson: JSON.stringify(response),
          createdAt: now,
        },
        audit: {
          id: uuidv7(),
          eventId: job.eventId,
          actorType: input.actorType ?? "user",
          actorId: input.actorId ?? input.actorUserId,
          action: "Comms.Send",
          entityType: "message_job",
          entityId: job.id,
          beforeJson: JSON.stringify({
            status: job.status,
            version: job.version,
          }),
          afterJson: JSON.stringify({
            status: "queued",
            version: nextVersion,
            idempotencyKey: input.body.idempotencyKey,
            outboxTopic: COMMS_OUTBOX_TOPIC,
          }),
          correlationId: input.correlationId,
          createdAt: now,
        },
      },
      (row) => deps.auth.insertAudit(row),
    );
  } catch (err) {
    if (err instanceof IdempotencyKeyConflictError) {
      return {
        ok: false,
        status: 409,
        error: "Idempotency key reused with different request",
        code: "CONFLICT",
        details: { key: input.body.idempotencyKey },
      };
    }
    throw err;
  }

  if (!updated) {
    // Race: concurrent same-key winner (or different-key version CAS).
    // Re-check requestHash so a different-preview race cannot replay as 200.
    const againIdem = await deps.comms.findIdempotencyKey(storageKey);
    if (againIdem) {
      if (againIdem.requestHash !== requestHash) {
        return {
          ok: false,
          status: 409,
          error: "Idempotency key reused with different request",
          code: "CONFLICT",
          details: { key: input.body.idempotencyKey },
        };
      }
      if (againIdem.responseJson) {
        try {
          const cached = JSON.parse(
            againIdem.responseJson,
          ) as CommsSendResponse;
          return { ok: true, value: { ...cached, enqueued: false } };
        } catch {
          // Fall through to job lookup
        }
      }
    }
    const again = await deps.comms.findJobByIdempotencyKey(
      input.body.idempotencyKey,
    );
    if (again) {
      // Same key on a different preview job without matching idem row → 409.
      if (again.id !== job.id) {
        return {
          ok: false,
          status: 409,
          error: "Idempotency key reused with different request",
          code: "CONFLICT",
          details: { key: input.body.idempotencyKey },
        };
      }
      return { ok: true, value: { job: toJobDto(again), enqueued: false } };
    }
    return {
      ok: false,
      status: 409,
      error: "Message job version conflict",
      code: "CONFLICT",
    };
  }

  return {
    ok: true,
    value: {
      job: toJobDto(updated),
      enqueued: true,
    },
  };
}

/** Build message_recipients rows from preview snapshot (no writes). */
function buildRecipientRows(
  job: MessageJobRow,
  now: string,
): import("./store.js").MessageRecipientRow[] {
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
  // Preview writes recipients[] and bodies[] in the same order; zip by index
  // so submission-derived recipients (participationId null) pair correctly.
  return recipients.map((r, i) => {
    const body =
      bodies[i] &&
      bodies[i]!.participationId === r.participationId &&
      (bodies[i]!.submissionId ?? null) === (r.submissionId ?? null)
        ? bodies[i]!
        : bodies.find(
            (b) =>
              b.participationId === r.participationId &&
              (b.submissionId ?? null) === (r.submissionId ?? null),
          );
    return {
      id: newMessageRecipientId(),
      jobId: job.id,
      eventId: job.eventId,
      participationId: r.participationId,
      toEmail: r.email,
      name: r.name,
      subject: body?.subject ?? null,
      body: body?.body ?? null,
      bodyHtml: body?.bodyHtml ?? null,
      status: "queued",
      createdAt: now,
    };
  });
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
    actorType?: "user" | "api_key";
    actorId?: string;
    correlationId: string;
    cancel?: boolean;
  },
): Promise<
  | CommandOk<{
      invite: CalendarInviteRow;
      state: CalendarInviteState;
      response: CommsIcsForPlacementResponse;
    }>
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
      actorType: input.actorType ?? "user",
      actorId: input.actorId ?? input.actorUserId,
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

    return {
      ok: true,
      value: {
        invite: row,
        state,
        response: { invite: toInviteDto(row) },
      },
    };
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
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
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

  return {
    ok: true,
    value: {
      invite: updated,
      state,
      response: { invite: toInviteDto(updated) },
    },
  };
}
