-- Enforce at most one program session per CFP submission.
-- Direct/sponsor sessions keep source_submission_id NULL (SQLite UNIQUE allows multiple NULLs).
-- Additive only on top of 0010_decisions.sql.
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

-- Drop non-unique index from 0010, replace with unique constraint.
DROP INDEX IF EXISTS idx_sessions_source_submission;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_source_submission_unique
  ON sessions(source_submission_id);
