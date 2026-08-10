-- SpeakerOps form_versions min_speakers / max_speakers — post-11.9 depth (Wave 1A item 3)
-- Configurable speaker bounds per form version (1–15, Zod-validated).
-- Defaults preserve pre-knob behavior (CFP_MIN_SPEAKERS=1 / CFP_MAX_SPEAKERS=5).
-- Submission.Create enforces against the PINNED published version's bounds.
-- Additive only on top of 0001–0023.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

ALTER TABLE form_versions ADD COLUMN min_speakers INTEGER NOT NULL DEFAULT 1;
ALTER TABLE form_versions ADD COLUMN max_speakers INTEGER NOT NULL DEFAULT 5;
