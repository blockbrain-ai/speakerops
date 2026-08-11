/**
 * BrandMark — the locked Signal soundwave mark (F1 · Sage & Honey lock).
 *
 * Three ascending sage bars + one offset honey accent bar (the complementary
 * colour lives in the mark), rounded rx. Reduces to the favicon
 * (public/favicon.svg keeps the same geometry).
 *
 * Colors come from Lumen tokens (var(--lumen-brand) / var(--lumen-honey)) so
 * no raw hex ships in components (E6 token lint).
 */
import type { SVGAttributes } from "react";

export type BrandMarkProps = {
  /** Square size in px (default 24). */
  size?: number;
  /** Accessible label; omit/decorative for pure chrome. */
  title?: string;
  decorative?: boolean;
  className?: string;
} & Omit<SVGAttributes<SVGSVGElement>, "className" | "width" | "height">;

export function BrandMark({
  size = 24,
  title = "SpeakerOps",
  decorative = false,
  className = "",
  ...rest
}: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={["brand-mark", className].filter(Boolean).join(" ")}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      data-testid="brand-mark"
      {...rest}
    >
      {decorative ? null : <title>{title}</title>}
      <rect x="2" y="11" width="5" height="12" rx="2.5" fill="var(--lumen-brand)" />
      <rect x="10" y="7" width="5" height="18" rx="2.5" fill="var(--lumen-brand)" />
      <rect x="18" y="2" width="5" height="24" rx="2.5" fill="var(--lumen-honey)" />
      <rect x="26" y="4" width="5" height="26" rx="2.5" fill="var(--lumen-brand)" />
    </svg>
  );
}

export type BrandLockupProps = {
  /** Mark size in px (default 24). */
  size?: number;
  /** Meta line under/beside the wordmark (e.g. "Admin"). */
  className?: string;
};

/**
 * Mark + lowercase wordmark lockup: `speaker` 700 / `ops` 400.
 */
export function BrandLockup({ size = 24, className = "" }: BrandLockupProps) {
  return (
    <span
      className={["brand-lockup", className].filter(Boolean).join(" ")}
      data-testid="brand-lockup"
    >
      <BrandMark size={size} decorative />
      <span className="brand-lockup__wordmark" aria-label="speakerops">
        <span className="brand-lockup__word-strong">speaker</span>
        <span className="brand-lockup__word-light">ops</span>
      </span>
    </span>
  );
}
