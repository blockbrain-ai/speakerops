-- SpeakerOps file_assets form binding — final-audit CFP upload hardening.
--
-- Public CFP uploads must be authorized against the ACTIVE published form
-- version and an exact file-typed field, and that authorization must be
-- PERSISTED so Submission.Create can re-check it: the referenced upload's
-- stored form_version_id must equal the submission's pinned version and its
-- stored field_key must equal the answering field. Without persistence, an
-- asset authorized via one form/field could be replayed against another.
--
-- Columns are nullable: logo/portal (headshot/slides) assets carry no CFP
-- binding, and pre-existing CFP assets keep honest NULLs (they are no longer
-- submittable — the binding check fails closed).
-- Additive only on top of 0001–0032.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see
-- OPERATIONS notes).

PRAGMA foreign_keys = ON;

ALTER TABLE file_assets ADD COLUMN form_version_id TEXT;
ALTER TABLE file_assets ADD COLUMN field_key TEXT;
