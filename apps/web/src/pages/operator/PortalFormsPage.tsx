/**
 * N1 Portal Forms builder — post-acceptance data collection (participation-scoped).
 * Create → edit fields → publish. Speakers fill published forms in the portal.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ErrorEnvelopeSchema,
  PortalFormDtoSchema,
  PortalFormListResponseSchema,
  type PortalFormDto,
  type PortalFormField,
} from "@speakerops/shared";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";

export function PortalFormsPage() {
  const { activeEventId } = useEventContext();
  const [forms, setForms] = useState<PortalFormDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = forms.find((f) => f.id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!activeEventId) {
      setForms([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/portal-forms`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Failed (${res.status})`);
        setForms([]);
        return;
      }
      const parsed = PortalFormListResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        setError("Unexpected forms response");
        setForms([]);
        return;
      }
      setForms(parsed.data.forms);
    } catch {
      setError("Network error");
      setForms([]);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createForm() {
    if (!activeEventId || !title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/portal-forms`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ title: title.trim(), fields: [] }),
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Create failed (${res.status})`);
        return;
      }
      const parsed = PortalFormDtoSchema.safeParse(await res.json());
      if (parsed.success) {
        setForms((prev) => [parsed.data, ...prev]);
        setSelectedId(parsed.data.id);
        setTitle("");
      }
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function patchForm(
    form: PortalFormDto,
    body: Record<string, unknown>,
  ) {
    if (!activeEventId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/portal-forms/${encodeURIComponent(form.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            ...body,
            expectedVersion: form.version,
          }),
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Update failed (${res.status})`);
        return;
      }
      const parsed = PortalFormDtoSchema.safeParse(await res.json());
      if (parsed.success) {
        setForms((prev) =>
          prev.map((f) => (f.id === parsed.data.id ? parsed.data : f)),
        );
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  function addField() {
    if (!selected || !fieldLabel.trim() || !fieldKey.trim()) return;
    const key = fieldKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+/, "");
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      setError("Field key must be snake_case starting with a letter");
      return;
    }
    if (selected.fields.some((f) => f.key === key)) {
      setError("Field key already exists");
      return;
    }
    const next: PortalFormField[] = [
      ...selected.fields,
      {
        key,
        label: fieldLabel.trim(),
        type: "text",
        required: false,
      },
    ];
    void patchForm(selected, { fields: next }).then(() => {
      setFieldLabel("");
      setFieldKey("");
    });
  }

  return (
    <div data-testid="page-portal-forms" data-section="n1-portal-forms">
      <PageHeader
        eyebrow="Portals"
        title="Portal forms"
        description="Post-acceptance questionnaires scoped to each speaker participation. Publish to collect answers in the speaker portal."
        data-testid="portal-forms-header"
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="portal-forms-refresh"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        }
      />

      {!activeEventId ? (
        <p className="eval-queue__muted">Select an event.</p>
      ) : (
        <div className="portal-forms-layout">
          <section className="portal-forms-list-pane">
            <div className="portal-forms-create" data-testid="portal-forms-create">
              <label className="portal-label" htmlFor="portal-form-title">
                New form title
              </label>
              <input
                id="portal-form-title"
                className="portal-input lumen-focusable"
                data-testid="portal-form-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="Travel preferences"
              />
              <Button
                type="button"
                data-testid="portal-form-create"
                disabled={creating || !title.trim()}
                onClick={() => void createForm()}
              >
                {creating ? "Creating…" : "Create form"}
              </Button>
            </div>

            {error ? (
              <p className="eval-queue__muted" data-testid="portal-forms-error">
                {error}
              </p>
            ) : null}

            {forms.length === 0 ? (
              <p className="eval-queue__muted" data-testid="portal-forms-empty">
                {loading
                  ? "Loading…"
                  : "No portal forms yet. Create one to collect post-acceptance answers."}
              </p>
            ) : (
              <ul className="portal-forms-list" data-testid="portal-forms-list">
                {forms.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className={
                        selectedId === f.id
                          ? "portal-forms-list__item is-active lumen-focusable"
                          : "portal-forms-list__item lumen-focusable"
                      }
                      data-testid={`portal-form-item-${f.id}`}
                      onClick={() => setSelectedId(f.id)}
                    >
                      <strong>{f.title}</strong>
                      <Badge
                        tone={
                          f.status === "published"
                            ? "success"
                            : f.status === "archived"
                              ? "neutral"
                              : "warn"
                        }
                      >
                        {f.status}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="portal-forms-editor"
            data-testid="portal-forms-editor"
          >
            {!selected ? (
              <p className="eval-queue__muted">Select a form to edit fields.</p>
            ) : (
              <>
                <header className="portal-forms-editor__head">
                  <h3>{selected.title}</h3>
                  <div className="portal-forms-editor__actions">
                    {selected.status !== "published" ? (
                      <Button
                        type="button"
                        size="sm"
                        data-testid="portal-form-publish"
                        disabled={busy}
                        onClick={() =>
                          void patchForm(selected, { status: "published" })
                        }
                      >
                        Publish
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        data-testid="portal-form-unpublish"
                        disabled={busy}
                        onClick={() =>
                          void patchForm(selected, { status: "draft" })
                        }
                      >
                        Unpublish
                      </Button>
                    )}
                  </div>
                </header>
                <p className="eval-queue__muted">
                  {selected.fields.length} field
                  {selected.fields.length === 1 ? "" : "s"} · v{selected.version}
                </p>
                <ul className="portal-forms-fields" data-testid="portal-form-fields">
                  {selected.fields.map((f) => (
                    <li key={f.key} data-testid={`portal-form-field-${f.key}`}>
                      <strong>{f.label}</strong>
                      <span className="eval-queue__muted">
                        {f.key} · {f.type}
                        {f.required ? " · required" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="portal-forms-add-field">
                  <label className="portal-label" htmlFor="pf-field-label">
                    Field label
                  </label>
                  <input
                    id="pf-field-label"
                    className="portal-input lumen-focusable"
                    data-testid="portal-form-field-label"
                    value={fieldLabel}
                    onChange={(e) => setFieldLabel(e.target.value)}
                  />
                  <label className="portal-label" htmlFor="pf-field-key">
                    Field key
                  </label>
                  <input
                    id="pf-field-key"
                    className="portal-input lumen-focusable"
                    data-testid="portal-form-field-key"
                    value={fieldKey}
                    onChange={(e) => setFieldKey(e.target.value)}
                    placeholder="dietary_needs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="portal-form-field-add"
                    disabled={busy}
                    onClick={addField}
                  >
                    Add text field
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
