/**
 * People + submissions persistence (section 3.3).
 *
 * MemorySubmissionsStore is the test / local e2e default (no D1 required).
 * D1SubmissionsStore wraps the Worker DB binding for production (E1 SoR).
 * Event-scoped queries take eventId (E2).
 */
import { eq, and, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  people,
  submissions,
  submissionAnswers,
  submissionSpeakers,
  idempotencyKeys,
} from "@speakerops/db";
import { d1Changes } from "../auth/store.js";

export type PersonRow = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionRow = {
  id: string;
  eventId: string;
  formVersionId: string;
  title: string;
  category: string | null;
  status: string;
  submittedAt: string;
  version: number;
};

export type SubmissionAnswerRow = {
  id: string;
  submissionId: string;
  fieldKey: string;
  valueJson: string;
};

export type SubmissionSpeakerRow = {
  submissionId: string;
  personId: string;
  isPrimary: boolean;
  sortOrder: number;
  /** Optional "About this speaker" seed fields (Wave 2); null when omitted. */
  bio?: string | null;
  company?: string | null;
  title?: string | null;
};

/**
 * Unique reservation claimed atomically with a submission insert (shared
 * idempotency_keys table) — race-safe per-submitter cap enforcement.
 */
export type SubmissionGuardRow = {
  id: string;
  key: string;
  requestHash: string;
  responseJson: string | null;
  createdAt: string;
};

export type SubmissionsStore = {
  findPersonByOrgEmail(orgId: string, email: string): Promise<PersonRow | null>;
  findPersonById(personId: string): Promise<PersonRow | null>;
  /**
   * Batch person lookup by id (admin speakers list at 150+ scale).
   * Missing ids are omitted from the map.
   */
  listPersonsByIds(personIds: string[]): Promise<Map<string, PersonRow>>;
  insertPerson(row: PersonRow): Promise<PersonRow>;
  updatePersonName(personId: string, name: string, updatedAt: string): Promise<void>;
  insertSubmission(row: SubmissionRow): Promise<SubmissionRow>;
  insertAnswers(rows: SubmissionAnswerRow[]): Promise<void>;
  insertSpeakers(rows: SubmissionSpeakerRow[]): Promise<void>;
  findSubmissionById(submissionId: string): Promise<SubmissionRow | null>;
  /**
   * Batch submission lookup by id (evaluator queue at 30+ assignments).
   * Missing ids are omitted from the map — avoids N+1 findSubmissionById.
   */
  listSubmissionsByIds(
    submissionIds: string[],
  ): Promise<Map<string, SubmissionRow>>;
  /** Event-scoped list (E2) — section 3.4 assign / admin rollup / 3.5 list. */
  listSubmissionsForEvent(eventId: string): Promise<SubmissionRow[]>;
  listAnswers(submissionId: string): Promise<SubmissionAnswerRow[]>;
  listSpeakers(submissionId: string): Promise<SubmissionSpeakerRow[]>;
  /**
   * Batch primary speaker display names for a page of submissions (section 10.1).
   * Avoids N+1 listSpeakers + findPersonById per row on dogfood 150+.
   * Missing speaker → null value for that submission id.
   */
  listPrimarySpeakerNames(
    submissionIds: string[],
  ): Promise<Map<string, string | null>>;
  /**
   * Optimistic status update (E1): WHERE id AND version = expectedVersion.
   * Returns null on version conflict.
   */
  updateSubmission(
    submissionId: string,
    patch: { status: string; version: number },
    expectedVersion: number,
  ): Promise<SubmissionRow | null>;
  /**
   * Update draft title/category/formVersionId with optimistic concurrency (section 10.5).
   * formVersionId re-pins to the published version used for the snapshot rewrite.
   * Returns null on missing row or version conflict.
   */
  updateDraftSubmission(
    submissionId: string,
    patch: {
      title: string;
      category: string | null;
      version: number;
      formVersionId: string;
    },
    expectedVersion: number,
  ): Promise<SubmissionRow | null>;
  /** Replace all answers for a submission (draft re-save). */
  replaceAnswers(
    submissionId: string,
    rows: SubmissionAnswerRow[],
  ): Promise<void>;
  /** Replace all speakers for a submission (draft re-save). */
  replaceSpeakers(
    submissionId: string,
    rows: SubmissionSpeakerRow[],
  ): Promise<void>;
  /** Count submitted rows for event (submission_limit check). */
  countSubmittedForEvent(eventId: string): Promise<number>;
  countSubmittedForFormVersion(formVersionId: string): Promise<number>;
  /**
   * Ids of submitted rows across the given form versions whose primary
   * speaker matches the normalized (lowercase/trimmed) email — per-submitter
   * cap, scoped to the logical FORM (all published versions of one form_id)
   * so "one per person on this form" survives a republish and never counts a
   * different form on the same event. Draft rows never listed; matches any
   * speaker flagged primary.
   */
  listSubmittedIdsByPrimaryEmailForVersions(
    formVersionIds: string[],
    email: string,
  ): Promise<string[]>;
  /**
   * Claimed per-submitter guard requestHashes (= submission ids) for a
   * form + normalized email — every guard row whose key starts with
   * `per-submitter:<formId>:<email>:`. Guards commit atomically WITH their
   * submission, so this is race-visible where the speaker-join count is not.
   */
  listSubmissionGuardHashes(formId: string, email: string): Promise<string[]>;
  /**
   * Insert a submission, atomically claiming an optional unique guard row
   * (shared idempotency_keys table) in the SAME unit — the race-safe
   * per-submitter cap reservation. Returns "guard_conflict" (and inserts
   * NOTHING) when the guard key is already claimed; the caller recomputes the
   * effective count and either 400s or retries with the next slot.
   * guard=null behaves exactly like insertSubmission.
   */
  insertSubmissionWithGuard(
    row: SubmissionRow,
    guard: SubmissionGuardRow | null,
  ): Promise<"inserted" | "guard_conflict">;
};

