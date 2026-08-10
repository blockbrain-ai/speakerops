-- SpeakerOps eval_rounds instructions_md — post-11.9 depth (Wave 1A item 5)
-- instructions_md TEXT — organiser guidance for evaluators, rendered as plain text
-- (markdown-safe, never HTML-executed) in the evaluator queue round banner.
-- closes_at already exists (0009); Eval.Score / Eval.Abstain reject after close (409).
-- Additive only on top of 0001–0025.
-- Rollback: revert git commit; use D1 Time Travel for data recovery (see OPERATIONS notes).

ALTER TABLE eval_rounds ADD COLUMN instructions_md TEXT;
