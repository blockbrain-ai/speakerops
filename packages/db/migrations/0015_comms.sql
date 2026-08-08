-- SpeakerOps email templates + message jobs — section 5.1 (S-COMMS)
-- email_templates, message_jobs (message_recipients / delivery_events / calendar_invites in 5.2)
-- Request path enqueues outbox_events only — no provider HTTP (E7).
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  key TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_md TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_event_key
  ON email_templates(event_id, key);

CREATE INDEX IF NOT EXISTS idx_email_templates_event_id
  ON email_templates(event_id);

CREATE TABLE IF NOT EXISTS message_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL,
  segment_json TEXT NOT NULL,
  recipients_json TEXT,
  bodies_json TEXT,
  missing_fields_json TEXT,
  idempotency_key TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (template_id) REFERENCES email_templates(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_jobs_idempotency_key
  ON message_jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_jobs_event_id
  ON message_jobs(event_id);

CREATE INDEX IF NOT EXISTS idx_message_jobs_template_id
  ON message_jobs(template_id);

CREATE INDEX IF NOT EXISTS idx_message_jobs_status
  ON message_jobs(status);
