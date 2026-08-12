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
  readRichTextValue,
  richTextIsEmpty,
  richTextToPlainText,
  type RichTextEnvelope,
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
import { renderIcs, stableIcsUid } from "../comms/ics.js";
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
  /** Optional schedule for session when/where on portal home. */
  schedule?: import("../schedule/store.js").ScheduleStore;
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
    // Dual-read (F2): prefer bio_rich_json, fall back to legacy bio as a
    // paragraph doc AT READ TIME — never writes.
    bioRich: readRichTextValue(row.bioRichJson ?? null, row.bio),
    company: row.company,
    title: row.title,
    headshotFileId: row.headshotFileId,
    socialLinks: parseSocialLinks(row.socialLinksJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    personName: person?.name ?? null,
    personEmail: person?.email ?? null,
  };
}

function parseSocialLinks(
  raw: string | null | undefined,
): ParticipationProfileDto["socialLinks"] {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const pick = (k: string) =>
      typeof o[k] === "string" && (o[k] as string).trim()
        ? (o[k] as string).trim()
        : null;
    return {
      linkedin: pick("linkedin"),
      x: pick("x"),
      facebook: pick("facebook"),
      website: pick("website"),
    };
  } catch {
    return null;
  }
}

/**
 * Bio patch from an update body (F2 dual-write): bioRich drives both columns
 * when the legacy bio field was not explicitly sent; explicit legacy bio
 * still wins for old clients. Whitespace-only docs clear to NULL.
 */
