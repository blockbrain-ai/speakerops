/**
 * Admin evaluations rollup (section 3.4 / 10.2 S-EVAL-UI / 10.6 S-EVAL-EXPORT / 11.4 S-L2-SUB).
 * Aggregate scores via GET /api/events/:eventId/eval/rollup.
 * Sort + CSV export via Eval.ExportScores (GET .../eval/export).
 * Lumen 2: coverage table, progress bars, DataTable.
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
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
  type DataTableColumn,
} from "../components/ui/index.js";

const ROLLUP_FETCH_TIMEOUT_MS = 12_000;

function assignmentCoverage(row: EvalAdminSubmissionRollup): {
  total: number;
  scored: number;
  pct: number;
} {
  const total = row.assignments.length;
  const scored = row.assignments.filter(
    (a) => a.status === "scored" || a.aggregateScore != null,
  ).length;
  const pct = total === 0 ? 0 : Math.round((scored / total) * 100);
  return { total, scored, pct };
}

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

  const coverageSummary = useMemo(() => {
    let assignmentTotal = 0;
    let assignmentScored = 0;
    let withScore = 0;
    for (const row of rows) {
      const c = assignmentCoverage(row);
      assignmentTotal += c.total;
      assignmentScored += c.scored;
      if (row.aggregateScore != null) withScore += 1;
    }
    const pct =
      assignmentTotal === 0
        ? 0
        : Math.round((assignmentScored / assignmentTotal) * 100);
    return {
      submissionCount: rows.length,
      withScore,
      assignmentTotal,
      assignmentScored,
      pct,
    };
  }, [rows]);

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

  const columns: DataTableColumn<EvalAdminSubmissionRollup>[] = [
    {
      id: "title",
      header: "Submission",
      primary: true,
      cell: (row) => (
        <>
          <span data-testid={`eval-rollup-title-${row.submissionId}`}>
            {row.title}
          </span>
          {row.category ? (
            <span className="l2-table__secondary">{row.category}</span>
          ) : null}
        </>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge tone="neutral" data-testid={`eval-rollup-status-${row.submissionId}`}>
          {row.status}
        </Badge>
      ),
    },
    {
      id: "coverage",
      header: "Coverage",
      cell: (row) => {
        const c = assignmentCoverage(row);
        return (
          <div
            className="eval-coverage__cell"
            data-testid={`eval-coverage-${row.submissionId}`}
            data-scored={c.scored}
            data-total={c.total}
            data-pct={c.pct}
          >
            <span className="eval-coverage__label">
              {c.scored}/{c.total} scored
            </span>
            <div
              className="eval-coverage__track"
              role="progressbar"
              aria-valuenow={c.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Evaluation coverage ${c.pct}%`}
            >
              <div
                className="eval-coverage__fill"
                style={{ width: `${c.pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      id: "assignments",
      header: "Assignments",
      cell: (row) => row.assignments.length,
    },
    {
      id: "score",
      header: "Aggregate score",
      cell: (row) => (
        <span data-testid={`eval-aggregate-score-${row.submissionId}`}>
          {row.aggregateScore != null ? row.aggregateScore.toFixed(2) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div
      className="event-settings eval-admin-page"
      data-testid="page-evaluations"
      data-section="11.4"
      data-layout="coverage-table"
    >
      <PageHeader
        eyebrow="Evaluations"
        title="Evaluation progress"
        description="Coverage and aggregate scores per submission (weighted mean of scored assignments)."
        data-testid="evaluations-page-header"
        actions={
          <a
            href="/admin/settings/rubric"
            className="l2-btn l2-btn--secondary lumen-focusable"
            data-testid="evaluations-rubric-link"
          >
            <span className="l2-btn__label">Edit rubric →</span>
          </a>
        }
      />

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="eval-rollup-no-event">
          Select an event.
        </p>
      ) : null}
      {loading ? (
        <div data-testid="eval-rollup-loading" aria-busy="true">
          <p className="eval-queue__muted">Loading…</p>
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      ) : null}
      {loadError ? (
        <Alert tone="danger" data-testid="eval-rollup-error">
          {loadError}
        </Alert>
      ) : null}

      {activeEventId && !loading && !loadError ? (
        <section
          className="eval-admin-page__section"
          data-testid="eval-rollup-section"
          data-has-round={hasRound ? "1" : "0"}
          data-criteria-count={String(criteriaCount)}
        >
          {!hasRound ? (
            <EmptyState
              title="No rubric configured"
              description="Configure criteria under Settings → Eval rubric before tracking coverage."
              data-testid="eval-rollup-no-rubric"
              action={
                <a
                  href="/admin/settings/rubric"
                  className="l2-btn l2-btn--primary lumen-focusable"
                  data-testid="eval-rollup-rubric-cta"
                >
                  <span className="l2-btn__label">Open rubric settings</span>
                </a>
              }
            />
          ) : null}
          {hasRound && rows.length === 0 ? (
            <p className="eval-queue__muted" data-testid="eval-rollup-empty">
              No submissions for this event yet.
            </p>
          ) : null}
          {rows.length > 0 ? (
            <>
              <Card
                className="eval-admin-page__summary"
                data-testid="eval-coverage-summary"
                title="Coverage overview"
                meta={`${coverageSummary.assignmentScored} of ${coverageSummary.assignmentTotal} assignments scored · ${coverageSummary.withScore}/${coverageSummary.submissionCount} submissions have an aggregate`}
              >
                <div
                  className="eval-coverage__summary-track"
                  role="progressbar"
                  aria-valuenow={coverageSummary.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Overall evaluation coverage ${coverageSummary.pct}%`}
                  data-testid="eval-coverage-progress"
                  data-pct={coverageSummary.pct}
                >
                  <div
                    className="eval-coverage__fill"
                    style={{ width: `${coverageSummary.pct}%` }}
                  />
                </div>
                <p
                  className="eval-coverage__summary-label"
                  data-testid="eval-coverage-progress-label"
                >
                  {coverageSummary.pct}% complete
                </p>
              </Card>

              <div
                className="submissions-page__toolbar eval-admin-page__toolbar"
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
                <Button
                  variant="primary"
                  data-testid="eval-export-csv"
                  data-inv="F05"
                  disabled={exporting}
                  pending={exporting}
                  onClick={() => void onExport()}
                >
                  {exporting ? "Exporting…" : "Export CSV"}
                </Button>
              </div>
              {exportError ? (
                <Alert tone="danger" data-testid="eval-export-error">
                  {exportError}
                </Alert>
              ) : null}
              <DataTable
                data-testid="eval-rollup-table"
                columns={columns}
                rows={sortedRows}
                getRowId={(r) => r.submissionId}
                getRowTestId={(r) => `eval-rollup-row-${r.submissionId}`}
                getRowAttrs={(r) => ({
                  "data-aggregate-score":
                    r.aggregateScore != null ? String(r.aggregateScore) : "",
                })}
                wrapAttrs={{
                  "data-sort": sort,
                }}
                density="comfortable"
              />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
