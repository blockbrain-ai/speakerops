/**
 * N1 portal forms persistence — memory + D1.
 */
import { and, eq } from "drizzle-orm";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  portalForms,
  portalFormResponses,
} from "@speakerops/db";

export type PortalFormRow = {
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  scope: "participation";
  status: "draft" | "published" | "archived";
  fieldsJson: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PortalFormResponseRow = {
  id: string;
  formId: string;
  eventId: string;
  participationId: string;
  answersJson: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PortalFormsStore = {
  listForms(eventId: string): Promise<PortalFormRow[]>;
  getForm(eventId: string, formId: string): Promise<PortalFormRow | null>;
  insertForm(row: PortalFormRow): Promise<PortalFormRow>;
  updateForm(
    eventId: string,
    formId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        PortalFormRow,
        "title" | "description" | "status" | "fieldsJson" | "updatedAt"
      >
    >,
  ): Promise<PortalFormRow | null>;
  deleteForm(eventId: string, formId: string): Promise<boolean>;
  getResponse(
    formId: string,
    participationId: string,
  ): Promise<PortalFormResponseRow | null>;
  upsertResponse(row: PortalFormResponseRow): Promise<PortalFormResponseRow>;
};

export class MemoryPortalFormsStore implements PortalFormsStore {
  private forms = new Map<string, PortalFormRow>();
  private responses = new Map<string, PortalFormResponseRow>();

  private formKey(eventId: string, formId: string) {
    return `${eventId}\0${formId}`;
  }
  private respKey(formId: string, participationId: string) {
    return `${formId}\0${participationId}`;
  }

  async listForms(eventId: string): Promise<PortalFormRow[]> {
    return [...this.forms.values()]
      .filter((f) => f.eventId === eventId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getForm(
    eventId: string,
    formId: string,
  ): Promise<PortalFormRow | null> {
    return this.forms.get(this.formKey(eventId, formId)) ?? null;
  }

  async insertForm(row: PortalFormRow): Promise<PortalFormRow> {
    this.forms.set(this.formKey(row.eventId, row.id), { ...row });
    return { ...row };
  }

  async updateForm(
    eventId: string,
    formId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        PortalFormRow,
        "title" | "description" | "status" | "fieldsJson" | "updatedAt"
      >
    >,
  ): Promise<PortalFormRow | null> {
    const existing = this.forms.get(this.formKey(eventId, formId));
    if (!existing || existing.version !== expectedVersion) return null;
    // Only apply defined patch keys — never clobber with undefined.
    const next: PortalFormRow = {
      ...existing,
      version: existing.version + 1,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.fieldsJson !== undefined
        ? { fieldsJson: patch.fieldsJson }
        : {}),
      ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
    };
    this.forms.set(this.formKey(eventId, formId), next);
    return { ...next };
  }

  async deleteForm(eventId: string, formId: string): Promise<boolean> {
    return this.forms.delete(this.formKey(eventId, formId));
  }

  async getResponse(
    formId: string,
    participationId: string,
  ): Promise<PortalFormResponseRow | null> {
    return this.responses.get(this.respKey(formId, participationId)) ?? null;
  }

  async upsertResponse(
    row: PortalFormResponseRow,
  ): Promise<PortalFormResponseRow> {
    this.responses.set(this.respKey(row.formId, row.participationId), {
      ...row,
    });
    return { ...row };
  }
}

export class D1PortalFormsStore implements PortalFormsStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  private mapForm(r: typeof portalForms.$inferSelect): PortalFormRow {
    return {
      id: r.id,
      eventId: r.eventId,
      title: r.title,
      description: r.description ?? null,
      scope: "participation",
      status: r.status as PortalFormRow["status"],
      fieldsJson: r.fieldsJson,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      version: r.version,
    };
  }

  private mapResp(
    r: typeof portalFormResponses.$inferSelect,
  ): PortalFormResponseRow {
    return {
      id: r.id,
      formId: r.formId,
      eventId: r.eventId,
      participationId: r.participationId,
      answersJson: r.answersJson,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      version: r.version,
    };
  }

  async listForms(eventId: string): Promise<PortalFormRow[]> {
    const rows = await this.db
      .select()
      .from(portalForms)
      .where(eq(portalForms.eventId, eventId));
    return rows
      .map((r) => this.mapForm(r))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getForm(
    eventId: string,
    formId: string,
  ): Promise<PortalFormRow | null> {
    const rows = await this.db
      .select()
      .from(portalForms)
      .where(
        and(eq(portalForms.eventId, eventId), eq(portalForms.id, formId)),
      )
      .limit(1);
    const row = rows[0];
    return row ? this.mapForm(row) : null;
  }

  async insertForm(row: PortalFormRow): Promise<PortalFormRow> {
    await this.db.insert(portalForms).values({
      id: row.id,
      eventId: row.eventId,
      title: row.title,
      description: row.description,
      scope: row.scope,
      status: row.status,
      fieldsJson: row.fieldsJson,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
    return row;
  }

  async updateForm(
    eventId: string,
    formId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        PortalFormRow,
        "title" | "description" | "status" | "fieldsJson" | "updatedAt"
      >
    >,
  ): Promise<PortalFormRow | null> {
    const existing = await this.getForm(eventId, formId);
    if (!existing || existing.version !== expectedVersion) return null;
    const nextVersion = existing.version + 1;
    await this.db
      .update(portalForms)
      .set({
        title: patch.title ?? existing.title,
        description:
          patch.description !== undefined
            ? patch.description
            : existing.description,
        status: patch.status ?? existing.status,
        fieldsJson: patch.fieldsJson ?? existing.fieldsJson,
        updatedAt: patch.updatedAt ?? existing.updatedAt,
        version: nextVersion,
      })
      .where(
        and(
          eq(portalForms.eventId, eventId),
          eq(portalForms.id, formId),
          eq(portalForms.version, expectedVersion),
        ),
      );
    return this.getForm(eventId, formId);
  }

  async deleteForm(eventId: string, formId: string): Promise<boolean> {
    const existing = await this.getForm(eventId, formId);
    if (!existing) return false;
    await this.db
      .delete(portalForms)
      .where(
        and(eq(portalForms.eventId, eventId), eq(portalForms.id, formId)),
      );
    return true;
  }

  async getResponse(
    formId: string,
    participationId: string,
  ): Promise<PortalFormResponseRow | null> {
    const rows = await this.db
      .select()
      .from(portalFormResponses)
      .where(
        and(
          eq(portalFormResponses.formId, formId),
          eq(portalFormResponses.participationId, participationId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? this.mapResp(row) : null;
  }

  async upsertResponse(
    row: PortalFormResponseRow,
  ): Promise<PortalFormResponseRow> {
    const existing = await this.getResponse(row.formId, row.participationId);
    if (existing) {
      await this.db
        .update(portalFormResponses)
        .set({
          answersJson: row.answersJson,
          updatedAt: row.updatedAt,
          version: existing.version + 1,
        })
        .where(eq(portalFormResponses.id, existing.id));
      return {
        ...existing,
        answersJson: row.answersJson,
        updatedAt: row.updatedAt,
        version: existing.version + 1,
      };
    }
    await this.db.insert(portalFormResponses).values({
      id: row.id,
      formId: row.formId,
      eventId: row.eventId,
      participationId: row.participationId,
      answersJson: row.answersJson,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
    return row;
  }
}
