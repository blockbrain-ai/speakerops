#!/usr/bin/env node
/**
 * Publish public programme snapshot for dogfood event on remote D1.
 * Composes a minimal immutable snapshot from SoR tables and upserts
 * programme_publications so /e/:slug and /embed/:slug serve real data.
 *
 * Usage (with secrets):
 *   scripts/with-secrets.sh node scripts/publish-programme-remote.mjs
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EVENT_ID = process.env.PUBLISH_EVENT_ID || "evt_dogfood";
const DB = process.env.DOGFOOD_D1_NAME || "speakerops-demo";
const ENV = process.env.DOGFOOD_WRANGLER_ENV || "dogfood";

function wranglerJson(sql) {
  const r = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DB,
      "--remote",
      "--env",
      ENV,
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`wrangler failed: ${sql.slice(0, 80)}`);
  }
  const out = r.stdout.trim();
  // wrangler may print warnings before JSON — find first [
  const idx = out.indexOf("[");
  const json = idx >= 0 ? out.slice(idx) : out;
  const parsed = JSON.parse(json);
  const block = Array.isArray(parsed) ? parsed[0] : parsed;
  return block?.results ?? [];
}

function esc(s) {
  return String(s ?? "").replace(/'/g, "''");
}

const eventRows = wranglerJson(
  `SELECT id, name, slug, timezone, starts_at, ends_at FROM events WHERE id='${esc(EVENT_ID)}' LIMIT 1;`,
);
if (!eventRows.length) {
  console.error(`event not found: ${EVENT_ID}`);
  process.exit(1);
}
const event = eventRows[0];

const sessions = wranglerJson(
  `SELECT id, title, description, track_id, status FROM sessions WHERE event_id='${esc(EVENT_ID)}' AND status != 'cancelled' LIMIT 500;`,
);
const parts = wranglerJson(
  `SELECT ep.id, ep.person_id, ep.title, ep.company, ep.bio, ep.role_label, ep.status, p.name AS person_name
   FROM event_participations ep
   LEFT JOIN people p ON p.id = ep.person_id
   WHERE ep.event_id='${esc(EVENT_ID)}' LIMIT 500;`,
);
const placements = wranglerJson(
  `SELECT id, session_id, room_id, starts_at, ends_at FROM schedule_placements WHERE event_id='${esc(EVENT_ID)}' LIMIT 500;`,
);
const rooms = wranglerJson(
  `SELECT id, name FROM rooms WHERE event_id='${esc(EVENT_ID)}';`,
);
const tracks = wranglerJson(
  `SELECT id, name, color FROM tracks WHERE event_id='${esc(EVENT_ID)}';`,
);
const links = wranglerJson(
  `SELECT ss.session_id, ss.participation_id, ss.is_primary
   FROM session_speakers ss
   INNER JOIN sessions s ON s.id = ss.session_id
   WHERE s.event_id='${esc(EVENT_ID)}' LIMIT 2000;`,
);

const roomById = new Map(rooms.map((r) => [r.id, r]));
const trackById = new Map(tracks.map((t) => [t.id, t]));
const partById = new Map(parts.map((p) => [p.id, p]));
const placementBySession = new Map(placements.map((p) => [p.session_id, p]));
const speakersBySession = new Map();
for (const l of links) {
  const list = speakersBySession.get(l.session_id) ?? [];
  list.push(l);
  speakersBySession.set(l.session_id, list);
}
const nameForPart = (pid) => {
  const p = partById.get(pid);
  return (p?.person_name || "Speaker").trim() || "Speaker";
};

const publicSessions = sessions.map((s) => {
  const track = s.track_id ? trackById.get(s.track_id) : null;
  const place = placementBySession.get(s.id);
  const room = place?.room_id ? roomById.get(place.room_id) : null;
  const slinks = speakersBySession.get(s.id) ?? [];
  return {
    id: s.id,
    title: s.title,
    description: s.description ?? null,
    trackId: s.track_id ?? null,
    trackName: track?.name ?? null,
    trackColor: track?.color ?? null,
    status: s.status,
    speakers: slinks.map((l) => ({
      participationId: l.participation_id,
      name: nameForPart(l.participation_id),
      isPrimary: Boolean(l.is_primary),
    })),
    startsAt: place?.starts_at ?? null,
    endsAt: place?.ends_at ?? null,
    roomId: place?.room_id ?? null,
    roomName: room?.name ?? null,
  };
});

const onSession = new Set(links.map((l) => l.participation_id));
const publicSpeakers = parts
  .filter(
    (p) =>
      onSession.has(p.id) ||
      p.status === "accepted" ||
      p.status === "confirmed" ||
      p.status === "active",
  )
  .map((p) => ({
    id: p.id,
    name: (p.person_name || "Speaker").trim() || "Speaker",
    title: p.title ?? null,
    company: p.company ?? null,
    bio: p.bio ?? null,
    headshotUrl: null,
    roleLabel: p.role_label ?? null,
  }));

const eligibleIds = new Set(publicSessions.map((s) => s.id));
const agenda = placements
  .filter((pl) => eligibleIds.has(pl.session_id))
  .map((pl) => {
    const sess = publicSessions.find((s) => s.id === pl.session_id);
    if (!sess) return null;
    return {
      placementId: pl.id,
      sessionId: sess.id,
      title: sess.title,
      startsAt: pl.starts_at,
      endsAt: pl.ends_at,
      roomName: sess.roomName,
      trackName: sess.trackName,
      trackColor: sess.trackColor,
      speakerNames: sess.speakers.map((s) => s.name),
    };
  })
  .filter(Boolean)
  .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));

const snapshot = {
  event: {
    id: event.id,
    name: event.name,
    slug: event.slug,
    timezone: event.timezone,
    startsAt: event.starts_at ?? null,
    endsAt: event.ends_at ?? null,
  },
  sessions: publicSessions,
  speakers: publicSpeakers,
  agenda,
};

const now = new Date().toISOString();
const snapshotJson = JSON.stringify(snapshot);
const sqlPath = join(tmpdir(), `programme-publish-${Date.now()}.sql`);
const sql = `INSERT INTO programme_publications (event_id, published_at, published_by, version, snapshot_json, updated_at)
VALUES ('${esc(EVENT_ID)}', '${esc(now)}', 'system_publish_script', 1, '${esc(snapshotJson)}', '${esc(now)}')
ON CONFLICT(event_id) DO UPDATE SET
  published_at=excluded.published_at,
  published_by=excluded.published_by,
  version=programme_publications.version + 1,
  snapshot_json=excluded.snapshot_json,
  updated_at=excluded.updated_at;
`;
writeFileSync(sqlPath, sql, "utf8");

const apply = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    DB,
    "--remote",
    "--env",
    ENV,
    "--file",
    sqlPath,
  ],
  { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
try {
  unlinkSync(sqlPath);
} catch {
  /* ignore */
}
if (apply.status !== 0) {
  console.error(apply.stderr || apply.stdout);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      eventId: EVENT_ID,
      slug: event.slug,
      sessions: publicSessions.length,
      speakers: publicSpeakers.length,
      agenda: agenda.length,
      publishedAt: now,
    },
    null,
    2,
  ),
);
