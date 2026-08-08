-- SpeakerOps decisions / sessions / tasks — section 3.5 (S-EVAL accept path)
-- SCHEMA.md: decisions, sessions (program), session_speakers,
--            event_participations, task_templates, speaker_tasks
-- Person ≠ Speaker: people (3.3) + event_participations join here.
-- Additive only on top of 0001–0009.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_submission_id ON decisions(submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_submission_unique ON decisions(submission_id);

CREATE TABLE IF NOT EXISTS event_participations (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  user_id TEXT,
  role_label TEXT,
  status TEXT NOT NULL,
  bio TEXT,
  company TEXT,
  title TEXT,
  headshot_file_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_participations_event_id ON event_participations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_participations_person_id ON event_participations(person_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_participations_event_person
  ON event_participations(event_id, person_id);

-- Program sessions (not auth_sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  source_submission_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  track_id TEXT,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_event_id ON sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_sessions_source_submission ON sessions(source_submission_id);

CREATE TABLE IF NOT EXISTS session_speakers (
  session_id TEXT NOT NULL,
  participation_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, participation_id)
);

CREATE INDEX IF NOT EXISTS idx_session_speakers_participation ON session_speakers(participation_id);

CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  trigger TEXT NOT NULL,
  due_offset_days INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_templates_event_id ON task_templates(event_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_event_trigger ON task_templates(event_id, trigger);

CREATE TABLE IF NOT EXISTS speaker_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL,
  participation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  due_at TEXT,
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_speaker_tasks_participation ON speaker_tasks(participation_id);
CREATE INDEX IF NOT EXISTS idx_speaker_tasks_template ON speaker_tasks(template_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_speaker_tasks_template_participation
  ON speaker_tasks(template_id, participation_id);
