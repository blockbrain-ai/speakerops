/**
 * Portal + admin speakers + task templates commands (section 4.1 / S-PORTAL).
 *
 * Portal.GetHome · Task.Complete · Participation.UpdateProfile
 * Speakers.List · Speakers.Get · Speakers.UpdateProfile
 * TaskTemplate.List/Create/Update/Delete (O05)
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  type PortalHomeResponse,
  type ParticipationProfileDto,
  type PortalTaskDto,
  type ParticipationUpdateProfileBody,
  type ParticipationUpdateProfileResponse,
  type TaskCompleteBody,
  type TaskCompleteResponse,
  type AdminSpeakersListResponse,
  type AdminSpeakerDetailResponse,
  type SpeakerFileMetaDto,
  type TaskTemplateCreateBody,
  type TaskTemplateUpdateBody,
  type TaskTemplateListResponse,
  type TaskTemplateResponse,
  type TaskTemplateDeleteResponse,
  type TaskTemplateDto,
  type ProgramSessionDto,
  type SpeakerTaskDto,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { DesignStore } from "../design/store.js";
import {
  type DecisionsStore,
  type ParticipationRow,
  type SpeakerTaskRow,
  type TaskTemplateRow,
  type ProgramSessionRow,
  newTaskTemplateId,
} from "../decisions/store.js";

export type PortalCommandDeps = {
  decisions: DecisionsStore;
  events: EventsStore;
  auth: AuthStore;
  submissions: SubmissionsStore;
  design?: DesignStore;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

function toProfileDto(
  row: ParticipationRow,
  person?: { name: string; email: string } | null,
): ParticipationProfileDto {
  return {
    id: row.id,
    eventId: row.eventId,
    personId: row.personId,
    userId: row.userId,
    roleLabel: row.roleLabel,
    status: row.status,
    version: row.version,
    bio: row.bio,
    company: row.company,
    title: row.title,
    headshotFileId: row.headshotFileId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    personName: person?.name ?? null,
    personEmail: person?.email ?? null,
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

function toPortalTask(
  row: SpeakerTaskRow,
  tpl: TaskTemplateRow | null,
): PortalTaskDto {
  return {
    ...toTaskDto(row),
    title: tpl?.title ?? "Task",
    description: tpl?.description ?? null,
    trigger: tpl?.trigger,
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

function toTemplateDto(row: TaskTemplateRow): TaskTemplateDto {
  return {
    id: row.id,
    eventId: row.eventId,
    title: row.title,
    description: row.description,
    trigger: row.trigger,
    dueOffsetDays: row.dueOffsetDays,
    version: row.version,
  };
}

function pickNextTask(tasks: PortalTaskDto[]): PortalTaskDto | null {
  const pending = tasks.filter(
    (t) => t.status === "pending" || t.status === "overdue",
  );
  if (pending.length === 0) return null;
  pending.sort((a, b) => {
    const ad = a.dueAt ?? "9999";
    const bd = b.dueAt ?? "9999";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.id.localeCompare(b.id);
  });
  return pending[0] ?? null;
}

/**
 * Resolve participations owned by the current user for an event.
 * Matches userId first; falls back to person email and links userId.
 * Identity-binding write emits audit_events (E3).
 */
export async function resolveOwnParticipations(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    userId: string;
    userEmail: string;
    correlationId?: string;
  },
): Promise<ParticipationRow[]> {
  const all = await deps.decisions.listParticipationsForEvent(input.eventId);
  const byUser = all.filter((p) => p.userId === input.userId);
  if (byUser.length > 0) return byUser;

  const event = await deps.events.findEventById(input.eventId);
  if (!event) return [];

  const person = await deps.submissions.findPersonByOrgEmail(
    event.orgId,
    input.userEmail,
  );
  if (!person) return [];

  const part = await deps.decisions.findParticipation(
    input.eventId,
    person.id,
  );
  if (!part) return [];

  // Link user on first portal access (Person ≠ Speaker; user is auth identity)
  if (!part.userId) {
    const now = new Date().toISOString();
    const linked = await deps.decisions.updateParticipation(part.id, {
      userId: input.userId,
      version: part.version + 1,
      updatedAt: now,
    });
    if (linked) {
      await deps.auth.insertAudit({
        id: uuidv7(),
        eventId: input.eventId,
        actorType: "user",
        actorId: input.userId,
        action: "Participation.LinkUser",
        entityType: "event_participation",
        entityId: part.id,
        beforeJson: JSON.stringify({
          userId: null,
          version: part.version,
        }),
        afterJson: JSON.stringify({
          userId: linked.userId,
          version: linked.version,
        }),
        correlationId: input.correlationId ?? "unknown",
        createdAt: now,
      });
      return [linked];
    }
    return [part];
  }

  // userId set to someone else — not own
  if (part.userId !== input.userId) return [];
  return [part];
}

