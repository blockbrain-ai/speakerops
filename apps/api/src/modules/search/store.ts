/**
 * F5 search_documents persistence.
 * Memory for unit/e2e; D1 + FTS5 for production.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  searchDocuments,
  searchIndexState,
} from "@speakerops/db";
import {
  escapeLikePattern,
  uuidv7,
  type SearchEntityType,
} from "@speakerops/shared";

export type SearchDocumentRow = {
  id: string;
  entityType: SearchEntityType;
  entityId: string;
  eventId: string;
  title: string;
  body: string;
  ownerUserId: string | null;
  participationId: string | null;
  status: string | null;
  route: string;
  updatedAt: string;
};

export type SearchAuthz = {
  role: "admin" | "evaluator" | "speaker";
  userId: string;
  /** Evaluator: submission ids they may see. Speaker: participation ids. */
  allowedSubmissionIds?: ReadonlySet<string>;
  allowedParticipationIds?: ReadonlySet<string>;
};

export type SearchStore = {
  replaceEventDocuments(
    eventId: string,
    docs: SearchDocumentRow[],
  ): Promise<void>;
  search(input: {
    eventId: string;
    ftsQuery: string;
    plainQ: string;
    types?: SearchEntityType[];
    limit: number;
    authz: SearchAuthz;
  }): Promise<SearchDocumentRow[]>;
  countForEvent(eventId: string): Promise<number>;
  maxUpdatedAt(eventId: string): Promise<string | null>;
  /** B3: bump requested_generation (creates row if missing). */
  invalidateIndex?(eventId: string): Promise<void>;
  /** B3: built_generation < requested_generation (or never built). */
  isStale?(eventId: string): Promise<boolean>;
  /** B3: process one event rebuild if stale (lease-fenced). */
  processIndexEvent?(
    eventId: string,
    rebuild: (eventId: string) => Promise<SearchDocumentRow[]>,
  ): Promise<"built" | "skipped" | "noop">;
};

function matchesPlain(doc: SearchDocumentRow, plainQ: string): boolean {
  const q = plainQ.toLowerCase().trim();
  if (!q) return false;
  // Memory path: literal substring (metacharacters are not wildcards here).
  return (
    doc.title.toLowerCase().includes(q) || doc.body.toLowerCase().includes(q)
  );
}

function authzOk(doc: SearchDocumentRow, authz: SearchAuthz): boolean {
  if (authz.role === "admin") return true;
  if (authz.role === "evaluator") {
    if (doc.entityType === "submission") {
      return authz.allowedSubmissionIds?.has(doc.entityId) ?? false;
    }
    // Evaluators only see their assigned submissions in Find (not sessions/forms).
    return false;
  }
  // speaker
  if (doc.entityType === "speaker" || doc.entityType === "task") {
    if (doc.participationId && authz.allowedParticipationIds?.has(doc.participationId)) {
      return true;
    }
    if (doc.ownerUserId && doc.ownerUserId === authz.userId) return true;
    return false;
  }
  if (doc.entityType === "session") {
    // Sessions linked via participation ownership are not always set; speakers
    // only see sessions when participation_id is in their set (index must set it).
    return (
      (doc.participationId != null &&
        (authz.allowedParticipationIds?.has(doc.participationId) ?? false)) ||
      (doc.ownerUserId != null && doc.ownerUserId === authz.userId)
    );
  }
  if (doc.entityType === "submission") {
    return doc.ownerUserId === authz.userId;
  }
  // forms: speakers/evaluators do not browse form defs via Find
  return false;
}

export class MemorySearchStore implements SearchStore {
  private docs = new Map<string, SearchDocumentRow>();
  private generations = new Map<
    string,
    { requested: number; built: number; builtAt: string | null }
  >();