/** Guard key prefix for one (form, normalized email) pair. */
export function perSubmitterGuardPrefix(
  formId: string,
  normalizedEmail: string,
): string {
  return `per-submitter:${formId}:${normalizedEmail}:`;
}

export function newPersonId(): string {
  return uuidv7();
}

export function newSubmissionId(): string {
  return uuidv7();
}

export function newAnswerId(): string {
  return uuidv7();
}

/**
 * In-memory submissions store — unit tests + e2e without D1.
 */
export class MemorySubmissionsStore implements SubmissionsStore {
  private people = new Map<string, PersonRow>();
  private byOrgEmail = new Map<string, string>();
  private submissions = new Map<string, SubmissionRow>();
  private answers = new Map<string, SubmissionAnswerRow[]>();
  private speakers = new Map<string, SubmissionSpeakerRow[]>();
  /** Claimed per-submitter guard keys (idempotency_keys parity with D1). */
  private guards = new Map<string, SubmissionGuardRow>();

  private orgEmailKey(orgId: string, email: string): string {
    return `${orgId}::${email.toLowerCase()}`;
  }

  async findPersonByOrgEmail(
    orgId: string,
    email: string,
  ): Promise<PersonRow | null> {
    const id = this.byOrgEmail.get(this.orgEmailKey(orgId, email));
    if (!id) return null;
    const row = this.people.get(id);
    return row ? { ...row } : null;
  }

  async findPersonById(personId: string): Promise<PersonRow | null> {
    const row = this.people.get(personId);
    return row ? { ...row } : null;
  }

  async listPersonsByIds(personIds: string[]): Promise<Map<string, PersonRow>> {
    const out = new Map<string, PersonRow>();
    for (const id of personIds) {
      const row = this.people.get(id);
      if (row) out.set(id, { ...row });
    }
    return out;
  }