async function enrichProfile(
  deps: PortalCommandDeps,
  row: ParticipationRow,
): Promise<ParticipationProfileDto> {
  const person = await deps.submissions.findPersonById(row.personId);
  return toProfileDto(
    row,
    person ? { name: person.name, email: person.email } : null,
  );
}

async function tasksForParticipations(
  deps: PortalCommandDeps,
  partIds: string[],
): Promise<PortalTaskDto[]> {
  const tasks = await deps.decisions.listSpeakerTasksForParticipations(partIds);
  const out: PortalTaskDto[] = [];
  for (const t of tasks) {
    if (t.status === "cancelled") continue;
    const tpl = await deps.decisions.findTaskTemplateById(t.templateId);
    out.push(toPortalTask(t, tpl));
  }
  return out;
}

async function sessionsForParticipations(
  deps: PortalCommandDeps,
  eventId: string,
  partIds: string[],
): Promise<ProgramSessionDto[]> {
  const sessionIds = new Set<string>();
  for (const pid of partIds) {
    const links =
      await deps.decisions.listSessionSpeakersForParticipation(pid);
    for (const l of links) sessionIds.add(l.sessionId);
  }
  const sessions: ProgramSessionDto[] = [];
  for (const sid of sessionIds) {
    const s = await deps.decisions.findSessionById(sid);
    if (s && s.eventId === eventId && s.status !== "cancelled") {
      sessions.push(toSessionDto(s));
    }
  }
  return sessions;
}

/**
 * Portal.GetHome — speaker's own tasks + sessions for eventId.
 */
export async function getPortalHome(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    userId: string;
    userEmail: string;
    correlationId?: string;
  },
): Promise<CommandOk<PortalHomeResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }

  const parts = await resolveOwnParticipations(deps, input);
  const partIds = parts.map((p) => p.id);
  const participations = await Promise.all(
    parts.map((p) => enrichProfile(deps, p)),
  );
  const tasks = await tasksForParticipations(deps, partIds);
  const sessions = await sessionsForParticipations(
    deps,
    input.eventId,
    partIds,
  );

  return {
    ok: true,
    value: {
      eventId: input.eventId,
      participations,
      tasks,
      sessions,
      nextTask: pickNextTask(tasks),
    },
  };
}

/**
 * Task.Complete — speaker may only complete own participation tasks.
 */
