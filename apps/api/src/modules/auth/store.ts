/**
 * Auth persistence — users, magic_links, auth_sessions, audit (section 2.1).
 *
 * MemoryAuthStore is the test / local e2e default (no D1 required).
 * D1AuthStore wraps the Worker DB binding for production.
 *
 * Tokens are stored only as hashes — callers must hash before insert.
 */
import { uuidv7 } from "@speakerops/shared";
import type { MagicLinkPurpose } from "@speakerops/shared";
import { buildAuditEventRow, type AuditWriteInput } from "@speakerops/db";

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
  createUser(input: {
    email: string;
    name?: string | null;
  }): Promise<UserRow>;
  insertMagicLink(row: Omit<MagicLinkRow, "usedAt"> & { usedAt?: null }): Promise<MagicLinkRow>;
  findMagicLinkByTokenHash(tokenHash: string): Promise<MagicLinkRow | null>;
  markMagicLinkUsed(id: string, usedAt: string): Promise<void>;
  insertSession(row: SessionRow): Promise<SessionRow>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<boolean>;
  insertAudit(row: AuditRow): Promise<void>;
  listAudits(): Promise<AuditRow[]>;
  /** All magic link rows (tests: assert hash-only storage). */
  listMagicLinks(): Promise<MagicLinkRow[]>;
  listSessions(): Promise<SessionRow[]>;
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

  async markMagicLinkUsed(id: string, usedAt: string): Promise<void> {
    const row = this.magicLinks.get(id);
    if (!row) return;
    this.magicLinks.set(id, { ...row, usedAt });
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

  async listMagicLinks(): Promise<MagicLinkRow[]> {
    return [...this.magicLinks.values()];
  }

  async listSessions(): Promise<SessionRow[]> {
    return [...this.sessions.values()];
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
