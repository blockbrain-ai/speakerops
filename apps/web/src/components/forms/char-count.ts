/**
 * Character-cap counter model shared by the builder preview and the public
 * CFP (post-11.9 depth, item 1). Pure — unit-testable without DOM.
 *
 * Tones:
 * - ok    → quiet counter
 * - warn  → approaching the cap (≥ 80% used)
 * - over  → past the cap (submit blocked client-side; server 400s too)
 */
export type CharCountTone = "ok" | "warn" | "over";

export const CHAR_COUNT_WARN_RATIO = 0.8;

export function charCountTone(length: number, maxChars: number): CharCountTone {
  if (maxChars <= 0) return "ok";
  if (length > maxChars) return "over";
  if (length >= Math.ceil(maxChars * CHAR_COUNT_WARN_RATIO)) return "warn";
  return "ok";
}

export function charCountLabel(length: number, maxChars: number): string {
  return `${length.toLocaleString()} / ${maxChars.toLocaleString()} characters`;
}

/** Human error used when a capped answer is over the limit. */
export function charCountOverMessage(label: string, maxChars: number): string {
  return `${label} is limited to ${maxChars.toLocaleString()} characters`;
}
