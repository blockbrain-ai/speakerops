/**
 * Readiness dashboard pure helpers (section 6.3 / S-READY).
 * Live poll interval, overdue filter, pagination for large lists.
 */

/** Live poll interval — must be ≤5s (H04 / constitution S-READY). */
export const READINESS_POLL_MS = 3_000;

/** Default page size for speakers large list (L05, seed ≤150). */
export const SPEAKERS_PAGE_SIZE = 25;

/**
 * Slice a list into a page window (1-based page).
 * Returns empty array when page is out of range.
 */
export function paginateSlice<T>(
  items: readonly T[],
  page: number,
  pageSize: number = SPEAKERS_PAGE_SIZE,
): { pageItems: T[]; totalPages: number; page: number; total: number } {
  const total = items.length;
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * size;
  return {
    pageItems: items.slice(start, start + size),
    totalPages,
    page: safePage,
    total,
  };
}

/** Build speakers list deep-link for readiness drill (H03). */
export function speakerDetailPath(participationId: string): string {
  return `/admin/speakers?participationId=${encodeURIComponent(participationId)}`;
}

/** Parse participationId from /admin/speakers search string. */
export function participationIdFromSearch(search: string): string | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(q);
  const id = params.get("participationId");
  return id && id.length > 0 ? id : null;
}
