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
  EvalBulkAssignResponseSchema,
  EventMembersResponseSchema,
  sortEvalSubmissionsByScore,
  type EvalAdminSubmissionRollup,
  type EvalBulkAssignResponse,
  type EvalScoreSort,
  type EventMember,
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
  const [roundId, setRoundId] = useState<string | null>(null);
  const [criteriaCount, setCriteriaCount] = useState(0);
  const [sort, setSort] = useState<EvalScoreSort>("score_desc");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  /** Expanded submission ids for individual review visibility. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(submissionId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(submissionId)) next.delete(submissionId);
      else next.add(submissionId);
      return next;
    });
  }

  /**
   * Load the rollup. `background: true` refreshes rows in place WITHOUT
   * toggling `loading` — the section stays mounted, so the bulk-assign
   * wizard keeps its state (selections, preview, success alert) across the
   * post-apply refresh instead of being unmounted and reset.
   */
  const load = useCallback(
    async (eventId: string, opts?: { background?: boolean }) => {
      const background = opts?.background === true;
      if (!background) setLoading(true);
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
        setRoundId(null);
        setCriteriaCount(0);
        return;
      }
      if (res.status === 403) {
        setLoadError("Admin role required to view evaluation progress");
        setRows([]);
        setHasRound(false);
        setRoundId(null);
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
        setRoundId(null);
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
        setRoundId(null);
        setCriteriaCount(0);
        return;
      }
      setHasRound(parsed.data.round != null);
      setRoundId(parsed.data.round?.id ?? null);
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
        setRoundId(null);
      setCriteriaCount(0);
    } finally {
      clearTimeout(timer);
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeEventId) {
      void load(activeEventId);
    } else {
      setRows([]);
      setHasRound(false);
        setRoundId(null);
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
    let abstained = 0;
    for (const row of rows) {
      const c = assignmentCoverage(row);
      assignmentTotal += c.total;
      assignmentScored += c.scored;
      if (row.aggregateScore != null) withScore += 1;
      abstained +=
        row.abstainedCount ??
        row.assignments.filter((a) => a.status === "abstained").length;
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
      abstained,
      pct,
    };
  }, [rows]);

  /** Top 10 by aggregate score (insights; post-11.9 depth). */
  const topTen = useMemo(
    () =>
      rows
        .filter(
          (r) => r.aggregateScore != null && Number.isFinite(r.aggregateScore),
        )
        .sort((a, b) => (b.aggregateScore ?? 0) - (a.aggregateScore ?? 0))
        .slice(0, 10),
    [rows],
  );

  /** Largest reviewer disagreement (max−min aggregate spread ≥ 2 reviews). */
  const divergent = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.scoreSpread != null &&
            Number.isFinite(r.scoreSpread) &&
            r.scoreSpread > 0,
        )
        .sort((a, b) => (b.scoreSpread ?? 0) - (a.scoreSpread ?? 0))
        .slice(0, 10),
    [rows],
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

  const columns: DataTableColumn<EvalAdminSubmissionRollup>[] = [
    {
      id: "title",
      header: "Submission",
      primary: true,
      cell: (row) => (
        <>
          <a
            href={`/admin/submissions?submissionId=${encodeURIComponent(row.submissionId)}`}
            className="eval-queue__link lumen-focusable"
            data-testid={`eval-rollup-title-${row.submissionId}`}
          >
            {row.title}
          </a>
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
    {
      id: "reviews",
      header: "Reviews",
      cell: (row) => (
        <Button
          type="button"
          variant="quiet"
          size="sm"
          data-testid={`eval-reviews-toggle-${row.submissionId}`}
          aria-expanded={expanded.has(row.submissionId)}
          disabled={row.assignments.length === 0}
          onClick={() => toggleExpanded(row.submissionId)}
        >
          {expanded.has(row.submissionId) ? "Hide reviews" : "Show reviews"}
        </Button>
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
                meta={`${coverageSummary.assignmentScored} of ${coverageSummary.assignmentTotal} assignments scored · ${coverageSummary.withScore}/${coverageSummary.submissionCount} submissions have an aggregate${coverageSummary.abstained > 0 ? ` · ${coverageSummary.abstained} abstained` : ""}`}
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
                {coverageSummary.abstained > 0 ? (
                  <p
                    className="eval-queue__muted"
                    data-testid="eval-coverage-abstained"
                    data-abstained={coverageSummary.abstained}
                  >
                    {coverageSummary.abstained} review
                    {coverageSummary.abstained === 1 ? "" : "s"} abstained —
                    excluded from every aggregate.
                  </p>
                ) : null}
              </Card>

              {/* Bulk-assign wizard (Wave 2 / F14) */}
              {hasRound && roundId ? (
                <BulkAssignWizard
                  eventId={activeEventId}
                  roundId={roundId}
                  onApplied={() =>
                    void load(activeEventId, { background: true })
                  }
                />
              ) : null}

              {/* Insights — top scores + reviewer divergence (post-11.9 depth) */}
              <div
                className="eval-insights"
                data-testid="eval-insights"
                data-top-count={topTen.length}
                data-divergent-count={divergent.length}
              >
                <Card
                  className="eval-insights__card"
                  data-testid="eval-insights-top"
                  title="Top 10 by aggregate"
                  meta="Weighted mean across scored reviews"
                >
                  {topTen.length === 0 ? (
                    <p
                      className="eval-queue__muted"
                      data-testid="eval-insights-top-empty"
                    >
                      No scored submissions yet. Rankings appear as soon as the
                      first review is saved.
                    </p>
                  ) : (
                    <ol
                      className="eval-insights__list"
                      data-testid="eval-insights-top-list"
                    >
                      {topTen.map((r, i) => (
                        <li
                          key={r.submissionId}
                          className="eval-insights__row"
                          data-testid={`eval-insights-top-${i + 1}`}
                          data-submission-id={r.submissionId}
                          data-score={
                            r.aggregateScore != null
                              ? r.aggregateScore.toFixed(2)
                              : ""
                          }
                        >
                          <span className="eval-insights__rank">{i + 1}</span>
                          <a
                            href={`/admin/submissions?submissionId=${encodeURIComponent(r.submissionId)}`}
                            className="eval-queue__link lumen-focusable eval-insights__title"
                            data-testid={`eval-insights-top-link-${r.submissionId}`}
                          >
                            {r.title}
                          </a>
                          <span className="eval-insights__value">
                            {r.aggregateScore != null
                              ? r.aggregateScore.toFixed(2)
                              : "—"}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
                <Card
                  className="eval-insights__card"
                  data-testid="eval-insights-divergence"
                  title="Largest disagreement"
                  meta="Spread between the highest and lowest review"
                >
                  {divergent.length === 0 ? (
                    <p
                      className="eval-queue__muted"
                      data-testid="eval-insights-divergence-empty"
                    >
                      No disagreement to show — spreads appear once a
                      submission has two or more scored reviews.
                    </p>
                  ) : (
                    <ol
                      className="eval-insights__list"
                      data-testid="eval-insights-divergence-list"
                    >
                      {divergent.map((r, i) => (
                        <li
                          key={r.submissionId}
                          className="eval-insights__row"
                          data-testid={`eval-insights-divergence-${i + 1}`}
                          data-submission-id={r.submissionId}
                          data-spread={
                            r.scoreSpread != null
                              ? r.scoreSpread.toFixed(2)
                              : ""
                          }
                        >
                          <span className="eval-insights__rank">{i + 1}</span>
                          <a
                            href={`/admin/submissions?submissionId=${encodeURIComponent(r.submissionId)}`}
                            className="eval-queue__link lumen-focusable eval-insights__title"
                            data-testid={`eval-insights-divergence-link-${r.submissionId}`}
                          >
                            {r.title}
                          </a>
                          <span className="eval-insights__value">
                            ± {r.scoreSpread != null ? r.scoreSpread.toFixed(2) : "—"}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </div>

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

              {sortedRows
                .filter((r) => expanded.has(r.submissionId))
                .map((row) => (
                  <Card
                    key={`reviews-${row.submissionId}`}
                    className="eval-admin-page__reviews"
                    data-testid={`eval-reviews-panel-${row.submissionId}`}
                    title={`Reviews · ${row.title}`}
                    meta={`${row.assignments.length} assignment(s)`}
                  >
                    {row.assignments.length === 0 ? (
                      <p className="eval-queue__muted">No assignments yet.</p>
                    ) : (
                      <ul
                        className="eval-reviews-list"
                        data-testid={`eval-reviews-list-${row.submissionId}`}
                      >
                        {row.assignments.map((a) => (
                          <li
                            key={a.id}
                            className="eval-reviews-list__item"
                            data-testid={`eval-review-${a.id}`}
                            data-status={a.status}
                          >
                            <div className="eval-reviews-list__meta">
                              <strong>
                                {a.evaluatorEmail?.trim() || a.evaluatorUserId}
                              </strong>
                              <Badge
                                tone={
                                  a.status === "scored"
                                    ? "success"
                                    : a.status === "abstained"
                                      ? "warn"
                                      : "neutral"
                                }
                              >
                                {a.status}
                              </Badge>
                              <span className="eval-queue__muted">
                                {a.status === "abstained"
                                  ? "abstained — not counted"
                                  : a.aggregateScore != null
                                    ? `score ${a.aggregateScore.toFixed(2)}`
                                    : "no score"}
                              </span>
                            </div>
                            {a.status === "abstained" ? (
                              <p
                                className="eval-reviews-list__comment"
                                data-testid={`eval-review-abstain-reason-${a.id}`}
                              >
                                {a.abstainReason?.trim()
                                  ? `Abstained: ${a.abstainReason}`
                                  : "Abstained without a reason."}
                              </p>
                            ) : null}
                            {a.overallComment ? (
                              <p
                                className="eval-reviews-list__comment"
                                data-testid={`eval-review-comment-${a.id}`}
                              >
                                {a.overallComment}
                              </p>
                            ) : a.status !== "abstained" ? (
                              <p className="eval-queue__muted">No comment.</p>
                            ) : null}
                            {a.scores && a.scores.length > 0 ? (
                              <p className="eval-queue__muted eval-reviews-list__scores">
                                {a.scores
                                  .map((s) => `${s.criterionId}: ${s.value}`)
                                  .join(" · ")}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ))}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Bulk-assign wizard (Wave 2 / F14) — plan-first cohort assignment.
 * Preview computes a deterministic plan server-side (dryRun=true) and returns
 * a previewId bound to the current estate; any input change invalidates the
 * preview. Apply commits with that previewId — a drifted estate returns 409
 * with honest copy prompting a re-preview.
 */
function BulkAssignWizard({
  eventId,
  roundId,
  onApplied,
}: {
  eventId: string;
  roundId: string;
  onApplied: () => void;
}) {
  const [evaluators, setEvaluators] = useState<EventMember[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  /** Bumped after a successful apply so the roster workload counts refresh. */
  const [rosterRefresh, setRosterRefresh] = useState(0);

  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"all_to_all" | "round_robin">("all_to_all");
  const [reviewersPer, setReviewersPer] = useState("1");
  const [maxPer, setMaxPer] = useState("");
  const [existing, setExisting] = useState<"preserve" | "replace">("preserve");

  const [preview, setPreview] = useState<EvalBulkAssignResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    additions: number;
    removals: number;
    skipped: number;
    idempotent: boolean;
  } | null>(null);

  /** Any input change makes an existing preview stale — clear it. */
  const invalidatePreview = useCallback(() => {
    setPreview(null);
    setWizardError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/members?role=evaluator`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (cancelled) return;
        if (!res.ok) {
          setEvaluators([]);
          setRosterError(
            res.status === 403
              ? "Admin role required to list evaluators"
              : `Could not load evaluators (${res.status})`,
          );
          return;
        }
        const raw: unknown = await res.json();
        const parsed = EventMembersResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setEvaluators([]);
          setRosterError("Evaluator list response was not understood");
          return;
        }
        setEvaluators(parsed.data.members);
      } catch {
        if (!cancelled) {
          setEvaluators([]);
          setRosterError("Network error loading evaluators");
        }
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, rosterRefresh]);

  function toggleEvaluator(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
    invalidatePreview();
  }

  function buildBody(dryRun: boolean, previewId?: string) {
    const filter: Record<string, string> = {};
    if (statusFilter) filter.status = statusFilter;
    if (categoryFilter.trim()) filter.category = categoryFilter.trim();
    const body: Record<string, unknown> = {
      roundId,
      evaluatorIds: [...selected].sort(),
      submissionFilter: filter,
      mode,
      existing,
      dryRun,
    };
    if (mode === "round_robin") {
      const rps = Number(reviewersPer);
      body.reviewersPerSubmission =
        Number.isInteger(rps) && rps >= 1 ? rps : 1;
    }
    const cap = Number(maxPer);
    if (maxPer.trim() !== "" && Number.isInteger(cap) && cap >= 1) {
      body.maxPerEvaluator = cap;
    }
    if (previewId) body.previewId = previewId;
    return body;
  }

  async function postPlan(
    body: Record<string, unknown>,
  ): Promise<EvalBulkAssignResponse | null> {
    const res = await fetch(
      `/api/events/${encodeURIComponent(eventId)}/eval/bulk-assign`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const raw: unknown = await res.json().catch(() => null);
      const env = ErrorEnvelopeSchema.safeParse(raw);
      const msg = env.success ? env.data.error : `Request failed (${res.status})`;
      setWizardError(
        res.status === 409 && env.success
          ? msg
          : res.status === 401
            ? "Sign in required"
            : res.status === 403
              ? "Admin role required to assign evaluators"
              : msg,
      );
      return null;
    }
    const raw: unknown = await res.json();
    const parsed = EvalBulkAssignResponseSchema.safeParse(raw);
    if (!parsed.success) {
      setWizardError("Assignment plan response was not understood");
      return null;
    }
    return parsed.data;
  }

  async function onPreview() {
    if (selected.size === 0) return;
    setPreviewing(true);
    setWizardError(null);
    setResult(null);
    try {
      const plan = await postPlan(buildBody(true));
      setPreview(plan);
    } catch {
      setWizardError("Network error building the preview");
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function onCommit() {
    if (!preview) return;
    setCommitting(true);
    setWizardError(null);
    try {
      const applied = await postPlan(buildBody(false, preview.previewId));
      if (!applied) {
        // 409 stale (or other failure) — force a fresh preview.
        setPreview(null);
        return;
      }
      setResult({
        additions: applied.counts.additions,
        removals: applied.counts.removals,
        skipped: applied.counts.skipped,
        idempotent: applied.idempotent === true,
      });
      setPreview(null);
      setRosterRefresh((n) => n + 1);
      onApplied();
    } catch {
      setWizardError("Network error applying the plan");
      setPreview(null);
    } finally {
      setCommitting(false);
    }
  }

  /** Skip reasons grouped for compact display. */
  const skipGroups = useMemo(() => {
    if (!preview) return [] as Array<{ reason: string; count: number }>;
    const byReason = new Map<string, number>();
    for (const s of preview.skipped) {
      byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    }
    return [...byReason.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => a.reason.localeCompare(b.reason));
  }, [preview]);

  return (
    <Card
      className="eval-admin-page__bulk"
      data-testid="eval-bulk-card"
      title="Assign evaluators"
      meta="Preview a bulk assignment plan for this round, then apply it. Nothing changes until you apply."
    >
      {/* Step a — which submissions */}
      <div
        className="submissions-page__toolbar eval-admin-page__toolbar"
        data-testid="eval-bulk-filters"
      >
        <label className="event-settings__label" htmlFor="eval-bulk-status">
          Submissions
        </label>
        <select
          id="eval-bulk-status"
          className="event-settings__input lumen-focusable"
          data-testid="eval-bulk-status-filter"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            invalidatePreview();
          }}
        >
          <option value="">All eligible (submitted + in review)</option>
          <option value="submitted">Submitted only</option>
          <option value="in_review">In review only</option>
        </select>
        <label className="event-settings__label" htmlFor="eval-bulk-category">
          Category
        </label>
        <input
          id="eval-bulk-category"
          className="event-settings__input lumen-focusable"
          data-testid="eval-bulk-category-filter"
          type="text"
          placeholder="Any category"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            invalidatePreview();
          }}
        />
      </div>

      {/* Step b — who reviews */}
      <p className="event-settings__label">Evaluators</p>
      {rosterLoading ? (
        <div data-testid="eval-bulk-roster-loading" aria-busy="true">
          <Skeleton variant="row" />
        </div>
      ) : null}
      {rosterError ? (
        <Alert tone="danger" data-testid="eval-bulk-roster-error">
          {rosterError}
        </Alert>
      ) : null}
      {!rosterLoading && !rosterError && evaluators.length === 0 ? (
        <p className="eval-queue__muted" data-testid="eval-bulk-roster-empty">
          No evaluators on this event yet — invite them first.
        </p>
      ) : null}
      {!rosterLoading && evaluators.length > 0 ? (
        <ul className="eval-reviews-list" data-testid="eval-bulk-roster">
          {evaluators.map((m) => (
            <li key={m.userId} className="eval-reviews-list__item">
              <label className="eval-queue__muted">
                <input
                  type="checkbox"
                  className="lumen-focusable"
                  data-testid={`eval-bulk-evaluator-${m.userId}`}
                  checked={selected.has(m.userId)}
                  onChange={() => toggleEvaluator(m.userId)}
                />{" "}
                {m.email}
                <span className="l2-table__secondary">
                  {" "}
                  · {m.assignmentCount} current assignment
                  {m.assignmentCount === 1 ? "" : "s"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Step c — how to spread the work */}
      <div
        className="submissions-page__toolbar eval-admin-page__toolbar"
        data-testid="eval-bulk-knobs"
        role="group"
        aria-label="Assignment mode"
      >
        <label className="event-settings__label">
          <input
            type="radio"
            name="eval-bulk-mode"
            className="lumen-focusable"
            data-testid="eval-bulk-mode-all"
            checked={mode === "all_to_all"}
            onChange={() => {
              setMode("all_to_all");
              invalidatePreview();
            }}
          />{" "}
          Everyone reviews everything
        </label>
        <label className="event-settings__label">
          <input
            type="radio"
            name="eval-bulk-mode"
            className="lumen-focusable"
            data-testid="eval-bulk-mode-rr"
            checked={mode === "round_robin"}
            onChange={() => {
              setMode("round_robin");
              invalidatePreview();
            }}
          />{" "}
          Share out round-robin
        </label>
        {mode === "round_robin" ? (
          <label className="event-settings__label" htmlFor="eval-bulk-rps">
            Reviewers per submission{" "}
            <input
              id="eval-bulk-rps"
              className="event-settings__input lumen-focusable"
              data-testid="eval-bulk-reviewers-per-submission"
              type="number"
              min={1}
              max={20}
              value={reviewersPer}
              onChange={(e) => {
                setReviewersPer(e.target.value);
                invalidatePreview();
              }}
            />
          </label>
        ) : null}
        <label className="event-settings__label" htmlFor="eval-bulk-cap">
          Max per evaluator{" "}
          <input
            id="eval-bulk-cap"
            className="event-settings__input lumen-focusable"
            data-testid="eval-bulk-max-per-evaluator"
            type="number"
            min={1}
            max={500}
            placeholder="No cap"
            value={maxPer}
            onChange={(e) => {
              setMaxPer(e.target.value);
              invalidatePreview();
            }}
          />
        </label>
      </div>
      <div
        className="submissions-page__toolbar eval-admin-page__toolbar"
        role="group"
        aria-label="Existing assignments"
      >
        <label className="event-settings__label">
          <input
            type="radio"
            name="eval-bulk-existing"
            className="lumen-focusable"
            data-testid="eval-bulk-existing-preserve"
            checked={existing === "preserve"}
            onChange={() => {
              setExisting("preserve");
              invalidatePreview();
            }}
          />{" "}
          Keep existing assignments
        </label>
        <label className="event-settings__label">
          <input
            type="radio"
            name="eval-bulk-existing"
            className="lumen-focusable"
            data-testid="eval-bulk-existing-replace"
            checked={existing === "replace"}
            onChange={() => {
              setExisting("replace");
              invalidatePreview();
            }}
          />{" "}
          Replace unscored assignments not in the plan
        </label>
      </div>

      {/* Step d/e — preview then apply */}
      <div className="submissions-page__toolbar eval-admin-page__toolbar">
        <Button
          variant="secondary"
          data-testid="eval-bulk-preview"
          data-inv="F14"
          disabled={selected.size === 0 || previewing || committing}
          pending={previewing}
          onClick={() => void onPreview()}
        >
          {previewing ? "Building preview…" : "Preview assignment plan"}
        </Button>
        <Button
          variant="primary"
          data-testid="eval-bulk-commit"
          data-inv="F14"
          disabled={!preview || committing || previewing}
          pending={committing}
          onClick={() => void onCommit()}
        >
          {committing ? "Applying…" : "Apply plan"}
        </Button>
        {selected.size === 0 ? (
          <span className="eval-queue__muted">
            Pick at least one evaluator to build a plan.
          </span>
        ) : !preview ? (
          <span className="eval-queue__muted">
            Preview first — applying always uses the exact plan shown.
          </span>
        ) : null}
      </div>

      {wizardError ? (
        <Alert tone="danger" data-testid="eval-bulk-error">
          {wizardError}
        </Alert>
      ) : null}
      {result ? (
        <Alert tone="success" data-testid="eval-bulk-result">
          {result.idempotent
            ? "This plan was already applied — nothing changed."
            : `Plan applied — ${result.additions} assignment${result.additions === 1 ? "" : "s"} added, ${result.removals} removed, ${result.skipped} skipped.`}
        </Alert>
      ) : null}

      {preview ? (
        <div
          className="eval-admin-page__bulk-preview"
          data-testid="eval-bulk-preview-table"
          data-matched={preview.matchedSubmissionCount}
          data-additions={preview.counts.additions}
          data-removals={preview.counts.removals}
          data-skipped={preview.counts.skipped}
        >
          <p className="eval-coverage__summary-label">
            {preview.matchedSubmissionCount} submission
            {preview.matchedSubmissionCount === 1 ? "" : "s"} matched ·{" "}
            {preview.counts.additions} to add · {preview.counts.removals} to
            remove · {preview.counts.skipped} skipped
          </p>
          <ul className="eval-reviews-list">
            {preview.perEvaluator.map((e) => (
              <li
                key={e.userId}
                className="eval-reviews-list__item"
                data-testid={`eval-bulk-preview-evaluator-${e.userId}`}
                data-current={e.current}
                data-planned={e.planned}
              >
                <strong>{e.email}</strong>{" "}
                <span className="eval-queue__muted">
                  {e.current} now → {e.planned} after this plan
                </span>
              </li>
            ))}
          </ul>
          {skipGroups.length > 0 ? (
            <ul
              className="eval-reviews-list"
              data-testid="eval-bulk-preview-skips"
            >
              {skipGroups.map((g) => (
                <li key={g.reason} className="eval-queue__muted">
                  Skipped {g.count}: {g.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.capacityFailures.length > 0 ? (
            <Alert tone="warn" data-testid="eval-bulk-capacity-warning">
              {preview.capacityFailures.length} submission
              {preview.capacityFailures.length === 1 ? "" : "s"} cannot get the
              requested reviewers — raise the cap or add evaluators.
            </Alert>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
