/**
 * Polished portal file field — hidden native input + accessible Choose/Replace.
 * Keeps inventory testids on the file input for Playwright filechooser flows.
 */
import { useId, type ChangeEvent } from "react";

export type PortalFileFieldProps = {
  /** Container testid e.g. portal-headshot */
  fieldTestId: string;
  /** Native file input testid (G03/G04). */
  inputTestId: string;
  /** Visible choose/replace control testid. */
  chooseTestId: string;
  /** Optional status testid (defaults to `${fieldTestId}-status`). */
  statusTestId?: string;
  /** Optional preview img testid when previewUrl set. */
  previewTestId?: string;
  title: string;
  hint: string;
  privacyNote: string;
  accept: string;
  disabled?: boolean;
  busy?: boolean;
  status?: string | null;
  previewUrl?: string | null;
  hasFile?: boolean;
  onFile: (file: File) => void;
};

export function PortalFileField({
  fieldTestId,
  inputTestId,
  chooseTestId,
  statusTestId,
  previewTestId,
  title,
  hint,
  privacyNote,
  accept,
  disabled = false,
  busy = false,
  status = null,
  previewUrl = null,
  hasFile = false,
  onFile,
}: PortalFileFieldProps) {
  const reactId = useId();
  const inputId = `${fieldTestId}-file-${reactId}`;

  function onChange(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    if (f) onFile(f);
    ev.target.value = "";
  }

  const showReplace = Boolean(hasFile || previewUrl);

  return (
    <div
      className={`portal-file-field${busy ? " portal-file-field--busy" : ""}${
        showReplace ? " portal-file-field--has-file" : ""
      }`}
      data-testid={fieldTestId}
      data-busy={busy ? "true" : "false"}
    >
      <div className="portal-file-field__header">
        <h3 className="portal-subheading">{title}</h3>
        <p className="portal-muted">{hint}</p>
        <p
          className="portal-file-field__privacy"
          data-testid={`${fieldTestId}-privacy`}
        >
          {privacyNote}
        </p>
      </div>

      {previewUrl && previewTestId ? (
        <img
          className="portal-headshot-preview"
          data-testid={previewTestId}
          src={previewUrl}
          alt={`${title} preview`}
        />
      ) : null}

      <div className="portal-file-field__actions">
        <label
          htmlFor={disabled || busy ? undefined : inputId}
          className={`portal-file-field__choose lumen-focusable${
            disabled || busy ? " portal-file-field__choose--disabled" : ""
          }`}
          data-testid={chooseTestId}
          aria-disabled={disabled || busy ? "true" : "false"}
        >
          {busy ? "Uploading…" : showReplace ? "Replace file" : "Choose file"}
        </label>
        <input
          id={inputId}
          type="file"
          accept={accept}
          className="portal-file-field__input"
          data-testid={inputTestId}
          disabled={disabled || busy}
          onChange={onChange}
        />
      </div>

      {status ? (
        <p
          className="portal-status"
          data-testid={statusTestId ?? `${fieldTestId}-status`}
          role="status"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
