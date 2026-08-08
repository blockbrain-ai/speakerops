-- SpeakerOps Airtable projection_records — section 7.3 (S-AIRTABLE)
-- SCHEMA.md: projection_records
-- One-way mirror only — never SoR; upsert keyed by (system, entity_type, internal_id).
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projection_records (
  id TEXT PRIMARY KEY NOT NULL,
  system TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  internal_id TEXT NOT NULL,
  external_id TEXT,
  source_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Upsert identity for Airtable one-way projection (internal_id is the stable key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_records_system_entity_internal
  ON projection_records(system, entity_type, internal_id);

CREATE INDEX IF NOT EXISTS idx_projection_records_system ON projection_records(system);

CREATE INDEX IF NOT EXISTS idx_projection_records_internal_id
  ON projection_records(internal_id);
