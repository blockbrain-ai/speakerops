/**
 * F1 SegmentedControl — compact radiogroup (1–N scores, toggles).
 * Not tab semantics (use real tabs for view switching).
 */
import type { KeyboardEvent } from "react";

export type SegmentedOption = {
  value: string;
  label: string;
};

export type SegmentedControlProps = {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  name: string;
  size?: "sm" | "md";
  "data-testid"?: string;
  disabled?: boolean;
};

export function SegmentedControl({
  options,
  value,
  onChange,
  name,
  size = "sm",
  "data-testid": testId,
  disabled = false,
}: SegmentedControlProps) {
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || options.length === 0) return;
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next = (idx + 1) % options.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      next = (idx - 1 + options.length) % options.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      next = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      next = options.length - 1;
    } else {
      return;
    }
    onChange(options[next]!.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={name}
      data-testid={testId}
      className={`l2-segmented l2-segmented--${size}`}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            name={name}
            disabled={disabled}
            className={
              checked
                ? "l2-segmented__opt l2-segmented__opt--active"
                : "l2-segmented__opt"
            }
            onClick={() => onChange(o.value)}
            tabIndex={checked ? 0 : -1}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
