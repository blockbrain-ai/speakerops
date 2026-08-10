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
  SUBMISSION_LIST_DEFAULT_LIMIT,
  SUBMISSION_LIST_MAX_LIMIT,
  SubmissionStatusSchema,
  isSubmissionDecisionSource,
  csvEscapeField,
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
import type { FormsStore } from "../forms/store.js";
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
  /** Optional — when present, Submission.Get enriches answers with form labels. */
  forms?: FormsStore;
  /**
   * Optional program invite after accept (magic link outbox).
   * When set, accepted speakers with email receive a speaker-purpose invite.
   */
  programInvite?: {
    issue: (input: {
      email: string;
      userId: string;
      eventId: string;
      correlationId: string;
    }) => Promise<unknown>;
    correlationId?: string;
  } | null;
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
      linkUrl: null,
      required: false,
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
    // Ensure person exists (should from CFP)
    const person = await deps.submissions.findPersonById(sp.personId);
    if (!person) {
      // Orphan speaker row — skip
      continue;
    }
    void orgId;

    // Provision auth user + bind participation (closed accept → portal loop).
    let boundUserId: string | null = null;
    const personEmail = (person.email ?? "").trim().toLowerCase();
    if (personEmail.includes("@")) {
      let user = await deps.auth.findUserByEmail(personEmail);
      if (!user) {
        user = await deps.auth.createUser({ email: personEmail });
      }
      boundUserId = user.id;
      // Single-role membership: grant speaker only when no row; never demote.
      const existingMem = await deps.auth.findMembership(eventId, user.id);
      if (!existingMem) {
        await deps.auth.upsertMembership({
          eventId,
          userId: user.id,
          role: "speaker",
        });
      }
      if (deps.programInvite) {
        try {
          await deps.programInvite.issue({
            email: personEmail,
            userId: user.id,
            eventId,
            correlationId:
              deps.programInvite.correlationId ?? `accept-${submission.id}`,
          });
        } catch {
          // Provisioning must not fail accept if invite enqueue fails.
        }
      }
    }

    // Wave 2 speaker-info seeding: the CFP "About this speaker" fields on the
    // submission speaker row pre-fill the participation profile. Seeds fill
    // ONLY empty profile fields — a non-empty bio/company/title is never
    // overwritten (speakers and admins own their profile edits).
    const seedBio = sp.bio?.trim() ? sp.bio.trim() : null;
    const seedCompany = sp.company?.trim() ? sp.company.trim() : null;
    const seedTitle = sp.title?.trim() ? sp.title.trim() : null;
    const isEmpty = (v: string | null | undefined): boolean =>
      v == null || v.trim() === "";

    let part = await deps.decisions.findParticipation(eventId, sp.personId);
    if (!part) {
      part = await deps.decisions.insertParticipation({
        id: newParticipationId(),
        eventId,
        personId: sp.personId,
        userId: boundUserId,
        roleLabel: "speaker",
        status: "accepted",
        bio: seedBio,
        company: seedCompany,
        title: seedTitle,
        headshotFileId: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const patch: {
        status?: string;
        userId?: string | null;
        bio?: string | null;
        company?: string | null;
        title?: string | null;
        version: number;
        updatedAt: string;
      } = {
        version: part.version + 1,
        updatedAt: now,
      };
      if (part.status !== "accepted") patch.status = "accepted";
      if (boundUserId && part.userId !== boundUserId) patch.userId = boundUserId;
      // Seed only fields that are still empty on the participation.
      if (seedBio != null && isEmpty(part.bio)) patch.bio = seedBio;
      if (seedCompany != null && isEmpty(part.company)) {
        patch.company = seedCompany;
      }
      if (seedTitle != null && isEmpty(part.title)) patch.title = seedTitle;
      const hasChange =
        patch.status !== undefined ||
        patch.userId !== undefined ||
        patch.bio !== undefined ||
        patch.company !== undefined ||
        patch.title !== undefined;
      if (hasChange) {
        const updated = await deps.decisions.updateParticipation(part.id, patch);
        if (updated) part = updated;
      }
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

  // Incomplete public drafts must not be accepted / decided (10.5).
  if (!isSubmissionDecisionSource(submission.status)) {
    return {
      ok: false,
      status: 400,
      error:
        submission.status === "draft"
          ? "Cannot record a decision on a draft submission"
          : "Submission is not in a valid state for a decision",
      code: "VALIDATION_ERROR",
      details: {
        status: submission.status,
        eligible: [
          "submitted",
          "in_review",
          "accepted",
          "rejected",
          "waitlist",
        ],
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

    // Direct session speakers: same closed-loop provision as accept materialize.
    let boundUserId: string | null = null;
    if (email.includes("@")) {
      let user = await deps.auth.findUserByEmail(email);
      if (!user) {
        user = await deps.auth.createUser({ email });
      }
      boundUserId = user.id;
      const existingMem = await deps.auth.findMembership(event.id, user.id);
      if (!existingMem) {
        await deps.auth.upsertMembership({
          eventId: event.id,
          userId: user.id,
          role: "speaker",
        });
      }
      if (deps.programInvite) {
        try {
          await deps.programInvite.issue({
            email,
            userId: user.id,
            eventId: event.id,
            correlationId:
              deps.programInvite.correlationId ?? `direct-${session.id}`,
          });
        } catch {
          /* non-fatal */
        }
      }
    }

    let part = await deps.decisions.findParticipation(event.id, person.id);
    if (!part) {
      part = await deps.decisions.insertParticipation({
        id: newParticipationId(),
        eventId: event.id,
        personId: person.id,
        userId: boundUserId,
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
    } else if (boundUserId && part.userId !== boundUserId) {
      const updated = await deps.decisions.updateParticipation(part.id, {
        userId: boundUserId,
        version: part.version + 1,
        updatedAt: now,
      });
      if (updated) part = updated;
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
 * Submission.List — admin filters by status/category (E01) + page window (10.1).
 * Event row may be absent for synthetic bootstrap memberships (evt_dogfood);
 * list is still event-scoped by id (empty when no rows).
 *
 * Reliability (S-SUB-LIST / AC-10.1-A/E):
 * - Server-side filters before slice; response carries total/limit/offset
 * - Batch primary-speaker names (no N+1) so dogfood 150+ stays under 5s
 * - Skip corrupt status/title rows instead of failing the whole list (500)
 */
export async function listSubmissions(
  deps: DecisionCommandDeps,
  input: {
    eventId: string;
    status?: SubmissionStatus;
    category?: string;
    q?: string;
    limit?: number;
    offset?: number;
  },
): Promise<
  CommandOk<{
    submissions: SubmissionListItem[];
    total: number;
    limit: number;
    offset: number;
    categories: string[];
  }> | CommandErr
> {
  // Prefer real event; bootstrap-only memberships have no row — still list by id.
  void (await deps.events.findEventById(input.eventId));

  const limit = Math.min(
    Math.max(1, input.limit ?? SUBMISSION_LIST_DEFAULT_LIMIT),
    SUBMISSION_LIST_MAX_LIMIT,
  );
  const offset = Math.max(0, input.offset ?? 0);

  let rows = await deps.submissions.listSubmissionsForEvent(input.eventId);
  if (input.status) {
    rows = rows.filter((r) => r.status === input.status);
  }

  // Distinct categories after status filter (before category filter) for SPA dropdown.
  const categorySet = new Set<string>();
  for (const r of rows) {
    if (r.category) categorySet.add(r.category);
  }
  const categories = [...categorySet].sort();

  if (input.category) {
    rows = rows.filter((r) => r.category === input.category);
  }

  // Search before paging: title + primary speaker name (case-insensitive).
  const q = input.q?.trim().toLowerCase();
  if (q) {
    const allNames = await deps.submissions.listPrimarySpeakerNames(
      rows.map((r) => r.id),
    );
    rows = rows.filter((r) => {
      const title = (r.title ?? "").toLowerCase();
      const speaker = (allNames.get(r.id) ?? "").toLowerCase();
      return title.includes(q) || speaker.includes(q);
    });
  }

  // Stable order: newest submitted first (tie-break by id for determinism)
  rows.sort((a, b) => {
    if (a.submittedAt < b.submittedAt) return 1;
    if (a.submittedAt > b.submittedAt) return -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);

  const nameBySubmission = await deps.submissions.listPrimarySpeakerNames(
    pageRows.map((r) => r.id),
  );

  const items: SubmissionListItem[] = [];
  for (const r of pageRows) {
    // Harden against corrupt SoR rows — skip rather than 500 the whole list.
    const statusParsed = SubmissionStatusSchema.safeParse(r.status);
    if (!statusParsed.success) continue;
    const title = (r.title ?? "").trim() || "(untitled)";
    const formVersionId = (r.formVersionId ?? "").trim() || "unknown";
    const submittedAt =
      (r.submittedAt ?? "").trim() || "1970-01-01T00:00:00.000Z";
    const version =
      typeof r.version === "number" && r.version >= 1 ? r.version : 1;

    items.push({
      id: r.id,
      eventId: r.eventId,
      formVersionId,
      title,
      category: r.category,
      status: statusParsed.data,
      submittedAt,
      version,
      primarySpeakerName: nameBySubmission.get(r.id) ?? null,
    });
  }

  return {
    ok: true,
    value: { submissions: items, total, limit, offset, categories },
  };
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
  // Prefer published form field labels over raw field_key (track_pref → "Track preference").
  // Choice options ride along so the SPA can resolve stored option VALUES
  // ("agents") to their human labels ("Agents & Tooling") — polish veto #7.
  const labelByKey = new Map<string, string>();
  const optionsByKey = new Map<
    string,
    Array<{ value: string; label: string }>
  >();
  if (deps.forms) {
    try {
      const fields = await deps.forms.listFields(submission.formVersionId);
      for (const f of fields) {
        if (f.label?.trim()) labelByKey.set(f.fieldKey, f.label.trim());
        if (f.options && f.options.length > 0) {
          optionsByKey.set(f.fieldKey, f.options);
        }
      }
      // Snapshot fallback when listFields empty (frozen publish snapshot)
      if (labelByKey.size === 0) {
        const ver = await deps.forms.findVersionById(submission.formVersionId);
        if (ver?.snapshotJson) {
          const snap = JSON.parse(ver.snapshotJson) as {
            fields?: Array<{
              fieldKey?: string;
              label?: string;
              options?: Array<{ value: string; label: string }> | null;
            }>;
          };
          for (const f of snap.fields ?? []) {
            if (f.fieldKey && f.label?.trim()) {
              labelByKey.set(f.fieldKey, f.label.trim());
            }
            if (f.fieldKey && f.options && f.options.length > 0) {
              optionsByKey.set(f.fieldKey, f.options);
            }
          }
        }
      }
    } catch {
      /* labels optional — SPA humanizes fieldKey */
    }
  }
  const answers = answerRows.map((a) => {
    let value: unknown = a.valueJson;
    try {
      value = JSON.parse(a.valueJson) as unknown;
    } catch {
      value = a.valueJson;
    }
    const label = labelByKey.get(a.fieldKey);
    const options = optionsByKey.get(a.fieldKey);
    return {
      fieldKey: a.fieldKey,
      value,
      ...(label ? { label } : {}),
      ...(options ? { options } : {}),
    };
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
      // Wave 2 "About this speaker" seed fields on the admin detail DTO.
      bio: s.bio ?? null,
      company: s.company ?? null,
      title: s.title ?? null,
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
 * Bulk decision commit — loops recordDecision; partial success allowed.
 */
export async function commitBulkDecision(
  deps: DecisionCommandDeps,
  input: {
    eventId: string;
    submissionIds: string[];
    decision: DecisionValue;
    reason?: string | null;
    expectedVersions?: Record<string, number>;
    actorUserId: string;
    correlationId: string;
  },
): Promise<
  CommandOk<{
    decision: DecisionValue;
    items: Array<{
      submissionId: string;
      ok: boolean;
      error?: string;
      code?: string;
    }>;
    applied: number;
    failed: number;
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

  const items: Array<{
    submissionId: string;
    ok: boolean;
    error?: string;
    code?: string;
  }> = [];
  let applied = 0;
  let failed = 0;

  for (const submissionId of input.submissionIds) {
    const sub = await deps.submissions.findSubmissionById(submissionId);
    if (!sub || sub.eventId !== input.eventId) {
      items.push({
        submissionId,
        ok: false,
        error: "Submission not in event",
        code: "VALIDATION_ERROR",
      });
      failed += 1;
      continue;
    }

    const expectedVersion = input.expectedVersions?.[submissionId];
    const result = await recordDecision(deps, {
      submissionId,
      decision: input.decision,
      reason: input.reason ?? null,
      expectedVersion,
      actorUserId: input.actorUserId,
      correlationId: input.correlationId,
    });

    if (result.ok) {
      items.push({ submissionId, ok: true });
      applied += 1;
    } else {
      items.push({
        submissionId,
        ok: false,
        error: result.error,
        code: result.code,
      });
      failed += 1;
    }
  }

  return {
    ok: true,
    value: {
      decision: input.decision,
      items,
      applied,
      failed,
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
    if (!isSubmissionDecisionSource(sub.status)) {
      return {
        ok: false,
        status: 400,
        error:
          sub.status === "draft"
            ? "Cannot preview a decision on a draft submission"
            : "Submission is not in a valid state for a decision",
        code: "VALIDATION_ERROR",
        details: {
          submissionId: id,
          status: sub.status,
          eligible: [
            "submitted",
            "in_review",
            "accepted",
            "rejected",
            "waitlist",
          ],
        },
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

/**
 * Submission.ExportCsv — filtered submissions as CSV (Wave 2 depth).
 *
 * Honors the same filters as Submission.List (status/category/q) and the same
 * deterministic ordering (newest submitted first, id tie-break). Columns are
 * stable: fixed base headers, then answer columns keyed by field_key in
 * lexicographic order. Layout nodes (section/divider, Wave 1B) never appear —
 * they carry no answers and are additionally excluded via the pinned form
 * version's node kinds. Cell values pass csvEscapeField (RFC4180 quoting +
 * formula neutralization).
 */
export async function exportSubmissionsCsv(
  deps: DecisionCommandDeps,
  input: {
    eventId: string;
    status?: SubmissionStatus;
    category?: string;
    q?: string;
  },
): Promise<CommandOk<{ csv: string; filename: string }> | CommandErr> {
  void (await deps.events.findEventById(input.eventId));

  let rows = await deps.submissions.listSubmissionsForEvent(input.eventId);
  if (input.status) {
    rows = rows.filter((r) => r.status === input.status);
  }
  if (input.category) {
    rows = rows.filter((r) => r.category === input.category);
  }
  const q = input.q?.trim().toLowerCase();
  if (q) {
    const allNames = await deps.submissions.listPrimarySpeakerNames(
      rows.map((r) => r.id),
    );
    rows = rows.filter((r) => {
      const title = (r.title ?? "").toLowerCase();
      const speaker = (allNames.get(r.id) ?? "").toLowerCase();
      return title.includes(q) || speaker.includes(q);
    });
  }
  rows.sort((a, b) => {
    if (a.submittedAt < b.submittedAt) return 1;
    if (a.submittedAt > b.submittedAt) return -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  // Layout-node field keys per pinned form version (excluded from columns).
  const layoutKeysByVersion = new Map<string, Set<string>>();
  async function layoutKeysFor(formVersionId: string): Promise<Set<string>> {
    const cached = layoutKeysByVersion.get(formVersionId);
    if (cached) return cached;
    const keys = new Set<string>();
    if (deps.forms) {
      try {
        const fields = await deps.forms.listFields(formVersionId);
        for (const f of fields) {
          if ((f as { nodeKind?: string }).nodeKind === "layout") {
            keys.add(f.fieldKey);
          }
        }
        if (fields.length === 0) {
          const ver = await deps.forms.findVersionById(formVersionId);
          if (ver?.snapshotJson) {
            const snap = JSON.parse(ver.snapshotJson) as {
              fields?: Array<{ fieldKey?: string; nodeKind?: string }>;
            };
            for (const f of snap.fields ?? []) {
              if (f.fieldKey && f.nodeKind === "layout") keys.add(f.fieldKey);
            }
          }
        }
      } catch {
        /* layout exclusion best-effort; layout nodes never store answers */
      }
    }
    layoutKeysByVersion.set(formVersionId, keys);
    return keys;
  }

  type ExportRow = {
    sub: SubmissionRow;
    answers: Map<string, string>;
    speakersFlat: string;
    primaryName: string;
    primaryEmail: string;
  };

  const exportRows: ExportRow[] = [];
  const answerKeys = new Set<string>();

  for (const sub of rows) {
    const layoutKeys = await layoutKeysFor(sub.formVersionId);
    const answerRows = await deps.submissions.listAnswers(sub.id);
    const answers = new Map<string, string>();
    for (const a of answerRows) {
      if (layoutKeys.has(a.fieldKey)) continue;
      let value: unknown = a.valueJson;
      try {
        value = JSON.parse(a.valueJson) as unknown;
      } catch {
        value = a.valueJson;
      }
      const flat = Array.isArray(value)
        ? value.map((v) => String(v)).join(" | ")
        : value == null
          ? ""
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
      answers.set(a.fieldKey, flat);
      answerKeys.add(a.fieldKey);
    }

    const speakerRows = await deps.submissions.listSpeakers(sub.id);
    speakerRows.sort((a, b) => a.sortOrder - b.sortOrder);
    const personById = await deps.submissions.listPersonsByIds(
      speakerRows.map((s) => s.personId),
    );
    const parts: string[] = [];
    let primaryName = "";
    let primaryEmail = "";
    for (const s of speakerRows) {
      const person = personById.get(s.personId);
      if (!person) continue;
      parts.push(`${person.name} <${person.email}>`);
      if (s.isPrimary || (!primaryEmail && parts.length === 1)) {
        primaryName = person.name;
        primaryEmail = person.email;
      }
    }

    exportRows.push({
      sub,
      answers,
      speakersFlat: parts.join("; "),
      primaryName,
      primaryEmail,
    });
  }

  const sortedAnswerKeys = [...answerKeys].sort();
  const header = [
    "submissionId",
    "title",
    "status",
    "category",
    "submittedAt",
    "primarySpeakerName",
    "primarySpeakerEmail",
    "speakers",
    ...sortedAnswerKeys,
  ];

  const lines = [header.map(csvEscapeField).join(",")];
  for (const r of exportRows) {
    const cells = [
      r.sub.id,
      r.sub.title ?? "",
      r.sub.status ?? "",
      r.sub.category ?? "",
      r.sub.submittedAt ?? "",
      r.primaryName,
      r.primaryEmail,
      r.speakersFlat,
      ...sortedAnswerKeys.map((k) => r.answers.get(k) ?? ""),
    ];
    lines.push(cells.map(csvEscapeField).join(","));
  }

  const safeEvent = input.eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return {
    ok: true,
    value: {
      csv: lines.join("\r\n") + "\r\n",
      filename: `submissions-${safeEvent}.csv`,
    },
  };
}
