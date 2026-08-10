-- SpeakerOps task_templates link_url + required — post-11.9 depth (Wave 2 portal task depth)
-- link_url  TEXT — optional https:// resource link rendered on portal task cards
--   (server validates https only; http rejected). NULL = no link (pre-depth behavior).
-- required  INTEGER NOT NULL DEFAULT 0 — when 1, incomplete instantiated tasks
--   keep portal readiness at needs_action; optional-only incomplete no longer blocks.
-- Existing templates keep [NULL, 0] (no link, optional) — behavior unchanged.
-- Additive only on top of 0001–0029.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

PRAGMA foreign_keys = ON;

ALTER TABLE task_templates ADD COLUMN link_url TEXT;
ALTER TABLE task_templates ADD COLUMN required INTEGER NOT NULL DEFAULT 0;
