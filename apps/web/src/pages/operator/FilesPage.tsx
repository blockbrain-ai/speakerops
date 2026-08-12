/**
 * N6 Files library — event file assets (admin).
 * Lists files via existing files API when available; honest empty otherwise.
 */
import { useCallback, useEffect, useState } from "react";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { ErrorEnvelopeSchema } from "@speakerops/shared";

type FileRow = {
  id: string;
  purpose?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  uploaded?: boolean;
  createdAt?: string;
};

export function FilesPage() {
  const { activeEventId } = useEventContext();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeEventId) {
      setFiles([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/files`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (res.status === 404) {
        // Endpoint may not exist yet — fail open with guidance.
        setFiles([]);
        setError(null);
        return;
      }
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Failed (${res.status})`);
        setFiles([]);
        return;
      }
      const body = (await res.json()) as { files?: FileRow[] };
      setFiles(Array.isArray(body.files) ? body.files : []);
    } catch {
      setError("Network error");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div data-testid="page-files" data-section="n6-files">
      <PageHeader
        eyebrow="Operator"
        title="Files"
        description="Central file library for this event (logos, headshots, uploads)."
        data-testid="files-page-header"
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="files-refresh"
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
        <p className="eval-queue__muted" data-testid="files-error">
          {error}
        </p>
      ) : files.length === 0 ? (
        <p className="eval-queue__muted" data-testid="files-empty">
          {loading
            ? "Loading…"
            : "No files listed yet. Uploads from CFP, portal, and design kit appear here as the index grows."}
        </p>
      ) : (
        <ul className="files-list" data-testid="files-list">
          {files.map((f) => (
            <li key={f.id} data-testid={`files-row-${f.id}`}>
              <a
                href={`/api/files/${encodeURIComponent(f.id)}`}
                className="eval-queue__link lumen-focusable"
                target="_blank"
                rel="noreferrer"
              >
                {f.filename || f.id}
              </a>
              <span className="eval-queue__muted">
                {[
                  f.purpose,
                  f.contentType,
                  f.sizeBytes != null ? `${f.sizeBytes} B` : null,
                  f.uploaded === false ? "pending" : null,
                  f.createdAt
                    ? new Date(f.createdAt).toLocaleString()
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
