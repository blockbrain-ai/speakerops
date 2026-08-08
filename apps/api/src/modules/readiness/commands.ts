/**
 * Reports.Readiness command (section 6.3 / S-READY).
 *
 * GET /api/events/:eventId/readiness → outstanding[] + stats
 * Derived from event_participations + speaker_tasks + task_templates (D1 SoR).
 * No separate readiness table — recomputed on each request for live poll.
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  isTaskOverdue,
  type ReportsReadinessResponse,
  type ReadinessOutstandingItem,
  type ReadinessStats,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { DecisionsStore } from "../decisions/store.js";

export type ReadinessCommandDeps = {
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

/**
 * Reports.Readiness — event-scoped outstanding tasks + stats.
 * Admin / reports:read (browser role admin maps to full scopes).
 */
export async function getReadiness(
  deps: ReadinessCommandDeps,
  input: {
    eventId: string;
    overdueOnly?: boolean;
    /** Optional clock for tests; defaults to Date.now(). */
    nowMs?: number;
  },
): Promise<CommandOk<ReportsReadinessResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return {
      ok: false,
      status: 404,
      error: "Event not found",
      code: "NOT_FOUND",
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();

  const parts = await deps.decisions.listParticipationsForEvent(input.eventId);
  const partIds = parts.map((p) => p.id);
  const allTasks =
    partIds.length === 0
      ? []
      : await deps.decisions.listSpeakerTasksForParticipations(partIds);

  // Template titles for outstanding rows
  const templates = await deps.decisions.listTaskTemplates(input.eventId);
  const titleByTemplate = new Map(templates.map((t) => [t.id, t.title]));

  // Person enrich (name/email) — Person ≠ Speaker (E1)
  const personCache = new Map<
    string,
    { name: string; email: string } | null
  >();
  async function personFor(personId: string) {
    if (personCache.has(personId)) return personCache.get(personId)!;
    const p = await deps.submissions.findPersonById(personId);
    const v = p ? { name: p.name, email: p.email } : null;
    personCache.set(personId, v);
    return v;
  }

  const partById = new Map(parts.map((p) => [p.id, p]));

  let completedTasks = 0;
  let cancelledTasks = 0;
  const outstandingAll: ReadinessOutstandingItem[] = [];
  const speakersWithOutstanding = new Set<string>();

  for (const task of allTasks) {
    if (task.status === "completed") {
      completedTasks += 1;
      continue;
    }
    if (task.status === "cancelled") {
      cancelledTasks += 1;
      continue;
    }

    // Incomplete (pending, overdue, or any non-terminal)
    const overdue = isTaskOverdue(task.status, task.dueAt, nowMs);
    const part = partById.get(task.participationId);
    if (!part) continue;

    const person = await personFor(part.personId);
    speakersWithOutstanding.add(part.id);

    outstandingAll.push({
      taskId: task.id,
      participationId: part.id,
      personId: part.personId,
      personName: person?.name ?? null,
      personEmail: person?.email ?? null,
      taskTitle: titleByTemplate.get(task.templateId) ?? "Task",
      templateId: task.templateId,
      status: overdue ? "overdue" : "pending",
      dueAt: task.dueAt,
      isOverdue: overdue,
      version: task.version,
    });
  }

  // Sort: overdue first, then dueAt asc (nulls last), then taskId
  outstandingAll.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    const ad = a.dueAt ?? "9999-12-31";
    const bd = b.dueAt ?? "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.taskId.localeCompare(b.taskId);
  });

  const overdueTasks = outstandingAll.filter((o) => o.isOverdue).length;
  const outstanding =
    input.overdueOnly === true
      ? outstandingAll.filter((o) => o.isOverdue)
      : outstandingAll;

  const stats: ReadinessStats = {
    totalSpeakers: parts.length,
    speakersWithOutstanding: speakersWithOutstanding.size,
    outstandingTasks: outstandingAll.length,
    overdueTasks,
    completedTasks,
    cancelledTasks,
  };

  return {
    ok: true,
    value: {
      eventId: input.eventId,
      stats,
      outstanding,
      generatedAt,
    },
  };
}
