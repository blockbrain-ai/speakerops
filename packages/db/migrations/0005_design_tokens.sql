-- SpeakerOps design token draft/published — section 2.4
-- SCHEMA.md: design_token_drafts, design_token_published
-- Tokens JSON: { brand, brandSoft, radius, wordmark, logoFileId, brandFg? }
-- Event-scoped; repository queries must require eventId (E1/E2).
-- Additive only on top of 0001–0004.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS design_token_drafts (
  event_id TEXT PRIMARY KEY NOT NULL,
  tokens_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS design_token_published (
  event_id TEXT PRIMARY KEY NOT NULL,
  tokens_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  published_at TEXT NOT NULL,
  published_by TEXT
);

-- Minimal file metadata for logo presign (purpose=logo); full portal files land in 4.2
CREATE TABLE IF NOT EXISTS file_assets (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  owner_participation_id TEXT,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  checksum TEXT,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_assets_event_id ON file_assets(event_id);