  async insertPerson(row: PersonRow): Promise<PersonRow> {
    const normalized = { ...row, email: row.email.toLowerCase() };
    this.people.set(normalized.id, normalized);
    this.byOrgEmail.set(
      this.orgEmailKey(normalized.orgId, normalized.email),
      normalized.id,
    );
    return { ...normalized };
  }

  async updatePersonName(
    personId: string,
    name: string,
    updatedAt: string,
  ): Promise<void> {
    const existing = this.people.get(personId);
    if (!existing) return;
    this.people.set(personId, { ...existing, name, updatedAt });
  }

  async insertSubmission(row: SubmissionRow): Promise<SubmissionRow> {
    this.submissions.set(row.id, { ...row });
    return { ...row };
  }

  async insertAnswers(rows: SubmissionAnswerRow[]): Promise<void> {
    for (const row of rows) {
      const list = this.answers.get(row.submissionId) ?? [];
      list.push({ ...row });
      this.answers.set(row.submissionId, list);
    }
  }

  async insertSpeakers(rows: SubmissionSpeakerRow[]): Promise<void> {
    for (const row of rows) {
      const list = this.speakers.get(row.submissionId) ?? [];
      list.push({
        ...row,
        bio: row.bio ?? null,
        company: row.company ?? null,
        title: row.title ?? null,
      });
      this.speakers.set(row.submissionId, list);
    }
  }

  async findSubmissionById(
    submissionId: string,
  ): Promise<SubmissionRow | null> {
    const row = this.submissions.get(submissionId);
    return row ? { ...row } : null;
  }

  async listSubmissionsByIds(
    submissionIds: string[],
  ): Promise<Map<string, SubmissionRow>> {
    const out = new Map<string, SubmissionRow>();
    for (const id of submissionIds) {
      const row = this.submissions.get(id);
      if (row) out.set(id, { ...row });
    }
    return out;
  }

  async listSubmissionsForEvent(eventId: string): Promise<SubmissionRow[]> {
    return [...this.submissions.values()]
      .filter((s) => s.eventId === eventId)
      .map((s) => ({ ...s }));
  }

  async listAnswers(submissionId: string): Promise<SubmissionAnswerRow[]> {
    return (this.answers.get(submissionId) ?? []).map((r) => ({ ...r }));
  }

  async listSpeakers(submissionId: string): Promise<SubmissionSpeakerRow[]> {
    return (this.speakers.get(submissionId) ?? []).map((r) => ({ ...r }));
  }

