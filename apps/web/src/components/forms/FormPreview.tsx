/**
 * Side-by-side live preview of the draft CFP form (D07 / 11.3).
 * Used in Build workspace canvas and Public preview view mode.
 * Shows welcome copy and visible fields; conditional showWhen applied.
 * Multiselect = checkbox group (matches public CFP); URL = type=url text.
 */
import { useMemo, useState } from "react";
import type { BuilderField } from "./form-builder-utils.js";
import { isFieldVisibleInPreview } from "./form-builder-utils.js";

export type FormPreviewProps = {
  fields: BuilderField[];
  welcomeMd: string;
  thankYouMd: string;
};

function parseMultiselect(raw: string | undefined): string[] {
  if (raw == null || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* single legacy value */
  }
  return [raw];
}

export function FormPreview({
  fields,
  welcomeMd,
  thankYouMd,
}: FormPreviewProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const sorted = useMemo(
    () => [...fields].sort((a, b) => a.sortOrder - b.sortOrder),
    [fields],
  );

  const visible = sorted.filter((f) =>
    isFieldVisibleInPreview(f, sorted, answers),
  );

  return (
    <div className="form-builder__preview" data-testid="form-preview">
      <h3 className="form-builder__heading" id="form-preview-heading">
        Live preview
      </h3>
      <p className="form-builder__muted">
        Side-by-side draft preview (not the public published surface).
      </p>

      {welcomeMd.trim() ? (
        <div
          className="form-builder__preview-welcome"
          data-testid="form-preview-welcome"
        >
          {welcomeMd}
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <p
          className="form-builder__empty"
          data-testid="form-preview-empty"
        >
          No fields yet. Add fields from the palette to preview the form.
        </p>
      ) : (
        <ul className="form-builder__preview-list" data-testid="form-preview-fields">
          {visible.map((f) => (
            <li
              key={f.clientId}
              className="form-builder__preview-field"
              data-testid={`form-preview-field-${f.fieldKey}`}
              data-field-key={f.fieldKey}
              data-required={f.required ? "true" : "false"}
            >
              <label
                className="form-builder__preview-label"
                htmlFor={
                  f.type === "multiselect"
                    ? undefined
                    : `preview-${f.fieldKey}`
                }
              >
                <span data-testid={`form-preview-label-${f.fieldKey}`}>
                  {f.label}
                </span>
                {f.required ? (
                  <span className="form-builder__required-mark" aria-hidden>
                    {" "}
                    *
                  </span>
                ) : null}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  id={`preview-${f.fieldKey}`}
                  className="form-builder__input lumen-focusable"
                  rows={3}
                  value={answers[f.fieldKey] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [f.fieldKey]: e.target.value,
                    }))
                  }
                  data-testid={`form-preview-input-${f.fieldKey}`}
                />
              ) : f.type === "select" ? (
                <select
                  id={`preview-${f.fieldKey}`}
                  className="form-builder__input lumen-focusable"
                  value={answers[f.fieldKey] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [f.fieldKey]: e.target.value,
                    }))
                  }
                  data-testid={`form-preview-input-${f.fieldKey}`}
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "multiselect" ? (
                <div
                  className="form-builder__preview-multiselect"
                  id={`preview-${f.fieldKey}`}
                  data-testid={`form-preview-input-${f.fieldKey}`}
                  role="group"
                  aria-label={f.label}
                >
                  {(f.options ?? []).map((o) => {
                    const selected = parseMultiselect(answers[f.fieldKey]);
                    const checked = selected.includes(o.value);
                    return (
                      <label
                        key={o.value}
                        className="form-builder__preview-multiselect-option"
                      >
                        <input
                          type="checkbox"
                          className="lumen-focusable"
                          data-testid={`form-preview-input-${f.fieldKey}-${o.value}`}
                          checked={checked}
                          onChange={(e) => {
                            const cur = parseMultiselect(answers[f.fieldKey]);
                            const next = e.target.checked
                              ? [...new Set([...cur, o.value])]
                              : cur.filter((v) => v !== o.value);
                            setAnswers((prev) => ({
                              ...prev,
                              [f.fieldKey]: JSON.stringify(next),
                            }));
                          }}
                        />
                        <span>{o.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : f.type === "checkbox" ? (
                <input
                  id={`preview-${f.fieldKey}`}
                  type="checkbox"
                  className="lumen-focusable"
                  checked={(answers[f.fieldKey] ?? "") === "true"}
                  onChange={(e) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [f.fieldKey]: e.target.checked ? "true" : "false",
                    }))
                  }
                  data-testid={`form-preview-input-${f.fieldKey}`}
                />
              ) : (
                <input
                  id={`preview-${f.fieldKey}`}
                  type={
                    f.type === "email"
                      ? "email"
                      : f.type === "number"
                        ? "number"
                        : f.type === "url"
                          ? "url"
                          : f.type === "date"
                            ? "date"
                            : "text"
                  }
                  className="form-builder__input lumen-focusable"
                  value={answers[f.fieldKey] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [f.fieldKey]: e.target.value,
                    }))
                  }
                  data-testid={`form-preview-input-${f.fieldKey}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {thankYouMd.trim() ? (
        <div
          className="form-builder__preview-thanks"
          data-testid="form-preview-thanks"
        >
          {thankYouMd}
        </div>
      ) : null}
    </div>
  );
}
