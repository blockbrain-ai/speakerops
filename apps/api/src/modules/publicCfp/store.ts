/**
 * People + submissions persistence (section 3.3).
 *
 * MemorySubmissionsStore is the test / local e2e default (no D1 required).
 * D1SubmissionsStore wraps the Worker DB binding for production (E1 SoR).
 * Event-scoped queries take eventId (E2).
 */
import { eq, and } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  people,
  submissions,
  submissionAnswers,
  submissionSpeakers,
} from "@speakerops/db";

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
};

export type SubmissionsStore = {
  findPersonByOrgEmail(orgId: string, email: string): Promise<PersonRow | null>;
  insertPerson(row: PersonRow): Promise<PersonRow>;
  updatePersonName(personId: string, name: string, updatedAt: string): Promise<void>;
  insertSubmission(row: SubmissionRow): Promise<SubmissionRow>;
  insertAnswers(rows: SubmissionAnswerRow[]): Promise<void>;
  insertSpeakers(rows: SubmissionSpeakerRow[]): Promise<void>;
  findSubmissionById(submissionId: string): Promise<SubmissionRow | null>;
  listAnswers(submissionId: string): Promise<SubmissionAnswerRow[]>;
  listSpeakers(submissionId: string): Promise<SubmissionSpeakerRow[]>;
  /** Count submitted rows for event (submission_limit check). */
  countSubmittedForEvent(eventId: string): Promise<number>;
  countSubmittedForFormVersion(formVersionId: string): Promise<number>;
};

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
      list.push({ ...row });
      this.speakers.set(row.submissionId, list);
    }
  }

  async findSubmissionById(
    submissionId: string,
  ): Promise<SubmissionRow | null> {
    const row = this.submissions.get(submissionId);
    return row ? { ...row } : null;
  }

  async listAnswers(submissionId: string): Promise<SubmissionAnswerRow[]> {
    return (this.answers.get(submissionId) ?? []).map((r) => ({ ...r }));
  }

  async listSpeakers(submissionId: string): Promise<SubmissionSpeakerRow[]> {
    return (this.speakers.get(submissionId) ?? []).map((r) => ({ ...r }));
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
    }));
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
}
