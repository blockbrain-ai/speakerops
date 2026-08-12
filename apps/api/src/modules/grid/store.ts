/**
 * Saved views persistence (F3).
 * Memory store for e2e/unit; D1 for production.
 *
 * Invariants (fail-closed):
 * - ownership = session user only
 * - mutations scoped by user + event + surface (not id alone)
 * - version CAS on update / setDefault
 * - case-insensitive unique name per scope
 * - ≤20 views per scope
 * - at most one default per scope (never clear defaults before a successful write)
 */
import { and, eq, ne, sql } from "drizzle-orm";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  savedViews,
} from "@speakerops/db";
import { SAVED_VIEWS_MAX_PER_SCOPE } from "@speakerops/shared";

/** Rows-changed from Drizzle D1/SQLite write (same pattern as auth store). */
function d1Changes(result: unknown): number {
  if (result == null || typeof result !== "object") return 0;
  const meta = (result as { meta?: { changes?: number } }).meta;
  if (meta && typeof meta.changes === "number") return meta.changes;
  const top = (result as { changes?: number }).changes;
  if (typeof top === "number") return top;
  return 0;
}

export type SavedViewRow = {
  id: string;
  userId: string;
  eventId: string;
  surface: string;
  name: string;
  definitionJson: string;
  isDefault: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SavedViewsStore = {
  listForScope(input: {
    userId: string;
    eventId: string;
    surface: string;
  }): Promise<SavedViewRow[]>;
  findById(id: string): Promise<SavedViewRow | null>;
  insert(row: SavedViewRow): Promise<"ok" | "name_conflict" | "cap">;
  update(
    id: string,
    scope: { userId: string; eventId: string; surface: string },
    patch: {
      name?: string;
      definitionJson?: string;
      isDefault?: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<"ok" | "not_found" | "version" | "name_conflict">;
  delete(
    id: string,
    scope: { userId: string; eventId: string; surface: string },
  ): Promise<boolean>;
  setDefault(input: {
    id: string;
    userId: string;
    eventId: string;
    surface: string;
    expectedVersion: number;
    updatedAt: string;
  }): Promise<"ok" | "not_found" | "version">;
};

export class MemorySavedViewsStore implements SavedViewsStore {
  private rows = new Map<string, SavedViewRow>();

  async listForScope(input: {
    userId: string;
    eventId: string;
    surface: string;
  }): Promise<SavedViewRow[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.userId === input.userId &&
          r.eventId === input.eventId &&
          r.surface === input.surface,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<SavedViewRow | null> {
    return this.rows.get(id) ?? null;
  }

  async insert(row: SavedViewRow): Promise<"ok" | "name_conflict" | "cap"> {
    const scope = [...this.rows.values()].filter(
      (r) =>
        r.userId === row.userId &&
        r.eventId === row.eventId &&
        r.surface === row.surface,
    );
    if (scope.length >= SAVED_VIEWS_MAX_PER_SCOPE) return "cap";
    if (scope.some((r) => r.name.toLowerCase() === row.name.toLowerCase())) {
      return "name_conflict";
    }
    // Insert first (never clear defaults before a successful write).
    const wantDefault = row.isDefault === 1;
    this.rows.set(row.id, { ...row, isDefault: wantDefault ? 0 : row.isDefault });
    if (wantDefault) {
      for (const r of this.rows.values()) {
        if (
          r.id !== row.id &&
          r.userId === row.userId &&
          r.eventId === row.eventId &&
          r.surface === row.surface &&
          r.isDefault === 1
        ) {
          this.rows.set(r.id, { ...r, isDefault: 0 });
        }
      }
      this.rows.set(row.id, { ...row, isDefault: 1 });
    }
    return "ok";
  }

  async update(
    id: string,
    scope: { userId: string; eventId: string; surface: string },
    patch: {
      name?: string;
      definitionJson?: string;
      isDefault?: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<"ok" | "not_found" | "version" | "name_conflict"> {
    const cur = this.rows.get(id);
    if (
      !cur ||
      cur.userId !== scope.userId ||
      cur.eventId !== scope.eventId ||
      cur.surface !== scope.surface
    ) {
      return "not_found";
    }
    if (cur.version !== patch.expectedVersion) return "version";
    if (patch.name != null) {
      const conflict = [...this.rows.values()].some(
        (r) =>
          r.id !== id &&
          r.userId === cur.userId &&
          r.eventId === cur.eventId &&
          r.surface === cur.surface &&
          r.name.toLowerCase() === patch.name!.toLowerCase(),
      );
      if (conflict) return "name_conflict";
    }
    const next: SavedViewRow = {
      ...cur,
      name: patch.name ?? cur.name,
      definitionJson: patch.definitionJson ?? cur.definitionJson,
      isDefault:
        patch.isDefault !== undefined ? patch.isDefault : cur.isDefault,
      version: cur.version + 1,
      updatedAt: patch.updatedAt,
    };
    this.rows.set(id, next);
    if (next.isDefault === 1) {
      for (const r of this.rows.values()) {
        if (
          r.id !== id &&
          r.userId === cur.userId &&
          r.eventId === cur.eventId &&
          r.surface === cur.surface &&
          r.isDefault === 1
        ) {
          this.rows.set(r.id, { ...r, isDefault: 0 });
        }
      }
    }
    return "ok";
  }

  async delete(
    id: string,
    scope: { userId: string; eventId: string; surface: string },
  ): Promise<boolean> {
    const cur = this.rows.get(id);
    if (
      !cur ||
      cur.userId !== scope.userId ||
      cur.eventId !== scope.eventId ||
      cur.surface !== scope.surface
    ) {
      return false;
    }
    this.rows.delete(id);
    return true;
  }

  async setDefault(input: {
    id: string;
    userId: string;
    eventId: string;
    surface: string;
    expectedVersion: number;
    updatedAt: string;
  }): Promise<"ok" | "not_found" | "version"> {
    const cur = this.rows.get(input.id);
    if (
      !cur ||
      cur.userId !== input.userId ||
      cur.eventId !== input.eventId ||
      cur.surface !== input.surface
    ) {
      return "not_found";
    }
    if (cur.version !== input.expectedVersion) return "version";
    this.rows.set(input.id, {
      ...cur,
      isDefault: 1,
      version: cur.version + 1,
      updatedAt: input.updatedAt,
    });
    for (const r of this.rows.values()) {
      if (
        r.id !== input.id &&
        r.userId === input.userId &&
        r.eventId === input.eventId &&
        r.surface === input.surface &&
        r.isDefault === 1
      ) {
        this.rows.set(r.id, { ...r, isDefault: 0 });
      }
    }
    return "ok";
  }
}

export class D1SavedViewsStore implements SavedViewsStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async listForScope(input: {
    userId: string;
    eventId: string;
    surface: string;
  }): Promise<SavedViewRow[]> {
    const rows = await this.db
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.userId, input.userId),
          eq(savedViews.eventId, input.eventId),
          eq(savedViews.surface, input.surface),
        ),
      )
      .all();
    return rows.map(mapRow).sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<SavedViewRow | null> {
    const rows = await this.db
      .select()
      .from(savedViews)
      .where(eq(savedViews.id, id))
      .limit(1)
      .all();
    const r = rows[0];
    return r ? mapRow(r) : null;
  }

  async insert(row: SavedViewRow): Promise<"ok" | "name_conflict" | "cap"> {
    const wantDefault = row.isDefault === 1;
    // Atomic cap: INSERT … SELECT WHERE count < MAX (same pattern as keys quota).
    // Always insert non-default first so a failed write never clears prior default.
    let result: unknown;
    try {
      result = await this.db.run(sql`
        INSERT INTO saved_views (
          id, user_id, event_id, surface, name, definition_json,
          is_default, version, created_at, updated_at
        )
        SELECT
          ${row.id}, ${row.userId}, ${row.eventId}, ${row.surface},
          ${row.name}, ${row.definitionJson}, 0, ${row.version},
          ${row.createdAt}, ${row.updatedAt}
        WHERE (
          SELECT COUNT(*) FROM saved_views
          WHERE user_id = ${row.userId}
            AND event_id = ${row.eventId}
            AND surface = ${row.surface}
        ) < ${SAVED_VIEWS_MAX_PER_SCOPE}
      `);
    } catch {
      return "name_conflict";
    }
    if (d1Changes(result) === 0) {
      // Cap blocked the insert (or rare no-op). Distinguish name conflict via re-check.
      const existing = await this.listForScope({
        userId: row.userId,
        eventId: row.eventId,
        surface: row.surface,
      });
      if (existing.length >= SAVED_VIEWS_MAX_PER_SCOPE) return "cap";
      if (
        existing.some((r) => r.name.toLowerCase() === row.name.toLowerCase())
      ) {
        return "name_conflict";
      }
      return "cap";
    }

    if (wantDefault) {
      // Clear siblings first (unique default index), then set this row.
      await this.db
        .update(savedViews)
        .set({ isDefault: 0 })
        .where(
          and(
            eq(savedViews.userId, row.userId),
            eq(savedViews.eventId, row.eventId),
            eq(savedViews.surface, row.surface),
            ne(savedViews.id, row.id),
          ),
        )
        .run();
      await this.db
        .update(savedViews)
        .set({ isDefault: 1 })
        .where(eq(savedViews.id, row.id))
        .run();
    }
    return "ok";
  }

  async update(
    id: string,
    scope: { userId: string; eventId: string; surface: string },
    patch: {
      name?: string;
      definitionJson?: string;
      isDefault?: number;
      expectedVersion: number;
      updatedAt: string;
    },
  ): Promise<"ok" | "not_found" | "version" | "name_conflict"> {
    const cur = await this.findById(id);
    if (
      !cur ||
      cur.userId !== scope.userId ||
      cur.eventId !== scope.eventId ||
      cur.surface !== scope.surface
    ) {
      return "not_found";
    }
    if (cur.version !== patch.expectedVersion) return "version";

    const nextName = patch.name ?? cur.name;
    const nextDef = patch.definitionJson ?? cur.definitionJson;
    const nextDefault =
      patch.isDefault !== undefined ? patch.isDefault : cur.isDefault;

    // If becoming default, clear siblings FIRST (partial unique index on is_default=1).
    if (nextDefault === 1) {
      await this.db
        .update(savedViews)
        .set({ isDefault: 0 })
        .where(
          and(
            eq(savedViews.userId, scope.userId),
            eq(savedViews.eventId, scope.eventId),
            eq(savedViews.surface, scope.surface),
            ne(savedViews.id, id),
          ),
        )
        .run();
    }

    let result: unknown;
    try {
      result = await this.db
        .update(savedViews)
        .set({
          name: nextName,
          definitionJson: nextDef,
          isDefault: nextDefault,
          version: cur.version + 1,
          updatedAt: patch.updatedAt,
        })
        .where(
          and(
            eq(savedViews.id, id),
            eq(savedViews.userId, scope.userId),
            eq(savedViews.eventId, scope.eventId),
            eq(savedViews.surface, scope.surface),
            eq(savedViews.version, patch.expectedVersion),
          ),
        )
        .run();
    } catch {
      return "name_conflict";
    }

    if (d1Changes(result) === 0) return "version";
    return "ok";
  }

  async delete(
    id: string,
    scope: { userId: string; eventId: string; surface: string },
  ): Promise<boolean> {
    const result = await this.db
      .delete(savedViews)
      .where(
        and(
          eq(savedViews.id, id),
          eq(savedViews.userId, scope.userId),
          eq(savedViews.eventId, scope.eventId),
          eq(savedViews.surface, scope.surface),
        ),
      )
      .run();
    return d1Changes(result) > 0;
  }

  async setDefault(input: {
    id: string;
    userId: string;
    eventId: string;
    surface: string;
    expectedVersion: number;
    updatedAt: string;
  }): Promise<"ok" | "not_found" | "version"> {
    const cur = await this.findById(input.id);
    if (
      !cur ||
      cur.userId !== input.userId ||
      cur.eventId !== input.eventId ||
      cur.surface !== input.surface
    ) {
      return "not_found";
    }
    if (cur.version !== input.expectedVersion) return "version";

    // Clear sibling defaults first (respects idx_saved_views_default_scope).
    await this.db
      .update(savedViews)
      .set({ isDefault: 0 })
      .where(
        and(
          eq(savedViews.userId, input.userId),
          eq(savedViews.eventId, input.eventId),
          eq(savedViews.surface, input.surface),
          ne(savedViews.id, input.id),
        ),
      )
      .run();

    const result = await this.db
      .update(savedViews)
      .set({
        isDefault: 1,
        version: cur.version + 1,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(savedViews.id, input.id),
          eq(savedViews.userId, input.userId),
          eq(savedViews.eventId, input.eventId),
          eq(savedViews.surface, input.surface),
          eq(savedViews.version, input.expectedVersion),
        ),
      )
      .run();

    if (d1Changes(result) === 0) return "version";
    return "ok";
  }
}

function mapRow(r: {
  id: string;
  userId: string;
  eventId: string;
  surface: string;
  name: string;
  definitionJson: string;
  isDefault: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}): SavedViewRow {
  return {
    id: r.id,
    userId: r.userId,
    eventId: r.eventId,
    surface: r.surface,
    name: r.name,
    definitionJson: r.definitionJson,
    isDefault: r.isDefault,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
