/**
 * Lumen 2 Field — label required; hint/error share one slot (section 11.0).
 * States: rest, hover, focus-visible, disabled, error.
 */
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export type FieldBaseProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

/** Allow inventory anchors on the underlying control (E9 @inv law). */
type WithTestId<T> = T & { "data-testid"?: string };

type InputFieldProps = FieldBaseProps & {
  as?: "input";
  inputProps?: WithTestId<
    Omit<
      InputHTMLAttributes<HTMLInputElement>,
      "id" | "disabled" | "required" | "className"
    >
  >;
};

type TextareaFieldProps = FieldBaseProps & {
  as: "textarea";
  inputProps?: WithTestId<
    Omit<
      TextareaHTMLAttributes<HTMLTextAreaElement>,
      "id" | "disabled" | "required" | "className"
    >
  >;
};

type SelectFieldProps = FieldBaseProps & {
  as: "select";
  children?: ReactNode;
  inputProps?: WithTestId<
    Omit<
      SelectHTMLAttributes<HTMLSelectElement>,
      "id" | "disabled" | "required" | "className"
    >
  >;
};

export type FieldProps = InputFieldProps | TextareaFieldProps | SelectFieldProps;

export function Field(props: FieldProps) {
  const {
    id,
    label,
    hint,
    error,
    required = false,
    disabled = false,
    className = "",
    as = "input",
  } = props;

  const hasError = Boolean(error);
  const describedBy = hasError
    ? `${id}-error`
    : hint
      ? `${id}-hint`
      : undefined;

  const classes = [
    "l2-field",
    hasError ? "is-error" : "",
    disabled ? "is-disabled" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-state={hasError ? "error" : disabled ? "disabled" : "rest"}
    >
      <label className="l2-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="l2-field__required"> (required)</span>
        ) : null}
      </label>
      {as === "textarea" ? (
        <textarea
          id={id}
          className="l2-field__control lumen-focusable"
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          {...(props as TextareaFieldProps).inputProps}
        />
      ) : as === "select" ? (
        <select
          id={id}
          className="l2-field__control lumen-focusable"
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          {...(props as SelectFieldProps).inputProps}
        >
          {(props as SelectFieldProps).children}
        </select>
      ) : (
        <input
          id={id}
          className="l2-field__control lumen-focusable"
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          {...(props as InputFieldProps).inputProps}
        />
      )}
      {hasError ? (
        <p className="l2-field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="l2-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : (
        <p className="l2-field__hint" aria-hidden="true">
          {"\u00a0"}
        </p>
      )}
    </div>
  );
}
