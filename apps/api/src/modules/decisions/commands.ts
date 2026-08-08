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
      version: 1,
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
 * True when participation remains on another confirmed program session
 * (excluding `excludeSessionId`). Tasks are unique per template+participation,
 * so they must only be cancelled when the speaker is no longer linked elsewhere.
 */
async function participationStillOnConfirmedSession(
  deps: DecisionCommandDeps,
  input: {
    eventId: string;
    participationId: string;
    excludeSessionId: string;
  },
): Promise<boolean> {
  const eventSessions = await deps.decisions.listSessionsForEvent(
    input.eventId,
  );
  for (const s of eventSessions) {
    if (s.status !== "confirmed" || s.id === input.excludeSessionId) continue;
    const links = await deps.decisions.listSessionSpeakers(s.id);
    if (links.some((l) => l.participationId === input.participationId)) {
      return true;
    }
  }
  return false;
}

/**
 * Invalidate accept-materialized program artifacts when decision moves off accept.
 * Session → cancelled; session_speakers removed.
 * Tasks and participations are only cancelled/withdrawn when the speaker is not
 * still linked to another confirmed session (another accepted talk or direct
 * sponsor session). Cancel-all-tasks-before-link-check would break shared
 * participation tasks still required by remaining sessions.
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

  // Drop session_speakers so this session no longer exposes accepted speakers
  // before checking remaining links (exclude this session once cancelled).
  await deps.decisions.deleteSessionSpeakers(session.id);

  if (session.status !== "cancelled") {
    await deps.decisions.updateSession(session.id, {
      status: "cancelled",
      version: session.version + 1,
      updatedAt: input.now,
    });
  }

  // Withdraw / cancel tasks only for participations with no remaining confirmed session
  for (const partId of partIds) {
    const stillLinked = await participationStillOnConfirmedSession(deps, {
      eventId: input.eventId,
      participationId: partId,
      excludeSessionId: session.id,
    });
    if (stillLinked) continue;

    const tasks = await deps.decisions.listSpeakerTasksForParticipations([
      partId,
    ]);
    for (const t of tasks) {
      if (t.status === "cancelled") continue;
      await deps.decisions.updateSpeakerTask(t.id, {
        status: "cancelled",
        version: t.version + 1,
        updatedAt: input.now,
        completedAt: t.completedAt,
      });
    }

    const part = await deps.decisions.findParticipationById(partId);
    if (!part || part.status === "withdrawn") continue;
    await deps.decisions.updateParticipation(partId, {
      status: "withdrawn",
      version: part.version + 1,
      updatedAt: input.now,
    });
  }
}

/**
 * Ensure a Decision.Record audit exists for the *current* decision + reason (E3).
 * Idempotent retries repair a missing audit when decision/submission already
 * persisted but audit insert failed. Skips only when the latest Decision.Record
 * audit already records the same decision *and* reason — a same-decision reason
 * update that lost its audit must still get a repair row (re-decide / reason
 * changes keep a full trail via the non-idempotent insert path).
 */
