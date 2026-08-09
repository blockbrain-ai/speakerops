/**
 * Loading state with skeleton placeholders — section 11.7 (S-L2-A11Y).
 *
 * Approximates final layout; honors prefers-reduced-motion via Skeleton CSS.
 */
import { Skeleton } from "./Skeleton.js";

export type LoadingStateProps = {
  label?: string;
  /** Number of skeleton rows. */
  rows?: number;
  className?: string;
  "data-testid"?: string;
};

export function LoadingState({
  label = "Loading…",
  rows = 3,
  className = "",
  "data-testid": testId = "loading-state",
}: LoadingStateProps) {
  const count = Math.max(1, Math.min(rows, 8));
  return (
    <div
      className={["l2-loading-state", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state="loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="l2-loading-state__label" data-testid={`${testId}-label`}>
        {label}
      </p>
      <div className="l2-loading-state__rows" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <Skeleton
            key={i}
            variant="row"
            data-testid={`${testId}-row-${i}`}
          />
        ))}
      </div>
    </div>
  );
}
