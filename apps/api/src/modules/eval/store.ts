/**
 * Eval rounds / criteria / assignments / scores persistence (section 3.4).
 *
 * MemoryEvalStore is the test / local e2e default (no D1 required).
 * D1EvalStore wraps the Worker DB binding for production (E1 SoR).
 * Event-scoped via eval_rounds.event_id (E2).
 */
import { eq, and, inArray } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import {
  createDb,
  buildAuditEventRow,
  type AuditWriteInput,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  evalRounds,
  evalCriteria,
  evalAssignments,
  scores,
  idempotencyKeys,
  auditEvents,
} from "@speakerops/db";

export type EvalRoundRow = {
  id: string;
  eventId: string;
  name: string;
  status: "open" | "closed";
  closesAt: string | null;
  /** Evaluator guidance (plain-text render; post-11.9 depth). */
  instructionsMd?: string | null;
  /** Hide speaker identities from evaluators (0029; default false). */
  hideSpeakers?: boolean;
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
  status: "pending" | "scored" | "abstained";
  overallComment: string | null;
  /** Optional evaluator reason when abstained (post-11.9 depth). */
  abstainReason?: string | null;
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

/**
 * Idempotency row for Eval.BulkAssign commits (shared idempotency_keys table —
 * same shape the comms store uses; kept module-local so eval never imports
 * the comms store).
 */
export type EvalIdempotencyKeyRow = {
  id: string;
  key: string;
  requestHash: string;
  responseJson: string | null;
  createdAt: string;
};

/**
 * Atomic Eval.BulkAssign commit unit: pending-only removals + additions +
 * audit + single-use idempotency claim commit or roll back together.
 */
export type EvalBulkAssignCommitInput = {
  roundId: string;
  /** Assignment ids to delete — pending-only guard enforced in the store. */
  removalAssignmentIds: string[];
  /** New pending assignment rows to insert. */
  additions: EvalAssignmentRow[];
  /** Single-use commit claim (shared idempotency_keys table, unique key). */
  idempotency: EvalIdempotencyKeyRow;
  audit: AuditWriteInput;
};

export type EvalStore = {
  insertRound(row: EvalRoundRow): Promise<EvalRoundRow>;
  updateRound(
    roundId: string,
    patch: {
      name?: string;
      status?: "open" | "closed";
      closesAt?: string | null;
      instructionsMd?: string | null;
      hideSpeakers?: boolean;
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
      status?: "pending" | "scored" | "abstained";
      overallComment?: string | null;
      abstainReason?: string | null;
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
  /**
   * Delete a PENDING assignment only (WHERE id AND status='pending').
   * Scored/abstained rows are never deleted — returns false, row untouched.
   */
  deleteAssignment(assignmentId: string): Promise<boolean>;

  /** Eval.BulkAssign single-use commit — shared idempotency_keys table. */
  findIdempotencyKey(key: string): Promise<EvalIdempotencyKeyRow | null>;
  insertIdempotencyKey(
    row: EvalIdempotencyKeyRow,
  ): Promise<EvalIdempotencyKeyRow>;

  /**
   * Atomic Eval.BulkAssign commit (E7): removals (pending-only) + additions +
   * audit + the single-use idempotency claim are one all-or-nothing unit.
   *
   * **Shared contract (Memory and D1 must both enforce — do not diverge):**
   * - Returns true only when *this* call performed the commit.
   * - Returns false when the idempotency key was already claimed (concurrent
   *   duplicate commit — the key embeds the estate hash, so an existing key is
   *   always the same plan; the caller replays the stored response).
   * - A failure of any part (including the audit write) leaves ZERO rows.
   *
   * D1: single batch — idempotency claim first (unique key aborts the whole
   *     batch for the race loser), then removals/additions/audit_events.
   * Memory: per-key inflight chain; onAudit runs before any map mutates so a
   *     rejected audit commits nothing.
   *
   * @param onAudit Memory/tests: write audit into AuthStore so listAudits
   *   works. D1 ignores this and inserts audit_events inside the same batch.
   */
  commitBulkAssignAtomic(
    input: EvalBulkAssignCommitInput,
    onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<boolean>;

  replaceScores(assignmentId: string, rows: ScoreRow[]): Promise<void>;
  listScores(assignmentId: string): Promise<ScoreRow[]>;
  /**
   * Batch scores for a set of assignments (evaluator queue — avoids N+1
   * listScores per assignment). Assignments without scores map to [].
   */
  listScoresForAssignments(
    assignmentIds: string[],
  ): Promise<Map<string, ScoreRow[]>>;
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
  private idemKeys = new Map<string, EvalIdempotencyKeyRow>();
  /**
   * In-flight bulk-assign commits keyed by idempotency key. Concurrent
   * duplicate commits chain here so exactly one claims the key (D1 parity
   * with the unique idempotency_keys index inside a single batch).
   */
  private inflightBulkCommits = new Map<string, Promise<boolean>>();

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
      instructionsMd?: string | null;
      hideSpeakers?: boolean;
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
      status?: "pending" | "scored" | "abstained";
      overallComment?: string | null;
      abstainReason?: string | null;
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

  async deleteAssignment(assignmentId: string): Promise<boolean> {
    const existing = this.assignments.get(assignmentId);
    if (!existing || existing.status !== "pending") return false;
    this.assignments.delete(assignmentId);
    this.scoreRows.delete(assignmentId);
    return true;
  }

  async findIdempotencyKey(
    key: string,
  ): Promise<EvalIdempotencyKeyRow | null> {
    const row = this.idemKeys.get(key);
    return row ? { ...row } : null;
  }

  async insertIdempotencyKey(
    row: EvalIdempotencyKeyRow,
  ): Promise<EvalIdempotencyKeyRow> {
    // Unique-key parity with D1: never silently overwrite a different hash.
    const existing = this.idemKeys.get(row.key);
    if (existing) {
      if (existing.requestHash !== row.requestHash) {
        throw new Error(`Idempotency key conflict: ${row.key}`);
      }
      return { ...existing };
    }
    this.idemKeys.set(row.key, { ...row });
    return { ...row };
  }

  /**
   * Memory parity with D1 commitBulkAssignAtomic (do not diverge):
   * - Concurrent duplicate commits serialize on a per-key inflight chain so
   *   exactly one performs the writes; the loser returns false.
   * - onAudit is part of the atomic unit: it runs BEFORE any map mutates, so
   *   a rejected audit leaves zero durable rows (retryable).
   * - Removals honor the pending-only delete guard.
   */
  async commitBulkAssignAtomic(
    input: EvalBulkAssignCommitInput,
    onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<boolean> {
    const key = input.idempotency.key;
    const prev = this.inflightBulkCommits.get(key);

    const run = async (): Promise<boolean> => {
      if (prev) {
        try {
          await prev;
        } catch {
          // Prior attempt failed atomically — nothing committed; re-check.
        }
      }
      // Committed single-use claim: the key embeds the estate hash, so an
      // existing row is by construction the same plan → duplicate (false).
      if (this.idemKeys.has(key)) return false;

      // Atomic unit: audit (cross-store in Memory) must succeed before ANY
      // map mutates — a rejected audit commits nothing.
      if (onAudit) await onAudit(input.audit);

      // Commit — synchronous section, no interleaving possible.
      for (const id of input.removalAssignmentIds) {
        const row = this.assignments.get(id);
        if (!row || row.status !== "pending") continue;
        this.assignments.delete(id);
        this.scoreRows.delete(id);
      }
      for (const row of input.additions) {
        this.assignments.set(row.id, { ...row });
      }
      this.idemKeys.set(key, { ...input.idempotency });
      return true;
    };

    const flight = run();
    this.inflightBulkCommits.set(key, flight);
    try {
      return await flight;
    } finally {
      if (this.inflightBulkCommits.get(key) === flight) {
        this.inflightBulkCommits.delete(key);
      }
    }
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

  async listScoresForAssignments(
    assignmentIds: string[],
  ): Promise<Map<string, ScoreRow[]>> {
    const out = new Map<string, ScoreRow[]>();
    for (const id of assignmentIds) {
      out.set(id, (this.scoreRows.get(id) ?? []).map((r) => ({ ...r })));
    }
    return out;
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
    const status =
      row.status === "closed" || row.status === "open" ? row.status : "open";
    return {
      id: row.id,
      eventId: row.eventId,
      name: row.name ?? "",
      status,
      closesAt: row.closesAt ?? null,
      instructionsMd: row.instructionsMd ?? null,
      hideSpeakers: row.hideSpeakers === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapCriterion(row: typeof evalCriteria.$inferSelect): EvalCriterionRow {
    // D1/SQLite REAL/INTEGER can surface as string numerics in some bindings.
    const maxScore = Number(row.maxScore);
    const weight = Number(row.weight);
    const sortOrder = Number(row.sortOrder);
    return {
      id: row.id,
      roundId: row.roundId,
      name: row.name ?? "",
      maxScore: Number.isFinite(maxScore) ? maxScore : 0,
      weight: Number.isFinite(weight) ? weight : 1,
      sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
    };
  }

  private mapAssignment(
    row: typeof evalAssignments.$inferSelect,
  ): EvalAssignmentRow {
    const status =
      row.status === "scored" ||
      row.status === "pending" ||
      row.status === "abstained"
        ? row.status
        : "pending";
    return {
      id: row.id,
      roundId: row.roundId,
      submissionId: row.submissionId,
      evaluatorUserId: row.evaluatorUserId,
      status,
      overallComment: row.overallComment ?? null,
      abstainReason: row.abstainReason ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapScore(row: typeof scores.$inferSelect): ScoreRow {
    const value = Number(row.value);
    return {
      id: row.id,
      assignmentId: row.assignmentId,
      criterionId: row.criterionId,
      value: Number.isFinite(value) ? value : 0,
      comment: row.comment ?? null,
    };
  }

  async insertRound(row: EvalRoundRow): Promise<EvalRoundRow> {
    await this.db.insert(evalRounds).values({
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      status: row.status,
      closesAt: row.closesAt,
      instructionsMd: row.instructionsMd ?? null,
      hideSpeakers: row.hideSpeakers === true ? 1 : 0,
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
      instructionsMd?: string | null;
      hideSpeakers?: boolean;
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
        instructionsMd: next.instructionsMd ?? null,
        hideSpeakers: next.hideSpeakers === true ? 1 : 0,
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
      abstainReason: row.abstainReason ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return row;
  }

  async updateAssignment(
    assignmentId: string,
    patch: {
      status?: "pending" | "scored" | "abstained";
      overallComment?: string | null;
      abstainReason?: string | null;
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
        abstainReason: next.abstainReason ?? null,
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

  async deleteAssignment(assignmentId: string): Promise<boolean> {
    const existing = await this.findAssignmentById(assignmentId);
    if (!existing || existing.status !== "pending") return false;
    // Guarded delete: only a still-pending row is removed (scored survives races).
    await this.db
      .delete(evalAssignments)
      .where(
        and(
          eq(evalAssignments.id, assignmentId),
          eq(evalAssignments.status, "pending"),
        ),
      );
    // Pending assignments carry no scores; clear defensively for hygiene.
    await this.db.delete(scores).where(eq(scores.assignmentId, assignmentId));
    return true;
  }

  async findIdempotencyKey(
    key: string,
  ): Promise<EvalIdempotencyKeyRow | null> {
    const rows = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      key: r.key,
      requestHash: r.requestHash,
      responseJson: r.responseJson,
      createdAt: r.createdAt,
    };
  }

  async insertIdempotencyKey(
    row: EvalIdempotencyKeyRow,
  ): Promise<EvalIdempotencyKeyRow> {
    await this.db.insert(idempotencyKeys).values({
      id: row.id,
      key: row.key,
      requestHash: row.requestHash,
      responseJson: row.responseJson,
      createdAt: row.createdAt,
    });
    return { ...row };
  }

  /**
   * Atomic Eval.BulkAssign commit (E7): one D1 batch = single-use idempotency
   * claim + pending-only removals + additions + audit_events. All-or-nothing —
   * a failure anywhere (including the unique idempotency key for a concurrent
   * duplicate) rolls the whole unit back, so a retry starts clean.
   *
   * The claim INSERT runs FIRST so a duplicate-commit race loser aborts the
   * batch before touching assignments. On that unique-key failure the stored
   * row is re-read: present → false (caller replays the stored response);
   * absent → rethrow (hard failure, nothing committed).
   */
  async commitBulkAssignAtomic(
    input: EvalBulkAssignCommitInput,
    _onAudit?: (row: AuditWriteInput) => Promise<void>,
  ): Promise<boolean> {
    const audit = buildAuditEventRow(input.audit);

    type Statement = Parameters<SpeakerOpsDb["batch"]>[0][number];
    const statements: Statement[] = [
      // Single-use claim first: unique(key) aborts the batch for race losers.
      this.db.insert(idempotencyKeys).values({
        id: input.idempotency.id,
        key: input.idempotency.key,
        requestHash: input.idempotency.requestHash,
        responseJson: input.idempotency.responseJson,
        createdAt: input.idempotency.createdAt,
      }),
    ];
    for (const id of input.removalAssignmentIds) {
      // Pending assignments carry no scores; clear defensively for hygiene.
      statements.push(
        this.db.delete(scores).where(eq(scores.assignmentId, id)),
      );
      // Guarded delete: only a still-pending row is removed.
      statements.push(
        this.db
          .delete(evalAssignments)
          .where(
            and(
              eq(evalAssignments.id, id),
              eq(evalAssignments.status, "pending"),
            ),
          ),
      );
    }
    // D1 bound-parameter limit is 100 per statement — chunk multi-row inserts
    // (9 columns per assignment row → 10 rows per statement).
    const INSERT_CHUNK = 10;
    for (let i = 0; i < input.additions.length; i += INSERT_CHUNK) {
      const slice = input.additions.slice(i, i + INSERT_CHUNK);
      statements.push(
        this.db.insert(evalAssignments).values(
          slice.map((row) => ({
            id: row.id,
            roundId: row.roundId,
            submissionId: row.submissionId,
            evaluatorUserId: row.evaluatorUserId,
            status: row.status,
            overallComment: row.overallComment,
            abstainReason: row.abstainReason ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
        ),
      );
    }
    statements.push(
      this.db.insert(auditEvents).values({
        id: audit.id,
        eventId: audit.eventId ?? null,
        actorType: audit.actorType,
        actorId: audit.actorId,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId,
        beforeJson: audit.beforeJson ?? null,
        afterJson: audit.afterJson ?? null,
        correlationId: audit.correlationId,
        createdAt: audit.createdAt,
      }),
    );

    try {
      await this.db.batch(
        statements as [Statement, ...Statement[]],
      );
    } catch (err) {
      const stored = await this.findIdempotencyKey(input.idempotency.key);
      if (stored) {
        // Concurrent duplicate already committed the same plan (the key
        // embeds the estate hash) — this call performed no writes.
        return false;
      }
      throw err;
    }
    return true;
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

  async listScoresForAssignments(
    assignmentIds: string[],
  ): Promise<Map<string, ScoreRow[]>> {
    const out = new Map<string, ScoreRow[]>();
    if (assignmentIds.length === 0) return out;
    const unique = [...new Set(assignmentIds)];
    for (const id of unique) out.set(id, []);
    // D1 bound-parameter limit is 100 per query — chunk IN lists.
    const CHUNK = 90;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const rows = await this.db
        .select()
        .from(scores)
        .where(inArray(scores.assignmentId, slice));
      for (const r of rows) {
        out.get(r.assignmentId)?.push(this.mapScore(r));
      }
    }
    return out;
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
