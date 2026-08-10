-- SpeakerOps form_fields help_text / placeholder / max_chars — post-11.9 depth (Wave 1A item 1)
-- Optional author-facing depth knobs on CFP form fields:
--   help_text   TEXT     — guidance rendered under the label on public CFP + preview (≤500 chars, Zod)
--   placeholder TEXT     — input placeholder copy (≤200 chars, Zod)
--   max_chars   INTEGER  — character cap for text/textarea answers (server-enforced on Submission.Create)
-- Additive only on top of 0001–0022; existing rows keep NULL (no cap / no help).
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

ALTER TABLE form_fields ADD COLUMN help_text TEXT;
ALTER TABLE form_fields ADD COLUMN placeholder TEXT;
ALTER TABLE form_fields ADD COLUMN max_chars INTEGER;
