-- SpeakerOps portal social links (P6 depth) — additive JSON on event_participations.
-- Keys: linkedin, x, facebook, website (https only enforced at API).
-- Rollback: ALTER is one-way on D1; use Time Travel.

PRAGMA foreign_keys = ON;

ALTER TABLE event_participations ADD COLUMN social_links_json TEXT;
