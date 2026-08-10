-- 0020: Durable file body storage when R2 is unavailable (dogfood without R2).
-- Bytes for headshot/slides/logo can live in D1 as base64 for small assets.
-- R2 remains preferred when FILES binding is present.

CREATE TABLE IF NOT EXISTS file_blobs (
  file_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  bytes_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_blobs_event_id ON file_blobs (event_id);
