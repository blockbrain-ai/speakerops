/**
 * Auth persistence — users, magic_links, auth_sessions, audit (section 2.1)
 * + event_memberships (section 2.2).
 *
 * MemoryAuthStore is the test / local e2e default (no D1 required).
 * D1AuthStore wraps the Worker DB binding for production (E1 SoR).
 *
 * Tokens are stored only as hashes — callers must hash before insert.
 */
import { eq, and, inArray, isNull, sql, desc } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import type { EventRole, MagicLinkPurpose } from "@speakerops/shared";
import {
  buildAuditEventRow,
  createDb,
  type AuditWriteInput,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  users,
  magicLinks,
  authSessions,
  eventMemberships,
  auditEvents,
} from "@speakerops/db";

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MagicLinkRow = {
  id: string;
  userId: string;
  eventId: string | null;
  purpose: MagicLinkPurpose;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type SessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type MembershipRow = {
  id: string;
  eventId: string;
  userId: string;
  role: EventRole;
  createdAt: string;
};

export type AuditRow = AuditWriteInput;

/** Captured magic-link delivery for dev/test transport (never production email). */
export type CapturedMagicLink = {
  email: string;
  purpose: MagicLinkPurpose;
  /** Plaintext token — only held in process memory / test outbox, never DB. */
  token: string;
  eventId: string | null;
  userId: string;
  magicLinkId: string;
  createdAt: string;
};

export type AuthStore = {
  findUserByEmail(email: string): Promise<UserRow | null>;
  findUserById(id: string): Promise<UserRow | null>;
  /**
   * Batch user lookup for aggregate views (eval rollup / CSV export).
   * One query per D1 parameter chunk instead of one per user — never
   * call findUserById in a loop (S-EVAL performance).
   * Missing ids are simply absent from the returned map.
   */
  findUsersByIds(ids: string[]): Promise<Map<string, UserRow>>;
  createUser(input: {
    email: string;
    name?: string | null;
  }): Promise<UserRow>;
  /**
   * Race-safe create-or-get by email (WS-C1).
   * INSERT ON CONFLICT DO NOTHING then SELECT — never racy find-then-insert alone.
   */
  findOrCreateUserByEmail(input: {
    email: string;
    name?: string | null;
  }): Promise<UserRow>;
  insertMagicLink(row: Omit<MagicLinkRow, "usedAt"> & { usedAt?: null }): Promise<MagicLinkRow>;
  findMagicLinkByTokenHash(tokenHash: string): Promise<MagicLinkRow | null>;
  /**
   * Conditionally mark magic link used only if still unused.
   * Returns true when this caller won the consume (gates session issuance).
   */
  consumeMagicLink(id: string, usedAt: string): Promise<boolean>;
  insertSession(row: SessionRow): Promise<SessionRow>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<boolean>;
  insertAudit(row: AuditRow): Promise<void>;
  listAudits(): Promise<AuditRow[]>;
  /**
   * Find the most recent audit for a consequential action on an entity.
   * Used to repair missing audit_events on idempotent command retries (E3).
   */
  findAuditByActionAndEntity(
    action: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditRow | null>;
  /** All magic link rows (tests: assert hash-only storage). */
  listMagicLinks(): Promise<MagicLinkRow[]>;
  listSessions(): Promise<SessionRow[]>;
  /** event_memberships (section 2.2) */
  upsertMembership(input: {
    eventId: string;
    userId: string;
    role: EventRole;
  }): Promise<MembershipRow>;
  /**
   * Create-only membership (WS-C1). INSERT ON CONFLICT DO NOTHING; never mutates role.
   * Returns the row after insert-or-no-op (caller compares role for 409).
   */
  insertMembershipIfAbsent(input: {
    eventId: string;
    userId: string;
    role: EventRole;
  }): Promise<MembershipRow>;
  /**
   * Atomic role change with event-scoped last-admin guard (WS-C2).
   * Returns false when the update was blocked (last admin demotion or missing row).
   */
  tryUpdateMemberRole(input: {
    eventId: string;
    userId: string;
    fromRole: EventRole;
    toRole: EventRole;
  }): Promise<boolean>;
  findMembership(
    eventId: string,
    userId: string,
  ): Promise<MembershipRow | null>;
  listMembershipsForUser(userId: string): Promise<MembershipRow[]>;
  listMemberships(): Promise<MembershipRow[]>;
  /**
   * Hard-delete membership for transactional-outbox compensation after a
   * failed Event.Create unit (E7). Not a product command.
   */
  deleteMembership(eventId: string, userId: string): Promise<boolean>;
  /** Count memberships with role (controlled first-admin bootstrap). */
  countMembershipsByRole(role: EventRole): Promise<number>;
};

/**
 * In-memory auth store — unit tests + e2e-api-server without D1.
 * Concurrent-safe enough for single-process local tests.
 */
export class MemoryAuthStore implements AuthStore {
  private users = new Map<string, UserRow>();
  private usersByEmail = new Map<string, string>();
  private magicLinks = new Map<string, MagicLinkRow>();
  private magicByHash = new Map<string, string>();
  private sessions = new Map<string, SessionRow>();
  private sessionsByHash = new Map<string, string>();
  private memberships = new Map<string, MembershipRow>();
  private audits: AuditRow[] = [];

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const key = normalizeEmail(email);
    const id = this.usersByEmail.get(key);
    if (!id) return null;
    return this.users.get(id) ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    return this.users.get(id) ?? null;
  }

  async findUsersByIds(ids: string[]): Promise<Map<string, UserRow>> {
    const out = new Map<string, UserRow>();
    for (const id of new Set(ids)) {
      const row = this.users.get(id);
      if (row) out.set(id, row);
    }
    return out;
  }

  async createUser(input: {
    email: string;
    name?: string | null;
  }): Promise<UserRow> {
    const email = normalizeEmail(input.email);
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    const now = new Date().toISOString();
    const row: UserRow = {
      id: uuidv7(),
      email,
      name: input.name ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(row.id, row);
    this.usersByEmail.set(email, row.id);
    return row;
  }

  async findOrCreateUserByEmail(input: {
    email: string;
    name?: string | null;
  }): Promise<UserRow> {
    // Memory is single-process; createUser already create-or-get.
    return this.createUser(input);
  }

  async insertMagicLink(
    row: Omit<MagicLinkRow, "usedAt"> & { usedAt?: null },
  ): Promise<MagicLinkRow> {
    const full: MagicLinkRow = {
      ...row,
      usedAt: row.usedAt ?? null,
    };
    this.magicLinks.set(full.id, full);
    this.magicByHash.set(full.tokenHash, full.id);
    return full;
  }

  async findMagicLinkByTokenHash(tokenHash: string): Promise<MagicLinkRow | null> {
    const id = this.magicByHash.get(tokenHash);
    if (!id) return null;
    return this.magicLinks.get(id) ?? null;
  }

  async consumeMagicLink(id: string, usedAt: string): Promise<boolean> {
    const row = this.magicLinks.get(id);
    if (!row || row.usedAt) return false;
    this.magicLinks.set(id, { ...row, usedAt });
    return true;
  }

  async insertSession(row: SessionRow): Promise<SessionRow> {
    this.sessions.set(row.id, row);
    this.sessionsByHash.set(row.tokenHash, row.id);
    return row;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const id = this.sessionsByHash.get(tokenHash);
    if (!id) return null;
    return this.sessions.get(id) ?? null;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<boolean> {
    const id = this.sessionsByHash.get(tokenHash);
    if (!id) return false;
    this.sessionsByHash.delete(tokenHash);
    this.sessions.delete(id);
    return true;
  }

  async insertAudit(row: AuditRow): Promise<void> {
    this.audits.push(buildAuditEventRow(row));
  }

  async listAudits(): Promise<AuditRow[]> {
    return [...this.audits];
  }

  async findAuditByActionAndEntity(
    action: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditRow | null> {
    for (let i = this.audits.length - 1; i >= 0; i--) {
      const a = this.audits[i]!;
      if (
        a.action === action &&
        a.entityType === entityType &&
        a.entityId === entityId
      ) {
        return a;
      }
    }
    return null;
  }

  async listMagicLinks(): Promise<MagicLinkRow[]> {
    return [...this.magicLinks.values()];
  }

  async listSessions(): Promise<SessionRow[]> {
    return [...this.sessions.values()];
  }

  private membershipKey(eventId: string, userId: string): string {
    return `${eventId}\0${userId}`;
  }

  async upsertMembership(input: {
    eventId: string;
    userId: string;
    role: EventRole;
  }): Promise<MembershipRow> {
    const key = this.membershipKey(input.eventId, input.userId);
    const existing = this.memberships.get(key);
    if (existing) {
      const updated: MembershipRow = { ...existing, role: input.role };
      this.memberships.set(key, updated);
      return updated;
    }
    const row: MembershipRow = {
      id: uuidv7(),
      eventId: input.eventId,
      userId: input.userId,
      role: input.role,
      createdAt: new Date().toISOString(),
    };
    this.memberships.set(key, row);
    return row;
  }

  async insertMembershipIfAbsent(input: {
    eventId: string;
    userId: string;
    role: EventRole;
  }): Promise<MembershipRow> {
    const key = this.membershipKey(input.eventId, input.userId);
    const existing = this.memberships.get(key);
    if (existing) return existing;
    const row: MembershipRow = {
      id: uuidv7(),
      eventId: input.eventId,
      userId: input.userId,
      role: input.role,
      createdAt: new Date().toISOString(),
    };
    this.memberships.set(key, row);
    return row;
  }

  async tryUpdateMemberRole(input: {
    eventId: string;
    userId: string;
    fromRole: EventRole;
    toRole: EventRole;
  }): Promise<boolean> {
    const key = this.membershipKey(input.eventId, input.userId);
    const existing = this.memberships.get(key);
    if (!existing || existing.role !== input.fromRole) return false;
    if (input.fromRole === "admin" && input.toRole !== "admin") {
      let adminCount = 0;
      for (const m of this.memberships.values()) {
        if (m.eventId === input.eventId && m.role === "admin") adminCount += 1;
      }
      if (adminCount <= 1) return false;
    }
    this.memberships.set(key, { ...existing, role: input.toRole });
    return true;
  }

  async findMembership(
    eventId: string,
    userId: string,
  ): Promise<MembershipRow | null> {
    return this.memberships.get(this.membershipKey(eventId, userId)) ?? null;
  }

  async listMembershipsForUser(userId: string): Promise<MembershipRow[]> {
    return [...this.memberships.values()].filter((m) => m.userId === userId);
  }

  async listMemberships(): Promise<MembershipRow[]> {
    return [...this.memberships.values()];
  }

  async deleteMembership(eventId: string, userId: string): Promise<boolean> {
    const key = this.membershipKey(eventId, userId);
    return this.memberships.delete(key);
  }

  async countMembershipsByRole(role: EventRole): Promise<number> {
    let n = 0;
    for (const m of this.memberships.values()) {
      if (m.role === role) n += 1;
    }
    return n;
  }
}

/**
 * D1-backed auth store — production Worker SoR (binding name: DB).
 * Never stores plaintext tokens.
 */
export class D1AuthStore implements AuthStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const key = normalizeEmail(email);
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findUsersByIds(ids: string[]): Promise<Map<string, UserRow>> {
    const out = new Map<string, UserRow>();
    if (ids.length === 0) return out;
    const unique = [...new Set(ids)];
    // D1 bound-parameter limit is 100 per query — chunk IN lists (mirror
    // D1EvalStore.listScoresForAssignments).
    const CHUNK = 90;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const rows = await this.db
        .select()
        .from(users)
        .where(inArray(users.id, slice));
      for (const row of rows) {
        out.set(row.id, {
          id: row.id,
          email: row.email,
          name: row.name ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }
    return out;
  }

  async createUser(input: {
    email: string;
    name?: string | null;
  }): Promise<UserRow> {
    const email = normalizeEmail(input.email);
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    const now = new Date().toISOString();
    const row: UserRow = {
      id: uuidv7(),
      email,
      name: input.name ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(users).values({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return row;
  }

  async findOrCreateUserByEmail(input: {
    email: string;
    name?: string | null;
  }): Promise<UserRow> {
    const email = normalizeEmail(input.email);
    const now = new Date().toISOString();
    const id = uuidv7();
    // Race-safe: unique idx_users_email; loser of insert does nothing then SELECT.
    try {
      await this.db.run(sql`
        INSERT INTO users (id, email, name, created_at, updated_at)
        VALUES (${id}, ${email}, ${input.name ?? null}, ${now}, ${now})
        ON CONFLICT(email) DO NOTHING
      `);
    } catch {
      // Some drivers surface unique races differently; fall through to SELECT.
    }
    const found = await this.findUserByEmail(email);
    if (!found) {
      // Extremely rare: insert failed for non-conflict reason.
      return this.createUser(input);
    }
    return found;
  }

  async insertMagicLink(
    row: Omit<MagicLinkRow, "usedAt"> & { usedAt?: null },
  ): Promise<MagicLinkRow> {
    const full: MagicLinkRow = {
      ...row,
      usedAt: row.usedAt ?? null,
    };
    await this.db.insert(magicLinks).values({
      id: full.id,
      userId: full.userId,
      eventId: full.eventId,
      purpose: full.purpose,
      tokenHash: full.tokenHash,
      expiresAt: full.expiresAt,
      usedAt: full.usedAt,
      createdAt: full.createdAt,
    });
    return full;
  }

  async findMagicLinkByTokenHash(
    tokenHash: string,
  ): Promise<MagicLinkRow | null> {
    const rows = await this.db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      eventId: row.eventId ?? null,
      purpose: row.purpose as MagicLinkPurpose,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt ?? null,
      createdAt: row.createdAt,
    };
  }

  async consumeMagicLink(id: string, usedAt: string): Promise<boolean> {
    const result = await this.db
      .update(magicLinks)
      .set({ usedAt })
      .where(and(eq(magicLinks.id, id), isNull(magicLinks.usedAt)));
    const changes = d1Changes(result);
    return changes > 0;
  }

  async insertSession(row: SessionRow): Promise<SessionRow> {
    await this.db.insert(authSessions).values({
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    });
    return row;
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<boolean> {
    const existing = await this.findSessionByTokenHash(tokenHash);
    if (!existing) return false;
    await this.db
      .delete(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash));
    return true;
  }

  async insertAudit(row: AuditRow): Promise<void> {
    const built = buildAuditEventRow(row);
    await this.db.insert(auditEvents).values({
      id: built.id,
      eventId: built.eventId ?? null,
      actorType: built.actorType,
      actorId: built.actorId,
      action: built.action,
      entityType: built.entityType,
      entityId: built.entityId,
      beforeJson: built.beforeJson ?? null,
      afterJson: built.afterJson ?? null,
      correlationId: built.correlationId,
      createdAt: built.createdAt,
    });
  }

  async listAudits(): Promise<AuditRow[]> {
    const rows = await this.db.select().from(auditEvents);
    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId ?? null,
      actorType: r.actorType as AuditRow["actorType"],
      actorId: r.actorId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      beforeJson: r.beforeJson ?? null,
      afterJson: r.afterJson ?? null,
      correlationId: r.correlationId,
      createdAt: r.createdAt,
    }));
  }

  async findAuditByActionAndEntity(
    action: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditRow | null> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, action),
          eq(auditEvents.entityType, entityType),
          eq(auditEvents.entityId, entityId),
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      eventId: r.eventId ?? null,
      actorType: r.actorType as AuditRow["actorType"],
      actorId: r.actorId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      beforeJson: r.beforeJson ?? null,
      afterJson: r.afterJson ?? null,
      correlationId: r.correlationId,
      createdAt: r.createdAt,
    };
  }

  async listMagicLinks(): Promise<MagicLinkRow[]> {
    const rows = await this.db.select().from(magicLinks);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      eventId: r.eventId ?? null,
      purpose: r.purpose as MagicLinkPurpose,
      tokenHash: r.tokenHash,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt ?? null,
      createdAt: r.createdAt,
    }));
  }

  async listSessions(): Promise<SessionRow[]> {
    const rows = await this.db.select().from(authSessions);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      tokenHash: r.tokenHash,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }

  async upsertMembership(input: {
    eventId: string;
    userId: string;
    role: EventRole;
  }): Promise<MembershipRow> {
    const existing = await this.findMembership(input.eventId, input.userId);
    if (existing) {
      await this.db
        .update(eventMemberships)
        .set({ role: input.role })
        .where(eq(eventMemberships.id, existing.id));
      return { ...existing, role: input.role };
    }
    const row: MembershipRow = {
      id: uuidv7(),
      eventId: input.eventId,
      userId: input.userId,
      role: input.role,
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(eventMemberships).values({
      id: row.id,
      eventId: row.eventId,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt,
    });
    return row;
  }

  async insertMembershipIfAbsent(input: {
    eventId: string;
    userId: string;
    role: EventRole;
  }): Promise<MembershipRow> {
    const id = uuidv7();
    const createdAt = new Date().toISOString();
    await this.db.run(sql`
      INSERT INTO event_memberships (id, event_id, user_id, role, created_at)
      VALUES (${id}, ${input.eventId}, ${input.userId}, ${input.role}, ${createdAt})
      ON CONFLICT(event_id, user_id) DO NOTHING
    `);
    const row = await this.findMembership(input.eventId, input.userId);
    if (!row) {
      // Should not happen after insert-or-noop; fall back to upsert for safety.
      return this.upsertMembership(input);
    }
    return row;
  }

  async tryUpdateMemberRole(input: {
    eventId: string;
    userId: string;
    fromRole: EventRole;
    toRole: EventRole;
  }): Promise<boolean> {
    // Atomic last-admin guard: demoting admin requires another admin on this event.
    if (input.fromRole === "admin" && input.toRole !== "admin") {
      const result = await this.db.run(sql`
        UPDATE event_memberships
        SET role = ${input.toRole}
        WHERE event_id = ${input.eventId}
          AND user_id = ${input.userId}
          AND role = ${input.fromRole}
          AND (
            SELECT COUNT(*) FROM event_memberships m2
            WHERE m2.event_id = ${input.eventId} AND m2.role = 'admin'
          ) > 1
      `);
      const changes =
        (result as { meta?: { changes?: number }; changes?: number })?.meta
          ?.changes ??
        (result as { changes?: number })?.changes ??
        0;
      return Number(changes) > 0;
    }
    const result = await this.db.run(sql`
      UPDATE event_memberships
      SET role = ${input.toRole}
      WHERE event_id = ${input.eventId}
        AND user_id = ${input.userId}
        AND role = ${input.fromRole}
    `);
    const changes =
      (result as { meta?: { changes?: number }; changes?: number })?.meta
        ?.changes ??
      (result as { changes?: number })?.changes ??
      0;
    return Number(changes) > 0;
  }

  async findMembership(
    eventId: string,
    userId: string,
  ): Promise<MembershipRow | null> {
    const rows = await this.db
      .select()
      .from(eventMemberships)
      .where(
        and(
          eq(eventMemberships.eventId, eventId),
          eq(eventMemberships.userId, userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      eventId: row.eventId,
      userId: row.userId,
      role: row.role as EventRole,
      createdAt: row.createdAt,
    };
  }

  async listMembershipsForUser(userId: string): Promise<MembershipRow[]> {
    const rows = await this.db
      .select()
      .from(eventMemberships)
      .where(eq(eventMemberships.userId, userId));
    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      userId: r.userId,
      role: r.role as EventRole,
      createdAt: r.createdAt,
    }));
  }

  async listMemberships(): Promise<MembershipRow[]> {
    const rows = await this.db.select().from(eventMemberships);
    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      userId: r.userId,
      role: r.role as EventRole,
      createdAt: r.createdAt,
    }));
  }

  async deleteMembership(eventId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .delete(eventMemberships)
      .where(
        and(
          eq(eventMemberships.eventId, eventId),
          eq(eventMemberships.userId, userId),
        ),
      );
    return d1Changes(result) > 0;
  }

  async countMembershipsByRole(role: EventRole): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(eventMemberships)
      .where(eq(eventMemberships.role, role));
    const n = rows[0]?.n;
    return typeof n === "number" ? n : Number(n ?? 0);
  }
}

/** Dev/test transport: captures magic links for exchange without email. */
export class MagicLinkTestOutbox {
  private items: CapturedMagicLink[] = [];

  capture(link: CapturedMagicLink): void {
    this.items.push(link);
  }

  /** Most recent link for email (case-insensitive). */
  lastForEmail(email: string): CapturedMagicLink | null {
    const key = normalizeEmail(email);
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (normalizeEmail(this.items[i]!.email) === key) {
        return this.items[i]!;
      }
    }
    return null;
  }

  all(): CapturedMagicLink[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Extract rows-changed count from a Drizzle D1/SQLite update result. */
export function d1Changes(result: unknown): number {
  if (result == null || typeof result !== "object") return 0;
  const meta = (result as { meta?: { changes?: number } }).meta;
  if (meta && typeof meta.changes === "number") return meta.changes;
  // better-sqlite3 / some drivers expose changes at top level
  const top = (result as { changes?: number }).changes;
  if (typeof top === "number") return top;
  return 0;
}
