/**
 * F5 Find commands — reindex + permissioned search.
 */
import {
  makeSnippet,
  sanitizeFtsQuery,
  searchHitRoute,
  type SearchEntityType,
  type SearchHit,
  type SearchResponse,
} from "@speakerops/shared";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import type { FormsStore } from "../forms/store.js";
import type { EvalStore } from "../eval/store.js";
import type { AuthStore } from "../auth/store.js";
import type { SearchDocumentRow, SearchStore } from "./store.js";

export type SearchCommandDeps = {
  search: SearchStore;
  events: EventsStore;
  submissions: SubmissionsStore;
  decisions: DecisionsStore;
  forms: FormsStore;
  eval?: EvalStore;
  auth: AuthStore;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404;
  error: string;
  code: string;
  details?: unknown;
};

function docId(type: SearchEntityType, entityId: string, suffix = ""): string {
  return suffix ? `${type}:${entityId}:${suffix}` : `${type}:${entityId}`;
}

/** Per-event rebuild watermark (truthful "Index as of"). */
const lastRebuildAt = new Map<string, string>();

/** Throttle full reindex per event (ms). */
const REINDEX_MIN_INTERVAL_MS = 15_000;

export async function reindexEvent(
  deps: SearchCommandDeps,
  eventId: string,
): Promise<CommandOk<{ indexed: number; freshness: string }> | CommandErr> {
  const event = await deps.events.findEventById(eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
  }

  const docs: SearchDocumentRow[] = [];
  const now = new Date().toISOString();

  // Submissions
  const subs = await deps.submissions.listSubmissionsForEvent(eventId);
  const names = await deps.submissions.listPrimarySpeakerNames(
    subs.map((s) => s.id),
  );
  for (const s of subs) {
    const speaker = names.get(s.id) ?? "";
    docs.push({
      id: docId("submission", s.id),
      entityType: "submission",
      entityId: s.id,
      eventId,
      title: (s.title ?? "").trim() || "(untitled submission)",
      body: [speaker, s.category ?? "", s.status].filter(Boolean).join(" "),
      ownerUserId: null,
      participationId: null,
      status: s.status,
      route: searchHitRoute("submission", s.id),
      updatedAt: s.submittedAt || now,
    });
  }

  // Sessions — one base doc + ACL shadow docs per linked participation
  const sessions = await deps.decisions.listSessionsForEvent(eventId);
  const parts = await deps.decisions.listParticipationsForEvent(eventId);
  const partIds = parts.map((p) => p.id);
  const sessionLinks =
    partIds.length > 0
      ? await deps.decisions.listSessionSpeakersForParticipations(partIds)
      : [];
  const partsBySession = new Map<string, string[]>();
  for (const link of sessionLinks) {
    const list = partsBySession.get(link.sessionId) ?? [];
    list.push(link.participationId);
    partsBySession.set(link.sessionId, list);
  }

  for (const sess of sessions) {
    const linked = partsBySession.get(sess.id) ?? [];
    const primaryPart = linked[0] ?? null;
    docs.push({
      id: docId("session", sess.id),
      entityType: "session",
      entityId: sess.id,
      eventId,
      title: (sess.title ?? "").trim() || "(untitled session)",
      body: [sess.description ?? "", sess.status].filter(Boolean).join(" "),
      ownerUserId: null,
      participationId: primaryPart,
      status: sess.status,
      route: searchHitRoute("session", sess.id),
      updatedAt: sess.updatedAt || now,
    });
    // Shadow ACL docs so multi-speaker sessions are findable by each speaker
    for (let i = 1; i < linked.length; i++) {
      const pid = linked[i]!;
      docs.push({
        id: docId("session", sess.id, `acl-${pid}`),
        entityType: "session",
        entityId: sess.id,
        eventId,
        title: (sess.title ?? "").trim() || "(untitled session)",
        body: [sess.description ?? "", sess.status].filter(Boolean).join(" "),
        ownerUserId: null,
        participationId: pid,
        status: sess.status,
        route: searchHitRoute("session", sess.id),
        updatedAt: sess.updatedAt || now,
      });
    }
  }

  // Speakers — batch person loads (avoid N+1)
  const personIds = [...new Set(parts.map((p) => p.personId))];
  const personName = new Map<string, string>();
  await Promise.all(
    personIds.map(async (pid) => {
      const found = await deps.submissions.findPersonById(pid);
      if (found?.name?.trim()) personName.set(pid, found.name.trim());
    }),
  );

  // personId → participation ids (for submission ACL linking)
  const partsByPerson = new Map<string, string[]>();
  for (const p of parts) {
    const list = partsByPerson.get(p.personId) ?? [];
    list.push(p.id);
    partsByPerson.set(p.personId, list);
  }

  for (const p of parts) {
    const title =
      personName.get(p.personId) ||
      [p.title, p.company].filter(Boolean).join(" · ") ||
      "Speaker";
    docs.push({
      id: docId("speaker", p.id),
      entityType: "speaker",
      entityId: p.id,
      eventId,
      title,
      body: [p.company ?? "", p.title ?? "", p.roleLabel ?? "", p.status]
        .filter(Boolean)
        .join(" "),
      ownerUserId: p.userId,
      participationId: p.id,
      status: p.status,
      route: searchHitRoute("speaker", p.id),
      updatedAt: p.updatedAt || now,
    });
  }

  // Forms
  const forms = await deps.forms.findFormsByEventId(eventId);
  for (const f of forms) {
    docs.push({
      id: docId("form", f.id),
      entityType: "form",
      entityId: f.id,
      eventId,
      title: (f.name ?? "").trim() || "Form",
      body: f.status,
      ownerUserId: null,
      participationId: null,
      status: f.status,
      route: searchHitRoute("form", f.id),
      updatedAt: f.createdAt || now,
    });
  }

  // Tasks
  if (partIds.length > 0) {
    const templates = await deps.decisions.listTaskTemplates(eventId);
    const tplTitle = new Map(templates.map((t) => [t.id, t.title]));
    const tasks =
      await deps.decisions.listSpeakerTasksForParticipations(partIds);
    for (const t of tasks) {
      docs.push({
        id: docId("task", t.id),
        entityType: "task",
        entityId: t.id,
        eventId,
        title: tplTitle.get(t.templateId) ?? "Speaker task",
        body: t.status,
        ownerUserId: null,
        participationId: t.participationId,
        status: t.status,
        route: searchHitRoute("task", t.id, {
          participationId: t.participationId,
        }),
        updatedAt: t.updatedAt || now,
      });
    }
  }

  // Submission ACL shadows for speakers (person is on submission)
  for (const s of subs) {
    const speakers = await deps.submissions.listSpeakers(s.id);
    for (const sp of speakers) {
      const pids = partsByPerson.get(sp.personId) ?? [];
      for (const pid of pids) {
        docs.push({
          id: docId("submission", s.id, `acl-${pid}`),
          entityType: "submission",
          entityId: s.id,
          eventId,
          title: (s.title ?? "").trim() || "(untitled submission)",
          body: [names.get(s.id) ?? "", s.category ?? "", s.status]
            .filter(Boolean)
            .join(" "),
          ownerUserId: null,
          participationId: pid,
          status: s.status,
          route: searchHitRoute("submission", s.id),
          updatedAt: s.submittedAt || now,
        });
      }
    }
  }

  await deps.search.replaceEventDocuments(eventId, docs);
  const freshness = new Date().toISOString();
  lastRebuildAt.set(eventId, freshness);
  return { ok: true, value: { indexed: docs.length, freshness } };
}

