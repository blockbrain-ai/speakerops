/**
 * Admin readiness dashboard (section 6.3 / S-READY).
 *
 * Inventory H01–H05:
 *   H01 stats + outstanding list
 *   H02 filter overdue
 *   H03 drill to speaker
 *   H04 live poll ≤5s after portal complete
 *   H05 empty state when all clear
 *
 * API: GET /api/events/:eventId/readiness (Reports.Readiness)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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

export function ReadinessPage() {
  const { activeEventId } = useEventContext();
  const [data, setData] = useState<ReportsReadinessResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const loadGenRef = useRef(0);
  const activeEventIdRef = useRef(activeEventId);
  activeEventIdRef.current = activeEventId;

  const load = useCallback(
    async (eventId: string, filterOverdue: boolean, opts?: { quiet?: boolean }) => {
      const gen = ++loadGenRef.current;
      if (!opts?.quiet) setLoading(true);
      setLoadError(null);
      const qs = filterOverdue ? "?overdueOnly=true" : "";
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/readiness${qs}`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (gen !== loadGenRef.current || activeEventIdRef.current !== eventId) {
          return;
        }
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setLoadError(
            env.success ? env.data.error : `Load failed (${res.status})`,
          );
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
        setLastFetchedAt(new Date().toISOString());
      } catch {
        if (gen === loadGenRef.current) {
          setLoadError("Network error");
        }
      } finally {
        if (gen === loadGenRef.current && !opts?.quiet) {
          setLoading(false);
        }
      }
    },
    [],
  );

  // Initial + filter change
  useEffect(() => {
    if (!activeEventId) {
      setData(null);
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
    data.outstanding.length === 0;

  return (
    <div
      className="event-settings readiness-dashboard"
      data-testid="page-readiness"
      data-section="6.3"
      data-poll-ms={READINESS_POLL_MS}
    >
      <p className="page-stub__overline">Overview</p>
      <h2 className="page-stub__title">Readiness</h2>
      <p className="page-stub__body">
        Outstanding speaker tasks for the active event. Updates automatically
        within {Math.round(READINESS_POLL_MS / 1000)}s after portal complete.
      </p>

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="readiness-no-event">
          Select an event to view readiness.
        </p>
      ) : null}

      {activeEventId ? (
        <>
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
            <button
              type="button"
              className="event-settings__submit lumen-focusable"
              data-testid="readiness-refresh"
              onClick={() => void load(activeEventId, overdueOnly)}
            >
              Refresh
            </button>
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
              <h3 className="event-settings__heading">All clear</h3>
              <p className="page-stub__body">
                No outstanding speaker tasks for this event. Portal complete
                items will reappear here if new tasks are assigned.
              </p>
            </section>
          ) : null}

          {!allClear && data ? (
            <section
              className="event-settings__card"
              data-testid="readiness-outstanding-section"
            >
              <h3 className="event-settings__heading">
                Outstanding tasks
                {overdueOnly ? " (overdue)" : ""}
              </h3>
              {outstanding.length === 0 ? (
                <p
                  className="eval-queue__muted"
                  data-testid="readiness-outstanding-empty-filter"
                >
                  No overdue tasks match this filter.
                </p>
              ) : (
                <ul
                  className="event-settings__list readiness-dashboard__list"
                  data-testid="readiness-outstanding-list"
                  data-count={outstanding.length}
                >
                  {outstanding.map((row) => (
                    <li
                      key={row.taskId}
                      className={
                        row.isOverdue
                          ? "event-settings__list-item readiness-dashboard__row readiness-dashboard__row--overdue"
                          : "event-settings__list-item readiness-dashboard__row"
                      }
                      data-testid={`readiness-row-${row.taskId}`}
                      data-task-id={row.taskId}
                      data-participation-id={row.participationId}
                      data-overdue={row.isOverdue ? "true" : "false"}
                    >
                      <div className="readiness-dashboard__row-main">
                        <span
                          className="readiness-dashboard__badge"
                          data-testid={`readiness-status-${row.taskId}`}
                        >
                          {row.status}
                        </span>
                        <strong data-testid={`readiness-task-title-${row.taskId}`}>
                          {row.taskTitle}
                        </strong>
                        <span className="eval-queue__muted">
                          {" "}
                          · {row.personName ?? row.personId}
                          {row.dueAt ? ` · due ${row.dueAt}` : ""}
                        </span>
                      </div>
                      <Link
                        className="eval-queue__link lumen-focusable"
                        data-testid={`readiness-drill-${row.participationId}`}
                        to={speakerDetailPath(row.participationId)}
                      >
                        Open speaker
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
