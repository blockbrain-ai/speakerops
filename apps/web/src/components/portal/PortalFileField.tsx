/**
 * Polished portal file field — button opens native picker via inputRef.click().
 * Do not rely on label+clipped input (breaks in Safari and when useId has colons).
 * Keeps inventory testids on the file input for Playwright filechooser flows.
 */
import { useRef, type ChangeEvent } from "react";

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
  /** Why disabled — shown so the control is never a silent dead button. */
  disabledReason?: string | null;
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
  disabledReason = null,
  status = null,
  previewUrl = null,
  hasFile = false,
  onFile,
}: PortalFileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const blocked = disabled || busy;

  function onChange(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    if (f) onFile(f);
    ev.target.value = "";
  }

  function openPicker() {
    if (blocked) return;
    inputRef.current?.click();
  }

  const showReplace = Boolean(hasFile || previewUrl);

  return (
    <div
      className={`portal-file-field${busy ? " portal-file-field--busy" : ""}${
        showReplace ? " portal-file-field--has-file" : ""
      }`}
      data-testid={fieldTestId}
      data-busy={busy ? "true" : "false"}
      data-disabled={blocked ? "true" : "false"}
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
        <button
          type="button"
          className={`portal-file-field__choose lumen-focusable${
            blocked ? " portal-file-field__choose--disabled" : ""
          }`}
          data-testid={chooseTestId}
          disabled={blocked}
          aria-disabled={blocked ? "true" : "false"}
          onClick={openPicker}
        >
          {busy ? "Uploading…" : showReplace ? "Replace file" : "Choose file"}
        </button>
        {/*
          Keep input in-flow but visually hidden (not position:absolute clip).
          Programmatic click from the button is the reliable open path.
        */}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="portal-file-field__input"
          data-testid={inputTestId}
          tabIndex={-1}
          disabled={blocked}
          onChange={onChange}
        />
      </div>

      {blocked && disabledReason ? (
        <p
          className="portal-status portal-status--error"
          data-testid={`${fieldTestId}-disabled-reason`}
          role="status"
        >
          {disabledReason}
        </p>
      ) : null}

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
