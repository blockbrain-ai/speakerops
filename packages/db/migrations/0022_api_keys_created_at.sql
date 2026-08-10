-- SpeakerOps api_keys.created_at — section 7.1 (S-CLI) repair
-- 0018_api_keys.sql never created created_at while the keys DTO expects it,
-- so Keys.List failed response validation (500) on live D1 rows.
-- Additive + backfill only (linear migrations, E1). Applied remotely by owner.
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

ALTER TABLE api_keys ADD COLUMN created_at TEXT;

UPDATE api_keys
SET created_at = '2026-08-09T00:00:00.000Z'
WHERE created_at IS NULL;
