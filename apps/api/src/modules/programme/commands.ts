/**
 * F7 programme publish + public read model (P11).
 * Group decision: no Group aggregate — Person/Participation/Submission only.
 */
import type {
  PublicAgendaItem,
  PublicProgrammeResponse,
  PublicSession,
  PublicSpeaker,
  ProgrammePublishResponse,
  ProgrammeStatusResponse,
} from "@speakerops/shared";
import type { EventsStore } from "../events/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { ScheduleStore } from "../schedule/store.js";
import type { ProgrammeStore } from "./store.js";

export type ProgrammeCommandDeps = {
  programme: ProgrammeStore;
  events: EventsStore;
  decisions: DecisionsStore;
  submissions: SubmissionsStore;
  schedule: ScheduleStore;
  /** Optional rooms/tracks via events store methods if present. */
  listRooms?: (eventId: string) => Promise<
    Array<{ id: string; name: string }>
  >;
  listTracks?: (eventId: string) => Promise<
    Array<{ id: string; name: string; color: string | null }>
  >;
  /** Optional one-way Accelevents enqueue after a successful publish (E7). */
  enqueueAccelevents?: (input: {
    eventId: string;
    version: number;
    correlationId: string;
  }) => Promise<void>;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404;
  error: string;
  code: string;
};

async function composeProgramme(
  deps: ProgrammeCommandDeps,
  eventId: string,
): Promise<{
  sessions: PublicSession[];
  speakers: PublicSpeaker[];
  agenda: PublicAgendaItem[];
}> {
  const sessions = await deps.decisions.listSessionsForEvent(eventId);
  const parts = await deps.decisions.listParticipationsForEvent(eventId);
  const placements = await deps.schedule.listPlacementsForEvent(eventId);

  let tracks: Array<{ id: string; name: string; color: string | null }> = [];
  let rooms: Array<{ id: string; name: string }> = [];
  try {
    if (deps.listTracks) tracks = await deps.listTracks(eventId);
    if (deps.listRooms) rooms = await deps.listRooms(eventId);
  } catch {
    /* optional */
  }
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const partIds = parts.map((p) => p.id);
  const sessionLinks =
    partIds.length > 0
      ? await deps.decisions.listSessionSpeakersForParticipations(partIds)
      : [];
  const speakersBySession = new Map<
    string,
    Array<{ participationId: string; isPrimary: boolean }>
  >();
  for (const link of sessionLinks) {
    const list = speakersBySession.get(link.sessionId) ?? [];
    list.push({
      participationId: link.participationId,
      isPrimary: link.isPrimary,
    });
    speakersBySession.set(link.sessionId, list);
  }

  const personIds = [...new Set(parts.map((p) => p.personId))];
  const personById = new Map<
    string,
    { name: string; email?: string | null }
  >();
  await Promise.all(
    personIds.map(async (id) => {
      const p = await deps.submissions.findPersonById(id);
      if (p) personById.set(id, { name: p.name?.trim() || "Speaker", email: p.email });
    }),
  );

  const partById = new Map(parts.map((p) => [p.id, p]));
  const nameForPart = (pid: string): string => {
    const part = partById.get(pid);
    if (!part) return "Speaker";
    return personById.get(part.personId)?.name ?? "Speaker";
  };

  const placementBySession = new Map(
    placements.map((p) => [p.sessionId, p]),
  );

  const eligibleSessions = sessions.filter((s) => s.status !== "cancelled");
  const eligibleIds = new Set(eligibleSessions.map((s) => s.id));

  const publicSessions: PublicSession[] = eligibleSessions
    .map((s) => {
      const track = s.trackId ? trackById.get(s.trackId) : undefined;
      const place = placementBySession.get(s.id);
      const room = place?.roomId ? roomById.get(place.roomId) : undefined;
      const links = speakersBySession.get(s.id) ?? [];
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        trackId: s.trackId,
        trackName: track?.name ?? null,
        trackColor: track?.color ?? null,
        status: s.status,
        speakers: links.map((l) => ({
          participationId: l.participationId,
          name: nameForPart(l.participationId),
          isPrimary: l.isPrimary,
        })),
        startsAt: place?.startsAt ?? null,
        endsAt: place?.endsAt ?? null,
        roomId: place?.roomId ?? null,
        roomName: room?.name ?? null,
      };
    });

  // Speakers with accepted presence (on a session or accepted participation)
  const onSession = new Set(
    sessionLinks.map((l) => l.participationId),
  );
  const publicSpeakers: PublicSpeaker[] = parts
    .filter(
      (p) =>
        onSession.has(p.id) ||
        p.status === "accepted" ||
        p.status === "confirmed" ||
        p.status === "active",
    )
    .map((p) => {
      const person = personById.get(p.personId);
      return {
        id: p.id,
        name: person?.name ?? "Speaker",
        title: p.title,
        company: p.company,
        // Plain bio only — never raw rich JSON, emails, or private file IDs.
        // Headshots wait on a publication-scoped public file route (logo-only
        // File.GetPublic would 404 every real headshot).
        bio: p.bio,
        headshotUrl: null,
        roleLabel: p.roleLabel,
      };
    });

  const agenda: PublicAgendaItem[] = placements
    .filter((pl) => eligibleIds.has(pl.sessionId))
    .map((pl) => {
      const sess = eligibleSessions.find((s) => s.id === pl.sessionId);
      if (!sess) return null;
      const track = sess.trackId ? trackById.get(sess.trackId) : undefined;
      const room = pl.roomId ? roomById.get(pl.roomId) : undefined;
      const links = speakersBySession.get(sess.id) ?? [];
      return {
        placementId: pl.id,
        sessionId: sess.id,
        title: sess.title,
        startsAt: pl.startsAt,
        endsAt: pl.endsAt,
        roomName: room?.name ?? null,
        trackName: track?.name ?? null,
        trackColor: track?.color ?? null,
        speakerNames: links.map((l) => nameForPart(l.participationId)),
      } satisfies PublicAgendaItem;
    })
    .filter((x): x is PublicAgendaItem => x != null)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    sessions: publicSessions,
    speakers: publicSpeakers,
    agenda,
  };
}

