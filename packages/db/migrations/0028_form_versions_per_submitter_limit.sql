-- SpeakerOps form_versions per_submitter_limit — post-11.9 depth (Wave 1B item 3)
-- ADDITIVE knob beside submission_limit (which stays the event-wide total cap):
--   per_submitter_limit INTEGER — max submitted proposals per person (matched by
--   normalized primary-speaker email); NULL = unlimited (pre-knob behavior).
-- Enforced server-side in Submission.Create by counting existing submitted rows
-- for the event whose primary speaker email matches (lowercase/trimmed).
-- Additive only on top of 0001–0027.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

ALTER TABLE form_versions ADD COLUMN per_submitter_limit INTEGER;
