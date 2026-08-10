/**
 * Admin Overview / readiness dashboard (section 6.3 / S-READY + 11.1 / S-L2-SHELL).
 *
 * Inventory H01–H05:
 *   H01 stats + outstanding list
 *   H02 filter overdue
 *   H03 drill to speaker
 *   H04 live poll ≤5s after portal complete
 *   H05 empty state when all clear
 *
 * Composition (page-atlas /admin · AC-11.1-A):
 *   1. Program context + status
 *   2. Four outcome metrics (submissions, evaluations, speakers, schedule)
 *   3. Readiness dimensions (existing H01 stats)
 *   4. Ranked attention queue + quick actions
 *
 * Session-expired (401) → redirect to /login (never alert inside usable shell).
 *
 * API: GET /api/events/:eventId/readiness (Reports.Readiness)
 *      GET /api/events/:eventId/submissions?limit=1
 *      GET /api/events/:eventId/eval/rollup
 *      GET /api/events/:eventId/schedule?view=week
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ReportsReadinessResponseSchema,
  ErrorEnvelopeSchema,
  type ReportsReadinessResponse,
  type ReadinessOutstandingItem,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";
import {
  READINESS_POLL_MS,
  speakerDetailPath,
} from "./readiness-utils.js";
import { Button } from "../components/ui/Button.js";
import { Icon } from "../components/ui/Icon.js";
import { EmptyState } from "../components/ui/EmptyState.js";

/** Program-level outcome metrics for the 5-second overview. */
export type OverviewProgramMetrics = {
  submissions: number;
  evaluationsTotal: number;
  evaluationsScored: number;
  speakers: number;
  schedulePlaced: number;
  scheduleUnscheduled: number;
};

export type AttentionItem = {
  id: string;
  rank: number;
  severity: "danger" | "warn" | "info";
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  /** When sourced from readiness outstanding row */
  taskId?: string;
  participationId?: string;
};

function formatEventWindow(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  timezone?: string | null,
): string | null {
  if (!startsAt && !endsAt) return null;
  const parts: string[] = [];
  if (startsAt) {
    try {
      parts.push(new Date(startsAt).toLocaleDateString(undefined, { dateStyle: "medium" }));
    } catch {
      parts.push(startsAt);
    }
  }
  if (endsAt && endsAt !== startsAt) {
    try {
      parts.push(new Date(endsAt).toLocaleDateString(undefined, { dateStyle: "medium" }));
    } catch {
      parts.push(endsAt);
    }
  }
  const range = parts.join(" – ");
  return timezone ? `${range} · ${timezone}` : range;
}

