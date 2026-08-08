-- SpeakerOps task_templates optimistic version — Phase 4 audit (E1)
-- Mutable aggregate updated via TaskTemplate.Update/Delete (O05) must carry version.
-- Additive ALTER only; existing rows default to version=1.
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

ALTER TABLE task_templates ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