export async function completeTask(
  deps: PortalCommandDeps,
  input: {
    taskId: string;
    userId: string;
    userEmail: string;
    body: TaskCompleteBody;
    correlationId: string;
  },
): Promise<CommandOk<TaskCompleteResponse> | CommandErr> {
  const task = await deps.decisions.findSpeakerTaskById(input.taskId);
  if (!task) {
    return {
      ok: false,
      status: 404,
      error: "Task not found",
      code: "NOT_FOUND",
    };
  }

  const part = await deps.decisions.findParticipationById(
    task.participationId,
  );
  if (!part) {
    return {
      ok: false,
      status: 404,
      error: "Task not found",
      code: "NOT_FOUND",
    };
  }

  const own = await resolveOwnParticipations(deps, {
    eventId: part.eventId,
    userId: input.userId,
    userEmail: input.userEmail,
    correlationId: input.correlationId,
  });
  if (!own.some((p) => p.id === part.id)) {
    // assert speaker cannot complete another participation task
    return {
      ok: false,
      status: 403,
      error: "Cannot complete another speaker's task",
      code: "FORBIDDEN",
    };
  }

  if (task.status === "cancelled") {
    return {
      ok: false,
      status: 400,
      error: "Task is cancelled",
      code: "VALIDATION_ERROR",
    };
  }

  if (task.version !== input.body.expectedVersion) {
    return {
      ok: false,
      status: 409,
      error: "Task version conflict",
      code: "CONFLICT",
      details: { expectedVersion: input.body.expectedVersion, version: task.version },
    };
  }

  const now = new Date().toISOString();
  if (task.status === "completed") {
    // Idempotent complete
    return { ok: true, value: { task: toTaskDto(task) } };
  }

  const updated = await deps.decisions.updateSpeakerTask(task.id, {
    status: "completed",
    version: task.version + 1,
    updatedAt: now,
    completedAt: now,
  });
  if (!updated) {
    return {
      ok: false,
      status: 409,
      error: "Task version conflict",
      code: "CONFLICT",
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: part.eventId,
    actorType: "user",
    actorId: input.userId,
    action: "Task.Complete",
    entityType: "speaker_task",
    entityId: task.id,
    beforeJson: JSON.stringify({
      status: task.status,
      version: task.version,
    }),
    afterJson: JSON.stringify({
      status: updated.status,
      version: updated.version,
      completedAt: updated.completedAt,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { task: toTaskDto(updated) } };
}

/**
 * Participation.UpdateProfile — own participation only (bio G02 field-flow).
 */
export async function updateParticipationProfile(
  deps: PortalCommandDeps,
  input: {
    participationId: string;
    userId: string;
    userEmail: string;
    body: ParticipationUpdateProfileBody;
    correlationId: string;
  },
): Promise<CommandOk<ParticipationUpdateProfileResponse> | CommandErr> {
  const part = await deps.decisions.findParticipationById(
    input.participationId,
  );
  if (!part) {
    return {
      ok: false,
      status: 404,
      error: "Participation not found",
      code: "NOT_FOUND",
    };
  }

  const own = await resolveOwnParticipations(deps, {
    eventId: part.eventId,
    userId: input.userId,
    userEmail: input.userEmail,
    correlationId: input.correlationId,
  });
  if (!own.some((p) => p.id === part.id)) {
    return {
      ok: false,
      status: 403,
      error: "Cannot update another speaker's profile",
      code: "FORBIDDEN",
    };
  }

  if (part.version !== input.body.expectedVersion) {
    return {
      ok: false,
      status: 409,
      error: "Participation version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.body.expectedVersion,
        version: part.version,
      },
    };
  }

  // headshotFileId must reference an uploaded headshot owned by this participation
  if (
    input.body.headshotFileId !== undefined &&
    input.body.headshotFileId !== null
  ) {
    if (!deps.design) {
      return {
        ok: false,
        status: 400,
        error: "Headshot file store unavailable",
        code: "VALIDATION_ERROR",
      };
    }
    const file = await deps.design.findFile(
      part.eventId,
      input.body.headshotFileId,
    );
    const uploadState =
      typeof file?.uploadState === "number"
        ? file.uploadState
        : file?.uploaded
          ? 1
          : 0;
    if (
      !file ||
      file.eventId !== part.eventId ||
      file.ownerParticipationId !== part.id ||
      file.purpose !== "headshot" ||
      uploadState !== 1
    ) {
      return {
        ok: false,
        status: 400,
        error:
          "headshotFileId must be an uploaded headshot file owned by this participation",
        code: "VALIDATION_ERROR",
        details: {
          headshotFileId: input.body.headshotFileId,
          participationId: part.id,
        },
      };
    }
  }

  const now = new Date().toISOString();
  const before = {
    bio: part.bio,
    company: part.company,
    title: part.title,
    headshotFileId: part.headshotFileId,
    version: part.version,
  };

  const updated = await deps.decisions.updateParticipation(part.id, {
    version: part.version + 1,
    updatedAt: now,
    ...(input.body.bio !== undefined ? { bio: input.body.bio } : {}),
    ...(input.body.company !== undefined ? { company: input.body.company } : {}),
    ...(input.body.title !== undefined ? { title: input.body.title } : {}),
    ...(input.body.headshotFileId !== undefined
      ? { headshotFileId: input.body.headshotFileId }
      : {}),
  });
  if (!updated) {
    return {
      ok: false,
      status: 409,
      error: "Participation version conflict",
      code: "CONFLICT",
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: part.eventId,
    actorType: "user",
    actorId: input.userId,
    action: "Participation.UpdateProfile",
    entityType: "event_participation",
    entityId: part.id,
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify({
      bio: updated.bio,
      company: updated.company,
      title: updated.title,
      headshotFileId: updated.headshotFileId,
      version: updated.version,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: { participation: await enrichProfile(deps, updated) },
  };
}

/**
 * Speakers.UpdateProfile — event admin updates a speaker's programme profile
 * (bio / company / title / headshot) on their behalf. Same field rules as
 * Participation.UpdateProfile; ownership check is admin membership (route).
 */
export async function adminUpdateSpeakerProfile(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    participationId: string;
    actorUserId: string;
    body: ParticipationUpdateProfileBody;
    correlationId: string;
  },
): Promise<CommandOk<ParticipationUpdateProfileResponse> | CommandErr> {
  const part = await deps.decisions.findParticipationById(
    input.participationId,
  );
  if (!part || part.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Participation not found",
      code: "NOT_FOUND",
    };
  }

  if (part.version !== input.body.expectedVersion) {
    return {
      ok: false,
      status: 409,
      error: "Participation version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.body.expectedVersion,
        version: part.version,
      },
    };
  }

  if (
    input.body.headshotFileId !== undefined &&
    input.body.headshotFileId !== null
  ) {
    if (!deps.design) {
      return {
        ok: false,
        status: 400,
        error: "Headshot file store unavailable",
        code: "VALIDATION_ERROR",
      };
    }
    const file = await deps.design.findFile(
      part.eventId,
      input.body.headshotFileId,
    );
    const uploadState =
      typeof file?.uploadState === "number"
        ? file.uploadState
        : file?.uploaded
          ? 1
          : 0;
    if (
      !file ||
      file.eventId !== part.eventId ||
      file.ownerParticipationId !== part.id ||
      file.purpose !== "headshot" ||
      uploadState !== 1
    ) {
      return {
        ok: false,
        status: 400,
        error:
          "headshotFileId must be an uploaded headshot file owned by this participation",
        code: "VALIDATION_ERROR",
        details: {
          headshotFileId: input.body.headshotFileId,
          participationId: part.id,
        },
      };
    }
  }

  const now = new Date().toISOString();
  const before = {
    bio: part.bio,
    company: part.company,
    title: part.title,
    headshotFileId: part.headshotFileId,
    version: part.version,
  };

  const updated = await deps.decisions.updateParticipation(part.id, {
    version: part.version + 1,
    updatedAt: now,
    ...(input.body.bio !== undefined ? { bio: input.body.bio } : {}),
    ...(input.body.company !== undefined ? { company: input.body.company } : {}),
    ...(input.body.title !== undefined ? { title: input.body.title } : {}),
    ...(input.body.headshotFileId !== undefined
      ? { headshotFileId: input.body.headshotFileId }
      : {}),
  });
  if (!updated) {
    return {
      ok: false,
      status: 409,
      error: "Participation version conflict",
      code: "CONFLICT",
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: part.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Speakers.UpdateProfile",
    entityType: "event_participation",
    entityId: part.id,
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify({
      bio: updated.bio,
      company: updated.company,
      title: updated.title,
      headshotFileId: updated.headshotFileId,
      version: updated.version,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: { participation: await enrichProfile(deps, updated) },
  };
}

/**
 * Admin speakers list — event-scoped only (assert speakers list scoped by eventId).
 * Batched person/task/session lookups so dogfood 150+ stays under Worker time limits
 * (AC-11.2-SCALE / S-SUB-LIST / Speakers L05).
 */
export async function listSpeakers(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    q?: string;
    status?: string;
  },
): Promise<CommandOk<AdminSpeakersListResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }

  let parts = await deps.decisions.listParticipationsForEvent(input.eventId);
  if (input.status) {
    parts = parts.filter((p) => p.status === input.status);
  }

  const partIds = parts.map((p) => p.id);
  const personIds = [...new Set(parts.map((p) => p.personId))];

  const [personById, allTasks, allLinks] = await Promise.all([
    deps.submissions.listPersonsByIds(personIds),
    deps.decisions.listSpeakerTasksForParticipations(partIds),
    deps.decisions.listSessionSpeakersForParticipations(partIds),
  ]);

  const tasksByPart = new Map<string, SpeakerTaskRow[]>();
  for (const t of allTasks) {
    const list = tasksByPart.get(t.participationId) ?? [];
    list.push(t);
    tasksByPart.set(t.participationId, list);
  }
  const sessionCountByPart = new Map<string, number>();
  for (const link of allLinks) {
    sessionCountByPart.set(
      link.participationId,
      (sessionCountByPart.get(link.participationId) ?? 0) + 1,
    );
  }

  const speakers = [];
  const q = input.q?.trim().toLowerCase();
  for (const p of parts) {
    const person = personById.get(p.personId);
    const profile = toProfileDto(
      p,
      person ? { name: person.name, email: person.email } : null,
    );
    if (q) {
      const hay = [
        profile.personName ?? "",
        profile.personEmail ?? "",
        profile.company ?? "",
        profile.title ?? "",
        profile.bio ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const tasks = tasksByPart.get(p.id) ?? [];
    const pendingTaskCount = tasks.filter(
      (t) => t.status === "pending" || t.status === "overdue",
    ).length;
    const completedTaskCount = tasks.filter(
      (t) => t.status === "completed",
    ).length;
    speakers.push({
      participation: profile,
      pendingTaskCount,
      completedTaskCount,
      sessionCount: sessionCountByPart.get(p.id) ?? 0,
    });
  }

  // Stable order by person name then id
  speakers.sort((a, b) => {
    const an = (a.participation.personName ?? "").toLowerCase();
    const bn = (b.participation.personName ?? "").toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return a.participation.id.localeCompare(b.participation.id);
  });

  return {
    ok: true,
    value: { eventId: input.eventId, speakers },
  };
}

function toFileMeta(f: {
  id: string;
  eventId: string;
  ownerParticipationId: string | null;
  filename: string;
  mime: string;
  size: number;
  purpose: string;
  uploaded: boolean;
  uploadState?: number;
  checksum: string | null;
  createdAt: string;
}): SpeakerFileMetaDto {
  return {
    id: f.id,
    eventId: f.eventId,
    ownerParticipationId: f.ownerParticipationId,
    filename: f.filename,
    mime: f.mime,
    size: f.size,
    purpose: f.purpose,
    // SCHEMA uploaded INTEGER; FileAssetRow exposes boolean readiness + optional uploadState
    uploaded:
      typeof f.uploadState === "number" ? f.uploadState : f.uploaded ? 1 : 0,
    checksum: f.checksum,
    createdAt: f.createdAt,
  };
}

async function filesForParticipation(
  deps: PortalCommandDeps,
  eventId: string,
  part: ParticipationRow,
): Promise<SpeakerFileMetaDto[]> {
  const files: SpeakerFileMetaDto[] = [];
  if (!deps.design) return files;
  const seen = new Set<string>();

  // Primary path: files owned by this participation (headshot + slides)
  if (deps.design.listFilesForParticipation) {
    const owned = await deps.design.listFilesForParticipation(
      eventId,
      part.id,
    );
    for (const f of owned) {
      if (f.eventId !== eventId) continue;
      // Cross-speaker isolation: only this participation's owner id
      if (f.ownerParticipationId !== part.id) continue;
      seen.add(f.id);
      files.push(toFileMeta(f));
    }
  }

  // Legacy / profile pointer: headshotFileId when owner was null historically
  if (part.headshotFileId && !seen.has(part.headshotFileId)) {
    const f = await deps.design.findFile(eventId, part.headshotFileId);
    if (f && f.eventId === eventId) {
      if (
        f.ownerParticipationId == null ||
        f.ownerParticipationId === part.id
      ) {
        files.push(toFileMeta(f));
      }
    }
  }
  return files;
}

/**
 * Admin speaker detail — tasks + files metadata (N03/N04).
 * Event-scoped; never returns another event's participation.
 */
export async function getSpeakerDetail(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    participationId: string;
  },
): Promise<CommandOk<AdminSpeakerDetailResponse> | CommandErr> {
  const part = await deps.decisions.findParticipationById(
    input.participationId,
  );
  if (!part || part.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Speaker not found",
      code: "NOT_FOUND",
    };
  }

  const tasks = await tasksForParticipations(deps, [part.id]);
  const sessions = await sessionsForParticipations(
    deps,
    input.eventId,
    [part.id],
  );
  const files = await filesForParticipation(deps, input.eventId, part);

  return {
    ok: true,
    value: {
      participation: await enrichProfile(deps, part),
      tasks,
      sessions,
      files,
    },
  };
}

/** TaskTemplate.List — admin O05 */
export async function listTaskTemplates(
  deps: PortalCommandDeps,
  input: { eventId: string },
): Promise<CommandOk<TaskTemplateListResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }
  const rows = await deps.decisions.listTaskTemplates(input.eventId);
  return {
    ok: true,
    value: {
      eventId: input.eventId,
      templates: rows.map(toTemplateDto),
    },
  };
}

