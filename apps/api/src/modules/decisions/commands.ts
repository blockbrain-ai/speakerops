/**
 * Decision domain commands (section 3.5 / S-EVAL accept path).
 *
 * Decision.Record · Session.CreateDirect · Submission.List · Submission.Get
 * · bulk preview
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  type DecisionRecordBody,
  type DecisionValue,
  type DecisionDto,
  type ProgramSessionDto,
  type EventParticipationDto,
  type SpeakerTaskDto,
  type SubmissionDto,
  type SubmissionListItem,
  type DirectSessionBody,
  type SubmissionStatus,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore, SubmissionRow } from "../publicCfp/store.js";
import {
  type DecisionsStore,
  type DecisionRow,
  type ProgramSessionRow,
  type ParticipationRow,
  type SpeakerTaskRow,
  type TaskTemplateRow,
  newDecisionId,
  newParticipationId,
  newProgramSessionId,
  newSpeakerTaskId,
  newTaskTemplateId,
} from "./store.js";

export type DecisionCommandDeps = {
  decisions: DecisionsStore;
  events: EventsStore;
  auth: AuthStore;
  submissions: SubmissionsStore;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

function decisionToStatus(decision: DecisionValue): SubmissionStatus {
  if (decision === "accept") return "accepted";
  if (decision === "reject") return "rejected";
  return "waitlist";
}

function toDecisionDto(row: DecisionRow): DecisionDto {
  return {
    id: row.id,
    submissionId: row.submissionId,
    decision: row.decision,
    reason: row.reason,
    decidedBy: row.decidedBy,
    createdAt: row.createdAt,
  };
}

function toSessionDto(row: ProgramSessionRow): ProgramSessionDto {
  return {
    id: row.id,
    eventId: row.eventId,
    sourceSubmissionId: row.sourceSubmissionId,
    title: row.title,
    description: row.description,
    trackId: row.trackId,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toParticipationDto(row: ParticipationRow): EventParticipationDto {
  return {
    id: row.id,
    eventId: row.eventId,
    personId: row.personId,
    userId: row.userId,
    roleLabel: row.roleLabel,
    status: row.status,
    version: row.version,
  };
}

function toTaskDto(row: SpeakerTaskRow): SpeakerTaskDto {
  return {
    id: row.id,
    templateId: row.templateId,
    participationId: row.participationId,
    status: row.status,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    version: row.version,
  };
}

function toSubmissionDto(row: SubmissionRow): SubmissionDto {
  return {
    id: row.id,
    eventId: row.eventId,
    formVersionId: row.formVersionId,
    title: row.title,
    category: row.category,
    status: row.status as SubmissionStatus,
    submittedAt: row.submittedAt,
    version: row.version,
  };
}

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * Ensure event has on_accept templates so accept materializes tasks in dogfood.
 * Only seeds when zero on_accept templates exist (tests may pre-seed exact sets).
 */
async function ensureOnAcceptTemplates(
  deps: DecisionCommandDeps,
  eventId: string,
  now: string,
): Promise<TaskTemplateRow[]> {
  const existing = await deps.decisions.listTaskTemplates(eventId, "on_accept");
  if (existing.length > 0) return existing;

  const defaults: Array<{ title: string; description: string; due: number }> = [
    {
      title: "Upload headshot",
      description: "Provide a high-resolution speaker headshot.",
      due: 14,
    },
    {
      title: "Confirm bio",
      description: "Review and confirm your speaker biography.",
      due: 14,
    },
  ];
  const created: TaskTemplateRow[] = [];
  for (const d of defaults) {
    const row = await deps.decisions.insertTaskTemplate({
      id: newTaskTemplateId(),
      eventId,
      title: d.title,
      description: d.description,
      trigger: "on_accept",
      dueOffsetDays: d.due,
      createdAt: now,
    });
    created.push(row);
  }
  return created;
}

