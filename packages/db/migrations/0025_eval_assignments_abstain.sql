-- SpeakerOps eval_assignments abstain — post-11.9 depth (Wave 1A item 4)
-- Assignment status set grows to pending | scored | abstained (TEXT column, Zod-validated).
-- abstain_reason TEXT — optional evaluator-provided reason, shown to admins in rollup detail.
-- Abstained assignments are excluded from score aggregates and counted distinctly.
-- Additive only on top of 0001–0024.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

ALTER TABLE eval_assignments ADD COLUMN abstain_reason TEXT;