export async function getProgrammeStatus(
  deps: ProgrammeCommandDeps,
  eventId: string,
): Promise<CommandOk<ProgrammeStatusResponse> | CommandErr> {
  const pub = await deps.programme.findByEventId(eventId);
  return {
    ok: true,
    value: {
      published: Boolean(pub),
      publishedAt: pub?.publishedAt ?? null,
      version: pub?.version ?? 0,
    },
  };
}

export async function publishProgramme(
  deps: ProgrammeCommandDeps,
  input: { eventId: string; userId: string; correlationId?: string },
): Promise<CommandOk<ProgrammePublishResponse> | CommandErr> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
  }
  const composed = await composeProgramme(deps, input.eventId);
  const prev = await deps.programme.findByEventId(input.eventId);
  const now = new Date().toISOString();
  const version = (prev?.version ?? 0) + 1;
  // Immutable snapshot includes event metadata (public reads serve snapshot only).
  const snapshot = {
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      timezone: event.timezone,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    },
    sessions: composed.sessions,
    speakers: composed.speakers,
    agenda: composed.agenda,
  };
  const write = await deps.programme.upsert({
    eventId: input.eventId,
    publishedAt: now,
    publishedBy: input.userId,
    version,
    snapshotJson: JSON.stringify(snapshot),
    updatedAt: now,
    expectedVersion: prev?.version ?? null,
  });
  if (write === "version") {
    return {
      ok: false,
      status: 400,
      error: "Programme was published concurrently — refresh and retry",
      code: "VALIDATION_ERROR",
    };
  }
  if (deps.enqueueAccelevents) {
    await deps.enqueueAccelevents({
      eventId: input.eventId,
      version,
      correlationId: input.correlationId ?? `programme-publish:${input.eventId}:${version}`,
    });
  }
  return {
    ok: true,
    value: {
      publishedAt: now,
      version,
      sessionCount: composed.sessions.length,
      speakerCount: composed.speakers.length,
    },
  };
}

export async function getPublicProgramme(
  deps: ProgrammeCommandDeps,
  slug: string,
): Promise<CommandOk<PublicProgrammeResponse> | CommandErr> {
  const event = await deps.events.findEventBySlug(slug);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  const pub = await deps.programme.findByEventId(event.id);
  if (!pub?.snapshotJson) {
    return {
      ok: false,
      status: 404,
      error: "Programme not published yet",
      code: "NOT_FOUND",
    };
  }

  // Immutable snapshot only — post-publish SoR edits require re-publish.
  let snap: {
    event?: PublicProgrammeResponse["event"];
    sessions: PublicSession[];
    speakers: PublicSpeaker[];
    agenda: PublicAgendaItem[];
  };
  try {
    snap = JSON.parse(pub.snapshotJson) as typeof snap;
  } catch {
    return {
      ok: false,
      status: 404,
      error: "Programme snapshot corrupt",
      code: "NOT_FOUND",
    };
  }
  if (!Array.isArray(snap.sessions) || !Array.isArray(snap.speakers)) {
    return {
      ok: false,
      status: 404,
      error: "Programme snapshot incomplete",
      code: "NOT_FOUND",
    };
  }

  return {
    ok: true,
    value: {
      event: snap.event ?? {
        id: event.id,
        name: event.name,
        slug: event.slug,
        timezone: event.timezone,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      },
      publishedAt: pub.publishedAt,
      version: pub.version,
      sessions: snap.sessions,
      speakers: snap.speakers,
      agenda: Array.isArray(snap.agenda) ? snap.agenda : [],
    },
  };
}