  async listPrimarySpeakerNames(
    submissionIds: string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    for (const submissionId of submissionIds) {
      const speakers = this.speakers.get(submissionId) ?? [];
      const primary =
        speakers.find((s) => s.isPrimary) ??
        speakers.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0];
      if (!primary) {
        out.set(submissionId, null);
        continue;
      }
      const person = this.people.get(primary.personId);
      out.set(submissionId, person?.name ?? null);
    }
    return out;
  }

  async updateSubmission(
    submissionId: string,
    patch: { status: string; version: number },
    expectedVersion: number,
  ): Promise<SubmissionRow | null> {
    const existing = this.submissions.get(submissionId);
    if (!existing) return null;
    if (existing.version !== expectedVersion) return null;
    const next: SubmissionRow = {
      ...existing,
      status: patch.status,
      version: patch.version,
    };
    this.submissions.set(submissionId, next);
    return { ...next };
  }

  async updateDraftSubmission(
    submissionId: string,
    patch: {
      title: string;
      category: string | null;
      version: number;
      formVersionId: string;
    },
    expectedVersion: number,
  ): Promise<SubmissionRow | null> {
    const existing = this.submissions.get(submissionId);
    if (!existing) return null;
    if (existing.version !== expectedVersion) return null;
    const next: SubmissionRow = {
      ...existing,
      title: patch.title,
      category: patch.category,
      version: patch.version,
      formVersionId: patch.formVersionId,
    };
    this.submissions.set(submissionId, next);
    return { ...next };
  }

  async replaceAnswers(
    submissionId: string,
    rows: SubmissionAnswerRow[],
  ): Promise<void> {
    this.answers.set(
      submissionId,
      rows.map((r) => ({ ...r })),
    );
  }

  async replaceSpeakers(
    submissionId: string,
    rows: SubmissionSpeakerRow[],
  ): Promise<void> {
    this.speakers.set(
      submissionId,
      rows.map((r) => ({
        ...r,
        bio: r.bio ?? null,
        company: r.company ?? null,
        title: r.title ?? null,
      })),
    );
  }

  async countSubmittedForEvent(eventId: string): Promise<number> {
    let n = 0;
    for (const s of this.submissions.values()) {
      if (s.eventId === eventId && s.status === "submitted") n++;
    }
    return n;
  }

  async countSubmittedForFormVersion(formVersionId: string): Promise<number> {
    let n = 0;
    for (const s of this.submissions.values()) {
      if (s.formVersionId === formVersionId && s.status === "submitted") n++;
    }
    return n;
  }

  async listSubmittedIdsByPrimaryEmailForVersions(
    formVersionIds: string[],
    email: string,
  ): Promise<string[]> {
    const versions = new Set(formVersionIds);
    const normalized = email.toLowerCase().trim();
    const ids: string[] = [];
    for (const s of this.submissions.values()) {
      if (!versions.has(s.formVersionId) || s.status !== "submitted") continue;
      const speakerRows = this.speakers.get(s.id) ?? [];
      const primaries = speakerRows.filter((sp) => sp.isPrimary);
      const matched = primaries.some((sp) => {
        const person = this.people.get(sp.personId);
        return person?.email.toLowerCase() === normalized;
      });
      if (matched) ids.push(s.id);
    }
    return ids;
  }

  async listSubmissionGuardHashes(
    formId: string,
    email: string,
  ): Promise<string[]> {
    const prefix = perSubmitterGuardPrefix(formId, email.toLowerCase().trim());
    const out: string[] = [];
    for (const [key, row] of this.guards) {
      if (key.startsWith(prefix)) out.push(row.requestHash);
    }
    return out;
  }

  /**
   * Memory parity with D1 insertSubmissionWithGuard (do not diverge):
   * the guard claim + submission insert happen in one synchronous section, so
   * concurrent callers can never both pass with the same guard key.
   */
  async insertSubmissionWithGuard(
    row: SubmissionRow,
    guard: SubmissionGuardRow | null,
  ): Promise<"inserted" | "guard_conflict"> {
    if (guard) {
      if (this.guards.has(guard.key)) return "guard_conflict";
      this.guards.set(guard.key, { ...guard });
    }
    this.submissions.set(row.id, { ...row });
    return "inserted";
  }
}

/**
 * D1-backed submissions store (production SoR).
 */
