/**
 * Eval rounds / criteria / assignments / scores persistence (section 3.4).
 *
 * MemoryEvalStore is the test / local e2e default (no D1 required).
 * D1EvalStore wraps the Worker DB binding for production (E1 SoR).
 * Event-scoped via eval_rounds.event_id (E2).
 */
import { eq, and } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  evalRounds,
  evalCriteria,
  evalAssignments,
  scores,
} from "@speakerops/db";

export type EvalRoundRow = {
  id: string;
  eventId: string;
  name: string;
  status: "open" | "closed";
  closesAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EvalCriterionRow = {
  id: string;
  roundId: string;
  name: string;
  maxScore: number;
  weight: number;
  sortOrder: number;
};

export type EvalAssignmentRow = {
  id: string;
  roundId: string;
  submissionId: string;
  evaluatorUserId: string;
  status: "pending" | "scored";
  overallComment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScoreRow = {
  id: string;
  assignmentId: string;
  criterionId: string;
  value: number;
  comment: string | null;
};

export type EvalStore = {
  insertRound(row: EvalRoundRow): Promise<EvalRoundRow>;
  updateRound(
    roundId: string,
    patch: {
      name?: string;
      status?: "open" | "closed";
      closesAt?: string | null;
      updatedAt: string;
    },
  ): Promise<EvalRoundRow | null>;
  findRoundById(roundId: string): Promise<EvalRoundRow | null>;
  /** Active (prefer open) round for event — most recently updated. */
  findActiveRoundForEvent(eventId: string): Promise<EvalRoundRow | null>;
  listRoundsForEvent(eventId: string): Promise<EvalRoundRow[]>;

  replaceCriteria(
    roundId: string,
    criteria: EvalCriterionRow[],
  ): Promise<void>;
  listCriteria(roundId: string): Promise<EvalCriterionRow[]>;
  findCriterionById(criterionId: string): Promise<EvalCriterionRow | null>;

  insertAssignment(row: EvalAssignmentRow): Promise<EvalAssignmentRow>;
  updateAssignment(
    assignmentId: string,
    patch: {
      status?: "pending" | "scored";
      overallComment?: string | null;
      updatedAt: string;
    },
  ): Promise<EvalAssignmentRow | null>;
  findAssignmentById(assignmentId: string): Promise<EvalAssignmentRow | null>;
  findAssignment(
    roundId: string,
    submissionId: string,
    evaluatorUserId: string,
  ): Promise<EvalAssignmentRow | null>;
  listAssignmentsForEvaluator(evaluatorUserId: string): Promise<EvalAssignmentRow[]>;
  listAssignmentsForRound(roundId: string): Promise<EvalAssignmentRow[]>;
  listAssignmentsForSubmission(submissionId: string): Promise<EvalAssignmentRow[]>;

  replaceScores(assignmentId: string, rows: ScoreRow[]): Promise<void>;
  listScores(assignmentId: string): Promise<ScoreRow[]>;
  countScoresForRound(roundId: string): Promise<number>;
};

export function newEvalRoundId(): string {
  return uuidv7();
}
export function newEvalCriterionId(): string {
  return uuidv7();
}
export function newEvalAssignmentId(): string {
  return uuidv7();
}
export function newScoreId(): string {
  return uuidv7();
}

/**
 * In-memory eval store — unit tests + e2e without D1.
 */
export class MemoryEvalStore implements EvalStore {
  private rounds = new Map<string, EvalRoundRow>();
  private criteria = new Map<string, EvalCriterionRow[]>();
  private assignments = new Map<string, EvalAssignmentRow>();
  private scoreRows = new Map<string, ScoreRow[]>();

  async insertRound(row: EvalRoundRow): Promise<EvalRoundRow> {
    const copy = { ...row };
    this.rounds.set(row.id, copy);
    return { ...copy };
  }

  async updateRound(
    roundId: string,
    patch: {
      name?: string;
      status?: "open" | "closed";
      closesAt?: string | null;
      updatedAt: string;
    },
  ): Promise<EvalRoundRow | null> {
    const existing = this.rounds.get(roundId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.rounds.set(roundId, next);
    return { ...next };
  }

  async findRoundById(roundId: string): Promise<EvalRoundRow | null> {
    const row = this.rounds.get(roundId);
    return row ? { ...row } : null;
  }

  async findActiveRoundForEvent(eventId: string): Promise<EvalRoundRow | null> {
    const list = [...this.rounds.values()]
      .filter((r) => r.eventId === eventId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const open = list.find((r) => r.status === "open");
    return open ? { ...open } : list[0] ? { ...list[0] } : null;
  }

  async listRoundsForEvent(eventId: string): Promise<EvalRoundRow[]> {
    return [...this.rounds.values()]
      .filter((r) => r.eventId === eventId)
      .map((r) => ({ ...r }));
  }

  async replaceCriteria(
    roundId: string,
    criteria: EvalCriterionRow[],
  ): Promise<void> {
    this.criteria.set(
      roundId,
      criteria.map((c) => ({ ...c })),
    );
  }

  async listCriteria(roundId: string): Promise<EvalCriterionRow[]> {
    return (this.criteria.get(roundId) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ ...c }));
  }

  async findCriterionById(criterionId: string): Promise<EvalCriterionRow | null> {
    for (const list of this.criteria.values()) {
      const found = list.find((c) => c.id === criterionId);
      if (found) return { ...found };
    }
    return null;
  }

  async insertAssignment(row: EvalAssignmentRow): Promise<EvalAssignmentRow> {
    const copy = { ...row };
    this.assignments.set(row.id, copy);
    return { ...copy };
  }

  async updateAssignment(
    assignmentId: string,
    patch: {
      status?: "pending" | "scored";
      overallComment?: string | null;
      updatedAt: string;
    },
  ): Promise<EvalAssignmentRow | null> {
    const existing = this.assignments.get(assignmentId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.assignments.set(assignmentId, next);
    return { ...next };
  }

  async findAssignmentById(
    assignmentId: string,
  ): Promise<EvalAssignmentRow | null> {
    const row = this.assignments.get(assignmentId);
    return row ? { ...row } : null;
  }

  async findAssignment(
    roundId: string,
    submissionId: string,
    evaluatorUserId: string,
  ): Promise<EvalAssignmentRow | null> {
    for (const row of this.assignments.values()) {
      if (
        row.roundId === roundId &&
        row.submissionId === submissionId &&
        row.evaluatorUserId === evaluatorUserId
      ) {
        return { ...row };
      }
    }
    return null;
  }

  async listAssignmentsForEvaluator(
    evaluatorUserId: string,
  ): Promise<EvalAssignmentRow[]> {
    return [...this.assignments.values()]
      .filter((a) => a.evaluatorUserId === evaluatorUserId)
      .map((a) => ({ ...a }));
  }

  async listAssignmentsForRound(roundId: string): Promise<EvalAssignmentRow[]> {
    return [...this.assignments.values()]
      .filter((a) => a.roundId === roundId)
      .map((a) => ({ ...a }));
  }

  async listAssignmentsForSubmission(
    submissionId: string,
  ): Promise<EvalAssignmentRow[]> {
    return [...this.assignments.values()]
      .filter((a) => a.submissionId === submissionId)
      .map((a) => ({ ...a }));
  }

  async replaceScores(assignmentId: string, rows: ScoreRow[]): Promise<void> {
    this.scoreRows.set(
      assignmentId,
      rows.map((r) => ({ ...r })),
    );
  }

  async listScores(assignmentId: string): Promise<ScoreRow[]> {
    return (this.scoreRows.get(assignmentId) ?? []).map((r) => ({ ...r }));
  }

  async countScoresForRound(roundId: string): Promise<number> {
    let n = 0;
    for (const a of this.assignments.values()) {
      if (a.roundId !== roundId) continue;
      n += (this.scoreRows.get(a.id) ?? []).length;
    }
    return n;
  }
}

/**
 * D1-backed eval store (production SoR).
 */
export class D1EvalStore implements EvalStore {
  private db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  private mapRound(row: typeof evalRounds.$inferSelect): EvalRoundRow {
    return {
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      status: row.status as "open" | "closed",
      closesAt: row.closesAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapCriterion(row: typeof evalCriteria.$inferSelect): EvalCriterionRow {
    return {
      id: row.id,
      roundId: row.roundId,
      name: row.name,
      maxScore: row.maxScore,
      weight: row.weight,
      sortOrder: row.sortOrder,
    };
  }

  private mapAssignment(
    row: typeof evalAssignments.$inferSelect,
  ): EvalAssignmentRow {
    return {
      id: row.id,
      roundId: row.roundId,
      submissionId: row.submissionId,
      evaluatorUserId: row.evaluatorUserId,
      status: row.status as "pending" | "scored",
      overallComment: row.overallComment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapScore(row: typeof scores.$inferSelect): ScoreRow {
    return {
      id: row.id,
      assignmentId: row.assignmentId,
      criterionId: row.criterionId,
      value: row.value,
      comment: row.comment,
    };
  }

  async insertRound(row: EvalRoundRow): Promise<EvalRoundRow> {
    await this.db.insert(evalRounds).values({
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      status: row.status,
      closesAt: row.closesAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return row;
  }

  async updateRound(
    roundId: string,
    patch: {
      name?: string;
      status?: "open" | "closed";
      closesAt?: string | null;
      updatedAt: string;
    },
  ): Promise<EvalRoundRow | null> {
    const existing = await this.findRoundById(roundId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    await this.db
      .update(evalRounds)
      .set({
        name: next.name,
        status: next.status,
        closesAt: next.closesAt,
        updatedAt: next.updatedAt,
      })
      .where(eq(evalRounds.id, roundId));
    return next;
  }

  async findRoundById(roundId: string): Promise<EvalRoundRow | null> {
    const rows = await this.db
      .select()
      .from(evalRounds)
      .where(eq(evalRounds.id, roundId))
      .limit(1);
    return rows[0] ? this.mapRound(rows[0]) : null;
  }

  async findActiveRoundForEvent(eventId: string): Promise<EvalRoundRow | null> {
    const rows = await this.db
      .select()
      .from(evalRounds)
      .where(eq(evalRounds.eventId, eventId));
    const list = rows
      .map((r) => this.mapRound(r))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const open = list.find((r) => r.status === "open");
    return open ?? list[0] ?? null;
  }

  async listRoundsForEvent(eventId: string): Promise<EvalRoundRow[]> {
    const rows = await this.db
      .select()
      .from(evalRounds)
      .where(eq(evalRounds.eventId, eventId));
    return rows.map((r) => this.mapRound(r));
  }

  async replaceCriteria(
    roundId: string,
    criteria: EvalCriterionRow[],
  ): Promise<void> {
    await this.db
      .delete(evalCriteria)
      .where(eq(evalCriteria.roundId, roundId));
    if (criteria.length === 0) return;
    await this.db.insert(evalCriteria).values(
      criteria.map((c) => ({
        id: c.id,
        roundId: c.roundId,
        name: c.name,
        maxScore: c.maxScore,
        weight: c.weight,
        sortOrder: c.sortOrder,
      })),
    );
  }

  async listCriteria(roundId: string): Promise<EvalCriterionRow[]> {
    const rows = await this.db
      .select()
      .from(evalCriteria)
      .where(eq(evalCriteria.roundId, roundId));
    return rows
      .map((r) => this.mapCriterion(r))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async findCriterionById(criterionId: string): Promise<EvalCriterionRow | null> {
    const rows = await this.db
      .select()
      .from(evalCriteria)
      .where(eq(evalCriteria.id, criterionId))
      .limit(1);
    return rows[0] ? this.mapCriterion(rows[0]) : null;
  }

  async insertAssignment(row: EvalAssignmentRow): Promise<EvalAssignmentRow> {
    await this.db.insert(evalAssignments).values({
      id: row.id,
      roundId: row.roundId,
      submissionId: row.submissionId,
      evaluatorUserId: row.evaluatorUserId,
      status: row.status,
      overallComment: row.overallComment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return row;
  }

  async updateAssignment(
    assignmentId: string,
    patch: {
      status?: "pending" | "scored";
      overallComment?: string | null;
      updatedAt: string;
    },
  ): Promise<EvalAssignmentRow | null> {
    const existing = await this.findAssignmentById(assignmentId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    await this.db
      .update(evalAssignments)
      .set({
        status: next.status,
        overallComment: next.overallComment,
        updatedAt: next.updatedAt,
      })
      .where(eq(evalAssignments.id, assignmentId));
    return next;
  }

  async findAssignmentById(
    assignmentId: string,
  ): Promise<EvalAssignmentRow | null> {
    const rows = await this.db
      .select()
      .from(evalAssignments)
      .where(eq(evalAssignments.id, assignmentId))
      .limit(1);
    return rows[0] ? this.mapAssignment(rows[0]) : null;
  }

  async findAssignment(
    roundId: string,
    submissionId: string,
    evaluatorUserId: string,
  ): Promise<EvalAssignmentRow | null> {
    const rows = await this.db
      .select()
      .from(evalAssignments)
      .where(
        and(
          eq(evalAssignments.roundId, roundId),
          eq(evalAssignments.submissionId, submissionId),
          eq(evalAssignments.evaluatorUserId, evaluatorUserId),
        ),
      )
      .limit(1);
    return rows[0] ? this.mapAssignment(rows[0]) : null;
  }

  async listAssignmentsForEvaluator(
    evaluatorUserId: string,
  ): Promise<EvalAssignmentRow[]> {
    const rows = await this.db
      .select()
      .from(evalAssignments)
      .where(eq(evalAssignments.evaluatorUserId, evaluatorUserId));
    return rows.map((r) => this.mapAssignment(r));
  }

  async listAssignmentsForRound(roundId: string): Promise<EvalAssignmentRow[]> {
    const rows = await this.db
      .select()
      .from(evalAssignments)
      .where(eq(evalAssignments.roundId, roundId));
    return rows.map((r) => this.mapAssignment(r));
  }

  async listAssignmentsForSubmission(
    submissionId: string,
  ): Promise<EvalAssignmentRow[]> {
    const rows = await this.db
      .select()
      .from(evalAssignments)
      .where(eq(evalAssignments.submissionId, submissionId));
    return rows.map((r) => this.mapAssignment(r));
  }

  async replaceScores(assignmentId: string, rows: ScoreRow[]): Promise<void> {
    await this.db
      .delete(scores)
      .where(eq(scores.assignmentId, assignmentId));
    if (rows.length === 0) return;
    await this.db.insert(scores).values(
      rows.map((r) => ({
        id: r.id,
        assignmentId: r.assignmentId,
        criterionId: r.criterionId,
        value: r.value,
        comment: r.comment,
      })),
    );
  }

  async listScores(assignmentId: string): Promise<ScoreRow[]> {
    const rows = await this.db
      .select()
      .from(scores)
      .where(eq(scores.assignmentId, assignmentId));
    return rows.map((r) => this.mapScore(r));
  }

  async countScoresForRound(roundId: string): Promise<number> {
    const assignments = await this.listAssignmentsForRound(roundId);
    let n = 0;
    for (const a of assignments) {
      const list = await this.listScores(a.id);
      n += list.length;
    }
    return n;
  }
}
