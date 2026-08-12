/**
 * Saved views commands (F3).
 */
import {
  GridSurfaceSchema,
  SAVED_VIEWS_MAX_PER_SCOPE,
  sanitizeGridDefinition,
  type GridSurface,
  type GridViewDefinition,
  type SavedViewDto,
} from "@speakerops/shared";
import type { SavedViewsStore, SavedViewRow } from "./store.js";

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

function rowToDto(row: SavedViewRow): SavedViewDto {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.definitionJson);
  } catch {
    parsed = {};
  }
  const { definition } = sanitizeGridDefinition(parsed);
  return {
    id: row.id,
    userId: row.userId,
    eventId: row.eventId,
    surface: row.surface as GridSurface,
    name: row.name,
    definition,
    isDefault: row.isDefault === 1,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

function parseSurface(
  surface: string,
): { ok: true; surface: GridSurface } | CommandErr {
  const parsed = GridSurfaceSchema.safeParse(surface);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid surface",
      code: "VALIDATION_ERROR",
    };
  }
  return { ok: true, surface: parsed.data };
}

export async function listSavedViews(
  store: SavedViewsStore,
  input: { userId: string; eventId: string; surface: string },
): Promise<CommandOk<{ views: SavedViewDto[] }> | CommandErr> {
  const surface = parseSurface(input.surface);
  if (!("surface" in surface)) return surface;
  const rows = await store.listForScope({
    userId: input.userId,
    eventId: input.eventId,
    surface: surface.surface,
  });
  return { ok: true, value: { views: rows.map(rowToDto) } };
}

export async function createSavedView(
  store: SavedViewsStore,
  input: {
    userId: string;
    eventId: string;
    surface: string;
    name: string;
    definition: GridViewDefinition;
    isDefault?: boolean;
  },
): Promise<CommandOk<{ view: SavedViewDto }> | CommandErr> {
  const surface = parseSurface(input.surface);
  if (!("surface" in surface)) return surface;
  const name = input.name.trim();
  if (!name) {
    return {
      ok: false,
      status: 400,
      error: "Name required",
      code: "VALIDATION_ERROR",
    };
  }
  const { definition } = sanitizeGridDefinition(input.definition);
  const now = new Date().toISOString();
  const row: SavedViewRow = {
    id: newId(),
    userId: input.userId,
    eventId: input.eventId,
    surface: surface.surface,
    name,
    definitionJson: JSON.stringify(definition),
    isDefault: input.isDefault ? 1 : 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const result = await store.insert(row);
  if (result === "cap") {
    return {
      ok: false,
      status: 400,
      error: `At most ${SAVED_VIEWS_MAX_PER_SCOPE} saved views per surface`,
      code: "VALIDATION_ERROR",
      details: { max: SAVED_VIEWS_MAX_PER_SCOPE },
    };
  }
  if (result === "name_conflict") {
    return {
      ok: false,
      status: 409,
      error: "A view with that name already exists",
      code: "CONFLICT",
    };
  }
  const saved = await store.findById(row.id);
  if (!saved) {
    return {
      ok: false,
      status: 400,
      error: "Failed to create view",
      code: "INTERNAL_ERROR",
    };
  }
  return { ok: true, value: { view: rowToDto(saved) } };
}

export async function updateSavedView(
  store: SavedViewsStore,
  input: {
    id: string;
    userId: string;
    eventId: string;
    surface: string;
    name?: string;
    definition?: GridViewDefinition;
    isDefault?: boolean;
    expectedVersion: number;
  },
): Promise<CommandOk<{ view: SavedViewDto }> | CommandErr> {
  const surface = parseSurface(input.surface);
  if (!("surface" in surface)) return surface;

  let name: string | undefined;
  if (input.name !== undefined) {
    name = input.name.trim();
    if (!name) {
      return {
        ok: false,
        status: 400,
        error: "Name required",
        code: "VALIDATION_ERROR",
      };
    }
  }

  const definition = input.definition
    ? sanitizeGridDefinition(input.definition).definition
    : undefined;

  const result = await store.update(
    input.id,
    {
      userId: input.userId,
      eventId: input.eventId,
      surface: surface.surface,
    },
    {
      name,
      definitionJson: definition ? JSON.stringify(definition) : undefined,
      isDefault:
        input.isDefault === undefined ? undefined : input.isDefault ? 1 : 0,
      expectedVersion: input.expectedVersion,
      updatedAt: new Date().toISOString(),
    },
  );
  if (result === "not_found") {
    return { ok: false, status: 404, error: "View not found", code: "NOT_FOUND" };
  }
  if (result === "version") {
    return {
      ok: false,
      status: 409,
      error: "View was modified — refresh and retry",
      code: "VERSION",
    };
  }
  if (result === "name_conflict") {
    return {
      ok: false,
      status: 409,
      error: "A view with that name already exists",
      code: "CONFLICT",
    };
  }
  const saved = await store.findById(input.id);
  if (!saved) {
    return { ok: false, status: 404, error: "View not found", code: "NOT_FOUND" };
  }
  return { ok: true, value: { view: rowToDto(saved) } };
}

export async function deleteSavedView(
  store: SavedViewsStore,
  input: {
    id: string;
    userId: string;
    eventId: string;
    surface: string;
  },
): Promise<CommandOk<{ deleted: true }> | CommandErr> {
  const surface = parseSurface(input.surface);
  if (!("surface" in surface)) return surface;
  const ok = await store.delete(input.id, {
    userId: input.userId,
    eventId: input.eventId,
    surface: surface.surface,
  });
  if (!ok) {
    return { ok: false, status: 404, error: "View not found", code: "NOT_FOUND" };
  }
  return { ok: true, value: { deleted: true } };
}