  async replaceEventDocuments(
    eventId: string,
    docs: SearchDocumentRow[],
  ): Promise<void> {
    for (const [id, d] of this.docs) {
      if (d.eventId === eventId) this.docs.delete(id);
    }
    for (const d of docs) this.docs.set(d.id, { ...d });
    const g = this.generations.get(eventId) ?? {
      requested: 0,
      built: -1,
      builtAt: null,
    };
    g.built = g.requested;
    g.builtAt = new Date().toISOString();
    this.generations.set(eventId, g);
  }

  async search(input: {
    eventId: string;
    ftsQuery: string;
    plainQ: string;
    types?: SearchEntityType[];
    limit: number;
    authz: SearchAuthz;
  }): Promise<SearchDocumentRow[]> {
    const typeSet = input.types ? new Set(input.types) : null;
    const out: SearchDocumentRow[] = [];
    for (const d of this.docs.values()) {
      if (d.eventId !== input.eventId) continue;
      if (typeSet && !typeSet.has(d.entityType)) continue;
      if (!matchesPlain(d, input.plainQ)) continue;
      if (!authzOk(d, input.authz)) continue;
      out.push(d);
    }
    out.sort((a, b) => {
      // Title prefix hits first, then updatedAt desc.
      const aq = input.plainQ.toLowerCase();
      const aPref = a.title.toLowerCase().startsWith(aq) ? 0 : 1;
      const bPref = b.title.toLowerCase().startsWith(aq) ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return out.slice(0, input.limit);
  }

  async countForEvent(eventId: string): Promise<number> {
    let n = 0;
    for (const d of this.docs.values()) if (d.eventId === eventId) n++;
    return n;
  }

  async maxUpdatedAt(eventId: string): Promise<string | null> {
    let max: string | null = null;
    for (const d of this.docs.values()) {
      if (d.eventId !== eventId) continue;
      if (!max || d.updatedAt > max) max = d.updatedAt;
    }
    return max;
  }

  async invalidateIndex(eventId: string): Promise<void> {
    const g = this.generations.get(eventId) ?? {
      requested: 0,
      built: -1,
      builtAt: null,
    };
    g.requested += 1;
    this.generations.set(eventId, g);
  }

  async isStale(eventId: string): Promise<boolean> {
    const g = this.generations.get(eventId);
    if (!g) return true;
    return g.built < g.requested;
  }

  async processIndexEvent(
    eventId: string,
    rebuild: (eventId: string) => Promise<SearchDocumentRow[]>,
  ): Promise<"built" | "skipped" | "noop"> {
    if (!(await this.isStale(eventId))) return "noop";
    const docs = await rebuild(eventId);
    await this.replaceEventDocuments(eventId, docs);
    return "built";
  }
}

export class D1SearchStore implements SearchStore {
  private readonly db: SpeakerOpsDb;
  private ftsReady: boolean | null = null;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  /**
   * Install FTS5 + triggers on D1 when the module is available (once per isolate).
   * Does not full-rebuild on every call — triggers keep content in sync after install.
   * sql.js unit tests have no fts5 — LIKE fallback remains correct.
   */
  async ensureFts(): Promise<boolean> {
    if (this.ftsReady != null) return this.ftsReady;
    try {
      await this.db.run(sql`
        CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(
          title,
          body,
          content = 'search_documents',
          content_rowid = 'rowid',
          tokenize = 'porter unicode61'
        )
      `);
      // Triggers are best-effort; D1 may already have them from a prior isolate.
      try {
        await this.db.run(sql`
          CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON search_documents BEGIN
            INSERT INTO search_documents_fts(rowid, title, body)
            VALUES (new.rowid, new.title, new.body);
          END
        `);
        await this.db.run(sql`
          CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON search_documents BEGIN
            INSERT INTO search_documents_fts(search_documents_fts, rowid, title, body)
            VALUES ('delete', old.rowid, old.title, old.body);
          END
        `);
        await this.db.run(sql`
          CREATE TRIGGER IF NOT EXISTS search_documents_au AFTER UPDATE ON search_documents BEGIN
            INSERT INTO search_documents_fts(search_documents_fts, rowid, title, body)
            VALUES ('delete', old.rowid, old.title, old.body);
            INSERT INTO search_documents_fts(rowid, title, body)
            VALUES (new.rowid, new.title, new.body);
          END
        `);
      } catch {
        /* trigger create may fail if already present under another name */
      }
      this.ftsReady = true;
    } catch {
      this.ftsReady = false;
    }
    return this.ftsReady;
  }

  async replaceEventDocuments(
    eventId: string,
    docs: SearchDocumentRow[],
  ): Promise<void> {
    await this.ensureFts();
    // Delete then insert; FTS triggers keep virtual table in sync when present.
    await this.db
      .delete(searchDocuments)
      .where(eq(searchDocuments.eventId, eventId))
      .run();
    for (const d of docs) {
      await this.db
        .insert(searchDocuments)
        .values({
          id: d.id,
          entityType: d.entityType,
          entityId: d.entityId,
          eventId: d.eventId,
          title: d.title,
          body: d.body,
          ownerUserId: d.ownerUserId,
          participationId: d.participationId,
          status: d.status,
          route: d.route,
          updatedAt: d.updatedAt,
        })
        .run();
    }
    // External-content FTS: full rebuild so MATCH works even if triggers missed
    // inserts (or FTS was created after content existed).
    if (await this.ensureFts()) {
      try {
        await this.db.run(sql`
          INSERT INTO search_documents_fts(search_documents_fts) VALUES('rebuild')
        `);
      } catch {
        /* rebuild optional if FTS content= sync already complete */
      }
    }
  }

  async search(input: {
    eventId: string;
    ftsQuery: string;
    plainQ: string;
    types?: SearchEntityType[];
    limit: number;
    authz: SearchAuthz;
  }): Promise<SearchDocumentRow[]> {
    // B2: pure-read — do NOT call ensureFts() (DDL) on the search path.
    // FTS is installed by consumer/rebuild; missing FTS → LIKE fallback.
    const useFts = input.ftsQuery.length > 0;
    let rows: SearchDocumentRow[] = [];

    if (useFts) {
      try {
        rows = await this.searchFts(input);
        // Empty FTS with content present → LIKE fallback (triggers/rebuild lag).
        if (rows.length === 0) {
          const n = await this.countForEvent(input.eventId);
          if (n > 0) rows = await this.searchLike(input);
        }
      } catch (err) {
        // Structured log path: avoid silent swallow of ranking bugs.
        console.error(
          JSON.stringify({
            msg: "search_fts_error",
            eventId: input.eventId,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
        rows = await this.searchLike(input);
      }
    } else {
      rows = await this.searchLike(input);
    }

    // Defense in depth: re-apply authz in process (SQL also filters).
    return rows.filter((d) => authzOk(d, input.authz)).slice(0, input.limit);
  }

  private async searchFts(input: {
    eventId: string;
    ftsQuery: string;
    types?: SearchEntityType[];
    limit: number;
    authz: SearchAuthz;
  }): Promise<SearchDocumentRow[]> {
    // Join FTS → content; authz predicates in SQL.
    const typeFilter =
      input.types && input.types.length > 0
        ? sql`AND d.entity_type IN (${sql.join(
            input.types.map((t) => sql`${t}`),
            sql`, `,
          )})`
        : sql``;

    // Qualify columns for FTS join (d.*).
    const authzSql = this.authzSql(input.authz, "d");

    // B1: bm25() must use the FTS table name, not an alias (alias form is invalid
    // in FTS5 and was swallowed → permanent LIKE fallback on D1).
    // D1: use .all() for SELECT — .run() returns write meta without results.
    const result = await this.db.all(sql`
      SELECT
        d.id, d.entity_type, d.entity_id, d.event_id, d.title, d.body,
        d.owner_user_id, d.participation_id, d.status, d.route, d.updated_at
      FROM search_documents_fts
      JOIN search_documents d ON d.rowid = search_documents_fts.rowid
      WHERE search_documents_fts MATCH ${input.ftsQuery}
        AND d.event_id = ${input.eventId}
        ${typeFilter}
        ${authzSql}
      ORDER BY bm25(search_documents_fts) ASC, d.updated_at DESC
      LIMIT ${input.limit}
    `);

    return mapRunRows(result);
  }

  private async searchLike(input: {
    eventId: string;
    plainQ: string;
    types?: SearchEntityType[];
    limit: number;
    authz: SearchAuthz;
  }): Promise<SearchDocumentRow[]> {
    const escaped = escapeLikePattern(input.plainQ.trim());
    if (!escaped) return [];
    const pattern = `%${escaped}%`;
    const typeFilter =
      input.types && input.types.length > 0
        ? sql`AND entity_type IN (${sql.join(
            input.types.map((t) => sql`${t}`),
            sql`, `,
          )})`
        : sql``;
    const authzSql = this.authzSql(input.authz);

    // D1: use .all() for SELECT — .run() returns write meta without results.
    const result = await this.db.all(sql`
      SELECT
        id, entity_type, entity_id, event_id, title, body,
        owner_user_id, participation_id, status, route, updated_at
      FROM search_documents
      WHERE event_id = ${input.eventId}
        AND (title LIKE ${pattern} ESCAPE '\\' OR body LIKE ${pattern} ESCAPE '\\')
        ${typeFilter}
        ${authzSql}
      ORDER BY updated_at DESC
      LIMIT ${input.limit}
    `);
    return mapRunRows(result);
  }

  private authzSql(authz: SearchAuthz, tableAlias?: string) {
    const col = (name: string) =>
      tableAlias ? sql.raw(`${tableAlias}.${name}`) : sql.raw(name);
    if (authz.role === "admin") return sql``;
    if (authz.role === "evaluator") {
      const ids = [...(authz.allowedSubmissionIds ?? [])];
      if (ids.length === 0) return sql`AND 1 = 0`;
      const CHUNK = 80;
      const orParts: ReturnType<typeof sql>[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        orParts.push(
          sql`${col("entity_id")} IN (${sql.join(
            slice.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      }
      return sql`AND ${col("entity_type")} = 'submission' AND (${sql.join(orParts, sql` OR `)})`;
    }
    // speaker: own user rows OR participation-scoped ACL (incl. shadow docs)
    const parts = [...(authz.allowedParticipationIds ?? [])];
    if (parts.length === 0) {
      return sql`AND ${col("owner_user_id")} = ${authz.userId}`;
    }
    const CHUNK = 80;
    const orParts: ReturnType<typeof sql>[] = [
      sql`${col("owner_user_id")} = ${authz.userId}`,
    ];
    for (let i = 0; i < parts.length; i += CHUNK) {
      const slice = parts.slice(i, i + CHUNK);
      orParts.push(
        sql`${col("participation_id")} IN (${sql.join(
          slice.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
    return sql`AND (${sql.join(orParts, sql` OR `)})`;
  }

  async countForEvent(eventId: string): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(searchDocuments)
      .where(eq(searchDocuments.eventId, eventId))
      .all();
    return Number(rows[0]?.n ?? 0);
  }

  async maxUpdatedAt(eventId: string): Promise<string | null> {
    const rows = await this.db
      .select({ m: sql<string | null>`max(${searchDocuments.updatedAt})` })
      .from(searchDocuments)
      .where(eq(searchDocuments.eventId, eventId))
      .all();
    return rows[0]?.m ?? null;
  }

  async invalidateIndex(eventId: string): Promise<void> {
    await this.db.run(sql`
      INSERT INTO search_index_state (event_id, requested_generation, built_generation)
      VALUES (${eventId}, 1, -1)
      ON CONFLICT(event_id) DO UPDATE SET
        requested_generation = search_index_state.requested_generation + 1
    `);
  }

  async isStale(eventId: string): Promise<boolean> {
    try {
      const rows = await this.db
        .select()
        .from(searchIndexState)
        .where(eq(searchIndexState.eventId, eventId))
        .all();
      const row = rows[0];
      if (!row) return true;
      return row.builtGeneration < row.requestedGeneration;
    } catch {
      return true;
    }
  }

  async processIndexEvent(
    eventId: string,
    rebuild: (eventId: string) => Promise<SearchDocumentRow[]>,
  ): Promise<"built" | "skipped" | "noop"> {
    if (!(await this.isStale(eventId))) return "noop";
    await this.ensureFts();
    const token = uuidv7();
    const leaseUntil = new Date(Date.now() + 120_000).toISOString();
    const now = new Date().toISOString();
    // Acquire lease
    await this.db.run(sql`
      UPDATE search_index_state
      SET lease_token = ${token}, lease_until = ${leaseUntil}
      WHERE event_id = ${eventId}
        AND (lease_until IS NULL OR lease_until < ${now})
    `);
    const leaseRows = await this.db
      .select()
      .from(searchIndexState)
      .where(eq(searchIndexState.eventId, eventId))
      .all();
    const state = leaseRows[0];
    if (!state || state.leaseToken !== token) return "skipped";
    const G = state.requestedGeneration;
    const docs = await rebuild(eventId);
    // Fenced full replacement in one batch
    const del = this.db.run(sql`
      DELETE FROM search_documents
      WHERE event_id = ${eventId}
        AND EXISTS (
          SELECT 1 FROM search_index_state s
          WHERE s.event_id = ${eventId} AND s.lease_token = ${token}
        )
    `);
    const inserts = docs.map((d) =>
      this.db.run(sql`
        INSERT INTO search_documents (
          id, entity_type, entity_id, event_id, title, body,
          owner_user_id, participation_id, status, route, updated_at
        )
        SELECT
          ${d.id}, ${d.entityType}, ${d.entityId}, ${d.eventId},
          ${d.title}, ${d.body}, ${d.ownerUserId}, ${d.participationId},
          ${d.status}, ${d.route}, ${d.updatedAt}
        WHERE EXISTS (
          SELECT 1 FROM search_index_state s
          WHERE s.event_id = ${eventId} AND s.lease_token = ${token}
        )
      `),
    );
    const complete = this.db.run(sql`
      UPDATE search_index_state
      SET built_generation = ${G},
          built_at = ${new Date().toISOString()},
          doc_count = ${docs.length},
          lease_token = NULL,
          lease_until = NULL
      WHERE event_id = ${eventId}
        AND lease_token = ${token}
        AND built_generation < ${G}
    `);
    await this.db.batch([del, ...inserts, complete]);
    try {
      await this.db.run(sql`
        INSERT INTO search_documents_fts(search_documents_fts) VALUES('rebuild')
      `);
    } catch {
      /* optional */
    }
    return "built";
  }
}

function mapRunRows(result: unknown): SearchDocumentRow[] {
  // drizzle d1 .all() returns an array of row objects; .run() returns meta only.
  // Also accept { results: [...] } for defensive compatibility.
  const list: Record<string, unknown>[] = Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : ((result as { results?: Record<string, unknown>[] })?.results ?? []);
  if (list.length === 0) return [];
  if (typeof list[0] !== "object" || list[0] === null) return [];
  return list.map((r) => ({
    id: String(r.id ?? ""),
    entityType: String(r.entity_type ?? r.entityType) as SearchEntityType,
    entityId: String(r.entity_id ?? r.entityId ?? ""),
    eventId: String(r.event_id ?? r.eventId ?? ""),
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    ownerUserId:
      r.owner_user_id != null || r.ownerUserId != null
        ? String(r.owner_user_id ?? r.ownerUserId)
        : null,
    participationId:
      r.participation_id != null || r.participationId != null
        ? String(r.participation_id ?? r.participationId)
        : null,
    status: r.status != null ? String(r.status) : null,
    route: String(r.route ?? ""),
    updatedAt: String(r.updated_at ?? r.updatedAt ?? ""),
  }));
}

// silence unused import if tree-shaken
void and;