export async function searchEvent(
  deps: SearchCommandDeps,
  input: {
    eventId: string;
    userId: string;
    role: "admin" | "evaluator" | "speaker";
    q: string;
    types?: SearchEntityType[];
    limit: number;
  },
): Promise<CommandOk<SearchResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
  }

  const plainQ = input.q.trim();
  if (!plainQ) {
    return {
      ok: false,
      status: 400,
      error: "Query required",
      code: "VALIDATION_ERROR",
    };
  }

  const ftsQuery = sanitizeFtsQuery(plainQ);
  if (!ftsQuery) {
    return {
      ok: false,
      status: 400,
      error: "Query has no searchable tokens",
      code: "VALIDATION_ERROR",
    };
  }

  // Rebuild when empty or stale (truthful index maintenance).
  const count = await deps.search.countForEvent(input.eventId);
  const last = lastRebuildAt.get(input.eventId);
  const lastMs = last ? Date.parse(last) : 0;
  const stale =
    !last ||
    !Number.isFinite(lastMs) ||
    Date.now() - lastMs > REINDEX_MIN_INTERVAL_MS;
  if (count === 0 || stale) {
    await reindexEvent(deps, input.eventId);
  }

  let allowedSubmissionIds: Set<string> | undefined;
  let allowedParticipationIds: Set<string> | undefined;

  if (input.role === "evaluator" && deps.eval) {
    const assigns = await deps.eval.listAssignmentsForEvaluator(input.userId);
    allowedSubmissionIds = new Set(
      assigns.filter((a) => a.submissionId).map((a) => a.submissionId),
    );
  }
  if (input.role === "speaker") {
    const parts = await deps.decisions.listParticipationsForEvent(input.eventId);
    allowedParticipationIds = new Set(
      parts.filter((p) => p.userId === input.userId).map((p) => p.id),
    );
  }

  const rows = await deps.search.search({
    eventId: input.eventId,
    ftsQuery,
    plainQ,
    types: input.types,
    limit: input.limit * 3, // over-fetch then de-dupe ACL shadows
    authz: {
      role: input.role,
      userId: input.userId,
      allowedSubmissionIds,
      allowedParticipationIds,
    },
  });

  // De-dupe ACL shadow docs (same entityType+entityId).
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const r of rows) {
    const key = `${r.entityType}:${r.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      eventId: r.eventId,
      title: r.title,
      snippet: makeSnippet(r.body || r.title, plainQ),
      status: r.status,
      route: searchHitRoute(r.entityType, r.entityId, {
        participationId: r.participationId,
      }),
      updatedAt: r.updatedAt,
    });
    if (hits.length >= input.limit) break;
  }

  const freshness =
    lastRebuildAt.get(input.eventId) ??
    (await deps.search.maxUpdatedAt(input.eventId));

  return {
    ok: true,
    value: {
      hits,
      total: hits.length,
      limit: input.limit,
      q: plainQ,
      freshness,
    },
  };
}