/** TaskTemplate.Create — admin O05 */
export async function createTaskTemplate(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    body: TaskTemplateCreateBody;
    actorUserId: string;
    correlationId: string;
  },
): Promise<CommandOk<TaskTemplateResponse> | CommandErr> {
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
  const row = await deps.decisions.insertTaskTemplate({
    id: newTaskTemplateId(),
    eventId: input.eventId,
    title: input.body.title.trim(),
    description:
      input.body.description === undefined
        ? null
        : input.body.description,
    trigger: input.body.trigger ?? "on_accept",
    dueOffsetDays: input.body.dueOffsetDays ?? 14,
    version: 1,
    createdAt: now,
  });

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "TaskTemplate.Create",
    entityType: "task_template",
    entityId: row.id,
    beforeJson: null,
    afterJson: JSON.stringify(toTemplateDto(row)),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { template: toTemplateDto(row) } };
}

/** TaskTemplate.Update — admin O05 */
export async function updateTaskTemplate(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    templateId: string;
    body: TaskTemplateUpdateBody;
    actorUserId: string;
    correlationId: string;
  },
): Promise<CommandOk<TaskTemplateResponse> | CommandErr> {
  const existing = await deps.decisions.findTaskTemplateById(input.templateId);
  if (!existing || existing.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Template not found",
      code: "NOT_FOUND",
    };
  }

  if (existing.version !== input.body.expectedVersion) {
    return {
      ok: false,
      status: 409,
      error: "Template version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.body.expectedVersion,
        version: existing.version,
      },
    };
  }

  const updated = await deps.decisions.updateTaskTemplate(input.templateId, {
    ...(input.body.title !== undefined
      ? { title: input.body.title.trim() }
      : {}),
    ...(input.body.description !== undefined
      ? { description: input.body.description }
      : {}),
    ...(input.body.trigger !== undefined
      ? { trigger: input.body.trigger }
      : {}),
    ...(input.body.dueOffsetDays !== undefined
      ? { dueOffsetDays: input.body.dueOffsetDays }
      : {}),
    version: existing.version + 1,
    expectedVersion: input.body.expectedVersion,
  });
  if (!updated) {
    return {
      ok: false,
      status: 409,
      error: "Template version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.body.expectedVersion,
        version: existing.version,
      },
    };
  }

  const now = new Date().toISOString();
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "TaskTemplate.Update",
    entityType: "task_template",
    entityId: updated.id,
    beforeJson: JSON.stringify(toTemplateDto(existing)),
    afterJson: JSON.stringify(toTemplateDto(updated)),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { template: toTemplateDto(updated) } };
}

/** TaskTemplate.Delete — admin O05 (E1 optimistic concurrency via expectedVersion) */
export async function deleteTaskTemplate(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    templateId: string;
    expectedVersion: number;
    actorUserId: string;
    correlationId: string;
  },
): Promise<CommandOk<TaskTemplateDeleteResponse> | CommandErr> {
  const existing = await deps.decisions.findTaskTemplateById(input.templateId);
  if (!existing || existing.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Template not found",
      code: "NOT_FOUND",
    };
  }

  if (existing.version !== input.expectedVersion) {
    return {
      ok: false,
      status: 409,
      error: "Template version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion,
        version: existing.version,
      },
    };
  }

  const deleted = await deps.decisions.deleteTaskTemplate(
    input.templateId,
    input.expectedVersion,
  );
  if (!deleted) {
    return {
      ok: false,
      status: 409,
      error: "Template version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion,
        version: existing.version,
      },
    };
  }

  const now = new Date().toISOString();
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "TaskTemplate.Delete",
    entityType: "task_template",
    entityId: existing.id,
    beforeJson: JSON.stringify(toTemplateDto(existing)),
    afterJson: null,
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: { deleted: true, id: existing.id },
  };
}
