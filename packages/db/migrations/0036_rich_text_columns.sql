-- SpeakerOps rich-text columns — F2 rich-text primitive (expand/dual window).
--
-- Rich text persists as versioned ProseMirror JSON envelopes
-- ({"schema":"v1","doc":{...}}) in dedicated nullable *_rich_json columns
-- BESIDE the legacy plain-text columns — never same-column JSON-prefix
-- detection (an older Worker must keep reading honest plain text from the
-- legacy columns). Dual-read prefers the rich column and falls back to
-- legacy text converted to a paragraph doc at READ time; reads never write.
-- Writers write BOTH columns on save during the dual window.
--
-- Columns:
--   form_versions.welcome_rich_json / thank_you_rich_json — CFP welcome and
--     thank-you copy (legacy welcome_md / thank_you_md stay authoritative
--     for old readers).
--   form_fields.description_rich_json — per-section "Description &
--     Instructions" on layout section nodes (NEW contract; help_text is NOT
--     overloaded and keeps its 500-char input-node semantics).
--   event_participations.bio_rich_json — speaker bio (legacy bio keeps the
--     plain-text serialization).
--   email_templates.body_rich_json — comms template body (legacy body_md
--     keeps the plain-text serialization with {{merge}} tokens).
--   message_recipients.body_html — durable per-recipient HTML part snapshot
--     at send time (body stays the plain-text part; merge values are applied
--     in doc-space BEFORE both serializations).
--
-- All columns nullable: legacy rows keep honest NULLs and dual-read falls
-- back to their plain-text columns. No data change; safe on D1.
-- Additive only on top of 0001–0035.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see
-- OPERATIONS notes).

PRAGMA foreign_keys = ON;

ALTER TABLE form_versions ADD COLUMN welcome_rich_json TEXT;
ALTER TABLE form_versions ADD COLUMN thank_you_rich_json TEXT;
ALTER TABLE form_fields ADD COLUMN description_rich_json TEXT;
ALTER TABLE event_participations ADD COLUMN bio_rich_json TEXT;
ALTER TABLE email_templates ADD COLUMN body_rich_json TEXT;
ALTER TABLE message_recipients ADD COLUMN body_html TEXT;
