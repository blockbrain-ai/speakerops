/**
 * N7 Custom analytics — submissions pipeline + speaker readiness widgets
 * built on existing readiness + submissions APIs (F4 charts). Template gallery first.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import {
  DonutChart,
  BarChart,
  type ChartSlice,
} from "../../components/ui/Chart.js";
import {
  ErrorEnvelopeSchema,
  ReportsReadinessResponseSchema,
} from "@speakerops/shared";

type Metrics = {
  statusCounts: Record<string, number>;
  outstandingTasks: number;
  overdueTasks: number;
  completedTasks: number;
  totalSpeakers: number;
  sessionsPlaced: number;
  sessionsUnscheduled: number;
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  in_review: "In review",
  accepted: "Accepted",
  rejected: "Rejected",
  waitlist: "Waitlist",
};

const STATUS_COLORS: Record<string, string> = {
  submitted: "var(--lumen-honey)",
  in_review: "var(--lumen-brand)",
  accepted: "var(--lumen-success)",
  rejected: "var(--lumen-danger)",
  waitlist: "var(--lumen-clay)",
};

const TEMPLATES = [
  {
    id: "pipeline",
    title: "Submissions pipeline",
    desc: "Status mix donut across the decision funnel",
  },
  {
    id: "speakers",
    title: "Speaker tracking",
    desc: "Task completion and overdue load",
  },
  {
    id: "schedule",
    title: "Schedule placement",
    desc: "Placed vs unscheduled sessions",
  },
] as const;

export function AnalyticsDashboardPage() {
  const { activeEventId } = useEventContext();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<string[]>([
    "pipeline",
    "speakers",
    "schedule",
  ]);

  const load = useCallback(async () => {
    if (!activeEventId) {
      setMetrics(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [readyRes, subRes, schedRes] = await Promise.all([
        fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/readiness`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        ),
        fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/submissions?limit=1&offset=0`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        ),
        fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/schedule?view=week`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        ),
      ]);

      if (!readyRes.ok) {
        const raw: unknown = await readyRes.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Failed (${readyRes.status})`);
        setMetrics(null);
        return;
      }

      const readyRaw: unknown = await readyRes.json();
      const ready = ReportsReadinessResponseSchema.safeParse(readyRaw);
      const stats = ready.success ? ready.data.stats : null;

      let statusCounts: Record<string, number> = {};
      if (subRes.ok) {
        const subRaw: unknown = await subRes.json().catch(() => null);
        if (
          subRaw &&
          typeof subRaw === "object" &&
          "statusCounts" in subRaw &&
          subRaw.statusCounts &&
          typeof subRaw.statusCounts === "object"
        ) {
          statusCounts = subRaw.statusCounts as Record<string, number>;
        }
      }

      let sessionsPlaced = 0;
      let sessionsUnscheduled = 0;
      if (schedRes.ok) {
        const schedRaw: unknown = await schedRes.json().catch(() => null);
        if (schedRaw && typeof schedRaw === "object") {
          const placements = (schedRaw as { placements?: unknown }).placements;
          const unscheduled = (schedRaw as { unscheduled?: unknown })
            .unscheduled;
          if (Array.isArray(placements)) sessionsPlaced = placements.length;
          if (Array.isArray(unscheduled))
            sessionsUnscheduled = unscheduled.length;
        }
      }

      setMetrics({
        statusCounts,
        outstandingTasks: stats?.outstandingTasks ?? 0,
        overdueTasks: stats?.overdueTasks ?? 0,
        completedTasks: stats?.completedTasks ?? 0,
        totalSpeakers: stats?.totalSpeakers ?? 0,
        sessionsPlaced,
        sessionsUnscheduled,
      });
    } catch {
      setError("Network error");
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pipelineSlices: ChartSlice[] = useMemo(() => {
    if (!metrics) return [];
    return Object.entries(metrics.statusCounts)
      .filter(([, n]) => n > 0)
      .map(([id, value]) => ({
        id,
        label: STATUS_LABELS[id] ?? id,
        value,
        color: STATUS_COLORS[id] ?? "var(--lumen-brand)",
      }));
  }, [metrics]);

  const speakerBars: ChartSlice[] = useMemo(() => {
    if (!metrics) return [];
    return [
      {
        id: "completed",
        label: "Completed",
        value: metrics.completedTasks,
        color: "var(--lumen-success)",
      },
      {
        id: "outstanding",
        label: "Outstanding",
        value: metrics.outstandingTasks,
        color: "var(--lumen-honey)",
      },
      {
        id: "overdue",
        label: "Overdue",
        value: metrics.overdueTasks,
        color: "var(--lumen-danger)",
      },
    ];
  }, [metrics]);

  const scheduleBars: ChartSlice[] = useMemo(() => {
    if (!metrics) return [];
    return [
      {
        id: "placed",
        label: "Placed",
        value: metrics.sessionsPlaced,
        color: "var(--lumen-success)",
      },
      {
        id: "unscheduled",
        label: "Unscheduled",
        value: metrics.sessionsUnscheduled,
        color: "var(--lumen-honey)",
      },
    ];
  }, [metrics]);

  function toggleTemplate(id: string) {
    setActive((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div data-testid="page-analytics" data-section="n7-analytics">
      <PageHeader
        eyebrow="Insights"
        title="Analytics"
        description="Template gallery of programme widgets. Data comes from live readiness and submissions roll-ups — never a second source of truth."
        data-testid="analytics-page-header"
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="analytics-refresh"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        }
      />

      <section className="analytics-templates" data-testid="analytics-templates">
        <h3 className="page-stub__overline">Widget gallery</h3>
        <ul className="analytics-templates__list">
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={
                  active.includes(t.id)
                    ? "analytics-templates__card is-active lumen-focusable"
                    : "analytics-templates__card lumen-focusable"
                }
                data-testid={`analytics-template-${t.id}`}
                onClick={() => toggleTemplate(t.id)}
              >
                <strong>{t.title}</strong>
                <span>{t.desc}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {!activeEventId ? (
        <p className="eval-queue__muted">Select an event.</p>
      ) : error ? (
        <p className="eval-queue__muted" data-testid="analytics-error">
          {error}
        </p>
      ) : (
        <div className="analytics-grid" data-testid="analytics-grid">
          {active.includes("pipeline") ? (
            <section
              className="analytics-widget"
              data-testid="analytics-widget-pipeline"
            >
              <h3>Submissions pipeline</h3>
              <DonutChart
                slices={pipelineSlices}
                data-testid="analytics-pipeline-donut"
              />
            </section>
          ) : null}
          {active.includes("speakers") ? (
            <section
              className="analytics-widget"
              data-testid="analytics-widget-speakers"
            >
              <h3>Speaker tracking</h3>
              <p className="eval-queue__muted">
                {metrics?.totalSpeakers ?? 0} speakers on the programme
              </p>
              <BarChart
                bars={speakerBars}
                data-testid="analytics-speakers-bars"
              />
            </section>
          ) : null}
          {active.includes("schedule") ? (
            <section
              className="analytics-widget"
              data-testid="analytics-widget-schedule"
            >
              <h3>Schedule placement</h3>
              <BarChart
                bars={scheduleBars}
                data-testid="analytics-schedule-bars"
              />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
