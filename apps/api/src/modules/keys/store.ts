/**
 * API keys persistence (section 7.1 / S-CLI).
 *
 * MemoryKeysStore — unit tests / local e2e (no D1 required).
 * D1KeysStore — production SoR (E1).
 *
 * Plaintext secrets never persist — only key_hash (E10).
 */
import { eq, isNull, and, or, gt, inArray, count } from "drizzle-orm";
import { API_KEY_CREATED_AT_FALLBACK } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  apiKeys,
} from "@speakerops/db";
import { d1Changes } from "../auth/store.js";

export type ApiKeyRow = {
  id: string;
  orgId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopesJson: string;
  eventId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  /** Never null out of a store — NULL D1 rows map to a fixed fallback ISO. */
  createdAt: string;
  lastUsedAt: string | null;
};

export type KeysStore = {
  insertKey(row: ApiKeyRow): Promise<ApiKeyRow>;
  findById(id: string): Promise<ApiKeyRow | null>;
  findByHash(keyHash: string): Promise<ApiKeyRow | null>;
  listKeys(options?: { orgId?: string }): Promise<ApiKeyRow[]>;
  /**
   * Soft-revoke: set revoked_at when currently null.
   * Returns updated row or null if missing / already revoked.
   */
  revokeKey(id: string, revokedAt: string): Promise<ApiKeyRow | null>;
  /** Touch last_used_at after successful bearer auth (best-effort). */
  touchLastUsed(id: string, lastUsedAt: string): Promise<void>;
  /**
   * COUNT of active keys (not revoked, not expired at nowIso) created by any
   * of the given user ids. Single aggregate query (idx_api_keys_created_by) —
   * durable shared-demo mint quota (section 8.4); never materializes rows.
   */
  countActiveKeysByCreators(
    creatorIds: string[],
    nowIso: string,
  ): Promise<number>;
};

/**
 * In-memory keys store — unit tests + e2e-api-server without D1.
 */
export class MemoryKeysStore implements KeysStore {
  private keys = new Map<string, ApiKeyRow>();
  private byHash = new Map<string, string>();

  async insertKey(row: ApiKeyRow): Promise<ApiKeyRow> {
    const copy = { ...row };
    this.keys.set(copy.id, copy);
    this.byHash.set(copy.keyHash, copy.id);
    return { ...copy };
  }

  async findById(id: string): Promise<ApiKeyRow | null> {
    const row = this.keys.get(id);
    return row ? { ...row } : null;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRow | null> {
    const id = this.byHash.get(keyHash);
    if (!id) return null;
    return this.findById(id);
  }

  async listKeys(options?: { orgId?: string }): Promise<ApiKeyRow[]> {
    let rows = [...this.keys.values()];
    if (options?.orgId) {
      rows = rows.filter((r) => r.orgId === options.orgId);
    }
    // uuidv7 is time-ordered — reverse for newest-first
    rows.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return rows.map((r) => ({ ...r }));
  }

  async revokeKey(id: string, revokedAt: string): Promise<ApiKeyRow | null> {
    const row = this.keys.get(id);
    if (!row || row.revokedAt) return null;
    const updated: ApiKeyRow = { ...row, revokedAt };
    this.keys.set(id, updated);
    return { ...updated };
  }

  async touchLastUsed(id: string, lastUsedAt: string): Promise<void> {
    const row = this.keys.get(id);
    if (!row || row.revokedAt) return;
    this.keys.set(id, { ...row, lastUsedAt });
  }

  async countActiveKeysByCreators(
    creatorIds: string[],
    nowIso: string,
  ): Promise<number> {
    if (creatorIds.length === 0) return 0;
    const creators = new Set(creatorIds);
    let n = 0;
    for (const row of this.keys.values()) {
      if (!creators.has(row.createdBy)) continue;
      if (row.revokedAt) continue;
      if (row.expiresAt && row.expiresAt <= nowIso) continue;
      n++;
    }
    return n;
  }
}

/**
 * D1-backed keys store for production Worker (E1 SoR).
 */
export class D1KeysStore implements KeysStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  private mapRow(r: typeof apiKeys.$inferSelect): ApiKeyRow {
    return {
      id: r.id,
      orgId: r.orgId,
      name: r.name,
      keyPrefix: r.keyPrefix,
      keyHash: r.keyHash,
      scopesJson: r.scopesJson,
      eventId: r.eventId ?? null,
      expiresAt: r.expiresAt ?? null,
      revokedAt: r.revokedAt ?? null,
      createdBy: r.createdBy,
      // Rows minted before migration 0022 backfill have NULL created_at —
      // tolerate with a fixed fallback so Keys.List never 500s on them.
      createdAt: r.createdAt ?? API_KEY_CREATED_AT_FALLBACK,
      lastUsedAt: r.lastUsedAt ?? null,
    };
  }

  async insertKey(row: ApiKeyRow): Promise<ApiKeyRow> {
    await this.db.insert(apiKeys).values({
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      keyPrefix: row.keyPrefix,
      keyHash: row.keyHash,
      scopesJson: row.scopesJson,
      eventId: row.eventId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    });
    return { ...row };
  }

  async findById(id: string): Promise<ApiKeyRow | null> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);
    const row = rows[0];
    return row ? this.mapRow(row) : null;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRow | null> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);
    const row = rows[0];
    return row ? this.mapRow(row) : null;
  }

  async listKeys(options?: { orgId?: string }): Promise<ApiKeyRow[]> {
    const rows = options?.orgId
      ? await this.db
          .select()
          .from(apiKeys)
          .where(eq(apiKeys.orgId, options.orgId))
      : await this.db.select().from(apiKeys);
    const mapped = rows.map((r) => this.mapRow(r));
    mapped.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return mapped;
  }

  async revokeKey(id: string, revokedAt: string): Promise<ApiKeyRow | null> {
    // d1Changes must read the UPDATE result (not the db handle) or revoke
    // always reports 0 rows changed on D1.
    const result = await this.db
      .update(apiKeys)
      .set({ revokedAt })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
    if (d1Changes(result) === 0) return null;
    return this.findById(id);
  }

  async touchLastUsed(id: string, lastUsedAt: string): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
  }

  async countActiveKeysByCreators(
    creatorIds: string[],
    nowIso: string,
  ): Promise<number> {
    if (creatorIds.length === 0) return 0;
    const rows = await this.db
      .select({ n: count() })
      .from(apiKeys)
      .where(
        and(
          inArray(apiKeys.createdBy, creatorIds),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, nowIso)),
        ),
      );
    return rows[0]?.n ?? 0;
  }
}
