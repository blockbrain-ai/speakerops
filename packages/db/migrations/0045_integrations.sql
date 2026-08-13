-- Integrations hub + Accelevents identity map (additive).
-- Rollback: DROP TABLE accelevents_identities; DROP TABLE integration_connections;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS integration_connections (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  provider TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  event_url TEXT,
  external_event_id TEXT,
  connection_generation INTEGER NOT NULL DEFAULT 1,
  verification_state TEXT NOT NULL DEFAULT 'never',
  last_attempt_at TEXT,
  last_verified_at TEXT,
  last_error TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_event_provider
  ON integration_connections(event_id, provider);

CREATE TABLE IF NOT EXISTS accelevents_identities (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  connection_generation INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  internal_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS accelevents_identities_unique
  ON accelevents_identities(event_id, connection_generation, entity_type, internal_id);
