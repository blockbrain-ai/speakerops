/**
 * F3 data-grid shared contracts — saved views + grid field allowlists.
 */
import { z } from "zod";

/** Surfaces that may persist saved views. */
export const GRID_SURFACES = ["submissions"] as const;
export type GridSurface = (typeof GRID_SURFACES)[number];
export const GridSurfaceSchema = z.enum(GRID_SURFACES);

export const GRID_DENSITIES = ["comfortable", "compact"] as const;
export type GridDensity = (typeof GRID_DENSITIES)[number];
export const GridDensitySchema = z.enum(GRID_DENSITIES);

/** Submissions grid field allowlist (read-model columns only — F3 cut). */
export const SUBMISSIONS_GRID_FIELDS = [
  "title",
  "status",
  "category",
  "primarySpeakerName",
  "submittedAt",
] as const;
export type SubmissionsGridField = (typeof SUBMISSIONS_GRID_FIELDS)[number];
export const SubmissionsGridFieldSchema = z.enum(SUBMISSIONS_GRID_FIELDS);

export const GRID_SORT_DIRS = ["asc", "desc"] as const;
export const GridSortDirSchema = z.enum(GRID_SORT_DIRS);

export const GridSortSchema = z.object({
  field: SubmissionsGridFieldSchema,
  dir: GridSortDirSchema.default("desc"),
});
export type GridSort = z.infer<typeof GridSortSchema>;

/**
 * Persisted view definition. Unknown fields dropped on read (not crash).
 * Cap: validated at write against surface allowlist.
 */
export const GridViewDefinitionSchema = z.object({
  columns: z.array(SubmissionsGridFieldSchema).min(1).max(40),
  columnOrder: z.array(SubmissionsGridFieldSchema).min(1).max(40),
  columnWidths: z.record(z.string(), z.number().int().min(48).max(640)).optional(),
  sort: GridSortSchema.optional().nullable(),
  /** Status filter chips / enum. */
  status: z.string().min(1).max(64).optional().nullable(),
  category: z.string().min(1).max(128).optional().nullable(),
  /** Prefix search only (index-usable); free contains waits for F5. */
  qPrefix: z.string().min(1).max(200).optional().nullable(),
  density: GridDensitySchema.default("comfortable"),
});
export type GridViewDefinition = z.infer<typeof GridViewDefinitionSchema>;

export const SAVED_VIEWS_MAX_PER_SCOPE = 20 as const;
export const SAVED_VIEW_NAME_MAX = 80 as const;

export const SavedViewDtoSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  eventId: z.string().min(1),
  surface: GridSurfaceSchema,
  name: z.string().min(1).max(SAVED_VIEW_NAME_MAX),
  definition: GridViewDefinitionSchema,
  isDefault: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type SavedViewDto = z.infer<typeof SavedViewDtoSchema>;

export const SavedViewListResponseSchema = z.object({
  views: z.array(SavedViewDtoSchema),
});
export type SavedViewListResponse = z.infer<typeof SavedViewListResponseSchema>;

export const SavedViewCreateBodySchema = z.object({
  name: z.string().min(1).max(SAVED_VIEW_NAME_MAX),
  definition: GridViewDefinitionSchema,
  isDefault: z.boolean().optional().default(false),
});
export type SavedViewCreateBody = z.infer<typeof SavedViewCreateBodySchema>;

export const SavedViewUpdateBodySchema = z.object({
  name: z.string().min(1).max(SAVED_VIEW_NAME_MAX).optional(),
  definition: GridViewDefinitionSchema.optional(),
  isDefault: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
});
export type SavedViewUpdateBody = z.infer<typeof SavedViewUpdateBodySchema>;

export const SavedViewResponseSchema = z.object({
  view: SavedViewDtoSchema,
});
export type SavedViewResponse = z.infer<typeof SavedViewResponseSchema>;

/** Drop unknown column ids gracefully (definition drift). Total: always valid. */
export function sanitizeGridDefinition(
  raw: unknown,
): { definition: GridViewDefinition; dropped: string[] } {
  const dropped: string[] = [];
  const allow = new Set<string>(SUBMISSIONS_GRID_FIELDS);
  const obj =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const colsIn = Array.isArray(obj.columns) ? (obj.columns as unknown[]) : [];
  const orderIn = Array.isArray(obj.columnOrder)
    ? (obj.columnOrder as unknown[])
    : colsIn;
  const columns: SubmissionsGridField[] = [];
  const seenCol = new Set<string>();
  for (const c of colsIn) {
    if (typeof c !== "string") continue;
    if (!allow.has(c)) {
      dropped.push(c);
      continue;
    }
    if (seenCol.has(c)) {
      dropped.push(`dup:${c}`);
      continue;
    }
    if (columns.length >= 40) {
      dropped.push(c);
      continue;
    }
    seenCol.add(c);
    columns.push(c as SubmissionsGridField);
  }
  const columnOrder: SubmissionsGridField[] = [];
  const seenOrder = new Set<string>();
  for (const c of orderIn) {
    if (typeof c !== "string") continue;
    if (!allow.has(c) || !seenCol.has(c) || seenOrder.has(c)) continue;
    if (columnOrder.length >= 40) break;
    seenOrder.add(c);
    columnOrder.push(c as SubmissionsGridField);
  }
  // Ensure every selected column appears in order.
  for (const c of columns) {
    if (!seenOrder.has(c)) columnOrder.push(c);
  }
  if (columns.length === 0) {
    columns.push("title", "status", "submittedAt");
    columnOrder.length = 0;
    columnOrder.push("title", "status", "submittedAt");
  }
  const densityParsed = GridDensitySchema.safeParse(obj.density);
  const sortParsed = GridSortSchema.safeParse(obj.sort);

  const clipStr = (
    v: unknown,
    max: number,
  ): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    return t.length > max ? t.slice(0, max) : t;
  };

  const def: GridViewDefinition = {
    columns,
    columnOrder,
    density: densityParsed.success ? densityParsed.data : "comfortable",
    sort: sortParsed.success ? sortParsed.data : undefined,
    status: clipStr(obj.status, 64),
    category: clipStr(obj.category, 128),
    qPrefix: clipStr(obj.qPrefix, 200),
  };
  if (
    obj.columnWidths &&
    typeof obj.columnWidths === "object" &&
    obj.columnWidths !== null
  ) {
    const widths: Record<string, number> = {};
    for (const [k, v] of Object.entries(
      obj.columnWidths as Record<string, unknown>,
    )) {
      if (allow.has(k) && typeof v === "number" && v >= 48 && v <= 640) {
        widths[k] = Math.round(v);
      }
    }
    if (Object.keys(widths).length > 0) def.columnWidths = widths;
  }
  return { definition: def, dropped };
}
