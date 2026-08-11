/**
 * API keys persistence (section 7.1 / S-CLI).
 *
 * MemoryKeysStore — unit tests / local e2e (no D1 required).
 * D1KeysStore — production SoR (E1).
 *
 * Plaintext secrets never persist — only key_hash (E10).
 */
import { eq, isNull, and, or, gt, inArray, count, sql } from "drizzle-orm";
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

/**
 * Durable shared-demo mint quota (section 8.4) — enforced AT insertion so
 * concurrent requests cannot all pass a pre-check and insert (TOCTOU).
 */
export type DemoMintQuota = {
  /** Demo persona user ids the quota is shared across (created_by values). */
  creatorIds: string[];
  /** Evaluation instant (UTC Z ISO). */
  nowIso: string;
  /** Max active (not revoked, not expired) demo-created keys. */
  activeLimit: number;
  /** Rolling window start (UTC Z ISO) for the non-releasing mint cap. */
  mintWindowStartIso: string;
  /** Max mints inside the window — counted over ALL rows, revoked/expired included. */
  mintLimit: number;
};

export type KeysStore = {
  insertKey(row: ApiKeyRow): Promise<ApiKeyRow>;
  /**
   * Quota-bounded insert — the enforcement point for demo mints. The count
   * checks and the INSERT are one atomic operation (single SQL statement on
   * D1; synchronous check+insert in memory), so N racing requests can never
   * exceed the caps. Returns "quota" (no row written) when either cap is hit.
   */
  insertKeyWithinDemoQuota(
    row: ApiKeyRow,
    quota: DemoMintQuota,
  ): Promise<"inserted" | "quota">;
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
   * demo quota fast-path/reporting (section 8.4); never materializes rows.
   */
  countActiveKeysByCreators(
    creatorIds: string[],
    nowIso: string,
  ): Promise<number>;
  /**
   * COUNT of ALL keys (any state — revoked/expired included) created by the
   * given user ids after sinceIso. Non-releasing rolling mint window (8.4):
   * a create→revoke loop cannot reset it.
   */
  countKeysCreatedSince(
    creatorIds: string[],
    sinceIso: string,
  ): Promise<number>;
};

/** Robust instant comparison — never lexical; offset-form ISO handled. */
function isAfterInstant(iso: string | null, thresholdIso: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t > Date.parse(thresholdIso);
}

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

  /** Synchronous counts — shared by the quota-bounded insert (atomicity). */
  private countActiveSync(creatorIds: string[], nowIso: string): number {
    const creators = new Set(creatorIds);
    let n = 0;
    for (const row of this.keys.values()) {
      if (!creators.has(row.createdBy)) continue;
      if (row.revokedAt) continue;
      // Robust instant comparison (never lexical): an offset-form future
      // expiry must count as active even when it sorts before now-Z.
      if (row.expiresAt && !isAfterInstant(row.expiresAt, nowIso)) continue;
      n++;
    }
    return n;
  }

  private countCreatedSinceSync(creatorIds: string[], sinceIso: string): number {
    const creators = new Set(creatorIds);
    let n = 0;
    for (const row of this.keys.values()) {
      if (!creators.has(row.createdBy)) continue;
      // Any state counts (revoked/expired included) — non-releasing window.
      if (isAfterInstant(row.createdAt, sinceIso)) n++;
    }
    return n;
  }

  async countActiveKeysByCreators(
    creatorIds: string[],
    nowIso: string,
  ): Promise<number> {
    if (creatorIds.length === 0) return 0;
    return this.countActiveSync(creatorIds, nowIso);
  }

  async countKeysCreatedSince(
    creatorIds: string[],
    sinceIso: string,
  ): Promise<number> {
    if (creatorIds.length === 0) return 0;
    return this.countCreatedSinceSync(creatorIds, sinceIso);
  }

  async insertKeyWithinDemoQuota(
    row: ApiKeyRow,
    quota: DemoMintQuota,
  ): Promise<"inserted" | "quota"> {
    // Check + insert with no awaits in between — atomic within the event
    // loop, mirroring the single-statement D1 semantics.
    if (
      this.countActiveSync(quota.creatorIds, quota.nowIso) >=
        quota.activeLimit ||
      this.countCreatedSinceSync(quota.creatorIds, quota.mintWindowStartIso) >=
        quota.mintLimit
    ) {
      return "quota";
    }
    const copy = { ...row };
    this.keys.set(copy.id, copy);
    this.byHash.set(copy.keyHash, copy.id);
    return "inserted";
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
          // datetime() normalizes offset-form ISO to UTC before comparing —
          // never a lexical string compare (offset expiries must count).
          or(
            isNull(apiKeys.expiresAt),
            gt(
              sql`datetime(${apiKeys.expiresAt})`,
              sql`datetime(${nowIso})`,
            ),
          ),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  async countKeysCreatedSince(
    creatorIds: string[],
    sinceIso: string,
  ): Promise<number> {
    if (creatorIds.length === 0) return 0;
    const rows = await this.db
      .select({ n: count() })
      .from(apiKeys)
      .where(
        and(
          inArray(apiKeys.createdBy, creatorIds),
          // Any state counts (revoked/expired included) — non-releasing.
          // Raw compare keeps the (created_by, created_at) index range scan:
          // created_at is always server-written Z-form ISO (never
          // client-supplied), so lexical order IS instant order here.
          gt(apiKeys.createdAt, sinceIso),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  async insertKeyWithinDemoQuota(
    row: ApiKeyRow,
    quota: DemoMintQuota,
  ): Promise<"inserted" | "quota"> {
    // Single statement: both quota counts AND the insert evaluate atomically
    // inside one INSERT ... SELECT ... WHERE — racing requests serialize on
    // the write and the losers insert nothing (meta.changes === 0).
    const creators = sql.join(
      quota.creatorIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const result = await this.db.run(sql`
      INSERT INTO api_keys (
        id, org_id, name, key_prefix, key_hash, scopes_json,
        event_id, expires_at, revoked_at, created_by, created_at, last_used_at
      )
      SELECT ${row.id}, ${row.orgId}, ${row.name}, ${row.keyPrefix},
             ${row.keyHash}, ${row.scopesJson}, ${row.eventId},
             ${row.expiresAt}, ${row.revokedAt}, ${row.createdBy},
             ${row.createdAt}, ${row.lastUsedAt}
      WHERE (
        SELECT COUNT(*) FROM api_keys
        WHERE created_by IN (${creators})
          AND revoked_at IS NULL
          AND (expires_at IS NULL
               OR datetime(expires_at) > datetime(${quota.nowIso}))
      ) < ${quota.activeLimit}
      AND (
        SELECT COUNT(*) FROM api_keys
        WHERE created_by IN (${creators})
          AND created_at > ${quota.mintWindowStartIso}
      ) < ${quota.mintLimit}
    `);
    return d1Changes(result) === 0 ? "quota" : "inserted";
  }
}
