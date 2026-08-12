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
  const [busy, setBusy] = useState(false);

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

  return (
    <div data-testid="page-resources" data-section="n2-resources">
      <PageHeader
        eyebrow="Portals"
        title="Resources"
        description="Event wiki pages for speakers. Publish when ready; speakers see published content in portal depth waves."
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
            <Button
              type="button"
              data-testid="resource-create"
              disabled={busy || !title.trim()}
              onClick={() => void create()}
            >
              Create resource
            </Button>
          </div>
          {error ? (
            <p className="eval-queue__muted" data-testid="resources-error">
              {error}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p className="eval-queue__muted" data-testid="resources-empty">
              No resources yet.
            </p>
          ) : (
            <ul className="portal-forms-list" data-testid="resources-list">
              {rows.map((r) => (
                <li key={r.id} data-testid={`resource-row-${r.id}`}>
                  <div className="portal-forms-list__item">
                    <strong>{r.title}</strong>
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
