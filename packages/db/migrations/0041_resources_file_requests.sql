-- SpeakerOps N2 resources + N3 file requests (additive, participation-scoped).
-- No Group aggregate. Rollback: DROP TABLE; D1 Time Travel.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portal_resources (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  title TEXT NOT NULL,
  body_md TEXT,
  -- draft | published | archived
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_portal_resources_event
  ON portal_resources (event_id, status);

CREATE TABLE IF NOT EXISTS file_requests (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  title TEXT NOT NULL,
  instructions TEXT,
  -- participation scope only (v1)
  scope TEXT NOT NULL DEFAULT 'participation',
  -- draft | published | archived
  status TEXT NOT NULL DEFAULT 'draft',
  -- headshot | slides | other
  purpose TEXT NOT NULL DEFAULT 'other',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_file_requests_event
  ON file_requests (event_id, status);
