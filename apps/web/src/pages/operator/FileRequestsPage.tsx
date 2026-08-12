/**
 * N3 File Requests — reusable request templates (participation-scoped).
 */
import { useCallback, useEffect, useState } from "react";
import { ErrorEnvelopeSchema } from "@speakerops/shared";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";

type FileRequest = {
  id: string;
  title: string;
  instructions: string | null;
  purpose: string;
  status: string;
  version: number;
};

export function FileRequestsPage() {
  const { activeEventId } = useEventContext();
  const [rows, setRows] = useState<FileRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [purpose, setPurpose] = useState<"headshot" | "slides" | "other">(
    "other",
  );
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeEventId) {
      setRows([]);
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/file-requests`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { fileRequests?: FileRequest[] };
      setRows(Array.isArray(data.fileRequests) ? data.fileRequests : []);
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
        `/api/events/${encodeURIComponent(activeEventId)}/file-requests`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            title: title.trim(),
            instructions: instructions.trim() || null,
            purpose,
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
      setInstructions("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function publish(r: FileRequest) {
    if (!activeEventId) return;
    setBusy(true);
    try {
      await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/file-requests/${encodeURIComponent(r.id)}`,
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
    <div data-testid="page-file-requests" data-section="n3-file-requests">
      <PageHeader
        eyebrow="Portals · assets"
        title="File requests"
        description="Named asks for files beyond the default headshot/slides tasks — e.g. session PDF, promo image. Templates are participation-scoped; speakers fulfill via portal upload paths."
        data-testid="file-requests-page-header"
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="file-requests-refresh"
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
          <div className="portal-forms-create" data-testid="file-requests-create">
            <label className="portal-label" htmlFor="fr-title">
              Title
            </label>
            <input
              id="fr-title"
              className="portal-input lumen-focusable"
              data-testid="file-request-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label className="portal-label" htmlFor="fr-purpose">
              Purpose
            </label>
            <select
              id="fr-purpose"
              className="portal-input lumen-focusable"
              data-testid="file-request-purpose"
              value={purpose}
              onChange={(e) =>
                setPurpose(e.target.value as "headshot" | "slides" | "other")
              }
            >
              <option value="headshot">Headshot</option>
              <option value="slides">Slides</option>
              <option value="other">Other</option>
            </select>
            <label className="portal-label" htmlFor="fr-instructions">
              Instructions
            </label>
            <textarea
              id="fr-instructions"
              className="portal-textarea lumen-focusable"
              data-testid="file-request-instructions"
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <Button
              type="button"
              data-testid="file-request-create"
              disabled={busy || !title.trim()}
              onClick={() => void create()}
            >
              Create request
            </Button>
          </div>
          {error ? (
            <p className="eval-queue__muted" data-testid="file-requests-error">
              {error}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p className="eval-queue__muted" data-testid="file-requests-empty">
              No file requests yet.
            </p>
          ) : (
            <ul className="portal-forms-list" data-testid="file-requests-list">
              {rows.map((r) => (
                <li key={r.id} data-testid={`file-request-row-${r.id}`}>
                  <div className="portal-forms-list__item">
                    <strong>
                      {r.title}{" "}
                      <span className="eval-queue__muted">({r.purpose})</span>
                    </strong>
                    <Badge
                      tone={r.status === "published" ? "success" : "warn"}
                    >
                      {r.status}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid={`file-request-publish-${r.id}`}
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