export class D1SubmissionsStore implements SubmissionsStore {
  private db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async findPersonByOrgEmail(
    orgId: string,
    email: string,
  ): Promise<PersonRow | null> {
    const rows = await this.db
      .select()
      .from(people)
      .where(
        and(eq(people.orgId, orgId), eq(people.email, email.toLowerCase())),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findPersonById(personId: string): Promise<PersonRow | null> {
    const rows = await this.db
      .select()
      .from(people)
      .where(eq(people.id, personId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listPersonsByIds(personIds: string[]): Promise<Map<string, PersonRow>> {
    const out = new Map<string, PersonRow>();
    if (personIds.length === 0) return out;
    const unique = [...new Set(personIds)];
    // D1 bound-parameter limit is 100 per query — chunk IN lists (dogfood 150+).
    const CHUNK = 90;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const rows = await this.db
        .select()
        .from(people)
        .where(inArray(people.id, slice));
      for (const row of rows) {
        out.set(row.id, {
          id: row.id,
          orgId: row.orgId,
          email: row.email,
          name: row.name,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }
    return out;
  }

  async insertPerson(row: PersonRow): Promise<PersonRow> {
    const normalized = { ...row, email: row.email.toLowerCase() };
    await this.db.insert(people).values({
      id: normalized.id,
      orgId: normalized.orgId,
      email: normalized.email,
      name: normalized.name,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
    });
    return normalized;
  }

  async updatePersonName(
    personId: string,
    name: string,
    updatedAt: string,
  ): Promise<void> {
    await this.db
      .update(people)
      .set({ name, updatedAt })
      .where(eq(people.id, personId));
  }

  async insertSubmission(row: SubmissionRow): Promise<SubmissionRow> {
    await this.db.insert(submissions).values({
      id: row.id,
      eventId: row.eventId,
      formVersionId: row.formVersionId,
      title: row.title,
      category: row.category,
      status: row.status,
      submittedAt: row.submittedAt,
      version: row.version,
    });
    return row;
  }

  async insertAnswers(rows: SubmissionAnswerRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(submissionAnswers).values(
      rows.map((r) => ({
        id: r.id,
        submissionId: r.submissionId,
        fieldKey: r.fieldKey,
        valueJson: r.valueJson,
      })),
    );
  }

  async insertSpeakers(rows: SubmissionSpeakerRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(submissionSpeakers).values(
      rows.map((r) => ({
        submissionId: r.submissionId,
        personId: r.personId,
        isPrimary: r.isPrimary ? 1 : 0,
        sortOrder: r.sortOrder,
        bio: r.bio ?? null,
        company: r.company ?? null,
        title: r.title ?? null,
      })),
    );
  }

  async findSubmissionById(
    submissionId: string,
  ): Promise<SubmissionRow | null> {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      eventId: row.eventId,
      formVersionId: row.formVersionId,
      title: row.title,
      category: row.category,
      status: row.status,
      submittedAt: row.submittedAt,
      version: row.version,
    };
  }

  async listSubmissionsByIds(
    submissionIds: string[],
  ): Promise<Map<string, SubmissionRow>> {
    const out = new Map<string, SubmissionRow>();
    if (submissionIds.length === 0) return out;
    const unique = [...new Set(submissionIds)];
    // D1 bound-parameter limit is 100 per query — chunk IN lists.
    const CHUNK = 90;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const rows = await this.db
        .select()
        .from(submissions)
        .where(inArray(submissions.id, slice));
      for (const row of rows) {
        out.set(row.id, {
          id: row.id,
          eventId: row.eventId,
          formVersionId: row.formVersionId,
          title: row.title,
          category: row.category,
          status: row.status,
          submittedAt: row.submittedAt,
          version: row.version,
        });
      }
    }
    return out;
  }

  async listSubmissionsForEvent(eventId: string): Promise<SubmissionRow[]> {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, eventId));
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      formVersionId: row.formVersionId,
      title: row.title,
      category: row.category,
      status: row.status,
      submittedAt: row.submittedAt,
      version: row.version,
    }));
  }

  async listAnswers(submissionId: string): Promise<SubmissionAnswerRow[]> {
    const rows = await this.db
      .select()
      .from(submissionAnswers)
      .where(eq(submissionAnswers.submissionId, submissionId));
    return rows.map((r) => ({
      id: r.id,
      submissionId: r.submissionId,
      fieldKey: r.fieldKey,
      valueJson: r.valueJson,
    }));
  }

  async listSpeakers(submissionId: string): Promise<SubmissionSpeakerRow[]> {
    const rows = await this.db
      .select()
      .from(submissionSpeakers)
      .where(eq(submissionSpeakers.submissionId, submissionId));
    return rows.map((r) => ({
      submissionId: r.submissionId,
      personId: r.personId,
      isPrimary: r.isPrimary === 1,
      sortOrder: r.sortOrder,
      bio: r.bio ?? null,
      company: r.company ?? null,
      title: r.title ?? null,
    }));
  }

