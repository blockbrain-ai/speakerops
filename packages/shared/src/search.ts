/**
 * F5 global permissioned Find — shared contracts.
 * NOT generative AI: permissioned DB search only.
 */
import { z } from "zod";

export const SEARCH_ENTITY_TYPES = [
  "submission",
  "session",
  "speaker",
  "form",
  "task",
] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];
export const SearchEntityTypeSchema = z.enum(SEARCH_ENTITY_TYPES);

export const SEARCH_QUERY_MAX = 200 as const;
export const SEARCH_DEFAULT_LIMIT = 20 as const;
export const SEARCH_MAX_LIMIT = 50 as const;

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(SEARCH_QUERY_MAX),
  types: z
    .union([
      z.array(SearchEntityTypeSchema),
      z.string().transform((s) =>
        s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ])
    .optional()
    .transform((v) => {
      if (v == null) return undefined;
      const arr = Array.isArray(v) ? v : [v];
      const out: SearchEntityType[] = [];
      for (const t of arr) {
        const p = SearchEntityTypeSchema.safeParse(t);
        if (p.success && !out.includes(p.data)) out.push(p.data);
      }
      return out.length > 0 ? out : undefined;
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_MAX_LIMIT)
    .optional()
    .default(SEARCH_DEFAULT_LIMIT),
  /** Opaque cursor (id of last result) for stable paging. */
  cursor: z.string().min(1).max(200).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchHitSchema = z.object({
  id: z.string().min(1),
  entityType: SearchEntityTypeSchema,
  entityId: z.string().min(1),
  eventId: z.string().min(1),
  title: z.string(),
  /** Safe plain-text snippet (no HTML). */
  snippet: z.string(),
  status: z.string().nullable(),
  route: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResponseSchema = z.object({
  hits: z.array(SearchHitSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  q: z.string(),
  /** ISO timestamp of index freshness for this event (last rebuild/upsert). */
  freshness: z.string().nullable(),
  nextCursor: z.string().nullable().optional(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SearchReindexResponseSchema = z.object({
  indexed: z.number().int().nonnegative(),
  freshness: z.string(),
});
export type SearchReindexResponse = z.infer<typeof SearchReindexResponseSchema>;

/**
 * Escape hostile FTS5 query syntax. Keeps alphanumerics + simple tokens;
 * wraps multi-word as AND of prefix tokens for usable autocomplete.
 * Strips boolean operators and punctuation so user input cannot inject FTS logic.
 */
export function sanitizeFtsQuery(raw: string): string {
  const cleaned = raw
    .replace(/["'*:(){}[\]^~=!<>]/g, " ")
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_QUERY_MAX);
  if (!cleaned) return "";
  const tokens = cleaned
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !/^(and|or|not|near)$/i.test(t));
  // Prefix match each token (index-usable for FTS); join with AND.
  return tokens.map((t) => `"${t.replace(/"/g, "")}"*`).join(" ");
}

/** Plain-text snippet around first match of q (case-insensitive). */
export function makeSnippet(body: string, q: string, max = 160): string {
  const text = (body || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const needle = q.trim().split(/\s+/)[0] ?? "";
  const lower = text.toLowerCase();
  const idx = needle ? lower.indexOf(needle.toLowerCase()) : -1;
  if (idx < 0) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, start + max);
  const slice = text.slice(start, end);
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}

/**
 * Canonical allowlisted deep links for Find hits.
 * Only these paths/query keys are navigable from the palette.
 */
export function searchHitRoute(
  entityType: SearchEntityType,
  entityId: string,
  opts?: { participationId?: string | null },
): string {
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case "submission":
      return `/admin/submissions?submissionId=${id}`;
    case "session":
      return `/admin/schedule?sessionId=${id}`;
    case "speaker":
      return `/admin/speakers?participationId=${id}`;
    case "task": {
      const pid = opts?.participationId
        ? encodeURIComponent(opts.participationId)
        : id;
      return `/admin/speakers?participationId=${pid}`;
    }
    case "form":
      return `/admin/cfp?form=${id}`;
    default:
      return "/admin";
  }
}

/** True only for allowlisted Find routes (blocks sessionStorage smuggling). */
export function isAllowedSearchRoute(route: string): boolean {
  if (typeof route !== "string" || !route.startsWith("/admin")) return false;
  try {
    const u = new URL(route, "https://speakerops.local");
    const path = u.pathname;
    if (path === "/admin/submissions") {
      return u.searchParams.has("submissionId");
    }
    if (path === "/admin/schedule") {
      return u.searchParams.has("sessionId");
    }
    if (path === "/admin/speakers") {
      return u.searchParams.has("participationId");
    }
    if (path === "/admin/cfp") {
      return u.searchParams.has("form") || u.search === "";
    }
    if (path === "/admin") return true;
    return false;
  } catch {
    return false;
  }
}

/** Escape LIKE metacharacters for prefix/contains patterns. */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
