/**
 * Speaker portal — Resources, File requests, and Portal forms (N1–N3).
 */
import { useCallback, useEffect, useState } from "react";
import {
  ErrorEnvelopeSchema,
  PortalFormListResponseSchema,
  PortalFormResponseDtoSchema,
  type PortalFormDto,
} from "@speakerops/shared";
import { Button } from "../../components/ui/Button.js";

type ResourceItem = {
  id: string;
  title: string;
  bodyMd: string | null;
  updatedAt: string;
};

type FileRequestItem = {
  id: string;
  title: string;
  instructions: string | null;
  purpose: string;
  updatedAt: string;
};

export function PortalResourcesPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<ResourceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/resources?eventId=${encodeURIComponent(eventId)}`,
          { credentials: "include", headers: { accept: "application/json" } },
        );
        if (cancelled) return;
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setError(env.success ? env.data.error : `Failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { resources?: ResourceItem[] };
        setRows(Array.isArray(body.resources) ? body.resources : []);
      } catch {
        if (!cancelled) setError("Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <section
      className="portal-card"
      data-testid="portal-resources"
      id="portal-resources"
    >
      <h2 className="portal-heading" tabIndex={-1}>
        Resources
      </h2>
      <p className="portal-muted">
        Guides and reference pages published by the organisers.
      </p>
      {error ? (
        <p className="portal-status portal-status--error" data-testid="portal-resources-error">
          {error}
        </p>
      ) : null}
      {rows.length === 0 && !error ? (
        <p className="portal-muted" data-testid="portal-resources-empty">
          No resources published yet.
        </p>
      ) : (
        <ul className="portal-task-list" data-testid="portal-resources-list">
          {rows.map((r) => (
            <li key={r.id} data-testid={`portal-resource-${r.id}`}>
              <button
                type="button"
                className="portal-btn portal-btn--secondary lumen-focusable"
                data-testid={`portal-resource-open-${r.id}`}
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
              >
                {r.title}
              </button>
              {openId === r.id ? (
                <div
                  className="portal-resource-body"
                  data-testid={`portal-resource-body-${r.id}`}
                >
                  <pre className="portal-muted" style={{ whiteSpace: "pre-wrap" }}>
                    {r.bodyMd || "—"}
                  </pre>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PortalFileRequestsPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<FileRequestItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/file-requests?eventId=${encodeURIComponent(eventId)}`,
          { credentials: "include", headers: { accept: "application/json" } },
        );
        if (cancelled) return;
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setError(env.success ? env.data.error : `Failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { fileRequests?: FileRequestItem[] };
        setRows(Array.isArray(body.fileRequests) ? body.fileRequests : []);
      } catch {
        if (!cancelled) setError("Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <section
      className="portal-card"
      data-testid="portal-file-requests"
      id="portal-file-requests"
    >
      <h2 className="portal-heading" tabIndex={-1}>
        File requests
      </h2>
      <p className="portal-muted">
        Additional files organisers need. Use Profile for headshot/slides when
        those tasks are open.
      </p>
      {error ? (
        <p className="portal-status portal-status--error">{error}</p>
      ) : null}
      {rows.length === 0 && !error ? (
        <p className="portal-muted" data-testid="portal-file-requests-empty">
          No extra file requests right now.
        </p>
      ) : (
        <ul className="portal-task-list" data-testid="portal-file-requests-list">
          {rows.map((r) => (
            <li key={r.id} data-testid={`portal-file-request-${r.id}`}>
              <strong>{r.title}</strong>
              <span className="portal-muted"> · {r.purpose}</span>
              {r.instructions ? (
                <p className="portal-muted">{r.instructions}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PortalFormsPanel({
  eventId,
  participationId,
}: {
  eventId: string;
  participationId: string | null;
}) {
  const [forms, setForms] = useState<PortalFormDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/portal/forms?eventId=${encodeURIComponent(eventId)}`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Failed (${res.status})`);
        return;
      }
      const parsed = PortalFormListResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        setError("Unexpected forms response");
        return;
      }
      setForms(parsed.data.forms);
      setError(null);
    } catch {
      setError("Network error");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = forms.find((f) => f.id === activeFormId) ?? null;

  async function submit() {
    if (!active || !participationId) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/portal/forms/${encodeURIComponent(active.id)}/responses`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            participationId,
            answers,
          }),
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus(env.success ? env.data.error : `Save failed (${res.status})`);
        return;
      }
      const parsed = PortalFormResponseDtoSchema.safeParse(await res.json());
      if (parsed.success) {
        setStatus("Saved");
      } else {
        setStatus("Saved");
      }
    } catch {
      setStatus("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="portal-card"
      data-testid="portal-forms"
      id="portal-forms"
    >
      <h2 className="portal-heading" tabIndex={-1}>
        Forms
      </h2>
      <p className="portal-muted">
        Post-acceptance questionnaires from the organisers (travel, AV, dietary…).
      </p>
      {error ? (
        <p className="portal-status portal-status--error" data-testid="portal-forms-error">
          {error}
        </p>
      ) : null}
      {!participationId ? (
        <p className="portal-muted">No participation linked — cannot submit forms.</p>
      ) : null}
      {forms.length === 0 && !error ? (
        <p className="portal-muted" data-testid="portal-forms-empty">
          No forms to complete right now.
        </p>
      ) : (
        <ul className="portal-task-list" data-testid="portal-forms-list">
          {forms.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="portal-btn portal-btn--secondary lumen-focusable"
                data-testid={`portal-form-open-${f.id}`}
                onClick={() => {
                  setActiveFormId(f.id);
                  setAnswers({});
                  setStatus(null);
                }}
              >
                {f.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {active ? (
        <div
          className="portal-form"
          data-testid="portal-form-fill"
          style={{ marginTop: 16 }}
        >
          <h3 className="portal-subheading">{active.title}</h3>
          {active.description ? (
            <p className="portal-muted">{active.description}</p>
          ) : null}
          {active.fields.map((field) => (
            <div key={field.key} style={{ marginBottom: 12 }}>
              <label className="portal-label" htmlFor={`pf-${field.key}`}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  id={`pf-${field.key}`}
                  className="portal-textarea lumen-focusable"
                  data-testid={`portal-form-field-${field.key}`}
                  value={String(answers[field.key] ?? "")}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [field.key]: e.target.value }))
                  }
                />
              ) : field.type === "checkbox" ? (
                <label className="portal-label">
                  <input
                    type="checkbox"
                    data-testid={`portal-form-field-${field.key}`}
                    checked={Boolean(answers[field.key])}
                    onChange={(e) =>
                      setAnswers((a) => ({
                        ...a,
                        [field.key]: e.target.checked,
                      }))
                    }
                  />{" "}
                  Yes
                </label>
              ) : (
                <input
                  id={`pf-${field.key}`}
                  type={field.type === "url" ? "url" : "text"}
                  className="portal-input lumen-focusable"
                  data-testid={`portal-form-field-${field.key}`}
                  value={String(answers[field.key] ?? "")}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [field.key]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}
          <Button
            type="button"
            data-testid="portal-form-submit"
            disabled={busy || !participationId}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : "Save answers"}
          </Button>
          {status ? (
            <p
              className={
                status === "Saved"
                  ? "portal-status portal-status--ok"
                  : "portal-status portal-status--error"
              }
              data-testid="portal-form-status"
            >
              {status}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