async function materializeAccept(
  deps: DecisionCommandDeps,
  input: {
    submission: SubmissionRow;
    eventId: string;
    orgId: string;
    now: string;
  },
): Promise<{
  session: ProgramSessionRow;
  participations: ParticipationRow[];
  tasks: SpeakerTaskRow[];
}> {
  const { submission, eventId, orgId, now } = input;

  // Idempotent: reuse session if already materialized for this submission
  let session = await deps.decisions.findSessionBySubmission(submission.id);
  if (!session) {
    session = await deps.decisions.insertSession({
      id: newProgramSessionId(),
      eventId,
      sourceSubmissionId: submission.id,
      title: submission.title,
      description: null,
      trackId: null,
      status: "confirmed",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  const speakers = await deps.submissions.listSpeakers(submission.id);
  const participations: ParticipationRow[] = [];

  for (const sp of speakers) {
    let part = await deps.decisions.findParticipation(eventId, sp.personId);
    if (!part) {
      // Ensure person exists (should from CFP)
      const person = await deps.submissions.findPersonById(sp.personId);
      if (!person) {
        // Orphan speaker row — skip
        continue;
      }
      void orgId;
      part = await deps.decisions.insertParticipation({
        id: newParticipationId(),
        eventId,
        personId: sp.personId,
        userId: null,
        roleLabel: "speaker",
        status: "accepted",
        bio: null,
        company: null,
        title: null,
        headshotFileId: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    participations.push(part);
    await deps.decisions.insertSessionSpeaker({
      sessionId: session.id,
      participationId: part.id,
      isPrimary: sp.isPrimary,
    });
  }

  const templates = await ensureOnAcceptTemplates(deps, eventId, now);
  const tasks: SpeakerTaskRow[] = [];

  for (const part of participations) {
    for (const tpl of templates) {
      const existing = await deps.decisions.findSpeakerTask(tpl.id, part.id);
      if (existing) {
        tasks.push(existing);
        continue;
      }
      const task = await deps.decisions.insertSpeakerTask({
        id: newSpeakerTaskId(),
        templateId: tpl.id,
        participationId: part.id,
        status: "pending",
        dueAt: addDaysIso(now, tpl.dueOffsetDays),
        completedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      tasks.push(task);
    }
  }

  return { session, participations, tasks };
}

export type RecordDecisionInput = DecisionRecordBody & {
  submissionId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Decision.Record — accept | reject | waitlist.
 * Accept materializes session + session_speakers + speaker_tasks from templates.
 * Second accept is idempotent (no duplicate session/tasks).
 */
export async function recordDecision(
  deps: DecisionCommandDeps,
  input: RecordDecisionInput,
): Promise<
  CommandOk<{
    decision: DecisionDto;
    submission: SubmissionDto;
    session: ProgramSessionDto | null;
    tasks: SpeakerTaskDto[];
    participations: EventParticipationDto[];
    idempotent: boolean;
  }> | CommandErr
> {
  const submission = await deps.submissions.findSubmissionById(
    input.submissionId,
  );
  if (!submission) {
    return {
      ok: false,
      status: 404,
      error: "Submission not found",
      code: "NOT_FOUND",
    };
  }

  if (
    input.expectedVersion !== undefined &&
    submission.version !== input.expectedVersion
  ) {
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion,
        actual: submission.version,
      },
    };
  }

  const existingDecision = await deps.decisions.findDecisionBySubmission(
    submission.id,
  );

  // Idempotent accept: same decision already recorded
  if (
    existingDecision &&
    existingDecision.decision === input.decision &&
    input.decision === "accept"
  ) {
    const session = await deps.decisions.findSessionBySubmission(
      submission.id,
    );
    const speakers = session
      ? await deps.decisions.listSessionSpeakers(session.id)
      : [];
    const partIds = speakers.map((s) => s.participationId);
    const tasks =
      await deps.decisions.listSpeakerTasksForParticipations(partIds);
    const participations: ParticipationRow[] = [];
    for (const id of partIds) {
      const p = await deps.decisions.findParticipationById(id);
      if (p) participations.push(p);
    }
    return {
      ok: true,
      value: {
        decision: toDecisionDto(existingDecision),
        submission: toSubmissionDto(submission),
        session: session ? toSessionDto(session) : null,
        tasks: tasks.map(toTaskDto),
        participations: participations.map(toParticipationDto),
        idempotent: true,
      },
    };
  }

  const event = await deps.events.findEventById(submission.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }

  const now = new Date().toISOString();
  const nextStatus = decisionToStatus(input.decision);
  const nextVersion = submission.version + 1;

  const updated = await deps.submissions.updateSubmission(
    submission.id,
    { status: nextStatus, version: nextVersion },
    submission.version,
  );
  if (!updated) {
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: submission.version,
        actual: "changed",
      },
    };
  }

  const decisionRow = await deps.decisions.upsertDecision({
    id: existingDecision?.id ?? newDecisionId(),
    submissionId: submission.id,
    decision: input.decision,
    reason: input.reason ?? null,
    decidedBy: input.actorUserId,
    createdAt: now,
  });

  let sessionDto: ProgramSessionDto | null = null;
  let tasks: SpeakerTaskDto[] = [];
  let participations: EventParticipationDto[] = [];

  if (input.decision === "accept") {
    const mat = await materializeAccept(deps, {
      submission: updated,
      eventId: event.id,
      orgId: event.orgId,
      now,
    });
    sessionDto = toSessionDto(mat.session);
    tasks = mat.tasks.map(toTaskDto);
    participations = mat.participations.map(toParticipationDto);
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: submission.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Decision.Record",
    entityType: "submission",
    entityId: submission.id,
    beforeJson: JSON.stringify({
      status: submission.status,
      version: submission.version,
      priorDecision: existingDecision?.decision ?? null,
    }),
    afterJson: JSON.stringify({
      decision: input.decision,
      reason: input.reason ?? null,
      status: nextStatus,
      version: nextVersion,
      sessionId: sessionDto?.id ?? null,
      taskCount: tasks.length,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      decision: toDecisionDto(decisionRow),
      submission: toSubmissionDto(updated),
      session: sessionDto,
      tasks,
      participations,
      idempotent: false,
    },
  };
}

export type CreateDirectSessionInput = DirectSessionBody & {
  eventId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Direct/sponsor session entry without CFP submission (E07).
 */
export async function createDirectSession(
  deps: DecisionCommandDeps,
  input: CreateDirectSessionInput,
): Promise<
  CommandOk<{
    session: ProgramSessionDto;
    participations: EventParticipationDto[];
    tasks: SpeakerTaskDto[];
  }> | CommandErr
> {
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
  const session = await deps.decisions.insertSession({
    id: newProgramSessionId(),
    eventId: event.id,
    sourceSubmissionId: null,
    title: input.title,
    description: input.description ?? null,
    trackId: input.trackId ?? null,
    status: "confirmed",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  const participations: ParticipationRow[] = [];
  const speakers = input.speakers ?? [];
  let index = 0;
  for (const sp of speakers) {
    const email = sp.email.toLowerCase();
    let person = await deps.submissions.findPersonByOrgEmail(
      event.orgId,
      email,
    );
    if (!person) {
      person = await deps.submissions.insertPerson({
        id: uuidv7(),
        orgId: event.orgId,
        email,
        name: sp.name,
        createdAt: now,
        updatedAt: now,
      });
    } else if (person.name !== sp.name) {
      await deps.submissions.updatePersonName(person.id, sp.name, now);
    }

    let part = await deps.decisions.findParticipation(event.id, person.id);
    if (!part) {
      part = await deps.decisions.insertParticipation({
        id: newParticipationId(),
        eventId: event.id,
        personId: person.id,
        userId: null,
        roleLabel: "speaker",
        status: "accepted",
        bio: null,
        company: null,
        title: null,
        headshotFileId: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    participations.push(part);
    const isPrimary =
      sp.isPrimary === true || (sp.isPrimary !== false && index === 0);
    await deps.decisions.insertSessionSpeaker({
      sessionId: session.id,
      participationId: part.id,
      isPrimary,
    });
    index++;
  }

  const templates = await ensureOnAcceptTemplates(deps, event.id, now);
  const tasks: SpeakerTaskRow[] = [];
  for (const part of participations) {
    for (const tpl of templates) {
      const existing = await deps.decisions.findSpeakerTask(tpl.id, part.id);
      if (existing) {
        tasks.push(existing);
        continue;
      }
      tasks.push(
        await deps.decisions.insertSpeakerTask({
          id: newSpeakerTaskId(),
          templateId: tpl.id,
          participationId: part.id,
          status: "pending",
          dueAt: addDaysIso(now, tpl.dueOffsetDays),
          completedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: event.id,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Session.CreateDirect",
    entityType: "session",
    entityId: session.id,
    afterJson: JSON.stringify({
      title: session.title,
      participationIds: participations.map((p) => p.id),
      taskCount: tasks.length,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      session: toSessionDto(session),
      participations: participations.map(toParticipationDto),
      tasks: tasks.map(toTaskDto),
    },
  };
}

/**
 * Submission.List — admin filters by status/category (E01).
 * Event row may be absent for synthetic bootstrap memberships (evt_dogfood);
 * list is still event-scoped by id (empty when no rows).
 */
export async function listSubmissions(
  deps: DecisionCommandDeps,
  input: {
    eventId: string;
    status?: SubmissionStatus;
    category?: string;
  },
): Promise<CommandOk<{ submissions: SubmissionListItem[] }> | CommandErr> {
  // Prefer real event; bootstrap-only memberships have no row — still list by id.
  void (await deps.events.findEventById(input.eventId));

  let rows = await deps.submissions.listSubmissionsForEvent(input.eventId);
  if (input.status) {
    rows = rows.filter((r) => r.status === input.status);
  }
  if (input.category) {
    rows = rows.filter((r) => r.category === input.category);
  }

  const items: SubmissionListItem[] = [];
  for (const r of rows) {
    const speakers = await deps.submissions.listSpeakers(r.id);
    const primary =
      speakers.find((s) => s.isPrimary) ??
      speakers.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0];
    let primarySpeakerName: string | null = null;
    if (primary) {
      const person = await deps.submissions.findPersonById(primary.personId);
      primarySpeakerName = person?.name ?? null;
    }
    items.push({
      id: r.id,
      eventId: r.eventId,
      formVersionId: r.formVersionId,
      title: r.title,
      category: r.category,
      status: r.status as SubmissionStatus,
      submittedAt: r.submittedAt,
      version: r.version,
      primarySpeakerName,
    });
  }

  // Stable order: newest submitted first
  items.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  return { ok: true, value: { submissions: items } };
}

/**
 * Submission.Get — detail with answers, speakers, decision, session (E02).
 */
export async function getSubmission(
  deps: DecisionCommandDeps,
  submissionId: string,
): Promise<
  CommandOk<{
    submission: SubmissionDto;
    answers: Array<{ fieldKey: string; value: unknown }>;
    speakers: Array<{
      personId: string;
      name: string;
      email: string;
      isPrimary: boolean;
      sortOrder: number;
    }>;
    decision: DecisionDto | null;
    session: ProgramSessionDto | null;
  }> | CommandErr
> {
  const submission = await deps.submissions.findSubmissionById(submissionId);
  if (!submission) {
    return {
      ok: false,
      status: 404,
      error: "Submission not found",
      code: "NOT_FOUND",
    };
  }

  const answerRows = await deps.submissions.listAnswers(submissionId);
  const answers = answerRows.map((a) => {
    let value: unknown = a.valueJson;
    try {
      value = JSON.parse(a.valueJson) as unknown;
    } catch {
      value = a.valueJson;
    }
    return { fieldKey: a.fieldKey, value };
  });

  const speakerRows = await deps.submissions.listSpeakers(submissionId);
  const speakers = [];
  for (const s of speakerRows) {
    const person = await deps.submissions.findPersonById(s.personId);
    speakers.push({
      personId: s.personId,
      name: person?.name ?? "",
      email: person?.email ?? "",
      isPrimary: s.isPrimary,
      sortOrder: s.sortOrder,
    });
  }
  speakers.sort((a, b) => a.sortOrder - b.sortOrder);

  const decision = await deps.decisions.findDecisionBySubmission(submissionId);
  const session =
    await deps.decisions.findSessionBySubmission(submissionId);

  return {
    ok: true,
    value: {
      submission: toSubmissionDto(submission),
      answers,
      speakers,
      decision: decision ? toDecisionDto(decision) : null,
      session: session ? toSessionDto(session) : null,
    },
  };
}

/**
 * Bulk decision preview (E08) — no writes; empty selection rejected by Zod min(1).
 */
export async function previewBulkDecision(
  deps: DecisionCommandDeps,
  input: {
    eventId: string;
    submissionIds: string[];
    decision: DecisionValue;
  },
): Promise<
  CommandOk<{
    decision: DecisionValue;
    items: Array<{
      submissionId: string;
      title: string;
      currentStatus: SubmissionStatus;
      nextStatus: SubmissionStatus;
    }>;
    count: number;
  }> | CommandErr
> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }

  if (input.submissionIds.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Empty selection",
      code: "VALIDATION_ERROR",
    };
  }

  const nextStatus = decisionToStatus(input.decision);
  const items: Array<{
    submissionId: string;
    title: string;
    currentStatus: SubmissionStatus;
    nextStatus: SubmissionStatus;
  }> = [];

  for (const id of input.submissionIds) {
    const sub = await deps.submissions.findSubmissionById(id);
    if (!sub || sub.eventId !== input.eventId) {
      return {
        ok: false,
        status: 400,
        error: "Submission not in event",
        code: "VALIDATION_ERROR",
        details: { submissionId: id },
      };
    }
    items.push({
      submissionId: sub.id,
      title: sub.title,
      currentStatus: sub.status as SubmissionStatus,
      nextStatus,
    });
  }

  return {
    ok: true,
    value: {
      decision: input.decision,
      items,
      count: items.length,
    },
  };
}
