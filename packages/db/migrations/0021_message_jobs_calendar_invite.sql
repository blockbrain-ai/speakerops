-- message_jobs.calendar_invite_id — optional ICS attach-on-send carrier (S-COMMS)
-- Written only by Comms.Send; consumer loads calendar_invites.ics_body for attachment.
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

ALTER TABLE message_jobs ADD COLUMN calendar_invite_id TEXT;
