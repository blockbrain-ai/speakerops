-- SpeakerOps API keys — section 7.1 (S-CLI)
-- SCHEMA.md: api_keys
-- key_hash only — plaintext secret never persists (E10).
-- scopes_json stores granted scopes; default-deny high-risk scopes unless explicit.
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  event_id TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys(org_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);

CREATE INDEX IF NOT EXISTS idx_api_keys_event_id ON api_keys(event_id);
