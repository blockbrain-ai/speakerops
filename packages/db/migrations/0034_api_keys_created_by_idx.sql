-- SpeakerOps api_keys.created_by index (section 8.4 shared-demo quota).
--
-- Demo-persona key mints enforce a durable quota: one COUNT of active
-- (not revoked, not expired) keys created by demo persona user ids per
-- create request. Without an index on created_by that COUNT scans the
-- whole api_keys table on every demo mint. Additive index only — no data
-- change; safe on D1 (CREATE INDEX IF NOT EXISTS).
-- Rollback: DROP INDEX idx_api_keys_created_by.

CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by);
