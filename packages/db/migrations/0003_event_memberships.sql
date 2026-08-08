-- SpeakerOps event_memberships — section 2.2
-- Roles: admin | evaluator | speaker (SCHEMA.md)
-- UNIQUE(event_id, user_id) — one membership row per user per event
-- Additive only on top of 0001_baseline + 0002_auth
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS event_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_memberships_event_user
  ON event_memberships(event_id, user_id);

CREATE INDEX IF NOT EXISTS idx_event_memberships_user_id
  ON event_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_event_memberships_event_id
  ON event_memberships(event_id);
