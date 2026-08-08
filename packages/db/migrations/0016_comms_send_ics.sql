-- SpeakerOps comms send + ICS — section 5.2 (S-COMMS)
-- message_recipients, delivery_events, calendar_invites
-- Provider drain of outbox_events (sandbox default); idempotency_keys already in baseline.
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS message_recipients (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  participation_id TEXT,
  to_email TEXT NOT NULL,
  name TEXT,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES message_jobs(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_message_recipients_job_id
  ON message_recipients(job_id);

CREATE INDEX IF NOT EXISTS idx_message_recipients_event_id
  ON message_recipients(event_id);

CREATE INDEX IF NOT EXISTS idx_message_recipients_to_email
  ON message_recipients(to_email);

CREATE TABLE IF NOT EXISTS delivery_events (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  recipient_id TEXT,
  event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES message_jobs(id),
  FOREIGN KEY (recipient_id) REFERENCES message_recipients(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_events_job_id
  ON delivery_events(job_id);

CREATE INDEX IF NOT EXISTS idx_delivery_events_recipient_id
  ON delivery_events(recipient_id);

CREATE INDEX IF NOT EXISTS idx_delivery_events_event_id
  ON delivery_events(event_id);

CREATE TABLE IF NOT EXISTS calendar_invites (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  session_id TEXT,
  uid TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL,
  summary TEXT,
  starts_at TEXT,
  ends_at TEXT,
  location TEXT,
  ics_body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_invites_uid
  ON calendar_invites(uid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_invites_event_placement
  ON calendar_invites(event_id, placement_id);

CREATE INDEX IF NOT EXISTS idx_calendar_invites_event_id
  ON calendar_invites(event_id);
