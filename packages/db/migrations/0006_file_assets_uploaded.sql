-- SpeakerOps file_assets upload readiness — phase-audit fix for section 2.4
-- Dedicated uploaded flag so checksum remains for content digests (File.CompleteUpload).
-- Additive only on top of 0001–0005.
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

-- SQLite: ADD COLUMN is additive; existing rows default to not-uploaded.
ALTER TABLE file_assets ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0;
