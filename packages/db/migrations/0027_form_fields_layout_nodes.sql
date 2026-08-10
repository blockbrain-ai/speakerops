-- SpeakerOps form_fields layout nodes — post-11.9 depth (Wave 1B item 4)
-- Discriminated node model for CFP form structure:
--   node_kind   TEXT NOT NULL DEFAULT 'input' — 'input' (answerable field) | 'layout' (section/divider)
--   layout_type TEXT                          — 'section' | 'divider' when node_kind='layout'; NULL for inputs
-- Layout nodes never participate in answers, required checks, conditional-rule
-- field lookups, submission payloads, or CSV export columns (I16 untouched).
-- Existing rows keep the 'input' default — behavior unchanged.
-- Additive only on top of 0001–0026.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

ALTER TABLE form_fields ADD COLUMN node_kind TEXT NOT NULL DEFAULT 'input';
ALTER TABLE form_fields ADD COLUMN layout_type TEXT;
