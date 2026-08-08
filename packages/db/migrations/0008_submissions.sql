-- SpeakerOps people + submissions — section 3.3 (public CFP submit)
-- SCHEMA.md: people, submissions, submission_answers, submission_speakers
-- Person ≠ Speaker (people is canonical identity; speakers are join rows).
-- form_version_id pins the published form snapshot on each submission (immutable pin).
-- Event-scoped via submissions.event_id; repository queries must scope by event (E1/E2).
-- Additive only on top of 0001–0007.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_people_org_id ON people(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_org_email ON people(org_id, email);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  form_version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_submissions_event_id ON submissions(event_id);
CREATE INDEX IF NOT EXISTS idx_submissions_form_version_id ON submissions(form_version_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(event_id, status);

CREATE TABLE IF NOT EXISTS submission_answers (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  UNIQUE (submission_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_submission_answers_submission_id ON submission_answers(submission_id);

CREATE TABLE IF NOT EXISTS submission_speakers (
  submission_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (submission_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_submission_speakers_person_id ON submission_speakers(person_id);
