-- SpeakerOps task_templates.required default repair (contract fix after 0030).
--
-- Pre-0030, EVERY incomplete task blocked portal readiness. 0030 introduced
-- the per-template `required` knob but defaulted it to 0 (optional), silently
-- flipping every pre-existing template to optional — incomplete tasks stopped
-- blocking readiness (live demo: 14/14 templates optional, 301 incomplete
-- optional tasks no longer blocking). That regressed the required-task
-- semantics organizers already relied on.
--
-- Repair (matches the pre-0030 contract; organizers now explicitly opt INTO
-- optional):
-- 1) Backfill required=1 for ALL templates created before this migration
--    (drop + re-add fills existing rows with the new default).
-- 2) Change the column default to 1 so raw inserts stay blocking-by-default.
--
-- DROP COLUMN + ADD COLUMN (SQLite >= 3.35, supported by D1) both backfills
-- and changes the default in place — no table rebuild, no FK churn.
-- `required` carries no index and no FK, so DROP COLUMN is legal here.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see
-- OPERATIONS notes).

PRAGMA foreign_keys = ON;

ALTER TABLE task_templates DROP COLUMN required;
ALTER TABLE task_templates ADD COLUMN required INTEGER NOT NULL DEFAULT 1;