/** Build ranked attention items: overdue tasks first, then pending, then program gaps. */
export function buildAttentionQueue(
  outstanding: readonly ReadinessOutstandingItem[],
  metrics: OverviewProgramMetrics | null,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Stable rank: overdue speaker tasks before pending, preserving relative order.
  const sortedTasks = [...outstanding].sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return 0;
  });

  for (const row of sortedTasks) {
    items.push({
      id: `task-${row.taskId}`,
      rank: 0,
      severity: row.isOverdue ? "danger" : "warn",
      title: row.taskTitle,
      detail: [
        row.personName ?? row.personId,
        row.isOverdue ? "Overdue" : "Pending",
        row.dueAt ? `due ${row.dueAt}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: speakerDetailPath(row.participationId),
      actionLabel: "Open speaker",
      taskId: row.taskId,
      participationId: row.participationId,
    });
  }

  if (metrics) {
    if (metrics.scheduleUnscheduled > 0) {
      items.push({
        id: "gap-schedule",
        rank: 0,
        severity: "warn",
        title: "Unscheduled sessions",
        detail: `${metrics.scheduleUnscheduled} session${metrics.scheduleUnscheduled === 1 ? "" : "s"} still need a slot`,
        href: "/admin/schedule",
        actionLabel: "Open schedule",
      });
    }
    if (
      metrics.evaluationsTotal > 0 &&
      metrics.evaluationsScored < metrics.evaluationsTotal
    ) {
      const remaining = metrics.evaluationsTotal - metrics.evaluationsScored;
      items.push({
        id: "gap-eval",
        rank: 0,
        severity: "info",
        title: "Evaluation coverage",
        detail: `${remaining} of ${metrics.evaluationsTotal} submission${metrics.evaluationsTotal === 1 ? "" : "s"} still need scores`,
        href: "/admin/evaluations",
        actionLabel: "Open evaluations",
      });
    }
    if (metrics.submissions === 0 && metrics.speakers === 0) {
      items.push({
        id: "gap-setup",
        rank: 0,
        severity: "info",
        title: "Get the program started",
        detail: "Publish a CFP or add speakers so readiness has something to track",
        href: "/admin/cfp",
        actionLabel: "Open CFP",
      });
    }
  }

  // Severity order: danger → warn → info; assign 1-based ranks
  const severityRank = { danger: 0, warn: 1, info: 2 } as const;
  items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return items.map((item, idx) => ({ ...item, rank: idx + 1 }));
}

export function ReadinessPage() {
  const { activeEventId, activeEvent } = useEventContext();
  const navigate = useNavigate();
  const [data, setData] = useState<ReportsReadinessResponse | null>(null);
  const [metrics, setMetrics] = useState<OverviewProgramMetrics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const loadGenRef = useRef(0);
  const activeEventIdRef = useRef(activeEventId);
  activeEventIdRef.current = activeEventId;

  const recoverSession = useCallback(() => {
    // Fail-closed: never leave privileged chrome with an auth alert inside.
    navigate("/login", { replace: true, state: { from: "/admin" } });
  }, [navigate]);

  const loadMetrics = useCallback(
    async (eventId: string): Promise<OverviewProgramMetrics | null> => {
      try {
        const [subRes, evalRes, schedRes] = await Promise.all([
          fetch(
            `/api/events/${encodeURIComponent(eventId)}/submissions?limit=1&offset=0`,
            {
              credentials: "include",
              headers: { accept: "application/json" },
            },
          ),
          fetch(`/api/events/${encodeURIComponent(eventId)}/eval/rollup`, {
            credentials: "include",
            headers: { accept: "application/json" },
          }),
          fetch(
            `/api/events/${encodeURIComponent(eventId)}/schedule?view=week`,
            {
              credentials: "include",
              headers: { accept: "application/json" },
            },
          ),
        ]);

        if (
          subRes.status === 401 ||
          evalRes.status === 401 ||
          schedRes.status === 401
        ) {
          recoverSession();
          return null;
        }

        let submissions = 0;
        if (subRes.ok) {
          const raw: unknown = await subRes.json().catch(() => null);
          if (raw && typeof raw === "object" && "total" in raw) {
            const t = (raw as { total: unknown }).total;
            if (typeof t === "number" && Number.isFinite(t)) submissions = t;
          }
        }

        let evaluationsTotal = 0;
        let evaluationsScored = 0;
        if (evalRes.ok) {
          const raw: unknown = await evalRes.json().catch(() => null);
          if (raw && typeof raw === "object" && "submissions" in raw) {
            const list = (raw as { submissions: unknown }).submissions;
            if (Array.isArray(list)) {
              evaluationsTotal = list.length;
              evaluationsScored = list.filter((row) => {
                if (!row || typeof row !== "object") return false;
                const score = (row as { aggregateScore?: unknown }).aggregateScore;
                return typeof score === "number" && Number.isFinite(score);
              }).length;
            }
          }
        }

        let schedulePlaced = 0;
        let scheduleUnscheduled = 0;
        if (schedRes.ok) {
          const raw: unknown = await schedRes.json().catch(() => null);
          if (raw && typeof raw === "object") {
            const placements = (raw as { placements?: unknown }).placements;
            const unscheduled = (raw as { unscheduled?: unknown }).unscheduled;
            if (Array.isArray(placements)) schedulePlaced = placements.length;
            if (Array.isArray(unscheduled))
              scheduleUnscheduled = unscheduled.length;
          }
        }

        return {
          submissions,
          evaluationsTotal,
          evaluationsScored,
          speakers: 0, // filled from readiness stats after load
          schedulePlaced,
          scheduleUnscheduled,
        };
      } catch {
        return null;
      }
    },
    [recoverSession],
  );

  const load = useCallback(
    async (eventId: string, filterOverdue: boolean, opts?: { quiet?: boolean }) => {
      const gen = ++loadGenRef.current;
      if (!opts?.quiet) setLoading(true);
      setLoadError(null);
      const qs = filterOverdue ? "?overdueOnly=true" : "";
      // Never leave Overview on infinite "Loading readiness…" (dogfood scale).
      const READINESS_FETCH_MS = 8_000;
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), READINESS_FETCH_MS);
      try {
        const [res, programMetrics] = await Promise.all([
          fetch(
            `/api/events/${encodeURIComponent(eventId)}/readiness${qs}`,
            {
              credentials: "include",
              headers: { accept: "application/json" },
              signal: controller.signal,
            },
          ),
          loadMetrics(eventId),
        ]);
        if (gen !== loadGenRef.current || activeEventIdRef.current !== eventId) {
          return;
        }
        if (res.status === 401) {
          recoverSession();
          return;
        }
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          // Auth-shaped errors must not render as inline alerts in a usable shell
          const msg = env.success ? env.data.error : `Load failed (${res.status})`;
          if (
            res.status === 403 ||
            /authenticat|session|unauthori/i.test(msg)
          ) {
            recoverSession();
            return;
          }
          setLoadError(msg);
          setData(null);
          return;
        }
        const raw: unknown = await res.json();
        const parsed = ReportsReadinessResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setLoadError("Unexpected readiness response");
          setData(null);
          return;
        }
        setData(parsed.data);
        if (programMetrics) {
          setMetrics({
            ...programMetrics,
            speakers: parsed.data.stats.totalSpeakers,
          });
        } else {
          setMetrics({
            submissions: 0,
            evaluationsTotal: 0,
            evaluationsScored: 0,
            speakers: parsed.data.stats.totalSpeakers,
            schedulePlaced: 0,
            scheduleUnscheduled: 0,
          });
        }
        setLastFetchedAt(new Date().toISOString());
      } catch (err) {
        if (gen === loadGenRef.current) {
          const aborted =
            (err instanceof DOMException && err.name === "AbortError") ||
            (err instanceof Error && err.name === "AbortError");
          setLoadError(
            aborted
              ? "Readiness took too long (over 8s). Refresh or try again — stats may still load on retry."
              : "Network error",
          );
        }
      } finally {
        clearTimeout(abortTimer);
        if (gen === loadGenRef.current && !opts?.quiet) {
          setLoading(false);
        }
      }
    },
    [loadMetrics, recoverSession],
  );

  // Initial + filter change
  useEffect(() => {
    if (!activeEventId) {
      setData(null);
      setMetrics(null);
      setLoadError(null);
      return;
    }
    void load(activeEventId, overdueOnly);
  }, [activeEventId, overdueOnly, load]);

  // Live poll ≤5s (H04) — quiet refresh so UI does not flash loading
  useEffect(() => {
    if (!activeEventId) return;
    const id = window.setInterval(() => {
      void load(activeEventId, overdueOnly, { quiet: true });
    }, READINESS_POLL_MS);
    return () => window.clearInterval(id);
  }, [activeEventId, overdueOnly, load]);

  const stats = data?.stats;
  const outstanding: ReadinessOutstandingItem[] = data?.outstanding ?? [];
  const allClear =
    data !== null &&
    !overdueOnly &&
    data.stats.outstandingTasks === 0 &&
    data.outstanding.length === 0 &&
    (metrics?.scheduleUnscheduled ?? 0) === 0;

  const attention = buildAttentionQueue(
    overdueOnly ? outstanding.filter((r) => r.isOverdue) : outstanding,
    metrics,
  );
  // When overdue filter is on, only show task rows (already filtered by API)
  const attentionVisible = overdueOnly
    ? attention.filter((a) => a.taskId)
    : attention;

  const eventWindow = formatEventWindow(
    activeEvent?.startsAt,
    activeEvent?.endsAt,
    activeEvent?.timezone,
  );

  const primaryRisk = attentionVisible[0] ?? null;
  const programStatus = !activeEventId
    ? "Select an event to begin."
    : loading && !data
      ? "Loading program health…"
      : primaryRisk
        ? primaryRisk.severity === "danger"
          ? "Needs attention now"
          : "On track with open items"
        : allClear
          ? "All clear"
          : "On track";

  return (
    <div
      className="event-settings readiness-dashboard overview-dashboard"
      data-testid="page-readiness"
      data-section="11.1"
      data-poll-ms={READINESS_POLL_MS}
    >
      {/* Program context (shell already owns the page H1 title) */}
      <header className="overview-dashboard__header" data-testid="overview-header">
        <div className="overview-dashboard__header-text">
          <p className="page-stub__overline">Overview</p>
          <h2 className="page-stub__title">
            {activeEvent?.name ?? "Program readiness"}
          </h2>
          <p className="page-stub__body" data-testid="overview-status">
            {eventWindow
              ? `${eventWindow}. ${programStatus}`
              : `Outstanding speaker tasks and program risks. Updates within ${Math.round(READINESS_POLL_MS / 1000)}s after portal complete.`}
          </p>
        </div>
        {activeEventId ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="readiness-refresh"
            onClick={() => void load(activeEventId, overdueOnly)}
          >
            Refresh
          </Button>
        ) : null}
      </header>

      {/* Primary risk callout — 5-second test: risk + next action */}
      {primaryRisk ? (
        <section
          className="overview-dashboard__primary-risk"
          data-testid="overview-primary-risk"
          aria-label="Primary risk"
        >
          <div className="overview-dashboard__primary-risk-body">
            <span
              className={[
                "overview-dashboard__severity",
                `overview-dashboard__severity--${primaryRisk.severity}`,
              ].join(" ")}
            >
              {primaryRisk.severity === "danger"
                ? "Urgent"
                : primaryRisk.severity === "warn"
                  ? "Attention"
                  : "Next"}
            </span>
            <h2 className="overview-dashboard__primary-title">
              {primaryRisk.title}
            </h2>
            <p className="overview-dashboard__primary-detail">
              {primaryRisk.detail}
            </p>
          </div>
          <Link
            className="l2-btn l2-btn--primary lumen-focusable overview-dashboard__primary-action"
            data-testid="overview-primary-action"
            to={primaryRisk.href}
          >
            {primaryRisk.actionLabel}
          </Link>
        </section>
      ) : null}

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="readiness-no-event">
          Select an event to view readiness.
        </p>
      ) : null}

      {activeEventId ? (
        <>
          {/* Four program outcome metrics */}
          <section
            className="overview-dashboard__metrics"
            data-testid="overview-metrics"
            aria-label="Program metrics"
          >
            <Link
              to="/admin/submissions"
              className="overview-dashboard__metric lumen-focusable"
              data-testid="overview-metric-submissions"
            >
              <span className="overview-dashboard__metric-value">
                {metrics ? metrics.submissions : "—"}
              </span>
              <span className="overview-dashboard__metric-label">
                Submissions
              </span>
              <span className="overview-dashboard__metric-hint">Review queue</span>
            </Link>
            <Link
              to="/admin/evaluations"
              className="overview-dashboard__metric lumen-focusable"
              data-testid="overview-metric-evaluations"
            >
              <span className="overview-dashboard__metric-value">
                {metrics
                  ? metrics.evaluationsTotal === 0
                    ? "0"
                    : `${metrics.evaluationsScored}/${metrics.evaluationsTotal}`
                  : "—"}
              </span>
              <span className="overview-dashboard__metric-label">
                Evaluations
              </span>
              <span className="overview-dashboard__metric-hint">
                Scored coverage
              </span>
            </Link>
            <Link
              to="/admin/speakers"
              className="overview-dashboard__metric lumen-focusable"
              data-testid="overview-metric-speakers"
            >
              <span className="overview-dashboard__metric-value">
                {metrics ? metrics.speakers : stats?.totalSpeakers ?? "—"}
              </span>
              <span className="overview-dashboard__metric-label">Speakers</span>
              <span className="overview-dashboard__metric-hint">
                Confirmed participations
              </span>
            </Link>
            <Link
              to="/admin/schedule"
              className="overview-dashboard__metric lumen-focusable"
              data-testid="overview-metric-schedule"
            >
              <span className="overview-dashboard__metric-value">
                {metrics
                  ? metrics.scheduleUnscheduled > 0
                    ? metrics.scheduleUnscheduled
                    : metrics.schedulePlaced
                  : "—"}
              </span>
              <span className="overview-dashboard__metric-label">
                {metrics && metrics.scheduleUnscheduled > 0
                  ? "Unscheduled"
                  : "Scheduled"}
              </span>
              <span className="overview-dashboard__metric-hint">
                {metrics && metrics.scheduleUnscheduled > 0
                  ? "Need a room/time"
                  : "Placed sessions"}
              </span>
            </Link>
          </section>

          {/* Quick actions */}
          <section
            className="overview-dashboard__quick-actions"
            data-testid="overview-quick-actions"
            aria-label="Quick actions"
          >
            <Link
              to="/admin/submissions"
              className="overview-dashboard__quick-action lumen-focusable"
              data-testid="overview-action-submissions"
            >
              <Icon name="inbox" size="sm" decorative />
              Submissions
            </Link>
            <Link
              to="/admin/schedule"
              className="overview-dashboard__quick-action lumen-focusable"
              data-testid="overview-action-schedule"
            >
              <Icon name="calendar" size="sm" decorative />
              Schedule
            </Link>
            <Link
              to="/admin/comms"
              className="overview-dashboard__quick-action lumen-focusable"
              data-testid="overview-action-comms"
            >
              <Icon name="mail" size="sm" decorative />
              Comms
            </Link>
            <Link
              to="/admin/cfp"
              className="overview-dashboard__quick-action lumen-focusable"
              data-testid="overview-action-cfp"
            >
              <Icon name="file" size="sm" decorative />
              CFP / Forms
            </Link>
          </section>

          <div className="readiness-dashboard__toolbar">
            <label className="readiness-dashboard__filter lumen-focusable">
              <input
                type="checkbox"
                data-testid="readiness-filter-overdue"
                checked={overdueOnly}
                onChange={(e) => setOverdueOnly(e.target.checked)}
              />
              <span>Overdue only</span>
            </label>
            {lastFetchedAt ? (
              <span
                className="eval-queue__muted"
                data-testid="readiness-last-fetched"
                data-generated-at={data?.generatedAt ?? ""}
              >
                Updated {lastFetchedAt}
              </span>
            ) : null}
          </div>

          {loadError ? (
            <p
              className="event-settings__status event-settings__status--error"
              data-testid="readiness-load-error"
              role="alert"
            >
              {loadError}
            </p>
          ) : null}

          {loading && !data ? (
            <p className="eval-queue__muted" data-testid="readiness-loading">
              Loading readiness…
            </p>
          ) : null}

          {/* Readiness dimensions (H01 stats) */}
          {stats ? (
            <section
              className="readiness-dashboard__stats"
              data-testid="readiness-stats"
              aria-label="Readiness stats"
            >
              <div
                className="readiness-dashboard__stat"
                data-testid="readiness-stat-speakers"
              >
                <span className="readiness-dashboard__stat-value">
                  {stats.totalSpeakers}
                </span>
                <span className="readiness-dashboard__stat-label">Speakers</span>
              </div>
              <div
                className="readiness-dashboard__stat"
                data-testid="readiness-stat-outstanding"
              >
                <span className="readiness-dashboard__stat-value">
                  {stats.outstandingTasks}
                </span>
                <span className="readiness-dashboard__stat-label">
                  Outstanding
                </span>
              </div>
              <div
                className="readiness-dashboard__stat"
                data-testid="readiness-stat-overdue"
              >
                <span className="readiness-dashboard__stat-value">
                  {stats.overdueTasks}
                </span>
                <span className="readiness-dashboard__stat-label">Overdue</span>
              </div>
              <div
                className="readiness-dashboard__stat"
                data-testid="readiness-stat-completed"
              >
                <span className="readiness-dashboard__stat-value">
                  {stats.completedTasks}
                </span>
                <span className="readiness-dashboard__stat-label">
                  Completed
                </span>
              </div>
              <div
                className="readiness-dashboard__stat"
                data-testid="readiness-stat-speakers-outstanding"
              >
                <span className="readiness-dashboard__stat-value">
                  {stats.speakersWithOutstanding}
                </span>
                <span className="readiness-dashboard__stat-label">
                  Speakers blocked
                </span>
              </div>
            </section>
          ) : null}

          {allClear ? (
            <section
              className="event-settings__card readiness-dashboard__empty"
              data-testid="readiness-empty"
            >
              <EmptyState
                icon="check"
                title="All clear"
                description="No outstanding speaker tasks for this event. Portal complete items will reappear here if new tasks are assigned."
              />
            </section>
          ) : null}

          {/* Ranked attention queue */}
          {!allClear && data ? (
            <section
              className="event-settings__card overview-dashboard__attention"
              data-testid="readiness-outstanding-section"
              aria-label="Attention queue"
            >
              <h3 className="event-settings__heading" data-testid="overview-attention-heading">
                Needs attention
                {overdueOnly ? " (overdue)" : ""}
              </h3>
              {data.outstandingTruncated ? (
                <p
                  className="eval-queue__muted"
                  data-testid="readiness-list-truncated"
                >
                  Showing top {data.outstanding.length} of{" "}
                  {data.outstandingTotal} outstanding tasks (cap{" "}
                  {data.outstandingListCap}). Stats above reflect the full
                  program.
                </p>
              ) : null}
              {attentionVisible.length === 0 ? (
                <p
                  className="eval-queue__muted"
                  data-testid="readiness-outstanding-empty-filter"
                >
                  No overdue tasks match this filter.
                </p>
              ) : (
                <ol
                  className="event-settings__list readiness-dashboard__list overview-dashboard__attention-list"
                  data-testid="readiness-outstanding-list"
                  data-count={attentionVisible.filter((a) => a.taskId).length || attentionVisible.length}
                >
                  {attentionVisible.map((item) => (
                    <li
                      key={item.id}
                      className={
                        item.severity === "danger"
                          ? "event-settings__list-item readiness-dashboard__row readiness-dashboard__row--overdue"
                          : "event-settings__list-item readiness-dashboard__row"
                      }
                      data-testid={
                        item.taskId
                          ? `readiness-row-${item.taskId}`
                          : `overview-attention-${item.id}`
                      }
                      data-task-id={item.taskId ?? ""}
                      data-participation-id={item.participationId ?? ""}
                      data-overdue={item.severity === "danger" ? "true" : "false"}
                      data-rank={item.rank}
                    >
                      <div className="readiness-dashboard__row-main">
                        <span
                          className="readiness-dashboard__badge"
                          data-testid={
                            item.taskId
                              ? `readiness-status-${item.taskId}`
                              : `overview-attention-severity-${item.id}`
                          }
                        >
                          {item.severity === "danger"
                            ? "overdue"
                            : item.severity === "warn"
                              ? item.taskId
                                ? "pending"
                                : "attention"
                              : "next"}
                        </span>
                        <strong
                          data-testid={
                            item.taskId
                              ? `readiness-task-title-${item.taskId}`
                              : `overview-attention-title-${item.id}`
                          }
                        >
                          {item.title}
                        </strong>
                        <span className="eval-queue__muted"> · {item.detail}</span>
                      </div>
                      <Link
                        className="eval-queue__link lumen-focusable"
                        data-testid={
                          item.participationId
                            ? `readiness-drill-${item.participationId}`
                            : `overview-attention-action-${item.id}`
                        }
                        to={item.href}
                      >
                        {item.actionLabel}
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
