/**
 * Admin evaluations rollup (section 3.4 / 10.2 S-EVAL-UI / 10.6 S-EVAL-EXPORT).
 * Aggregate scores via GET /api/events/:eventId/eval/rollup.
 * Sort + CSV export via Eval.ExportScores (GET .../eval/export).
 * Contract: EvalAdminRollupResponseSchema — never surface "Response validation failed".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EvalAdminRollupResponseSchema,
  ErrorEnvelopeSchema,
  EvalScoreSortSchema,
  sortEvalSubmissionsByScore,
  type EvalAdminSubmissionRollup,
  type EvalScoreSort,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

const ROLLUP_FETCH_TIMEOUT_MS = 12_000;

export function AdminEvaluationsPage() {
  const { activeEventId } = useEventContext();
  const [rows, setRows] = useState<EvalAdminSubmissionRollup[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRound, setHasRound] = useState(false);
  const [criteriaCount, setCriteriaCount] = useState(0);
  const [sort, setSort] = useState<EvalScoreSort>("score_desc");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (eventId: string) => {
    setLoading(true);
    setLoadError(null);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      ROLLUP_FETCH_TIMEOUT_MS,
    );
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/eval/rollup`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
          signal: controller.signal,
        },
      );
      if (res.status === 401) {
        setLoadError("Sign in required");
        setRows([]);
        setHasRound(false);
        setCriteriaCount(0);
        return;
      }
      if (res.status === 403) {
        setLoadError("Admin role required to view evaluation progress");
        setRows([]);
        setHasRound(false);
        setCriteriaCount(0);
        return;
      }
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        // Map server Zod-output failure (pre-10.2) to recovery copy — never
        // leave operators blocked on the raw INTERNAL_ERROR string alone.
        const msg = env.success
          ? env.data.error === "Response validation failed"
            ? "Evaluation progress could not be loaded (server response invalid). Retry or re-save the rubric."
            : env.data.error
          : `Failed (${res.status})`;
        setLoadError(msg);
        setRows([]);
        setHasRound(false);
        setCriteriaCount(0);
        return;
      }
      const raw: unknown = await res.json();
      const parsed = EvalAdminRollupResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError(
          "Evaluation progress response was not understood. Retry or contact support.",
        );
        setRows([]);
        setHasRound(false);
        setCriteriaCount(0);
        return;
      }
      setHasRound(parsed.data.round != null);
      setCriteriaCount(parsed.data.criteria.length);
      setRows(parsed.data.submissions);
      setLoadError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setLoadError("Timed out loading evaluation progress");
      } else {
        setLoadError("Network error");
      }
      setRows([]);
      setHasRound(false);
      setCriteriaCount(0);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeEventId) {
      void load(activeEventId);
    } else {
      setRows([]);
      setHasRound(false);
      setCriteriaCount(0);
      setLoadError(null);
      setLoading(false);
    }
  }, [activeEventId, load]);

  const sortedRows = useMemo(
    () => sortEvalSubmissionsByScore(rows, sort),
    [rows, sort],
  );

  const onSortChange = useCallback((value: string) => {
    const parsed = EvalScoreSortSchema.safeParse(value);
    if (parsed.success) setSort(parsed.data);
  }, []);

  const onExport = useCallback(async () => {
    if (!activeEventId) return;
    setExporting(true);
    setExportError(null);
    try {
      const params = new URLSearchParams({ sort });
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/eval/export?${params}`,
        {
          credentials: "include",
          headers: { accept: "text/csv" },
        },
      );
      if (res.status === 401) {
        setExportError("Sign in required");
        return;
      }
      if (res.status === 403) {
        setExportError("Admin role required to export scores");
        return;
      }
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setExportError(
          env.success ? env.data.error : `Export failed (${res.status})`,
        );
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `eval-scores-${activeEventId}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      a.setAttribute("data-testid", "eval-export-download-anchor");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Network error exporting scores");
    } finally {
      setExporting(false);
    }
  }, [activeEventId, sort]);

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
        <p className="eval-queue__muted" data-testid="eval-rollup-no-event">
          Select an event.
        </p>
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
          data-has-round={hasRound ? "1" : "0"}
          data-criteria-count={String(criteriaCount)}
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
            <>
              <div
                className="submissions-page__toolbar"
                data-testid="eval-rollup-toolbar"
              >
                <label className="event-settings__label" htmlFor="eval-sort">
                  Sort by
                </label>
                <select
                  id="eval-sort"
                  className="event-settings__input lumen-focusable"
                  data-testid="eval-sort-select"
                  value={sort}
                  onChange={(e) => onSortChange(e.target.value)}
                >
                  <option value="score_desc">Score (high → low)</option>
                  <option value="score_asc">Score (low → high)</option>
                  <option value="title">Title</option>
                </select>
                <button
                  type="button"
                  className="event-settings__submit lumen-focusable"
                  data-testid="eval-export-csv"
                  data-inv="F05"
                  disabled={exporting}
                  onClick={() => void onExport()}
                >
                  {exporting ? "Exporting…" : "Export CSV"}
                </button>
              </div>
              {exportError ? (
                <p
                  className="event-settings__status event-settings__status--error"
                  data-testid="eval-export-error"
                  role="alert"
                >
                  {exportError}
                </p>
              ) : null}
              <table
                className="eval-queue__table"
                data-testid="eval-rollup-table"
                data-sort={sort}
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
                  {sortedRows.map((row) => (
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
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