async function ensureDecisionAudit(
  deps: DecisionCommandDeps,
  input: {
    submissionId: string;
    eventId: string;
    actorUserId: string;
    correlationId: string;
    now: string;
    before: {
      status: string;
      version: number;
      priorDecision: string | null;
    };
    after: {
      decision: DecisionValue;
      reason: string | null;
      status: SubmissionStatus;
      version: number;
      sessionId: string | null;
      taskCount: number;
    };
  },
): Promise<void> {
  const existing = await deps.auth.findAuditByActionAndEntity(
    "Decision.Record",
    "submission",
    input.submissionId,
  );
  if (existing?.afterJson) {
    try {
      const after = JSON.parse(existing.afterJson) as {
        decision?: string;
        reason?: string | null;
      };
      const auditReason = after.reason ?? null;
      if (
        after.decision === input.after.decision &&
        auditReason === input.after.reason
      ) {
        return;
      }
    } catch {
      // fall through to insert
    }
  } else if (existing) {
    // Legacy/empty afterJson — treat as present for this entity action
    return;
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Decision.Record",
    entityType: "submission",
    entityId: input.submissionId,
    beforeJson: JSON.stringify(input.before),
    afterJson: JSON.stringify(input.after),
    correlationId: input.correlationId,
    createdAt: input.now,
  });
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
 * Ordering for concurrency + partial-failure safety:
 * 1. Optimistic submission status update FIRST when status must change (claims
 *    the version race). Side effects only run after the claim so a concurrent
 *    loser never materializes a session for a non-accepted submission.
 * 2. Accept: materialize session/tasks (idempotent; unique source_submission_id).
 *    Reject/waitlist after accept: dematerialize (tasks only if speaker free).
 * 3. Upsert decision (reason is contract input — reject/waitlist reason updates
 *    are not silently dropped), then write audit.
 * 4. Same decision + same reason already recorded + status matches: re-run
 *    side-effect repair + ensure audit, return idempotent=true without bumping.
 * 5. Partial apply repair: if status already matches the target decision but a
 *    later write failed (missing decision row, or decision value still previous
 *    after accept↔reject), retries (including with the original expectedVersion)
 *    complete remaining artifacts/decision/audit instead of hard-409. Stale
 *    expectedVersion with same decision but a *different* reason is a real
 *    conflict (E1), not a repair.
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
  const nextStatus = decisionToStatus(input.decision);
  const nextReason = input.reason ?? null;

  const statusAlreadyTarget = submission.status === nextStatus;
  const decisionMatches =
    existingDecision != null && existingDecision.decision === input.decision;
  const reasonMatches =
    existingDecision != null && existingDecision.reason === nextReason;

  // Version conflict — allow repair when a prior attempt already advanced status
  // toward this decision (partial apply; client still holds pre-claim version).
  // Repairable:
  //   - decision row missing (claim succeeded, upsert failed)
  //   - decision value still stale after status flip (accept↔reject partial)
  //   - same decision + same reason (idempotent retry with stale expectedVersion)
  // NOT repairable (E1): same decision, different reason — concurrent reason
  // update must lose on stale expectedVersion rather than overwrite.
  if (
    input.expectedVersion !== undefined &&
    submission.version !== input.expectedVersion
  ) {
    const repairablePartial =
      statusAlreadyTarget &&
      (!existingDecision || !decisionMatches || reasonMatches);
    if (!repairablePartial) {
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
  }

  // Pure idempotent: same decision + reason + matching status → repair only
  if (decisionMatches && statusAlreadyTarget && reasonMatches) {
    let sessionDto: ProgramSessionDto | null = null;
    let tasks: SpeakerTaskDto[] = [];
    let participations: EventParticipationDto[] = [];

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
    } else {
      // Repair: prior accept→reject may have crashed before dematerialize
      await dematerializeAccept(deps, {
        submissionId: submission.id,
        eventId: event.id,
        now,
      });
    }

    await ensureDecisionAudit(deps, {
      submissionId: submission.id,
      eventId: submission.eventId,
      actorUserId: input.actorUserId,
      correlationId: input.correlationId,
      now,
      before: {
        status: submission.status,
        version: submission.version,
        priorDecision: existingDecision!.decision,
      },
      after: {
        decision: input.decision,
        reason: nextReason,
        status: nextStatus,
        version: submission.version,
        sessionId: sessionDto?.id ?? null,
        taskCount: tasks.length,
      },
    });

    return {
      ok: true,
      value: {
        decision: toDecisionDto(existingDecision!),
        submission: toSubmissionDto(submission),
        session: sessionDto,
        tasks,
        participations,
        idempotent: true,
      },
    };
  }

  // Claim version/status when transitioning, or when updating reason on an
  // already-applied same decision. Skip re-claim when repairing a partial where
  // status already matches and the decision row is still missing.
  let updated = submission;
  let nextVersion = submission.version;
  const needsStatusClaim =
    !statusAlreadyTarget || (decisionMatches && !reasonMatches);

  if (needsStatusClaim) {
    nextVersion = submission.version + 1;
    const claimed = await deps.submissions.updateSubmission(
      submission.id,
      { status: nextStatus, version: nextVersion },
      submission.version,
    );
    if (!claimed) {
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
    updated = claimed;
  }

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
  } else {
    // Leaving accept (or repairing): invalidate program artifacts for this submission
    await dematerializeAccept(deps, {
      submissionId: submission.id,
      eventId: event.id,
      now,
    });
  }

  const decisionRow = await deps.decisions.upsertDecision({
    id: existingDecision?.id ?? newDecisionId(),
    submissionId: submission.id,
    decision: input.decision,
    reason: nextReason,
    decidedBy: input.actorUserId,
    createdAt: now,
  });

  // Real transitions and reason updates insert a full audit trail.
  // Pure idempotent retries (above) only ensure a missing audit row.
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
      priorReason: existingDecision?.reason ?? null,
    }),
    afterJson: JSON.stringify({
      decision: input.decision,
      reason: nextReason,
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
