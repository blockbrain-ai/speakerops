-- SpeakerOps eval rubric / assignments / scores — section 3.4 (S-EVAL)
-- SCHEMA.md: eval_rounds, eval_criteria, eval_assignments, scores
-- Human scoring only (no AI). Event-scoped via eval_rounds.event_id.
-- Additive only on top of 0001–0008.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS eval_rounds (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  closes_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_rounds_event_id ON eval_rounds(event_id);

CREATE TABLE IF NOT EXISTS eval_criteria (
  id TEXT PRIMARY KEY NOT NULL,
  round_id TEXT NOT NULL,
  name TEXT NOT NULL,
  max_score REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_eval_criteria_round_id ON eval_criteria(round_id);

CREATE TABLE IF NOT EXISTS eval_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  round_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  evaluator_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  overall_comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_assignments_round_id ON eval_assignments(round_id);
CREATE INDEX IF NOT EXISTS idx_eval_assignments_evaluator ON eval_assignments(evaluator_user_id);
CREATE INDEX IF NOT EXISTS idx_eval_assignments_submission ON eval_assignments(submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_assignments_unique
  ON eval_assignments(round_id, submission_id, evaluator_user_id);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  value REAL NOT NULL,
  comment TEXT,
  UNIQUE (assignment_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_assignment_id ON scores(assignment_id);
CREATE INDEX IF NOT EXISTS idx_scores_criterion_id ON scores(criterion_id);
