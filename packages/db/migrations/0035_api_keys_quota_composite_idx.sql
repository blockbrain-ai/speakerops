-- SpeakerOps api_keys (created_by, created_at) composite index (8.4 quota).
--
-- 0034 shipped a single-column created_by index and was applied remotely
-- before the quota gained its rolling 24h mint arm. The composite index
-- serves both quota COUNTs — created_by prefix for the active count, the
-- (created_by, created_at) pair turns the 24h window count into an index
-- range scan. Supersedes and drops the 0034 index (its prefix is covered).
-- Additive + drop-redundant only; no data change; safe on D1.
-- Rollback: DROP INDEX idx_api_keys_created_by_created_at;
--           CREATE INDEX idx_api_keys_created_by ON api_keys(created_by);

CREATE INDEX IF NOT EXISTS idx_api_keys_created_by_created_at
  ON api_keys(created_by, created_at);

DROP INDEX IF EXISTS idx_api_keys_created_by;
