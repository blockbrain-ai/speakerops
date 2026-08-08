-- SpeakerOps forms / form_versions / form_fields / form_rules — section 3.1
-- SCHEMA.md: forms, form_versions, form_fields, form_rules
-- Draft is version_num=0 (published_at NULL). Publish freezes immutable rows with version_num++ and snapshot_json.
-- Event-scoped via forms.event_id; repository queries must scope by event (E1/E2).
-- Additive only on top of 0001–0006.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forms_event_id ON forms(event_id);

CREATE TABLE IF NOT EXISTS form_versions (
  id TEXT PRIMARY KEY NOT NULL,
  form_id TEXT NOT NULL,
  version_num INTEGER NOT NULL,
  welcome_md TEXT,
  thank_you_md TEXT,
  opens_at TEXT,
  closes_at TEXT,
  submission_limit INTEGER,
  published_at TEXT,
  snapshot_json TEXT,
  UNIQUE (form_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_form_versions_form_id ON form_versions(form_id);

CREATE TABLE IF NOT EXISTS form_fields (
  id TEXT PRIMARY KEY NOT NULL,
  form_version_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  conditions_json TEXT,
  UNIQUE (form_version_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_form_fields_form_version_id ON form_fields(form_version_id);

CREATE TABLE IF NOT EXISTS form_rules (
  id TEXT PRIMARY KEY NOT NULL,
  form_version_id TEXT NOT NULL,
  when_json TEXT NOT NULL,
  route_to_category TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_rules_form_version_id ON form_rules(form_version_id);
