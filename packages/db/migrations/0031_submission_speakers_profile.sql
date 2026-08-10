-- SpeakerOps submission_speakers bio/company/title — post-11.9 depth (Wave 2 speaker-info seeding)
-- Optional "About this speaker" fields captured on the public CFP submit.
-- On Decision.Record accept, these seed the event_participation profile —
-- only where the profile field is still NULL/empty; non-empty profile values
-- are never overwritten. Existing rows keep NULL (nothing provided).
-- Additive only on top of 0001–0030.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

ALTER TABLE submission_speakers ADD COLUMN bio TEXT;
ALTER TABLE submission_speakers ADD COLUMN company TEXT;
ALTER TABLE submission_speakers ADD COLUMN title TEXT;
