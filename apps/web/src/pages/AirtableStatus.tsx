/**
 * Airtable projection status (section 7.3 / S-AIRTABLE).
 *
 * Inventory O06: admin Settings → Airtable projection status read
 * API: GET /api/events/:eventId/airtable/status (Reports.AirtableStatus)
 *
 * Shows lag fields when projection is paused (missing credentials).
 * Never performs Airtable dual-write; status is D1-derived only.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ReportsAirtableStatusResponseSchema,
  ErrorEnvelopeSchema,
  type ReportsAirtableStatusResponse,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

export function AirtableStatusPage() {
  const { activeEventId } = useEventContext();
  const [data, setData] = useState<ReportsAirtableStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (eventId: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/airtable/status`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
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
      const parsed = ReportsAirtableStatusResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError("Unexpected airtable status response");
        setData(null);
        return;
      }
      setData(parsed.data);
    } catch {
      setLoadError("Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeEventId) {
      setData(null);
      setLoadError(null);
      return;
    }
    void load(activeEventId);
  }, [activeEventId, load]);

  return (
    <div
      className="event-settings"
      data-testid="airtable-status-page"
      data-section="7.3"
    >
      <p className="page-stub__overline">Settings · Integrations</p>
      <h2 className="page-stub__title">Airtable projection</h2>
      <p className="page-stub__body">
        One-way mirror status (never SoR). Product mutations succeed while
        Airtable is paused — outbox lags until credentials resume.{" "}
        <Link
          to="/admin/settings"
          className="design-kit__link lumen-focusable"
          data-testid="airtable-status-back"
        >
          ← Event settings
        </Link>
      </p>

      {!activeEventId ? (
        <p className="page-stub__body" data-testid="airtable-status-no-event">
          No active event. Select or create an event first.
        </p>
      ) : null}

      {loadError ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="airtable-status-error"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="page-stub__body" data-testid="airtable-status-loading">
          Loading…
        </p>
      ) : null}

      {data ? (
        <section
          className="event-settings__card"
          data-testid="airtable-status-section"
          aria-labelledby="airtable-status-heading"
        >
          <h3 id="airtable-status-heading" className="event-settings__heading">
            Projection status
          </h3>

          <dl className="airtable-status__grid" data-testid="airtable-status-grid">
            <div className="airtable-status__row">
              <dt>Configured</dt>
              <dd data-testid="airtable-status-configured">
                {data.configured ? "Yes" : "No"}
              </dd>
            </div>
            <div className="airtable-status__row">
              <dt>Paused</dt>
              <dd data-testid="airtable-status-paused">
                {data.paused ? "Yes — outbox lagging" : "No — draining"}
              </dd>
            </div>
            <div className="airtable-status__row">
              <dt>Pending outbox</dt>
              <dd data-testid="airtable-status-pending-count">
                {data.lag.pendingCount}
              </dd>
            </div>
            <div className="airtable-status__row">
              <dt>Oldest pending</dt>
              <dd data-testid="airtable-status-oldest-pending">
                {data.lag.oldestPendingAt ?? "—"}
              </dd>
            </div>
            <div className="airtable-status__row">
              <dt>Max attempts</dt>
              <dd data-testid="airtable-status-max-attempts">
                {data.lag.maxAttempts}
              </dd>
            </div>
            <div className="airtable-status__row">
              <dt>Projected rows</dt>
              <dd data-testid="airtable-status-projected-count">
                {data.projectedCount}
              </dd>
            </div>
            <div className="airtable-status__row">
              <dt>Last success</dt>
              <dd data-testid="airtable-status-last-success">
                {data.lastSuccessAt ?? "—"}
              </dd>
            </div>
            <div className="airtable-status__row">
              <dt>Generated at</dt>
              <dd data-testid="airtable-status-generated-at">
                {data.generatedAt}
              </dd>
            </div>
          </dl>

          {data.recentErrors.length > 0 ? (
            <div data-testid="airtable-status-errors">
              <h4 className="event-settings__heading">Recent errors</h4>
              <ul className="airtable-status__errors">
                {data.recentErrors.map((err) => (
                  <li key={err.outboxId} data-testid="airtable-status-error-row">
                    <span>{err.entityType ?? "—"}</span>{" "}
                    <code>{err.internalId ?? err.outboxId}</code>:{" "}
                    {err.lastError ?? "unknown"} (attempts {err.attempts})
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p
              className="page-stub__body"
              data-testid="airtable-status-errors-empty"
            >
              No recent projection errors.
            </p>
          )}

          <button
            type="button"
            className="event-settings__submit lumen-focusable"
            data-testid="airtable-status-refresh"
            onClick={() => {
              if (activeEventId) void load(activeEventId);
            }}
          >
            Refresh status
          </button>
        </section>
      ) : null}

      <section
        className="event-settings__card"
        data-testid="accelevents-status-section"
        aria-labelledby="accelevents-heading"
        style={{ marginTop: 24 }}
      >
        <h3 id="accelevents-heading" className="event-settings__heading">
          Accelevents projection
        </h3>
        <p className="page-stub__body" data-testid="accelevents-status-disclose">
          One-way Accelevents projector is designed (outbox identity map,
          retries, no dual-write, no request-path calls). It is{" "}
          <strong>not active</strong> until third-party API credentials are
          provisioned for this estate. We do not stub or fake live Accelevents
          writes. D1 remains the system of record; Airtable above is the
          optional one-way mirror when configured.
        </p>
        <p className="eval-queue__muted" data-testid="accelevents-status-state">
          Status: awaiting credentials (honest disclosure — not a product stub).
        </p>
      </section>
    </div>
  );
}
