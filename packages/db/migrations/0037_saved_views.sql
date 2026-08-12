-- SpeakerOps saved_views — F3 data-grid primitive (additive).
--
-- Per-user, per-event, per-surface grid view definitions (column set/order/
-- widths, sort, filters, density). Fail-closed: version for optimistic CAS,
-- unique case-insensitive name per (user,event,surface), at most one default
-- per scope, ≤20 active views per (user,event,surface).
--
-- Additive only on top of 0001–0036. Rollback: D1 Time Travel.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  surface TEXT NOT NULL,
  name TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_views_user_event_surface
  ON saved_views (user_id, event_id, surface);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_views_name_scope
  ON saved_views (user_id, event_id, surface, name COLLATE NOCASE);

-- Partial unique: one default per scope (SQLite supports WHERE on unique index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_views_default_scope
  ON saved_views (user_id, event_id, surface)
  WHERE is_default = 1;
