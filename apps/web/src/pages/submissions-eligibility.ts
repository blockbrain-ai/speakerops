/**
 * Submission detail control gating (section 3.5 / 10.5).
 *
 * Mirrors server-side eligibility so assign/decision controls disable with a
 * reason instead of failing with a 400 after the click:
 * - Assign: SUBMISSION_EVAL_ELIGIBLE_STATUSES (submitted, in_review)
 * - Decision: SUBMISSION_DECISION_SOURCE_STATUSES (no draft / withdrawn)
 */
import {
  isSubmissionDecisionSource,
  isSubmissionEvalEligible,
} from "@speakerops/shared";

/**
 * Reason the assign controls are disabled for this status, or null when
 * assignment is allowed.
 */
export function assignIneligibleReason(status: string): string | null {
  if (isSubmissionEvalEligible(status)) return null;
  if (status === "draft") {
    return "Drafts cannot be assigned — the speaker has not submitted yet.";
  }
  return `Evaluator assignment is only available for submitted or in-review submissions (this one is ${status}).`;
}

/**
 * Reason the decision controls are disabled for this status, or null when a
 * decision can be recorded. Re-decisions among accepted/rejected/waitlist stay
 * allowed — only draft and withdrawn block.
 */
export function decisionIneligibleReason(status: string): string | null {
  if (isSubmissionDecisionSource(status)) return null;
  if (status === "draft") {
    return "Drafts cannot be decided — the speaker has not submitted yet.";
  }
  return `Decisions are not available for ${status} submissions.`;
}
