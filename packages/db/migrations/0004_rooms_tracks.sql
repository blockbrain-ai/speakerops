-- SpeakerOps rooms + tracks — section 2.3
-- SCHEMA.md: rooms / tracks — id, event_id, name, …
-- Event-scoped; repository queries must require eventId (E1/E2).
-- Additive only on top of 0001–0003.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rooms_event_id ON rooms(event_id);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tracks_event_id ON tracks(event_id);
