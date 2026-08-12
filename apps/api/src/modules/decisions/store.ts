/**
 * Decisions / program sessions / participations / tasks persistence (section 3.5).
 *
 * MemoryDecisionsStore is the test / local e2e default (no D1 required).
 * D1DecisionsStore wraps the Worker DB binding for production (E1 SoR).
 * Event-scoped queries take eventId (E2).
 */
import { eq, and, inArray } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  decisions,
  eventParticipations,
  programSessions,
  sessionSpeakers,
  taskTemplates,
  speakerTasks,
} from "@speakerops/db";
import { d1Changes } from "../auth/store.js";

export type DecisionRow = {
  id: string;
  submissionId: string;
  decision: "accept" | "reject" | "waitlist";
  reason: string | null;
  decidedBy: string;
  createdAt: string;
};

export type ParticipationRow = {
  id: string;
  eventId: string;
  personId: string;
  userId: string | null;
  roleLabel: string | null;
  status: string;
  bio: string | null;
  /** Rich bio doc envelope JSON (F2; 0036). Dual-read with bio. */
  bioRichJson?: string | null;
  company: string | null;
  title: string | null;
  headshotFileId: string | null;
  /** P6 social links JSON string or null. */
  socialLinksJson?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProgramSessionRow = {
  id: string;
  eventId: string;
  sourceSubmissionId: string | null;
  title: string;
  description: string | null;
  trackId: string | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SessionSpeakerRow = {
  sessionId: string;
  participationId: string;
  isPrimary: boolean;
};

export type TaskTemplateRow = {
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  trigger: "on_accept" | "manual";
  dueOffsetDays: number;
  /** Optional https:// resource link for portal task cards (0030). */
  linkUrl: string | null;
  /** True when incomplete tasks from this template block readiness (0030). */
  required: boolean;
  /** Optimistic concurrency version (E1). */
  version: number;
  createdAt: string;
};

export type SpeakerTaskRow = {
  id: string;
  templateId: string;
  participationId: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type DecisionsStore = {
  insertDecision(row: DecisionRow): Promise<DecisionRow>;
  findDecisionBySubmission(
    submissionId: string,
  ): Promise<DecisionRow | null>;
  /** Replace decision for re-decide after non-accept paths; keeps same submission unique. */
  upsertDecision(row: DecisionRow): Promise<DecisionRow>;

  insertParticipation(row: ParticipationRow): Promise<ParticipationRow>;
  findParticipation(
    eventId: string,
    personId: string,
  ): Promise<ParticipationRow | null>;
  findParticipationById(id: string): Promise<ParticipationRow | null>;
  listParticipationsForEvent(eventId: string): Promise<ParticipationRow[]>;
  /**
   * Status-only or profile patch (section 3.5 dematerialize + 4.1 profile).
   * Optimistic: WHERE id AND version = patch.version - 1 (callers bump by 1).
   * Returns null on missing row or version conflict (no row changed).
   */
  updateParticipation(
    id: string,
    patch: {
      version: number;
      updatedAt: string;
      status?: string;
      userId?: string | null;
      bio?: string | null;
      bioRichJson?: string | null;
      company?: string | null;
      title?: string | null;
      headshotFileId?: string | null;
      socialLinksJson?: string | null;
    },
  ): Promise<ParticipationRow | null>;

  insertSession(row: ProgramSessionRow): Promise<ProgramSessionRow>;
  findSessionById(id: string): Promise<ProgramSessionRow | null>;
  findSessionBySubmission(
    submissionId: string,
  ): Promise<ProgramSessionRow | null>;
  listSessionsForEvent(eventId: string): Promise<ProgramSessionRow[]>;
  updateSession(
    id: string,
    patch: { status: string; version: number; updatedAt: string },
  ): Promise<ProgramSessionRow | null>;

  insertSessionSpeaker(row: SessionSpeakerRow): Promise<SessionSpeakerRow>;
  listSessionSpeakers(sessionId: string): Promise<SessionSpeakerRow[]>;
  /** Reverse lookup: sessions linked to a participation (portal / admin detail). */
  listSessionSpeakersForParticipation(
    participationId: string,
  ): Promise<SessionSpeakerRow[]>;
  /**
   * Batch reverse lookup for admin speakers list (dogfood 150+ scale).
   * Empty input → empty array.
   */
  listSessionSpeakersForParticipations(
    participationIds: string[],
  ): Promise<SessionSpeakerRow[]>;
  /** Remove all session_speakers rows for a session (accept rollback). */
  deleteSessionSpeakers(sessionId: string): Promise<void>;

  insertTaskTemplate(row: TaskTemplateRow): Promise<TaskTemplateRow>;
  findTaskTemplateById(id: string): Promise<TaskTemplateRow | null>;
  listTaskTemplates(
    eventId: string,
    trigger?: "on_accept" | "manual",
  ): Promise<TaskTemplateRow[]>;
  /**
   * Conditional update: WHERE id AND version = expectedVersion.
   * Returns null on missing row or version conflict (no row changed).
   */
  updateTaskTemplate(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      trigger?: "on_accept" | "manual";
      dueOffsetDays?: number;
      linkUrl?: string | null;
      required?: boolean;
      version: number;
      expectedVersion: number;
    },
  ): Promise<TaskTemplateRow | null>;
  /**
   * Conditional delete: WHERE id AND version = expectedVersion.
   * Returns false on missing row or version conflict (no row deleted).
   */
  deleteTaskTemplate(id: string, expectedVersion: number): Promise<boolean>;

  insertSpeakerTask(row: SpeakerTaskRow): Promise<SpeakerTaskRow>;
  findSpeakerTask(
    templateId: string,
    participationId: string,
  ): Promise<SpeakerTaskRow | null>;
  findSpeakerTaskById(id: string): Promise<SpeakerTaskRow | null>;
  listSpeakerTasksForParticipation(
    participationId: string,
  ): Promise<SpeakerTaskRow[]>;
  listSpeakerTasksForParticipations(
    participationIds: string[],
  ): Promise<SpeakerTaskRow[]>;
  /**
   * Optimistic: WHERE id AND version = patch.version - 1 (callers bump by 1).
   * Returns null on missing row or version conflict (no row changed).
   */
  updateSpeakerTask(
    id: string,
    patch: {
      status: string;
      version: number;
      updatedAt: string;
      completedAt?: string | null;
    },
  ): Promise<SpeakerTaskRow | null>;
};

export function newDecisionId(): string {
  return uuidv7();
}
export function newParticipationId(): string {
  return uuidv7();
}
export function newProgramSessionId(): string {
  return uuidv7();
}
export function newTaskTemplateId(): string {
  return uuidv7();
}
export function newSpeakerTaskId(): string {
  return uuidv7();
}

/**
 * In-memory decisions store — unit tests + e2e without D1.
 */
export class MemoryDecisionsStore implements DecisionsStore {
  private decisions = new Map<string, DecisionRow>();
  private bySubmission = new Map<string, string>();
  private participations = new Map<string, ParticipationRow>();
  private partByEventPerson = new Map<string, string>();
  private sessions = new Map<string, ProgramSessionRow>();
  private sessionBySubmission = new Map<string, string>();
  private sessionSpeakers = new Map<string, SessionSpeakerRow[]>();
  private templates = new Map<string, TaskTemplateRow>();
  private tasks = new Map<string, SpeakerTaskRow>();
  private taskByTplPart = new Map<string, string>();

  private epKey(eventId: string, personId: string): string {
    return `${eventId}::${personId}`;
  }
  private tpKey(templateId: string, participationId: string): string {
    return `${templateId}::${participationId}`;
  }

  async insertDecision(row: DecisionRow): Promise<DecisionRow> {
    this.decisions.set(row.id, { ...row });
    this.bySubmission.set(row.submissionId, row.id);
    return { ...row };
  }

  async findDecisionBySubmission(
    submissionId: string,
  ): Promise<DecisionRow | null> {
    const id = this.bySubmission.get(submissionId);
    if (!id) return null;
    const row = this.decisions.get(id);
    return row ? { ...row } : null;
  }

  async upsertDecision(row: DecisionRow): Promise<DecisionRow> {
    const existingId = this.bySubmission.get(row.submissionId);
    if (existingId) {
      this.decisions.delete(existingId);
    }
    this.decisions.set(row.id, { ...row });
    this.bySubmission.set(row.submissionId, row.id);
    return { ...row };
  }

  async insertParticipation(row: ParticipationRow): Promise<ParticipationRow> {
    this.participations.set(row.id, { ...row });
    this.partByEventPerson.set(this.epKey(row.eventId, row.personId), row.id);
    return { ...row };
  }

  async findParticipation(
    eventId: string,
    personId: string,
  ): Promise<ParticipationRow | null> {
    const id = this.partByEventPerson.get(this.epKey(eventId, personId));
    if (!id) return null;
    const row = this.participations.get(id);
    return row ? { ...row } : null;
  }

  async findParticipationById(id: string): Promise<ParticipationRow | null> {
    const row = this.participations.get(id);
    return row ? { ...row } : null;
  }

  async listParticipationsForEvent(
    eventId: string,
  ): Promise<ParticipationRow[]> {
    return [...this.participations.values()]
      .filter((p) => p.eventId === eventId)
      .map((p) => ({ ...p }));
  }

  async updateParticipation(
    id: string,
    patch: {
      version: number;
      updatedAt: string;
      status?: string;
      userId?: string | null;
      bio?: string | null;
      bioRichJson?: string | null;
      company?: string | null;
      title?: string | null;
      headshotFileId?: string | null;
      socialLinksJson?: string | null;
    },
  ): Promise<ParticipationRow | null> {
    const existing = this.participations.get(id);
    if (!existing) return null;
    // Atomic optimistic concurrency: reject stale expected version
    if (patch.version !== existing.version + 1) return null;
    const next: ParticipationRow = {
      ...existing,
      version: patch.version,
      updatedAt: patch.updatedAt,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.userId !== undefined ? { userId: patch.userId } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      ...(patch.bioRichJson !== undefined
        ? { bioRichJson: patch.bioRichJson }
        : {}),
      ...(patch.company !== undefined ? { company: patch.company } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.headshotFileId !== undefined
        ? { headshotFileId: patch.headshotFileId }
        : {}),
      ...(patch.socialLinksJson !== undefined
        ? { socialLinksJson: patch.socialLinksJson }
        : {}),
    };
    this.participations.set(id, next);
    return { ...next };
  }

  async insertSession(row: ProgramSessionRow): Promise<ProgramSessionRow> {
    // Unique source_submission_id: concurrent materialize reuses the winner.
    if (row.sourceSubmissionId) {
      const existingId = this.sessionBySubmission.get(row.sourceSubmissionId);
      if (existingId) {
        const existing = this.sessions.get(existingId);
        if (existing) return { ...existing };
      }
    }
    this.sessions.set(row.id, { ...row });
    if (row.sourceSubmissionId) {
      this.sessionBySubmission.set(row.sourceSubmissionId, row.id);
    }
    return { ...row };
  }

  async findSessionById(id: string): Promise<ProgramSessionRow | null> {
    const row = this.sessions.get(id);
    return row ? { ...row } : null;
  }

  async findSessionBySubmission(
    submissionId: string,
  ): Promise<ProgramSessionRow | null> {
    const id = this.sessionBySubmission.get(submissionId);
    if (!id) return null;
    const row = this.sessions.get(id);
    return row ? { ...row } : null;
  }

  async listSessionsForEvent(eventId: string): Promise<ProgramSessionRow[]> {
    return [...this.sessions.values()]
      .filter((s) => s.eventId === eventId)
      .map((s) => ({ ...s }));
  }

  async updateSession(
    id: string,
    patch: { status: string; version: number; updatedAt: string },
  ): Promise<ProgramSessionRow | null> {
    const existing = this.sessions.get(id);
    if (!existing) return null;
    const next: ProgramSessionRow = {
      ...existing,
      status: patch.status,
      version: patch.version,
      updatedAt: patch.updatedAt,
    };
    this.sessions.set(id, next);
    return { ...next };
  }

  async insertSessionSpeaker(
    row: SessionSpeakerRow,
  ): Promise<SessionSpeakerRow> {
    const list = this.sessionSpeakers.get(row.sessionId) ?? [];
    if (!list.some((s) => s.participationId === row.participationId)) {
      list.push({ ...row });
      this.sessionSpeakers.set(row.sessionId, list);
    }
    return { ...row };
  }

  async listSessionSpeakers(sessionId: string): Promise<SessionSpeakerRow[]> {
    return (this.sessionSpeakers.get(sessionId) ?? []).map((r) => ({ ...r }));
  }

  async listSessionSpeakersForParticipation(
    participationId: string,
  ): Promise<SessionSpeakerRow[]> {
    const out: SessionSpeakerRow[] = [];
    for (const list of this.sessionSpeakers.values()) {
      for (const row of list) {
        if (row.participationId === participationId) {
          out.push({ ...row });
        }
      }
    }
    return out;
  }

  async listSessionSpeakersForParticipations(
    participationIds: string[],
  ): Promise<SessionSpeakerRow[]> {
    if (participationIds.length === 0) return [];
    const set = new Set(participationIds);
    const out: SessionSpeakerRow[] = [];
    for (const list of this.sessionSpeakers.values()) {
      for (const row of list) {
        if (set.has(row.participationId)) {
          out.push({ ...row });
        }
      }
    }
    return out;
  }

  async deleteSessionSpeakers(sessionId: string): Promise<void> {
    this.sessionSpeakers.delete(sessionId);
  }

  async insertTaskTemplate(row: TaskTemplateRow): Promise<TaskTemplateRow> {
    this.templates.set(row.id, { ...row });
    return { ...row };
  }

  async findTaskTemplateById(id: string): Promise<TaskTemplateRow | null> {
    const row = this.templates.get(id);
    return row ? { ...row } : null;
  }

  async listTaskTemplates(
    eventId: string,
    trigger?: "on_accept" | "manual",
  ): Promise<TaskTemplateRow[]> {
    return [...this.templates.values()]
      .filter(
        (t) => t.eventId === eventId && (trigger ? t.trigger === trigger : true),
      )
      .map((t) => ({ ...t }));
  }

  async updateTaskTemplate(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      trigger?: "on_accept" | "manual";
      dueOffsetDays?: number;
      linkUrl?: string | null;
      required?: boolean;
      version: number;
      expectedVersion: number;
    },
  ): Promise<TaskTemplateRow | null> {
    const existing = this.templates.get(id);
    if (!existing) return null;
    if (existing.version !== patch.expectedVersion) return null;
    if (patch.version !== patch.expectedVersion + 1) return null;
    const next: TaskTemplateRow = {
      ...existing,
      version: patch.version,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
      ...(patch.dueOffsetDays !== undefined
        ? { dueOffsetDays: patch.dueOffsetDays }
        : {}),
      ...(patch.linkUrl !== undefined ? { linkUrl: patch.linkUrl } : {}),
      ...(patch.required !== undefined ? { required: patch.required } : {}),
    };
    this.templates.set(id, next);
    return { ...next };
  }

  async deleteTaskTemplate(
    id: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const existing = this.templates.get(id);
    if (!existing || existing.version !== expectedVersion) return false;
    return this.templates.delete(id);
  }

  async insertSpeakerTask(row: SpeakerTaskRow): Promise<SpeakerTaskRow> {
    this.tasks.set(row.id, { ...row });
    this.taskByTplPart.set(
      this.tpKey(row.templateId, row.participationId),
      row.id,
    );
    return { ...row };
  }

  async findSpeakerTask(
    templateId: string,
    participationId: string,
  ): Promise<SpeakerTaskRow | null> {
    const id = this.taskByTplPart.get(this.tpKey(templateId, participationId));
    if (!id) return null;
    const row = this.tasks.get(id);
    return row ? { ...row } : null;
  }

  async findSpeakerTaskById(id: string): Promise<SpeakerTaskRow | null> {
    const row = this.tasks.get(id);
    return row ? { ...row } : null;
  }

  async listSpeakerTasksForParticipation(
    participationId: string,
  ): Promise<SpeakerTaskRow[]> {
    return [...this.tasks.values()]
      .filter((t) => t.participationId === participationId)
      .map((t) => ({ ...t }));
  }

  async listSpeakerTasksForParticipations(
    participationIds: string[],
  ): Promise<SpeakerTaskRow[]> {
    const set = new Set(participationIds);
    return [...this.tasks.values()]
      .filter((t) => set.has(t.participationId))
      .map((t) => ({ ...t }));
  }

  async updateSpeakerTask(
    id: string,
    patch: {
      status: string;
      version: number;
      updatedAt: string;
      completedAt?: string | null;
    },
  ): Promise<SpeakerTaskRow | null> {
    const existing = this.tasks.get(id);
    if (!existing) return null;
    // Atomic optimistic concurrency: reject stale expected version
    if (patch.version !== existing.version + 1) return null;
    const next: SpeakerTaskRow = {
      ...existing,
      status: patch.status,
      version: patch.version,
      updatedAt: patch.updatedAt,
      completedAt:
        patch.completedAt !== undefined
          ? patch.completedAt
          : existing.completedAt,
    };
    this.tasks.set(id, next);
    return { ...next };
  }
}

/**
 * D1-backed decisions store (production SoR).
 */
export class D1DecisionsStore implements DecisionsStore {
  private db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async insertDecision(row: DecisionRow): Promise<DecisionRow> {
    await this.db.insert(decisions).values({
      id: row.id,
      submissionId: row.submissionId,
      decision: row.decision,
      reason: row.reason,
      decidedBy: row.decidedBy,
      createdAt: row.createdAt,
    });
    return row;
  }

  async findDecisionBySubmission(
    submissionId: string,
  ): Promise<DecisionRow | null> {
    const rows = await this.db
      .select()
      .from(decisions)
      .where(eq(decisions.submissionId, submissionId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      submissionId: row.submissionId,
      decision: row.decision as DecisionRow["decision"],
      reason: row.reason,
      decidedBy: row.decidedBy,
      createdAt: row.createdAt,
    };
  }

  async upsertDecision(row: DecisionRow): Promise<DecisionRow> {
    const existing = await this.findDecisionBySubmission(row.submissionId);
    if (existing) {
      await this.db
        .update(decisions)
        .set({
          decision: row.decision,
          reason: row.reason,
          decidedBy: row.decidedBy,
          createdAt: row.createdAt,
        })
        .where(eq(decisions.submissionId, row.submissionId));
      return {
        ...row,
        id: existing.id,
      };
    }
    return this.insertDecision(row);
  }

  async insertParticipation(row: ParticipationRow): Promise<ParticipationRow> {
    await this.db.insert(eventParticipations).values({
      id: row.id,
      eventId: row.eventId,
      personId: row.personId,
      userId: row.userId,
      roleLabel: row.roleLabel,
      status: row.status,
      bio: row.bio,
      bioRichJson: row.bioRichJson ?? null,
      company: row.company,
      title: row.title,
      headshotFileId: row.headshotFileId,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return row;
  }

  async findParticipation(
    eventId: string,
    personId: string,
  ): Promise<ParticipationRow | null> {
    const rows = await this.db
      .select()
      .from(eventParticipations)
      .where(
        and(
          eq(eventParticipations.eventId, eventId),
          eq(eventParticipations.personId, personId),
        ),
      )
      .limit(1);
    return rows[0] ? this.mapParticipation(rows[0]) : null;
  }

  async findParticipationById(id: string): Promise<ParticipationRow | null> {
    const rows = await this.db
      .select()
      .from(eventParticipations)
      .where(eq(eventParticipations.id, id))
      .limit(1);
    return rows[0] ? this.mapParticipation(rows[0]) : null;
  }

  async listParticipationsForEvent(
    eventId: string,
  ): Promise<ParticipationRow[]> {
    const rows = await this.db
      .select()
      .from(eventParticipations)
      .where(eq(eventParticipations.eventId, eventId));
    return rows.map((r) => this.mapParticipation(r));
  }

  async updateParticipation(
    id: string,
    patch: {
      version: number;
      updatedAt: string;
      status?: string;
      userId?: string | null;
      bio?: string | null;
      bioRichJson?: string | null;
      company?: string | null;
      title?: string | null;
      headshotFileId?: string | null;
      socialLinksJson?: string | null;
    },
  ): Promise<ParticipationRow | null> {
    // Callers always set version = prior + 1; include prior in WHERE for E1 atomicity.
    const expectedVersion = patch.version - 1;
    const set: Record<string, unknown> = {
      version: patch.version,
      updatedAt: patch.updatedAt,
    };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.userId !== undefined) set.userId = patch.userId;
    if (patch.bio !== undefined) set.bio = patch.bio;
    if (patch.bioRichJson !== undefined) set.bioRichJson = patch.bioRichJson;
    if (patch.company !== undefined) set.company = patch.company;
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.headshotFileId !== undefined) {
      set.headshotFileId = patch.headshotFileId;
    }
    if (patch.socialLinksJson !== undefined) {
      set.socialLinksJson = patch.socialLinksJson;
    }
    const result = await this.db
      .update(eventParticipations)
      .set(set)
      .where(
        and(
          eq(eventParticipations.id, id),
          eq(eventParticipations.version, expectedVersion),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return this.findParticipationById(id);
  }

  private mapParticipation(row: {
    id: string;
    eventId: string;
    personId: string;
    userId: string | null;
    roleLabel: string | null;
    status: string;
    bio: string | null;
    bioRichJson?: string | null;
    company: string | null;
    title: string | null;
    headshotFileId: string | null;
    socialLinksJson?: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
  }): ParticipationRow {
    return {
      id: row.id,
      eventId: row.eventId,
      personId: row.personId,
      userId: row.userId,
      roleLabel: row.roleLabel,
      status: row.status,
      bio: row.bio,
      bioRichJson: row.bioRichJson ?? null,
      company: row.company,
      title: row.title,
      headshotFileId: row.headshotFileId,
      socialLinksJson: row.socialLinksJson ?? null,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async insertSession(row: ProgramSessionRow): Promise<ProgramSessionRow> {
    // Unique source_submission_id: on concurrent insert, re-read winner.
    if (row.sourceSubmissionId) {
      const existing = await this.findSessionBySubmission(row.sourceSubmissionId);
      if (existing) return existing;
    }
    try {
      await this.db.insert(programSessions).values({
        id: row.id,
        eventId: row.eventId,
        sourceSubmissionId: row.sourceSubmissionId,
        title: row.title,
        description: row.description,
        trackId: row.trackId,
        status: row.status,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      return row;
    } catch (err) {
      if (row.sourceSubmissionId) {
        const raced = await this.findSessionBySubmission(row.sourceSubmissionId);
        if (raced) return raced;
      }
      throw err;
    }
  }

  async findSessionById(id: string): Promise<ProgramSessionRow | null> {
    const rows = await this.db
      .select()
      .from(programSessions)
      .where(eq(programSessions.id, id))
      .limit(1);
    return rows[0] ? this.mapSession(rows[0]) : null;
  }

  async findSessionBySubmission(
    submissionId: string,
  ): Promise<ProgramSessionRow | null> {
    const rows = await this.db
      .select()
      .from(programSessions)
      .where(eq(programSessions.sourceSubmissionId, submissionId))
      .limit(1);
    return rows[0] ? this.mapSession(rows[0]) : null;
  }

  async listSessionsForEvent(eventId: string): Promise<ProgramSessionRow[]> {
    const rows = await this.db
      .select()
      .from(programSessions)
      .where(eq(programSessions.eventId, eventId));
    return rows.map((r) => this.mapSession(r));
  }

  async updateSession(
    id: string,
    patch: { status: string; version: number; updatedAt: string },
  ): Promise<ProgramSessionRow | null> {
    await this.db
      .update(programSessions)
      .set({
        status: patch.status,
        version: patch.version,
        updatedAt: patch.updatedAt,
      })
      .where(eq(programSessions.id, id));
    return this.findSessionById(id);
  }

  private mapSession(row: {
    id: string;
    eventId: string;
    sourceSubmissionId: string | null;
    title: string;
    description: string | null;
    trackId: string | null;
    status: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }): ProgramSessionRow {
    return {
      id: row.id,
      eventId: row.eventId,
      sourceSubmissionId: row.sourceSubmissionId,
      title: row.title,
      description: row.description,
      trackId: row.trackId,
      status: row.status,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async insertSessionSpeaker(
    row: SessionSpeakerRow,
  ): Promise<SessionSpeakerRow> {
    await this.db.insert(sessionSpeakers).values({
      sessionId: row.sessionId,
      participationId: row.participationId,
      isPrimary: row.isPrimary ? 1 : 0,
    });
    return row;
  }

  async listSessionSpeakers(sessionId: string): Promise<SessionSpeakerRow[]> {
    const rows = await this.db
      .select()
      .from(sessionSpeakers)
      .where(eq(sessionSpeakers.sessionId, sessionId));
    return rows.map((r) => ({
      sessionId: r.sessionId,
      participationId: r.participationId,
      isPrimary: r.isPrimary === 1,
    }));
  }

  async listSessionSpeakersForParticipation(
    participationId: string,
  ): Promise<SessionSpeakerRow[]> {
    const rows = await this.db
      .select()
      .from(sessionSpeakers)
      .where(eq(sessionSpeakers.participationId, participationId));
    return rows.map((r) => ({
      sessionId: r.sessionId,
      participationId: r.participationId,
      isPrimary: r.isPrimary === 1,
    }));
  }

  async listSessionSpeakersForParticipations(
    participationIds: string[],
  ): Promise<SessionSpeakerRow[]> {
    if (participationIds.length === 0) return [];
    const unique = [...new Set(participationIds)];
    // D1 bound-parameter limit is 100 per query — chunk IN lists (dogfood 150+).
    const CHUNK = 90;
    const out: SessionSpeakerRow[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const rows = await this.db
        .select()
        .from(sessionSpeakers)
        .where(inArray(sessionSpeakers.participationId, slice));
      for (const r of rows) {
        out.push({
          sessionId: r.sessionId,
          participationId: r.participationId,
          isPrimary: r.isPrimary === 1,
        });
      }
    }
    return out;
  }

  async deleteSessionSpeakers(sessionId: string): Promise<void> {
    await this.db
      .delete(sessionSpeakers)
      .where(eq(sessionSpeakers.sessionId, sessionId));
  }

  async insertTaskTemplate(row: TaskTemplateRow): Promise<TaskTemplateRow> {
    await this.db.insert(taskTemplates).values({
      id: row.id,
      eventId: row.eventId,
      title: row.title,
      description: row.description,
      trigger: row.trigger,
      dueOffsetDays: row.dueOffsetDays,
      linkUrl: row.linkUrl,
      required: row.required ? 1 : 0,
      version: row.version,
      createdAt: row.createdAt,
    });
    return row;
  }

  async findTaskTemplateById(id: string): Promise<TaskTemplateRow | null> {
    const rows = await this.db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      eventId: r.eventId,
      title: r.title,
      description: r.description,
      trigger: r.trigger as TaskTemplateRow["trigger"],
      dueOffsetDays: r.dueOffsetDays,
      linkUrl: r.linkUrl ?? null,
      required: r.required === 1,
      version: r.version ?? 1,
      createdAt: r.createdAt,
    };
  }

  async listTaskTemplates(
    eventId: string,
    trigger?: "on_accept" | "manual",
  ): Promise<TaskTemplateRow[]> {
    const rows = await this.db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.eventId, eventId));
    return rows
      .filter((r) => (trigger ? r.trigger === trigger : true))
      .map((r) => ({
        id: r.id,
        eventId: r.eventId,
        title: r.title,
        description: r.description,
        trigger: r.trigger as TaskTemplateRow["trigger"],
        dueOffsetDays: r.dueOffsetDays,
        linkUrl: r.linkUrl ?? null,
        required: r.required === 1,
        version: r.version ?? 1,
        createdAt: r.createdAt,
      }));
  }

  async updateTaskTemplate(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      trigger?: "on_accept" | "manual";
      dueOffsetDays?: number;
      linkUrl?: string | null;
      required?: boolean;
      version: number;
      expectedVersion: number;
    },
  ): Promise<TaskTemplateRow | null> {
    const set: Record<string, unknown> = {
      version: patch.version,
    };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.trigger !== undefined) set.trigger = patch.trigger;
    if (patch.dueOffsetDays !== undefined) set.dueOffsetDays = patch.dueOffsetDays;
    if (patch.linkUrl !== undefined) set.linkUrl = patch.linkUrl;
    if (patch.required !== undefined) set.required = patch.required ? 1 : 0;
    const result = await this.db
      .update(taskTemplates)
      .set(set)
      .where(
        and(
          eq(taskTemplates.id, id),
          eq(taskTemplates.version, patch.expectedVersion),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return this.findTaskTemplateById(id);
  }

  async deleteTaskTemplate(
    id: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await this.db
      .delete(taskTemplates)
      .where(
        and(
          eq(taskTemplates.id, id),
          eq(taskTemplates.version, expectedVersion),
        ),
      );
    return d1Changes(result) > 0;
  }

  async insertSpeakerTask(row: SpeakerTaskRow): Promise<SpeakerTaskRow> {
    await this.db.insert(speakerTasks).values({
      id: row.id,
      templateId: row.templateId,
      participationId: row.participationId,
      status: row.status,
      dueAt: row.dueAt,
      completedAt: row.completedAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return row;
  }

  async findSpeakerTask(
    templateId: string,
    participationId: string,
  ): Promise<SpeakerTaskRow | null> {
    const rows = await this.db
      .select()
      .from(speakerTasks)
      .where(
        and(
          eq(speakerTasks.templateId, templateId),
          eq(speakerTasks.participationId, participationId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      templateId: row.templateId,
      participationId: row.participationId,
      status: row.status,
      dueAt: row.dueAt,
      completedAt: row.completedAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findSpeakerTaskById(id: string): Promise<SpeakerTaskRow | null> {
    const rows = await this.db
      .select()
      .from(speakerTasks)
      .where(eq(speakerTasks.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      templateId: row.templateId,
      participationId: row.participationId,
      status: row.status,
      dueAt: row.dueAt,
      completedAt: row.completedAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listSpeakerTasksForParticipation(
    participationId: string,
  ): Promise<SpeakerTaskRow[]> {
    const rows = await this.db
      .select()
      .from(speakerTasks)
      .where(eq(speakerTasks.participationId, participationId));
    return rows.map((row) => ({
      id: row.id,
      templateId: row.templateId,
      participationId: row.participationId,
      status: row.status,
      dueAt: row.dueAt,
      completedAt: row.completedAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async listSpeakerTasksForParticipations(
    participationIds: string[],
  ): Promise<SpeakerTaskRow[]> {
    if (participationIds.length === 0) return [];
    const unique = [...new Set(participationIds)];
    // D1 bound-parameter limit is 100 per query — chunk IN lists (dogfood 150+).
    const CHUNK = 90;
    const out: SpeakerTaskRow[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const rows = await this.db
        .select()
        .from(speakerTasks)
        .where(inArray(speakerTasks.participationId, slice));
      for (const row of rows) {
        out.push({
          id: row.id,
          templateId: row.templateId,
          participationId: row.participationId,
          status: row.status,
          dueAt: row.dueAt,
          completedAt: row.completedAt,
          version: row.version,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }
    return out;
  }

  async updateSpeakerTask(
    id: string,
    patch: {
      status: string;
      version: number;
      updatedAt: string;
      completedAt?: string | null;
    },
  ): Promise<SpeakerTaskRow | null> {
    // Callers always set version = prior + 1; include prior in WHERE for E1 atomicity.
    const expectedVersion = patch.version - 1;
    const set: {
      status: string;
      version: number;
      updatedAt: string;
      completedAt?: string | null;
    } = {
      status: patch.status,
      version: patch.version,
      updatedAt: patch.updatedAt,
    };
    if (patch.completedAt !== undefined) {
      set.completedAt = patch.completedAt;
    }
    const result = await this.db
      .update(speakerTasks)
      .set(set)
      .where(
        and(
          eq(speakerTasks.id, id),
          eq(speakerTasks.version, expectedVersion),
        ),
      );
    if (d1Changes(result) === 0) return null;
    const rows = await this.db
      .select()
      .from(speakerTasks)
      .where(eq(speakerTasks.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      templateId: row.templateId,
      participationId: row.participationId,
      status: row.status,
      dueAt: row.dueAt,
      completedAt: row.completedAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
