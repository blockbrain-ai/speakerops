-- SpeakerOps eval_rounds hide_speakers — post-11.9 depth (Wave 1B item 2)
-- hide_speakers INTEGER NOT NULL DEFAULT 0 — when 1, the evaluator proposal DTO
-- omits speakers[] entirely (server-side, never CSS). Honest scope: titles and
-- free-text answers may still reveal identity; admin surfaces are unaffected.
-- Existing rounds keep 0 (roster visible) — behavior unchanged.
-- Additive only on top of 0001–0028.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

ALTER TABLE eval_rounds ADD COLUMN hide_speakers INTEGER NOT NULL DEFAULT 0;
