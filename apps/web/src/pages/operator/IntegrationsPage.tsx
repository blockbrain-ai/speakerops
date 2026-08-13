/**
 * Integrations hub — Airtable (existing O06 surface) + Accelevents.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ErrorEnvelopeSchema,
  IntegrationsStatusResponseSchema,
  SaveAcceleventsResponseSchema,
  VerifyAcceleventsResponseSchema,
  type IntegrationConnection,
} from "@speakerops/shared";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { Field } from "../../components/ui/Field.js";
import { AirtableStatusPage } from "../AirtableStatus.js";

export function IntegrationsPage() {
  const { activeEventId } = useEventContext();
  const [ae, setAe] = useState<IntegrationConnection | null>(null);
  const [eventUrl, setEventUrl] = useState("");
  const [externalEventId, setExternalEventId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeEventId) {
      setAe(null);
      return;
    }
    setError(null);
    const res = await fetch(
      `/api/events/${encodeURIComponent(activeEventId)}/integrations`,
      { credentials: "include", headers: { accept: "application/json" } },
    );
    if (!res.ok) {
      const raw: unknown = await res.json().catch(() => null);
      const env = ErrorEnvelopeSchema.safeParse(raw);
      setError(env.success ? env.data.error : `Failed (${res.status})`);
      return;
    }
    const parsed = IntegrationsStatusResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      setError("Unexpected integrations response");
      return;
    }
    const row =
      parsed.data.connections.find((c) => c.provider === "accelevents") ?? null;
    setAe(row);
    if (row?.eventUrl) setEventUrl(row.eventUrl);
    if (row?.externalEventId) setExternalEventId(row.externalEventId);
    if (row) setEnabled(row.enabled);
  }, [activeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function verify() {
    if (!activeEventId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/integrations/accelevents/verify`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            expectedVersion:
              ae && ae.id !== "ae-placeholder" ? ae.version : undefined,
          }),
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Verify failed (${res.status})`);
        return;
      }
      const parsed = VerifyAcceleventsResponseSchema.safeParse(await res.json());
      if (parsed.success) setAe(parsed.data.connection);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!activeEventId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/integrations/accelevents`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            eventUrl: eventUrl.trim(),
            externalEventId: externalEventId.trim(),
            enabled,
            expectedVersion: ae && ae.id !== "ae-placeholder" ? ae.version : undefined,
          }),
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Save failed (${res.status})`);
        return;
      }
      const parsed = SaveAcceleventsResponseSchema.safeParse(await res.json());
      if (parsed.success) setAe(parsed.data.connection);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="integrations-page">
      <PageHeader
        eyebrow="Settings · Integrations"
        title="Integrations"
        description="One-way projectors from SpeakerOps (D1 is the system of record). API keys live in Worker secrets — this page only stores event identity."
        data-testid="integrations-page-header"
      />

      <section
        className="event-settings__card"
        data-testid="accelevents-card"
        style={{ marginBottom: 24 }}
      >
        <h3 className="event-settings__heading">Accelevents</h3>
        <p className="eval-queue__muted" data-testid="accelevents-honesty">
          Projector is implemented against the public Accelevents API (header{" "}
          <code>Key</code>). This dogfood estate has no API key, so live HTTP
          has not been executed. Status stays paused until{" "}
          <code>ACCELEVENTS_API_KEY</code> is set as a Worker secret.
        </p>
        {!activeEventId ? (
          <p className="eval-queue__muted">Select an event.</p>
        ) : (
          <>
            <Field
              id="ae-event-url"
              label="Accelevents event URL (slug)"
              inputProps={{
                "data-testid": "ae-event-url",
                value: eventUrl,
                onChange: (e) => setEventUrl(e.target.value),
                placeholder: "demo",
              }}
            />
            <Field
              id="ae-event-id"
              label="Numeric event id"
              inputProps={{
                "data-testid": "ae-event-id",
                value: externalEventId,
                onChange: (e) => setExternalEventId(e.target.value),
                placeholder: "12345",
              }}
            />
            <label className="portal-label">
              <input
                type="checkbox"
                data-testid="ae-enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />{" "}
              Enable projection (after a key is present)
            </label>
            <p className="eval-queue__muted" data-testid="ae-status">
              State: {ae?.verificationState ?? "paused"}
              {ae?.credentialPresent ? " · key present" : " · no key"}
              {ae?.lastError ? ` · ${ae.lastError}` : ""}
            </p>
            {error ? (
              <p className="eval-queue__muted" data-testid="ae-error">
                {error}
              </p>
            ) : null}
            <Button
              type="button"
              data-testid="ae-save"
              disabled={busy || !eventUrl.trim() || !externalEventId.trim()}
              onClick={() => void save()}
            >
              Save connection
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="ae-verify"
              disabled={busy || !eventUrl.trim() || !externalEventId.trim()}
              onClick={() => void verify()}
            >
              Queue verification
            </Button>
          </>
        )}
      </section>

      <AirtableStatusPage />
    </div>
  );
}
