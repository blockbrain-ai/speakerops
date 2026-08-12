-- SpeakerOps N3 file request fulfilments (additive).
-- Speakers upload a file for a published request; organisers see linkage.
-- Rollback: DROP TABLE; D1 Time Travel.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS file_request_fulfillments (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  request_id TEXT NOT NULL REFERENCES file_requests(id),
  participation_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_request_fulfillments_unique
  ON file_request_fulfillments (request_id, participation_id);

CREATE INDEX IF NOT EXISTS idx_file_request_fulfillments_event
  ON file_request_fulfillments (event_id, request_id);