function bioPatchFromBody(body: {
  bio?: string | null;
  bioRich?: RichTextEnvelope | null;
}): { bio?: string | null; bioRichJson?: string | null } {
  const patch: { bio?: string | null; bioRichJson?: string | null } = {};
  if (body.bioRich !== undefined) {
    const hasDoc = body.bioRich != null && !richTextIsEmpty(body.bioRich);
    patch.bioRichJson = hasDoc ? JSON.stringify(body.bioRich) : null;
    if (body.bio === undefined) {
      patch.bio = hasDoc ? richTextToPlainText(body.bioRich) : null;
    }
  } else if (body.bio !== undefined) {
    // Legacy-only write (old client): clear the rich column so a stale doc
    // never shadows the fresh legacy text on the next dual-read.
    patch.bioRichJson = null;
  }
  if (body.bio !== undefined) patch.bio = body.bio;
  return patch;
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
    linkUrl: tpl?.linkUrl ?? null,
    required: tpl?.required ?? false,
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

async function toPortalSessionDto(
  deps: PortalCommandDeps,
  row: ProgramSessionRow,
): Promise<
  ProgramSessionDto & {
    placement: {
      startsAt: string;
      endsAt: string;
      roomId: string | null;
      roomName: string | null;
    } | null;
  }
> {
  const base = toSessionDto(row);
  if (!deps.schedule) {
    return { ...base, placement: null };
  }
  try {
    const pl = await deps.schedule.findPlacementBySession(row.id);
    if (!pl || pl.eventId !== row.eventId) {
      return { ...base, placement: null };
    }
    let roomName: string | null = null;
    if (pl.roomId) {
      const room = await deps.events.findRoom(row.eventId, pl.roomId);
      roomName = room?.name ?? null;
    }
    return {
      ...base,
      placement: {
        startsAt: pl.startsAt,
        endsAt: pl.endsAt,
        roomId: pl.roomId ?? null,
        roomName,
      },
    };
  } catch {
    return { ...base, placement: null };
  }
}

function toTemplateDto(row: TaskTemplateRow): TaskTemplateDto {
  return {
    id: row.id,
    eventId: row.eventId,
    title: row.title,
    description: row.description,
    trigger: row.trigger,
    dueOffsetDays: row.dueOffsetDays,
    linkUrl: row.linkUrl,
    required: row.required,
    version: row.version,
  };
}

/** Canonical portal task order: required first, then dueAt asc (null last), then id. */
function comparePortalTasks(a: PortalTaskDto, b: PortalTaskDto): number {
  const ar = a.required === true ? 0 : 1;
  const br = b.required === true ? 0 : 1;
  if (ar !== br) return ar - br;
  const ad = a.dueAt ?? "9999";
  const bd = b.dueAt ?? "9999";
  if (ad !== bd) return ad.localeCompare(bd);
  return a.id.localeCompare(b.id);
}

function pickNextTask(tasks: PortalTaskDto[]): PortalTaskDto | null {
  const pending = tasks.filter(
    (t) => t.status === "pending" || t.status === "overdue",
  );
  if (pending.length === 0) return null;
  // Required incomplete tasks outrank optional ones regardless of due date.
  pending.sort(comparePortalTasks);
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
  // Server-side order: required first, then dueAt asc (null last), then id.
  out.sort(comparePortalTasks);
  return out;
}

async function sessionsForParticipations(
  deps: PortalCommandDeps,
  eventId: string,
  partIds: string[],
): Promise<
  Array<
    ProgramSessionDto & {
      placement: {
        startsAt: string;
        endsAt: string;
        roomId: string | null;
        roomName: string | null;
      } | null;
    }
  >
> {
  const sessionIds = new Set<string>();
  for (const pid of partIds) {
    const links =
      await deps.decisions.listSessionSpeakersForParticipation(pid);
    for (const l of links) sessionIds.add(l.sessionId);
  }
  const sessions: Array<
    ProgramSessionDto & {
      placement: {
        startsAt: string;
        endsAt: string;
        roomId: string | null;
        roomName: string | null;
      } | null;
    }
  > = [];
  for (const sid of sessionIds) {
    const s = await deps.decisions.findSessionById(sid);
    if (s && s.eventId === eventId && s.status !== "cancelled") {
      sessions.push(await toPortalSessionDto(deps, s));
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

  const nextTask = pickNextTask(tasks);
  const primary = participations[0] ?? null;
  const readiness = computePortalReadiness(primary, tasks);

  let brandColor: string | null = null;
  let brandSoft: string | null = null;
  let brandFg: string | null = null;
  let logoFileId: string | null = null;
  if (deps.design) {
    try {
      const pub = await deps.design.findPublished(input.eventId);
      if (pub?.tokens) {
        brandColor = pub.tokens.brand ?? null;
        brandSoft = pub.tokens.brandSoft ?? null;
        brandFg = pub.tokens.brandFg ?? null;
        logoFileId = pub.tokens.logoFileId ?? null;
      }
    } catch {
      /* brand optional */
    }
  }

  // Durable file list for portal UI (headshot + slides)
  const files: Array<{
    id: string;
    purpose: "headshot" | "slides" | "logo";
    filename: string | null;
    mime: string;
    uploaded: boolean;
    updatedAt: string;
  }> = [];
  if (parts[0]) {
    const metas = await filesForParticipation(deps, input.eventId, parts[0]);
    for (const m of metas) {
      const purpose =
        m.purpose === "headshot" || m.purpose === "slides" || m.purpose === "logo"
          ? m.purpose
          : null;
      if (!purpose) continue;
      files.push({
        id: m.id,
        purpose,
        filename: m.filename ?? null,
        mime: m.mime,
        uploaded: Boolean(m.uploaded),
        updatedAt: m.createdAt,
      });
    }
  }

  return {
    ok: true,
    value: {
      eventId: input.eventId,
      eventName: event.name,
      eventSlug: event.slug ?? null,
      eventTimezone: event.timezone ?? null,
      brandColor,
      brandSoft,
      brandFg,
      logoFileId,
      participations,
      tasks,
      sessions,
      files,
      nextTask,
      readiness,
    },
  };
}

function profileFieldDone(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Single readiness contract for portal API + UI (no contradictory ready states).
 *
 * Wave 2 semantics: only REQUIRED incomplete tasks keep the speaker at
 * needs_action once the profile is complete. When only optional tasks remain
 * the state is "ready" with an honest headline; complete means nothing open.
 */
export function computePortalReadiness(
  part: {
    bio?: string | null;
    company?: string | null;
    title?: string | null;
    headshotFileId?: string | null;
  } | null,
  tasks: Array<{ status: string; required?: boolean }>,
): {
  state: "needs_action" | "waiting_on_organiser" | "ready" | "complete";
  percent: number;
  profileComplete: boolean;
  profileDone: number;
  profileTotal: number;
  tasksTotal: number;
  tasksPending: number;
  tasksCompleted: number;
  headline: string;
  detail: string;
} {
  const profileChecks = [
    profileFieldDone(part?.bio),
    profileFieldDone(part?.company),
    profileFieldDone(part?.title),
    Boolean(part?.headshotFileId),
  ];
  const profileDone = profileChecks.filter(Boolean).length;
  const profileTotal = 4;
  const profileComplete = profileDone === profileTotal;
  const profilePct = Math.round((profileDone / profileTotal) * 100);

  let tasksCompleted = 0;
  let tasksPending = 0;
  let requiredPending = 0;
  for (const t of tasks) {
    const s = (t.status ?? "").toLowerCase();
    if (s === "completed") tasksCompleted += 1;
    else if (s !== "cancelled") {
      tasksPending += 1;
      if (t.required === true) requiredPending += 1;
    }
  }
  const tasksActive = tasksCompleted + tasksPending;
  const tasksPct =
    tasksActive === 0 ? 100 : Math.round((tasksCompleted / tasksActive) * 100);
  const percent =
    tasks.length === 0
      ? profilePct
      : Math.round(profilePct * 0.4 + tasksPct * 0.6);

  if (!profileComplete) {
    return {
      state: "needs_action",
      percent,
      profileComplete: false,
      profileDone,
      profileTotal,
      tasksTotal: tasks.length,
      tasksPending,
      tasksCompleted,
      headline: "Complete your profile",
      detail:
        tasksPending > 0
          ? "Finish required profile fields and outstanding tasks."
          : tasks.length === 0
            ? "No organiser tasks yet — finish your profile so the programme team can publish you."
            : "Finish required profile fields to continue.",
    };
  }

  if (requiredPending > 0) {
    return {
      state: "needs_action",
      percent,
      profileComplete: true,
      profileDone,
      profileTotal,
      tasksTotal: tasks.length,
      tasksPending,
      tasksCompleted,
      headline: "Required tasks remaining",
      detail: `${requiredPending} required task${requiredPending === 1 ? "" : "s"} must be finished before you're ready.`,
    };
  }

  if (tasksPending > 0) {
    // Only optional tasks remain — honest "ready" without pretending done.
    return {
      state: "ready",
      percent,
      profileComplete: true,
      profileDone,
      profileTotal,
      tasksTotal: tasks.length,
      tasksPending,
      tasksCompleted,
      headline: "Ready — optional tasks remain",
      detail: `You're set for the programme. ${tasksPending} optional task${tasksPending === 1 ? "" : "s"} still open if you'd like to finish ${tasksPending === 1 ? "it" : "them"}.`,
    };
  }

  if (tasks.length === 0) {
    return {
      state: "waiting_on_organiser",
      percent,
      profileComplete: true,
      profileDone,
      profileTotal,
      tasksTotal: 0,
      tasksPending: 0,
      tasksCompleted: 0,
      headline: "Profile complete",
      detail:
        "No organiser tasks assigned yet. You're set on profile — check back for programme tasks.",
    };
  }

  return {
    state: "complete",
    percent: 100,
    profileComplete: true,
    profileDone,
    profileTotal,
    tasksTotal: tasks.length,
    tasksPending: 0,
    tasksCompleted,
    headline: "You're ready",
    detail: "Profile complete and all assigned tasks done.",
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
 * Speakers.CompleteTask — event admin completes a speaker task on their behalf
 * (Wave 2 N05). Mirrors Task.Complete minus the own-participation check:
 * - task must belong to :participationId and participation to :eventId → 404
 * - cancelled → 400 · version mismatch → 409 · already completed → 200 no-op
 * Audited as Speakers.CompleteTask with the admin as actor.
 */
export async function adminCompleteSpeakerTask(
  deps: PortalCommandDeps,
  input: {
    eventId: string;
    participationId: string;
    taskId: string;
    actorUserId: string;
    body: TaskCompleteBody;
    correlationId: string;
  },
): Promise<CommandOk<TaskCompleteResponse> | CommandErr> {
  const task = await deps.decisions.findSpeakerTaskById(input.taskId);
  if (!task || task.participationId !== input.participationId) {
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
  if (!part || part.eventId !== input.eventId) {
    // Cross-event probe gets the same 404 as a missing task (no existence leak).
    return {
      ok: false,
      status: 404,
      error: "Task not found",
      code: "NOT_FOUND",
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
      details: {
        expectedVersion: input.body.expectedVersion,
        version: task.version,
      },
    };
  }

  if (task.status === "completed") {
    // Idempotent replay — no extra state change, no duplicate audit row.
    return { ok: true, value: { task: toTaskDto(task) } };
  }

  const now = new Date().toISOString();
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
    actorId: input.actorUserId,
    action: "Speakers.CompleteTask",
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
      onBehalfOfParticipationId: part.id,
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
    socialLinksJson: part.socialLinksJson ?? null,
    version: part.version,
  };

  let socialLinksJson: string | null | undefined;
  if (input.body.socialLinks !== undefined) {
    if (input.body.socialLinks === null) {
      socialLinksJson = null;
    } else {
      const cleaned: Record<string, string> = {};
      for (const k of ["linkedin", "x", "facebook", "website"] as const) {
        const v = input.body.socialLinks[k];
        if (typeof v === "string" && v.trim()) cleaned[k] = v.trim();
      }
      socialLinksJson =
        Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
    }
  }

  const updated = await deps.decisions.updateParticipation(part.id, {
    version: part.version + 1,
    updatedAt: now,
    ...bioPatchFromBody(input.body),
    ...(input.body.company !== undefined ? { company: input.body.company } : {}),
    ...(input.body.title !== undefined ? { title: input.body.title } : {}),
    ...(input.body.headshotFileId !== undefined
      ? { headshotFileId: input.body.headshotFileId }
      : {}),
    ...(socialLinksJson !== undefined ? { socialLinksJson } : {}),
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
    ...bioPatchFromBody(input.body),
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
    linkUrl: input.body.linkUrl ?? null,
    // Blocking by default (0032 repair) — organizers opt INTO optional.
    required: input.body.required ?? true,
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
    ...(input.body.linkUrl !== undefined
      ? { linkUrl: input.body.linkUrl }
      : {}),
    ...(input.body.required !== undefined
      ? { required: input.body.required }
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

/**
 * Portal.SessionIcs — speaker-owned calendar invite download (read-only).
 *
 * Serves the current ICS body for ONE of the signed-in speaker's own placed
 * sessions. Ownership is verified server-side (participation → session link);
 * non-owned / unknown sessions return 404 (no existence probing). Reuses the
 * stored calendar_invites UID/SEQUENCE when the admin comms flow has already
 * issued one so a later email invite and this download stay the same VEVENT
 * identity; otherwise derives the stable UID with SEQUENCE 0. Never writes.
 */
export async function portalSessionIcs(
  deps: PortalCommandDeps & {
    comms?: {
      findCalendarInviteByPlacement(
        eventId: string,
        placementId: string,
      ): Promise<{ uid: string; sequence: number } | null>;
    };
  },
  input: {
    eventId: string;
    userId: string;
    userEmail: string;
    sessionId: string;
    correlationId?: string;
  },
): Promise<CommandOk<{ filename: string; body: string }> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const parts = await resolveOwnParticipations(deps, input);
  let owned = false;
  for (const p of parts) {
    const links = await deps.decisions.listSessionSpeakersForParticipation(
      p.id,
    );
    if (links.some((l) => l.sessionId === input.sessionId)) {
      owned = true;
      break;
    }
  }
  if (!owned) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const session = await deps.decisions.findSessionById(input.sessionId);
  if (
    !session ||
    session.eventId !== input.eventId ||
    session.status === "cancelled"
  ) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  if (!deps.schedule) {
    return {
      ok: false,
      status: 404,
      error: "Session is not scheduled yet",
      code: "NOT_FOUND",
    };
  }
  const placement = await deps.schedule.findPlacementBySession(session.id);
  if (!placement || placement.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Session is not scheduled yet",
      code: "NOT_FOUND",
    };
  }

  let roomName: string | null = null;
  if (placement.roomId) {
    const room = await deps.events.findRoom(input.eventId, placement.roomId);
    roomName = room?.name ?? null;
  }

  const prior = deps.comms
    ? await deps.comms.findCalendarInviteByPlacement(
        input.eventId,
        placement.id,
      )
    : null;
  const uid = prior?.uid ?? stableIcsUid(input.eventId, placement.id);
  const sequence = prior?.sequence ?? 0;

  const body = renderIcs({
    uid,
    sequence,
    method: "REQUEST",
    summary: session.title,
    startsAt: placement.startsAt,
    endsAt: placement.endsAt,
    location: roomName,
    description: `${event.name} — ${session.title}`,
    attendeeEmail: input.userEmail || null,
  });

  return {
    ok: true,
    value: { filename: "invite.ics", body },
  };
}
