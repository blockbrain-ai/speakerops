/**
 * Accelevents one-way projection from a published programme snapshot.
 * Speakers first, then scheduled sessions. Unscheduled sessions are skipped.
 * Sessions dropped from a later snapshot become HIDDEN.
 */
import { uuidv7 } from "@speakerops/shared";
import type { PublicSession, PublicSpeaker } from "@speakerops/shared";
import {
  AcceleventsAmbiguousError,
  AcceleventsDupEmailError,
  type AcceleventsClient,
} from "./client.js";
import type { ConnectionRow, IntegrationsStore } from "./store.js";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Event-timezone wall clock → Accelevents `yyyy/MM/dd HH:mm` (no offset). */
export function formatAcceleventsDateTime(
  iso: string,
  timeZone: string,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error("invalid datetime");
  }
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

export function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim() || "Speaker";
  const bits = trimmed.split(/\s+/);
  if (bits.length === 1) return { firstName: bits[0]!, lastName: "-" };
  return { firstName: bits[0]!, lastName: bits.slice(1).join(" ") };
}

export type ProjectSnapshot = {
  event: { timezone?: string | null };
  speakers: Array<PublicSpeaker & { email?: string | null }>;
  sessions: PublicSession[];
};

export async function projectPublishedSnapshot(
  store: IntegrationsStore,
  client: AcceleventsClient,
  conn: ConnectionRow,
  snap: ProjectSnapshot,
): Promise<{ speakers: number; sessions: number; hidden: number; errors: string[] }> {
  const eventUrl = conn.eventUrl;
  const eventId = conn.externalEventId;
  if (!eventUrl || !eventId) {
    return { speakers: 0, sessions: 0, hidden: 0, errors: ["metadata incomplete"] };
  }
  const tz = snap.event.timezone || "UTC";
  const errors: string[] = [];
  let speakers = 0;
  let sessions = 0;
  let hidden = 0;

  const speakerExt = new Map<string, string>();
  for (const sp of snap.speakers) {
    try {
      const ext = await projectSpeaker(store, client, conn, eventUrl, eventId, sp);
      if (ext) {
        speakerExt.set(sp.id, ext);
        speakers += 1;
      }
    } catch (err) {
      errors.push(`speaker ${sp.id}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  const scheduledIds = new Set<string>();
  for (const sess of snap.sessions) {
    if (!sess.startsAt || !sess.endsAt) continue;
    scheduledIds.add(sess.id);
    try {
      const extIds = sess.speakers
        .map((s) => speakerExt.get(s.participationId))
        .filter((x): x is string => Boolean(x));
      await projectSession(store, client, conn, eventUrl, eventId, tz, sess, extIds);
      sessions += 1;
    } catch (err) {
      errors.push(`session ${sess.id}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  const known = await store.listIdentities(conn.eventId, conn.connectionGeneration, "session");
  for (const ident of known) {
    if (scheduledIds.has(ident.internalId)) continue;
    try {
      await client.updateSession(eventUrl, ident.externalId, { status: "HIDDEN" });
      hidden += 1;
    } catch (err) {
      errors.push(
        `hide ${ident.internalId}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  return { speakers, sessions, hidden, errors };
}

async function projectSpeaker(
  store: IntegrationsStore,
  client: AcceleventsClient,
  conn: ConnectionRow,
  eventUrl: string,
  eventId: string,
  sp: PublicSpeaker & { email?: string | null },
): Promise<string | null> {
  const email = typeof sp.email === "string" ? normalizeEmail(sp.email) : "";
  if (!email) return null;
  const { firstName, lastName } = splitName(sp.name);
  const body: Record<string, unknown> = {
    firstName,
    lastName,
    email,
    bio: sp.bio ?? "",
    company: sp.company ?? "",
    title: sp.title ?? "",
  };

  const existing = await store.getIdentity(
    conn.eventId,
    conn.connectionGeneration,
    "speaker",
    sp.id,
  );
  if (existing) {
    await client.updateSpeaker(eventUrl, existing.externalId, body);
    return existing.externalId;
  }

  const listed = await client.listSpeakers(eventUrl, eventId);
  const matches = listed.filter(
    (s) => s.email && normalizeEmail(s.email) === email,
  );
  if (matches.length > 1) {
    throw new Error("ambiguous email match");
  }
  if (matches.length === 1) {
    await remember(store, conn, "speaker", sp.id, matches[0]!.id);
    await client.updateSpeaker(eventUrl, matches[0]!.id, body);
    return matches[0]!.id;
  }

  try {
    const created = await client.createSpeaker(eventUrl, body);
    await remember(store, conn, "speaker", sp.id, created.externalId);
    return created.externalId;
  } catch (err) {
    if (err instanceof AcceleventsAmbiguousError) throw err;
    if (!(err instanceof AcceleventsDupEmailError)) throw err;
    const again = await client.listSpeakers(eventUrl, eventId);
    const rematch = again.filter(
      (s) => s.email && normalizeEmail(s.email) === email,
    );
    if (rematch.length !== 1) {
      throw new Error("4068906 unmatched");
    }
    await remember(store, conn, "speaker", sp.id, rematch[0]!.id);
    return rematch[0]!.id;
  }
}

async function projectSession(
  store: IntegrationsStore,
  client: AcceleventsClient,
  conn: ConnectionRow,
  eventUrl: string,
  eventId: string,
  timeZone: string,
  sess: PublicSession,
  speakerExternalIds: string[],
) {
  const body: Record<string, unknown> = {
    title: sess.title,
    startTime: formatAcceleventsDateTime(sess.startsAt!, timeZone),
    endTime: formatAcceleventsDateTime(sess.endsAt!, timeZone),
    description: sess.description ?? "",
    location: sess.roomName ?? "",
    format: "SESSION",
    sessionTypeFormat: "IN_PERSON",
    status: "VISIBLE",
    speakerIds: speakerExternalIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)),
  };

  const existing = await store.getIdentity(
    conn.eventId,
    conn.connectionGeneration,
    "session",
    sess.id,
  );
  if (existing) {
    await client.updateSession(eventUrl, existing.externalId, body);
    return;
  }

  const listed = await client.listSessions(eventUrl, eventId);
  const start = String(body.startTime);
  const matches = listed.filter(
    (s) => s.title === sess.title && s.startTime === start,
  );
  if (matches.length > 1) {
    throw new Error("ambiguous session match");
  }
  if (matches.length === 1) {
    await remember(store, conn, "session", sess.id, matches[0]!.id);
    await client.updateSession(eventUrl, matches[0]!.id, body);
    return;
  }

  const created = await client.createSession(eventUrl, body);
  await remember(store, conn, "session", sess.id, created.externalId);
}

async function remember(
  store: IntegrationsStore,
  conn: ConnectionRow,
  entityType: "speaker" | "session",
  internalId: string,
  externalId: string,
) {
  await store.putIdentity({
    id: uuidv7(),
    eventId: conn.eventId,
    connectionGeneration: conn.connectionGeneration,
    entityType,
    internalId,
    externalId,
    createdAt: new Date().toISOString(),
  });
}
