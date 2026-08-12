-- SpeakerOps F5 search index generation state (additive).
-- Monotonic requested/built generations + fenced rebuild lease (WS-B3).
-- Rollback: DROP TABLE search_index_state; D1 Time Travel.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS search_index_state (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id),
  requested_generation INTEGER NOT NULL DEFAULT 0,
  built_generation INTEGER NOT NULL DEFAULT -1,
  built_at TEXT,
  doc_count INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until TEXT
);
