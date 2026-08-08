/**
 * Admin task templates settings (section 4.1 / O05).
 *
 * CRUD for on_accept / manual templates that materialize speaker_tasks on accept.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  TaskTemplateListResponseSchema,
  TaskTemplateResponseSchema,
  TaskTemplateDeleteResponseSchema,
  ErrorEnvelopeSchema,
  type TaskTemplateDto,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

type StatusMsg = { kind: "ok" | "error"; text: string } | null;

export function TaskTemplatesSettingsPage() {
  const { activeEventId } = useEventContext();
  const [templates, setTemplates] = useState<TaskTemplateDto[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<"on_accept" | "manual">("on_accept");
  const [dueOffsetDays, setDueOffsetDays] = useState("14");
  const [status, setStatus] = useState<StatusMsg>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadTemplates = useCallback(async (eventId: string) => {
    setLoadError(null);
    // Do not clear action status here — create/delete set it after reload.
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/task-templates`,
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
        return;
      }
      const raw: unknown = await res.json();
      const parsed = TaskTemplateListResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError("Unexpected templates response");
        return;
      }
      setTemplates(parsed.data.templates);
    } catch {
      setLoadError("Network error");
    }
  }, []);

  useEffect(() => {
    if (activeEventId) {
      void loadTemplates(activeEventId);
    }
  }, [activeEventId, loadTemplates]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!activeEventId) {
      setStatus({ kind: "error", text: "Select an event first" });
      return;
    }
    setSaving(true);
    setStatus(null);
    const days = Number.parseInt(dueOffsetDays, 10);
    if (Number.isNaN(days) || days < 0) {
      setStatus({ kind: "error", text: "dueOffsetDays must be a non-negative integer" });
      setSaving(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/task-templates`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() === "" ? null : description.trim(),
            trigger,
            dueOffsetDays: days,
          }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Create failed (${res.status})`,
        });
        setSaving(false);
        return;
      }
      const parsed = TaskTemplateResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected response" });
        setSaving(false);
        return;
      }
      setTitle("");
      setDescription("");
      setDueOffsetDays("14");
      setTrigger("on_accept");
      await loadTemplates(activeEventId);
      setStatus({
        kind: "ok",
        text: `Template “${parsed.data.template.title}” created`,
      });
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(templateId: string) {
    if (!activeEventId) return;
    setStatus(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/task-templates/${encodeURIComponent(templateId)}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Delete failed (${res.status})`,
        });
        return;
      }
      const parsed = TaskTemplateDeleteResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected delete response" });
        return;
      }
      await loadTemplates(activeEventId);
      setStatus({ kind: "ok", text: "Template deleted" });
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    }
  }

  return (
    <div
      className="event-settings"
      data-testid="page-task-templates"
      data-section="4.1"
    >
      <p className="page-stub__overline">Settings</p>
      <h2 className="page-stub__title">Task templates</h2>
      <p className="page-stub__body">
        Templates with trigger <code>on_accept</code> create speaker tasks when a
        submission is accepted.{" "}
        <a
          href="/admin/settings"
          className="design-kit__link lumen-focusable"
          data-testid="task-templates-back"
        >
          ← Event settings
        </a>
      </p>

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="task-templates-no-event">
          Select an event to manage task templates.
        </p>
      ) : null}

      {loadError ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="task-templates-load-error"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {activeEventId ? (
        <>
          <section
            className="event-settings__card"
            data-testid="task-templates-list-section"
            aria-labelledby="task-templates-list-heading"
          >
            <h3
              id="task-templates-list-heading"
              className="event-settings__heading"
            >
              Existing templates
            </h3>
            {templates.length === 0 ? (
              <p
                className="eval-queue__muted"
                data-testid="task-templates-empty"
              >
                No templates yet. Defaults seed on first accept if none exist.
              </p>
            ) : (
              <ul
                className="event-settings__list"
                data-testid="task-templates-list"
              >
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className="event-settings__list-item"
                    data-testid={`task-template-row-${t.id}`}
                    data-template-id={t.id}
                  >
                    <strong data-testid={`task-template-title-${t.id}`}>
                      {t.title}
                    </strong>
                    <span className="eval-queue__muted">
                      {" "}
                      · {t.trigger} · due +{t.dueOffsetDays}d
                    </span>
                    {t.description ? (
                      <p className="page-stub__body">{t.description}</p>
                    ) : null}
                    <button
                      type="button"
                      className="eval-queue__link lumen-focusable"
                      data-testid={`task-template-delete-${t.id}`}
                      onClick={() => void onDelete(t.id)}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="event-settings__card"
            data-testid="task-templates-create-section"
            aria-labelledby="task-templates-create-heading"
          >
            <h3
              id="task-templates-create-heading"
              className="event-settings__heading"
            >
              Add template
            </h3>
            <form
              className="event-settings__form"
              onSubmit={onCreate}
              data-testid="task-templates-form"
            >
              <label
                className="event-settings__label"
                htmlFor="task-template-title"
              >
                Title
              </label>
              <input
                id="task-template-title"
                className="event-settings__input lumen-focusable"
                data-testid="task-template-title-input"
                value={title}
                onChange={(ev) => setTitle(ev.target.value)}
                required
                maxLength={200}
              />

              <label
                className="event-settings__label"
                htmlFor="task-template-description"
              >
                Description
              </label>
              <textarea
                id="task-template-description"
                className="event-settings__input lumen-focusable"
                data-testid="task-template-description-input"
                value={description}
                onChange={(ev) => setDescription(ev.target.value)}
                rows={3}
                maxLength={4000}
              />

              <label
                className="event-settings__label"
                htmlFor="task-template-trigger"
              >
                Trigger
              </label>
              <select
                id="task-template-trigger"
                className="event-settings__input lumen-focusable"
                data-testid="task-template-trigger-input"
                value={trigger}
                onChange={(ev) =>
                  setTrigger(ev.target.value as "on_accept" | "manual")
                }
              >
                <option value="on_accept">on_accept</option>
                <option value="manual">manual</option>
              </select>

              <label
                className="event-settings__label"
                htmlFor="task-template-due"
              >
                Due offset (days)
              </label>
              <input
                id="task-template-due"
                type="number"
                min={0}
                className="event-settings__input lumen-focusable"
                data-testid="task-template-due-input"
                value={dueOffsetDays}
                onChange={(ev) => setDueOffsetDays(ev.target.value)}
                required
              />

              <button
                type="submit"
                className="event-settings__submit lumen-focusable"
                data-testid="task-template-create"
                disabled={saving}
              >
                {saving ? "Saving…" : "Create template"}
              </button>

              {status ? (
                <p
                  className={
                    status.kind === "ok"
                      ? "event-settings__status event-settings__status--ok"
                      : "event-settings__status event-settings__status--error"
                  }
                  data-testid="task-templates-status"
                  role="status"
                >
                  {status.text}
                </p>
              ) : null}
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}
