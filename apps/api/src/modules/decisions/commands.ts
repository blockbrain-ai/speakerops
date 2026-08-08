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

/**
 * Materialize accept side effects (session, speakers, participations, tasks).
 * Fully idempotent and safe to re-run after a partial failure so retries repair
 * missing artifacts instead of returning early without side effects.
 */
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
  } else if (session.status !== "confirmed") {
    // Re-accept after reject/waitlist: reactivate cancelled program session
    const reactivated = await deps.decisions.updateSession(session.id, {
      status: "confirmed",
      version: session.version + 1,
      updatedAt: now,
    });
    if (reactivated) session = reactivated;
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
    } else if (part.status !== "accepted") {
      const updated = await deps.decisions.updateParticipation(part.id, {
        status: "accepted",
        version: part.version + 1,
        updatedAt: now,
      });
      if (updated) part = updated;
    }
    participations.push(part);
    const existingLinks = await deps.decisions.listSessionSpeakers(session.id);
    if (!existingLinks.some((l) => l.participationId === part.id)) {
      await deps.decisions.insertSessionSpeaker({
        sessionId: session.id,
        participationId: part.id,
        isPrimary: sp.isPrimary,
      });
    }
  }

  const templates = await ensureOnAcceptTemplates(deps, eventId, now);
  const tasks: SpeakerTaskRow[] = [];

  for (const part of participations) {
    for (const tpl of templates) {
      const existing = await deps.decisions.findSpeakerTask(tpl.id, part.id);
      if (existing) {
        // Reactivate cancelled tasks on re-accept
        if (existing.status === "cancelled") {
          const revived = await deps.decisions.updateSpeakerTask(existing.id, {
            status: "pending",
            version: existing.version + 1,
            updatedAt: now,
            completedAt: null,
          });
          tasks.push(revived ?? existing);
          continue;
        }
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

/**
 * Invalidate accept-materialized program artifacts when decision moves off accept.
 * Session → cancelled; session_speakers removed; on_accept tasks cancelled;
 * participations that have no other confirmed session speakers → withdrawn.
 */
async function dematerializeAccept(
  deps: DecisionCommandDeps,
  input: {
    submissionId: string;
    eventId: string;
    now: string;
  },
): Promise<void> {
  const session = await deps.decisions.findSessionBySubmission(
    input.submissionId,
  );
  if (!session) return;

  const speakers = await deps.decisions.listSessionSpeakers(session.id);
  const partIds = speakers.map((s) => s.participationId);

  // Cancel speaker tasks tied to these participations
  if (partIds.length > 0) {
    const tasks =
      await deps.decisions.listSpeakerTasksForParticipations(partIds);
    for (const t of tasks) {
      if (t.status === "cancelled") continue;
      await deps.decisions.updateSpeakerTask(t.id, {
        status: "cancelled",
        version: t.version + 1,
        updatedAt: input.now,
        completedAt: t.completedAt,
      });
    }
  }

  // Drop session_speakers so the session no longer exposes accepted speakers
  await deps.decisions.deleteSessionSpeakers(session.id);

  if (session.status !== "cancelled") {
    await deps.decisions.updateSession(session.id, {
      status: "cancelled",
      version: session.version + 1,
      updatedAt: input.now,
    });
  }

  // Withdraw participations that are no longer on any confirmed session
  for (const partId of partIds) {
    const part = await deps.decisions.findParticipationById(partId);
    if (!part || part.status === "withdrawn") continue;

    const eventSessions = await deps.decisions.listSessionsForEvent(
      input.eventId,
    );
    let stillLinked = false;
    for (const s of eventSessions) {
      if (s.status !== "confirmed" || s.id === session.id) continue;
      const links = await deps.decisions.listSessionSpeakers(s.id);
      if (links.some((l) => l.participationId === partId)) {
        stillLinked = true;
        break;
      }
    }
    if (!stillLinked) {
      await deps.decisions.updateParticipation(partId, {
        status: "withdrawn",
        version: part.version + 1,
        updatedAt: input.now,
      });
    }
  }
}

/** Active (non-cancelled) session for a submission, if any. */
async function findActiveSessionForSubmission(
  deps: DecisionCommandDeps,
  submissionId: string,
): Promise<ProgramSessionRow | null> {
  const session = await deps.decisions.findSessionBySubmission(submissionId);
  if (!session || session.status === "cancelled") return null;
  return session;
}

export type RecordDecisionInput = DecisionRecordBody & {
  submissionId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Decision.Record — accept | reject | waitlist.
 *
 * Ordering for partial-failure safety:
 * 1. Accept: materialize session/tasks first (idempotent), then optimistic
 *    submission update + decision + audit. A retry after materialize-only
 *    failure re-runs materialize and completes the write path.
 * 2. Same accept already recorded: still re-runs materialize to repair any
 *    missing side effects, then returns idempotent=true.
 * 3. Accept → reject/waitlist: dematerialize session/speakers/tasks before
 *    updating status so program artifacts are not left exposed.
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

  // Idempotent accept: same decision already recorded — repair side effects if incomplete
  if (
    existingDecision &&
    existingDecision.decision === input.decision &&
    input.decision === "accept" &&
    submission.status === "accepted"
  ) {
    const mat = await materializeAccept(deps, {
      submission,
      eventId: event.id,
      orgId: event.orgId,
      now,
    });
    return {
      ok: true,
      value: {
        decision: toDecisionDto(existingDecision),
        submission: toSubmissionDto(submission),
        session: toSessionDto(mat.session),
        tasks: mat.tasks.map(toTaskDto),
        participations: mat.participations.map(toParticipationDto),
        idempotent: true,
      },
    };
  }

  const nextStatus = decisionToStatus(input.decision);
  const nextVersion = submission.version + 1;

  let sessionDto: ProgramSessionDto | null = null;
  let tasks: SpeakerTaskDto[] = [];
  let participations: EventParticipationDto[] = [];

  // Accept: materialize BEFORE mutating submission so a crash mid-materialize
  // never leaves status=accepted without program artifacts. Retries repair.
  if (input.decision === "accept") {
    const mat = await materializeAccept(deps, {
      submission,
      eventId: event.id,
      orgId: event.orgId,
      now,
    });
    sessionDto = toSessionDto(mat.session);
    tasks = mat.tasks.map(toTaskDto);
    participations = mat.participations.map(toParticipationDto);
  } else if (
    existingDecision?.decision === "accept" ||
    submission.status === "accepted"
  ) {
    // Leaving accept: invalidate previously materialized program artifacts
    await dematerializeAccept(deps, {
      submissionId: submission.id,
      eventId: event.id,
      now,
    });
  }

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
  // Do not expose cancelled accept-session artifacts on rejected/waitlisted rows
  const session = await findActiveSessionForSubmission(deps, submissionId);

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
