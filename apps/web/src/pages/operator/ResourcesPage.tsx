/**
 * N2 Resources — event wiki pages for speakers (admin).
 */
import { useCallback, useEffect, useState } from "react";
import { ErrorEnvelopeSchema } from "@speakerops/shared";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";

type Resource = {
  id: string;
  title: string;
  bodyMd: string | null;
  status: string;
  version: number;
};

export function ResourcesPage() {
  const { activeEventId } = useEventContext();
  const [rows, setRows] = useState<Resource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!activeEventId) {
      setRows([]);
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/resources`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { resources?: Resource[] };
      setRows(Array.isArray(data.resources) ? data.resources : []);
    } catch {
      setError("Network error");
    }
  }, [activeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!activeEventId || !title.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/resources`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            title: title.trim(),
            bodyMd: body.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Create failed (${res.status})`);
        return;
      }
      setTitle("");
      setBody("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function publish(r: Resource) {
    if (!activeEventId) return;
    setBusy(true);
    try {
      await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/resources/${encodeURIComponent(r.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            status: r.status === "published" ? "draft" : "published",
            expectedVersion: r.version,
          }),
        },
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveSelected() {
    if (!activeEventId || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/resources/${encodeURIComponent(selected.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            title: title.trim() || selected.title,
            bodyMd: body.trim() || null,
            expectedVersion: selected.version,
          }),
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Save failed (${res.status})`);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  function selectResource(r: Resource) {
    setSelectedId(r.id);
    setTitle(r.title);
    setBody(r.bodyMd ?? "");
  }

  return (
    <div data-testid="page-resources" data-section="n2-resources">
      <PageHeader
        eyebrow="Portals · speaker library"
        title="Resources"
        description="A short speaker wiki: code of conduct, venue map, AV guide, schedule PDF. Draft → Publish. Published pages are the speaker-facing library (not a public microsite)."
        data-testid="resources-page-header"
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="resources-refresh"
            onClick={() => void load()}
          >
            Refresh
          </Button>
        }
      />
      {!activeEventId ? (
        <p className="eval-queue__muted">Select an event.</p>
      ) : (
        <>
          <div className="portal-forms-create" data-testid="resources-create">
            <label className="portal-label" htmlFor="resource-title">
              Title
            </label>
            <input
              id="resource-title"
              className="portal-input lumen-focusable"
              data-testid="resource-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label className="portal-label" htmlFor="resource-body">
              Body (markdown)
            </label>
            <textarea
              id="resource-body"
              className="portal-textarea lumen-focusable"
              data-testid="resource-body-input"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="eval-queue__row" style={{ gap: 8, display: "flex" }}>
              <Button
                type="button"
                data-testid="resource-create"
                disabled={busy || !title.trim() || selectedId != null}
                onClick={() => void create()}
              >
                Create resource
              </Button>
              {selectedId ? (
                <Button
                  type="button"
                  data-testid="resource-save"
                  disabled={busy || !title.trim()}
                  onClick={() => void saveSelected()}
                >
                  Save changes
                </Button>
              ) : null}
              {selectedId ? (
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="resource-clear-selection"
                  disabled={busy}
                  onClick={() => {
                    setSelectedId(null);
                    setTitle("");
                    setBody("");
                  }}
                >
                  New page
                </Button>
              ) : null}
            </div>
          </div>
          {error ? (
            <p className="eval-queue__muted" data-testid="resources-error">
              {error}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <div className="portal-forms-empty" data-testid="resources-empty">
              <h3>No resources yet</h3>
              <p className="eval-queue__muted">
                Start with a Code of conduct or Speaker FAQ. Keep each page
                short — this is a library, not a full CMS.
              </p>
              <Button
                type="button"
                variant="secondary"
                data-testid="resources-seed-starter"
                disabled={busy}
                onClick={() => {
                  setTitle("Speaker code of conduct");
                  setBody(
                    "Be kind. Be on time. No harassment. Contact the organiser desk for help.",
                  );
                }}
              >
                Prefill starter page
              </Button>
            </div>
          ) : (
            <ul className="portal-forms-list" data-testid="resources-list">
              {rows.map((r) => (
                <li key={r.id} data-testid={`resource-row-${r.id}`}>
                  <div
                    className={
                      selectedId === r.id
                        ? "portal-forms-list__item is-active"
                        : "portal-forms-list__item"
                    }
                  >
                    <button
                      type="button"
                      className="lumen-focusable"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        textAlign: "left",
                        cursor: "pointer",
                        font: "inherit",
                        color: "inherit",
                      }}
                      data-testid={`resource-select-${r.id}`}
                      onClick={() => selectResource(r)}
                    >
                      <strong>{r.title}</strong>
                    </button>
                    <Badge
                      tone={r.status === "published" ? "success" : "warn"}
                    >
                      {r.status}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid={`resource-publish-${r.id}`}
                      disabled={busy}
                      onClick={() => void publish(r)}
                    >
                      {r.status === "published" ? "Unpublish" : "Publish"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
