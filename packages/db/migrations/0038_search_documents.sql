-- SpeakerOps search_documents — F5 global permissioned Find (additive).
--
-- Projection of searchable entity rows. Content table is portable (sql.js + D1).
-- FTS5 virtual table is created at runtime on D1 (sql.js test wasm has no fts5
-- module). D1SearchStore.ensureFts() installs FTS + triggers when available.
--
-- Additive only on top of 0001–0037. Rollback: DROP TABLE search_documents;
-- D1 Time Travel for production recovery.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS search_documents (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  participation_id TEXT,
  status TEXT,
  route TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_docs_event_type
  ON search_documents (event_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_search_docs_event_owner
  ON search_documents (event_id, owner_user_id);

CREATE INDEX IF NOT EXISTS idx_search_docs_event_part
  ON search_documents (event_id, participation_id);

CREATE INDEX IF NOT EXISTS idx_search_docs_entity
  ON search_documents (entity_type, entity_id);
