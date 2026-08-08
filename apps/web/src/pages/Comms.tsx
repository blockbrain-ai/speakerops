/**
 * Admin Comms — email templates with merge fields (section 5.1 / S-COMMS).
 *
 * Comms.UpsertTemplate via PUT /api/events/:eventId/templates/:key
 * Inventory: J01 create/edit template merge fields (subject field-flow I16).
 */
import { useCallback, useState, type FormEvent } from "react";
import {
  CommsUpsertTemplateResponseSchema,
  extractMergeFields,
  type EmailTemplateDto,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

export function CommsPage() {
  const { activeEventId } = useEventContext();
  const [key, setKey] = useState("accept-reminder");
  const [subject, setSubject] = useState(
    "Your talk was accepted — {{eventName}}",
  );
  const [body, setBody] = useState(
    "Hi {{name}},\n\nPlease complete your portal tasks for {{eventName}}.\n\nThanks!",
  );
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [lastSaved, setLastSaved] = useState<EmailTemplateDto | null>(null);
  const [status, setStatus] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [saving, setSaving] = useState(false);

  const mergeFields = extractMergeFields(subject, body);

  const onSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!activeEventId) return;
      setSaving(true);
      setStatus(null);
      try {
        const payload: {
          subject: string;
          body: string;
          expectedVersion?: number;
        } = { subject, body };
        if (expectedVersion != null) {
          payload.expectedVersion = expectedVersion;
        }
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/templates/${encodeURIComponent(key)}`,
          {
            method: "PUT",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        const raw: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const err = raw as { error?: string; code?: string } | null;
          setStatus({
            kind: "error",
            text: err?.error ?? `Save failed (${res.status})`,
          });
          return;
        }
        const parsed = CommsUpsertTemplateResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setStatus({ kind: "error", text: "Unexpected template response" });
          return;
        }
        setLastSaved(parsed.data.template);
        setExpectedVersion(parsed.data.template.version);
        setSubject(parsed.data.template.subject);
        setBody(parsed.data.template.body);
        setStatus({
          kind: "ok",
          text: `Template “${parsed.data.template.key}” saved (v${parsed.data.template.version})`,
        });
      } catch {
        setStatus({ kind: "error", text: "Network error" });
      } finally {
        setSaving(false);
      }
    },
    [activeEventId, key, subject, body, expectedVersion],
  );

  return (
    <div className="event-settings" data-testid="page-comms" data-section="5.1">
      <p className="page-stub__overline">Comms</p>
      <h2 className="page-stub__title">Email templates</h2>
      <p className="page-stub__body">
        Create and edit templates with merge fields such as{" "}
        <code>{"{{name}}"}</code>, <code>{"{{eventName}}"}</code>,{" "}
        <code>{"{{company}}"}</code>. Sends enqueue via outbox (no provider
        call on save).
      </p>

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="comms-no-event">
          Select an event to edit email templates.
        </p>
      ) : null}

      {activeEventId ? (
        <section
          className="event-settings__card"
          data-testid="comms-template-editor"
          aria-labelledby="comms-template-heading"
        >
          <h3 id="comms-template-heading" className="event-settings__heading">
            Template editor
          </h3>
          <form
            className="event-settings__form"
            data-testid="comms-template-form"
            onSubmit={(e) => void onSave(e)}
          >
            <label className="event-settings__label" htmlFor="comms-template-key">
              Key
            </label>
            <input
              id="comms-template-key"
              className="event-settings__input lumen-focusable"
              data-testid="comms-template-key-input"
              value={key}
              onChange={(e) => {
                setKey(e.target.value.trim().toLowerCase());
                setExpectedVersion(null);
                setLastSaved(null);
              }}
              pattern="[a-z][a-z0-9_-]*"
              required
              maxLength={64}
            />

            <label
              className="event-settings__label"
              htmlFor="comms-template-subject"
            >
              Subject
            </label>
            <input
              id="comms-template-subject"
              className="event-settings__input lumen-focusable"
              data-testid="comms-template-subject-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              maxLength={500}
            />

            <label
              className="event-settings__label"
              htmlFor="comms-template-body"
            >
              Body
            </label>
            <textarea
              id="comms-template-body"
              className="event-settings__input lumen-focusable"
              data-testid="comms-template-body-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={8}
              maxLength={50_000}
            />

            <p
              className="eval-queue__muted"
              data-testid="comms-merge-fields"
            >
              Merge fields detected:{" "}
              {mergeFields.length === 0
                ? "none"
                : mergeFields.map((f) => `{{${f}}}`).join(", ")}
            </p>

            <button
              type="submit"
              className="event-settings__submit lumen-focusable"
              data-testid="comms-template-save"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save template"}
            </button>
          </form>

          {status ? (
            <p
              className={
                status.kind === "error"
                  ? "event-settings__status event-settings__status--error"
                  : "event-settings__status"
              }
              data-testid="comms-template-status"
              role={status.kind === "error" ? "alert" : "status"}
            >
              {status.text}
            </p>
          ) : null}

          {lastSaved ? (
            <p
              className="eval-queue__muted"
              data-testid="comms-template-saved-subject"
            >
              Saved subject: {lastSaved.subject}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
