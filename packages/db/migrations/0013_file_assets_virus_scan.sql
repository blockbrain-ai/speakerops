-- SpeakerOps file_assets virus scan stub — section 4.2 (R2 portal uploads)
-- SCHEMA.md: virus_scan_status on file_assets (unscanned | clean | infected | error)
-- Stub only: new uploads default to unscanned; no scanner integration in 4.2.
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

ALTER TABLE file_assets ADD COLUMN virus_scan_status TEXT NOT NULL DEFAULT 'unscanned';
