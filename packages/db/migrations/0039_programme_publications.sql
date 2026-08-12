-- SpeakerOps programme_publications — F7 published read-model gate (additive).
--
-- Marks when an event's public programme is published. Public pages/embeds
-- only serve accepted sessions / speakers / agenda when a row exists.
-- Snapshot JSON is optional freeze for future cache; live reads currently
-- compose from SoR under this gate (fail-closed when unpublished).
--
-- Additive only on top of 0001–0038. Rollback: DROP TABLE; D1 Time Travel.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS programme_publications (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id),
  published_at TEXT NOT NULL,
  published_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  snapshot_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_programme_publications_published_at
  ON programme_publications (published_at);

-- Fail-closed public slug resolution: one slug → one event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug_unique ON events (slug);