  async listPrimarySpeakerNames(
    submissionIds: string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (submissionIds.length === 0) return out;
    for (const id of submissionIds) out.set(id, null);

    // D1 bound-parameter limit is 100 per query — chunk IN lists. The q search
    // path passes every filtered row id (not just a page), so an unchunked
    // inArray 500s on dogfood 150+ (live `?q=` regression).
    const CHUNK = 90;
    const uniqueIds = [...new Set(submissionIds)];
    const speakerRows: Array<typeof submissionSpeakers.$inferSelect> = [];
    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const slice = uniqueIds.slice(i, i + CHUNK);
      const rows = await this.db
        .select()
        .from(submissionSpeakers)
        .where(inArray(submissionSpeakers.submissionId, slice));
      speakerRows.push(...rows);
    }

    // Prefer is_primary=1; otherwise lowest sort_order per submission.
    const best = new Map<
      string,
      { personId: string; isPrimary: boolean; sortOrder: number }
    >();
    for (const r of speakerRows) {
      const candidate = {
        personId: r.personId,
        isPrimary: r.isPrimary === 1,
        sortOrder: r.sortOrder,
      };
      const prev = best.get(r.submissionId);
      if (!prev) {
        best.set(r.submissionId, candidate);
        continue;
      }
      if (candidate.isPrimary && !prev.isPrimary) {
        best.set(r.submissionId, candidate);
        continue;
      }
      if (candidate.isPrimary === prev.isPrimary && candidate.sortOrder < prev.sortOrder) {
        best.set(r.submissionId, candidate);
      }
    }

    const personIds = [...new Set([...best.values()].map((b) => b.personId))];
    if (personIds.length === 0) return out;

    const nameById = new Map<string, string>();
    for (let i = 0; i < personIds.length; i += CHUNK) {
      const slice = personIds.slice(i, i + CHUNK);
      const personRows = await this.db
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(inArray(people.id, slice));
      for (const p of personRows) nameById.set(p.id, p.name);
    }

