-- SpeakerOps portal_forms — N1 post-acceptance data collection (additive).
-- Scoped to participation (no Group aggregate). Responses owned by participation.
-- Rollback: DROP TABLE portal_form_responses; DROP TABLE portal_forms; D1 Time Travel.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portal_forms (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  title TEXT NOT NULL,
  description TEXT,
  -- participation | submission (submission reserved; v1 uses participation)
  scope TEXT NOT NULL DEFAULT 'participation',
  -- draft | published | archived
  status TEXT NOT NULL DEFAULT 'draft',
  -- JSON array of { key, label, type, required, help? }
  fields_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_portal_forms_event_id
  ON portal_forms (event_id);

CREATE INDEX IF NOT EXISTS idx_portal_forms_event_status
  ON portal_forms (event_id, status);

CREATE TABLE IF NOT EXISTS portal_form_responses (
  id TEXT PRIMARY KEY NOT NULL,
  form_id TEXT NOT NULL REFERENCES portal_forms(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  participation_id TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (form_id, participation_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_form_responses_event
  ON portal_form_responses (event_id);

CREATE INDEX IF NOT EXISTS idx_portal_form_responses_participation
  ON portal_form_responses (participation_id);
