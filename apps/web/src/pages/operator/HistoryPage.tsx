/**
 * N6 History / audit browser — event-scoped audit trail (admin).
 */
import { useCallback, useEffect, useState } from "react";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { ErrorEnvelopeSchema } from "@speakerops/shared";

type AuditRow = {
  id: string;
  eventId: string | null;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  createdAt: string;
};

export function HistoryPage() {
  const { activeEventId } = useEventContext();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!activeEventId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/history`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Failed (${res.status})`);
        setRows([]);
        return;
      }
      const body = (await res.json()) as { events?: AuditRow[] };
      setRows(Array.isArray(body.events) ? body.events : []);
    } catch {
      setError("Network error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = rows.filter((r) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      r.action.toLowerCase().includes(needle) ||
      r.actorId.toLowerCase().includes(needle) ||
      r.entityType.toLowerCase().includes(needle) ||
      r.correlationId.toLowerCase().includes(needle)
    );
  });

  return (
    <div data-testid="page-history" data-section="n6-history">
      <PageHeader
        eyebrow="Operator"
        title="History"
        description="Consequential writes for this event (correlation-aware audit trail)."
        data-testid="history-page-header"
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="history-refresh"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        }
      />
      {!activeEventId ? (
        <p className="eval-queue__muted">Select an event.</p>
      ) : error ? (
        <p className="eval-queue__muted" data-testid="history-error">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="eval-queue__muted" data-testid="history-empty">
          {loading ? "Loading…" : "No audit events yet."}
        </p>
      ) : (
        <>
        <label className="portal-label" htmlFor="history-filter">
          Filter
        </label>
        <input
          id="history-filter"
          className="portal-input lumen-focusable"
          data-testid="history-filter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Action, actor, entity…"
        />
        <table className="l2-table" data-testid="history-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Actor</th>
              <th>Correlation</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} data-testid={`history-row-${r.id}`}>
                <td>
                  <time dateTime={r.createdAt}>
                    {new Date(r.createdAt).toLocaleString()}
                  </time>
                </td>
                <td>{r.action}</td>
                <td>
                  {r.entityType}:{r.entityId}
                </td>
                <td>
                  {r.actorType}/{r.actorId}
                </td>
                <td>
                  <code className="history-corr">{r.correlationId}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}