    for (const [submissionId, b] of best) {
      out.set(submissionId, nameById.get(b.personId) ?? null);
    }
    return out;
  }

  async updateSubmission(
    submissionId: string,
    patch: { status: string; version: number },
    expectedVersion: number,
  ): Promise<SubmissionRow | null> {
    // Optimistic concurrency: must verify the UPDATE affected a row.
    // Post-update read matching patch.version/status is insufficient — a
    // concurrent request can advance to the same target and make a no-op
    // UPDATE look successful (false 200 instead of 409).
    const result = await this.db
      .update(submissions)
      .set({
        status: patch.status,
        version: patch.version,
      })
      .where(
        and(
          eq(submissions.id, submissionId),
          eq(submissions.version, expectedVersion),
        ),
      );
    if (d1Changes(result) === 0) {
      return null;
    }
    return this.findSubmissionById(submissionId);
  }

  async updateDraftSubmission(
    submissionId: string,
    patch: {
      title: string;
      category: string | null;
      version: number;
      formVersionId: string;
    },
    expectedVersion: number,
  ): Promise<SubmissionRow | null> {
    const result = await this.db
      .update(submissions)
      .set({
        title: patch.title,
        category: patch.category,
        version: patch.version,
        formVersionId: patch.formVersionId,
      })
      .where(
        and(
          eq(submissions.id, submissionId),
          eq(submissions.version, expectedVersion),
        ),
      );
    if (d1Changes(result) === 0) {
      return null;
    }
    return this.findSubmissionById(submissionId);
  }

  async replaceAnswers(
    submissionId: string,
    rows: SubmissionAnswerRow[],
  ): Promise<void> {
    await this.db
      .delete(submissionAnswers)
      .where(eq(submissionAnswers.submissionId, submissionId));
    if (rows.length === 0) return;
    await this.db.insert(submissionAnswers).values(
      rows.map((r) => ({
        id: r.id,
        submissionId: r.submissionId,
        fieldKey: r.fieldKey,
        valueJson: r.valueJson,
      })),
    );
  }

  async replaceSpeakers(
    submissionId: string,
    rows: SubmissionSpeakerRow[],
  ): Promise<void> {
    await this.db
      .delete(submissionSpeakers)
      .where(eq(submissionSpeakers.submissionId, submissionId));
    if (rows.length === 0) return;
    await this.db.insert(submissionSpeakers).values(
      rows.map((r) => ({
        submissionId: r.submissionId,
        personId: r.personId,
        isPrimary: r.isPrimary ? 1 : 0,
        sortOrder: r.sortOrder,
        bio: r.bio ?? null,
        company: r.company ?? null,
        title: r.title ?? null,
      })),
    );
  }

  async countSubmittedForEvent(eventId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(
        and(eq(submissions.eventId, eventId), eq(submissions.status, "submitted")),
      );
    return rows.length;
  }

  async countSubmittedForFormVersion(formVersionId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.formVersionId, formVersionId),
          eq(submissions.status, "submitted"),
        ),
      );
    return rows.length;
  }

  async listSubmittedIdsByPrimaryEmailForVersions(
    formVersionIds: string[],
    email: string,
  ): Promise<string[]> {
    if (formVersionIds.length === 0) return [];
    const normalized = email.toLowerCase().trim();
    const unique = [...new Set(formVersionIds)];
    const matched = new Set<string>();
    // D1 bound-parameter limit is 100 per query — chunk IN lists.
    const CHUNK = 90;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const rows = await this.db
        .select({ id: submissions.id })
        .from(submissions)
        .innerJoin(
          submissionSpeakers,
          eq(submissionSpeakers.submissionId, submissions.id),
        )
        .innerJoin(people, eq(people.id, submissionSpeakers.personId))
        .where(
          and(
            inArray(submissions.formVersionId, slice),
            eq(submissions.status, "submitted"),
            eq(submissionSpeakers.isPrimary, 1),
            eq(people.email, normalized),
          ),
        );
      for (const r of rows) matched.add(r.id);
    }
    // Defensive distinct — a submission with duplicated primary rows counts once.
    return [...matched];
  }

  async listSubmissionGuardHashes(
    formId: string,
    email: string,
  ): Promise<string[]> {
    const prefix = perSubmitterGuardPrefix(formId, email.toLowerCase().trim());
    // Escape LIKE wildcards in the prefix (emails may contain "_" / "%").
    const escaped = prefix.replace(/([\\%_])/g, "\\$1");
    const rows = await this.db
      .select({ requestHash: idempotencyKeys.requestHash })
      .from(idempotencyKeys)
      .where(sql`${idempotencyKeys.key} LIKE ${`${escaped}%`} ESCAPE '\\'`);
    return rows.map((r) => r.requestHash);
  }

  /**
   * Guard claim + submission insert in ONE D1 batch: the unique
   * idempotency_keys.key aborts the whole batch (rollback) for a concurrent
   * duplicate, so the loser inserts nothing — race-safe per-submitter cap.
   */
  async insertSubmissionWithGuard(
    row: SubmissionRow,
    guard: SubmissionGuardRow | null,
  ): Promise<"inserted" | "guard_conflict"> {
    if (!guard) {
      await this.insertSubmission(row);
      return "inserted";
    }
    try {
      await this.db.batch([
        // Guard first: unique(key) aborts the batch for race losers.
        this.db.insert(idempotencyKeys).values({
          id: guard.id,
          key: guard.key,
          requestHash: guard.requestHash,
          responseJson: guard.responseJson,
          createdAt: guard.createdAt,
        }),
        this.db.insert(submissions).values({
          id: row.id,
          eventId: row.eventId,
          formVersionId: row.formVersionId,
          title: row.title,
          category: row.category,
          status: row.status,
          submittedAt: row.submittedAt,
          version: row.version,
        }),
      ]);
    } catch (err) {
      // Classify: a stored guard row means a concurrent claim won (the batch
      // rolled back — this submission was NOT inserted). Anything else is a
      // hard failure, also with zero rows committed.
      const stored = await this.db
        .select({ key: idempotencyKeys.key })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, guard.key))
        .limit(1);
      if (stored[0]) return "guard_conflict";
      throw err;
    }
    return "inserted";
  }
}
