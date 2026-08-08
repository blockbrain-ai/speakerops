/**
 * Admin evaluations rollup (section 3.4).
 * Aggregate scores visible to admin via GET /api/events/:eventId/eval/rollup.
 */
import { useCallback, useEffect, useState } from "react";
import {
  EvalAdminRollupResponseSchema,
  ErrorEnvelopeSchema,
  type EvalAdminSubmissionRollup,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

export function AdminEvaluationsPage() {
  const { activeEventId } = useEventContext();
  const [rows, setRows] = useState<EvalAdminSubmissionRollup[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRound, setHasRound] = useState(false);

  const load = useCallback(async (eventId: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/eval/rollup`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setLoadError(env.success ? env.data.error : `Failed (${res.status})`);
        setRows([]);
        setLoading(false);
        return;
      }
      const raw: unknown = await res.json();
      const parsed = EvalAdminRollupResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError("Unexpected rollup response");
        setRows([]);
        setLoading(false);
        return;
      }
      setHasRound(parsed.data.round != null);
      setRows(parsed.data.submissions);
    } catch {
      setLoadError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeEventId) {
      void load(activeEventId);
    }
  }, [activeEventId, load]);

  return (
    <div
      className="event-settings"
      data-testid="page-evaluations"
      data-section="3.4"
    >
      <p className="page-stub__overline">Evaluations</p>
      <h2 className="page-stub__title">Evaluation progress</h2>
      <p className="page-stub__body">
        Aggregate scores per submission (weighted mean of scored assignments).{" "}
        <a
          href="/admin/settings/rubric"
          className="design-kit__link lumen-focusable"
          data-testid="evaluations-rubric-link"
        >
          Edit rubric →
        </a>
      </p>

      {!activeEventId ? (
        <p className="eval-queue__muted">Select an event.</p>
      ) : null}
      {loading ? (
        <p className="eval-queue__muted" data-testid="eval-rollup-loading">
          Loading…
        </p>
      ) : null}
      {loadError ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="eval-rollup-error"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {activeEventId && !loading && !loadError ? (
        <section
          className="event-settings__card"
          data-testid="eval-rollup-section"
        >
          {!hasRound ? (
            <p className="eval-queue__muted" data-testid="eval-rollup-no-rubric">
              No rubric configured yet. Configure criteria under Settings → Eval
              rubric.
            </p>
          ) : null}
          {hasRound && rows.length === 0 ? (
            <p className="eval-queue__muted" data-testid="eval-rollup-empty">
              No submissions for this event yet.
            </p>
          ) : null}
          {rows.length > 0 ? (
            <table
              className="eval-queue__table"
              data-testid="eval-rollup-table"
            >
              <thead>
                <tr>
                  <th scope="col">Submission</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assignments</th>
                  <th scope="col">Aggregate score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.submissionId}
                    data-testid={`eval-rollup-row-${row.submissionId}`}
                    data-aggregate-score={
                      row.aggregateScore != null
                        ? String(row.aggregateScore)
                        : ""
                    }
                  >
                    <td data-testid={`eval-rollup-title-${row.submissionId}`}>
                      {row.title}
                    </td>
                    <td>{row.status}</td>
                    <td>{row.assignments.length}</td>
                    <td
                      data-testid={`eval-aggregate-score-${row.submissionId}`}
                    >
                      {row.aggregateScore != null
                        ? row.aggregateScore.toFixed(2)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
