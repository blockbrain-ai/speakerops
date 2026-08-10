/**
 * Forms / form_versions / form_fields / form_rules persistence (section 3.1).
 *
 * MemoryFormsStore is the test / local e2e default (no D1 required).
 * D1FormsStore wraps the Worker DB binding for production (E1 SoR).
 *
 * Draft = form_versions.version_num === 0 (published_at NULL).
 * Published rows are never updated after insert (immutability).
 */
import { eq, and, desc } from "drizzle-orm";
import { uuidv7, FORM_DRAFT_VERSION_NUM } from "@speakerops/shared";
import type {
  FormCondition,
  FormFieldConditions,
  FormFieldOption,
  FormFieldType,
  FormSnapshot,
  FormStatus,
} from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  forms,
  formVersions,
  formFields,
  formRules,
} from "@speakerops/db";

export type FormRow = {
  id: string;
  eventId: string;
  name: string;
  status: FormStatus;
  createdAt: string;
};

export type FormVersionRow = {
  id: string;
  formId: string;
  versionNum: number;
  welcomeMd: string | null;
  thankYouMd: string | null;
  opensAt: string | null;
  closesAt: string | null;
  submissionLimit: number | null;
  /** Configurable speaker bounds (post-11.9 depth; defaults 1/5 pre-knob). */
  minSpeakers?: number;
  maxSpeakers?: number;
  publishedAt: string | null;
  snapshotJson: string | null;
};

export type FormFieldRow = {
  id: string;
  formVersionId: string;
  fieldKey: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options: FormFieldOption[] | null;
  sortOrder: number;
  conditions: FormFieldConditions | null;
  /** Depth knobs (post-11.9; optional for pre-0023 rows). */
  helpText?: string | null;
  placeholder?: string | null;
  maxChars?: number | null;
};

export type FormRuleRow = {
  id: string;
  formVersionId: string;
  when: FormCondition;
  routeToCategory: string;
};

export type FormsStore = {
  insertForm(row: FormRow): Promise<FormRow>;
  findFormById(formId: string): Promise<FormRow | null>;
  findFormsByEventId(eventId: string): Promise<FormRow[]>;
  updateFormStatus(formId: string, status: FormStatus): Promise<void>;
  insertVersion(row: FormVersionRow): Promise<FormVersionRow>;
  findDraftVersion(formId: string): Promise<FormVersionRow | null>;
  findPublishedVersions(formId: string): Promise<FormVersionRow[]>;
  findLatestPublishedVersion(formId: string): Promise<FormVersionRow | null>;
  findVersionById(versionId: string): Promise<FormVersionRow | null>;
  /**
   * Update draft version meta only. Returns false if version is published
   * (published_at set) — immutability guard.
   */
  updateDraftVersionMeta(
    versionId: string,
    patch: {
      welcomeMd: string | null;
      thankYouMd: string | null;
      opensAt: string | null;
      closesAt: string | null;
      submissionLimit: number | null;
      minSpeakers: number;
      maxSpeakers: number;
    },
  ): Promise<boolean>;
  /** Replace all fields on a draft version (delete + insert). */
  replaceFields(formVersionId: string, fields: FormFieldRow[]): Promise<void>;
  listFields(formVersionId: string): Promise<FormFieldRow[]>;
  /** Replace all rules on a draft version. */
  replaceRules(formVersionId: string, rules: FormRuleRow[]): Promise<void>;
  listRules(formVersionId: string): Promise<FormRuleRow[]>;
  /**
   * Attempt to mutate a published version's snapshot_json.
   * Must return false / no-op for immutability proofs.
   */
  tryMutatePublishedSnapshot(
    versionId: string,
    snapshotJson: string,
  ): Promise<boolean>;
};

function parseOptions(raw: string | null): FormFieldOption[] | null {
  if (raw == null || raw === "") return null;
  return JSON.parse(raw) as FormFieldOption[];
}

function parseConditions(raw: string | null): FormFieldConditions | null {
  if (raw == null || raw === "") return null;
  return JSON.parse(raw) as FormFieldConditions;
}

function parseWhen(raw: string): FormCondition {
  return JSON.parse(raw) as FormCondition;
}

/**
 * In-memory forms store — unit tests + e2e without D1.
 */
export class MemoryFormsStore implements FormsStore {
  private forms = new Map<string, FormRow>();
  private versions = new Map<string, FormVersionRow>();
  private fields = new Map<string, FormFieldRow[]>();
  private rules = new Map<string, FormRuleRow[]>();

  async insertForm(row: FormRow): Promise<FormRow> {
    this.forms.set(row.id, row);
    return row;
  }

  async findFormById(formId: string): Promise<FormRow | null> {
    return this.forms.get(formId) ?? null;
  }

  async findFormsByEventId(eventId: string): Promise<FormRow[]> {
    return [...this.forms.values()].filter((f) => f.eventId === eventId);
  }

  async updateFormStatus(formId: string, status: FormStatus): Promise<void> {
    const existing = this.forms.get(formId);
    if (!existing) return;
    this.forms.set(formId, { ...existing, status });
  }

  async insertVersion(row: FormVersionRow): Promise<FormVersionRow> {
    this.versions.set(row.id, { ...row });
    return row;
  }

  async findDraftVersion(formId: string): Promise<FormVersionRow | null> {
    for (const v of this.versions.values()) {
      if (v.formId === formId && v.versionNum === FORM_DRAFT_VERSION_NUM) {
        return { ...v };
      }
    }
    return null;
  }

  async findPublishedVersions(formId: string): Promise<FormVersionRow[]> {
    return [...this.versions.values()]
      .filter((v) => v.formId === formId && v.versionNum > 0)
      .sort((a, b) => b.versionNum - a.versionNum)
      .map((v) => ({ ...v }));
  }

  async findLatestPublishedVersion(
    formId: string,
  ): Promise<FormVersionRow | null> {
    const list = await this.findPublishedVersions(formId);
    return list[0] ?? null;
  }

  async findVersionById(versionId: string): Promise<FormVersionRow | null> {
    const v = this.versions.get(versionId);
    return v ? { ...v } : null;
  }

  async updateDraftVersionMeta(
    versionId: string,
    patch: {
      welcomeMd: string | null;
      thankYouMd: string | null;
      opensAt: string | null;
      closesAt: string | null;
      submissionLimit: number | null;
      minSpeakers: number;
      maxSpeakers: number;
    },
  ): Promise<boolean> {
    const existing = this.versions.get(versionId);
    if (!existing) return false;
    if (existing.publishedAt != null || existing.versionNum !== FORM_DRAFT_VERSION_NUM) {
      return false;
    }
    this.versions.set(versionId, { ...existing, ...patch });
    return true;
  }

  async replaceFields(
    formVersionId: string,
    fieldRows: FormFieldRow[],
  ): Promise<void> {
    const version = this.versions.get(formVersionId);
    const existing = this.fields.get(formVersionId) ?? [];
    // Published versions are immutable after first seed (publish path seeds once).
    if (
      version &&
      version.publishedAt != null &&
      existing.length > 0
    ) {
      throw new Error("Cannot replace fields on published form_version");
    }
    this.fields.set(
      formVersionId,
      fieldRows.map((f) => ({ ...f })),
    );
  }

  async listFields(formVersionId: string): Promise<FormFieldRow[]> {
    const list = this.fields.get(formVersionId) ?? [];
    return list
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.fieldKey.localeCompare(b.fieldKey))
      .map((f) => ({ ...f }));
  }

  async replaceRules(
    formVersionId: string,
    ruleRows: FormRuleRow[],
  ): Promise<void> {
    const version = this.versions.get(formVersionId);
    const existing = this.rules.get(formVersionId) ?? [];
    if (
      version &&
      version.publishedAt != null &&
      existing.length > 0
    ) {
      throw new Error("Cannot replace rules on published form_version");
    }
    this.rules.set(
      formVersionId,
      ruleRows.map((r) => ({ ...r })),
    );
  }

  async listRules(formVersionId: string): Promise<FormRuleRow[]> {
    const list = this.rules.get(formVersionId) ?? [];
    return list.map((r) => ({ ...r }));
  }

  async tryMutatePublishedSnapshot(
    versionId: string,
    snapshotJson: string,
  ): Promise<boolean> {
    const existing = this.versions.get(versionId);
    if (!existing) return false;
    // Published rows are immutable — refuse mutation.
    if (existing.publishedAt != null) {
      return false;
    }
    this.versions.set(versionId, { ...existing, snapshotJson });
    return true;
  }
}

/**
 * D1 forms store — production Worker SoR.
 */
export class D1FormsStore implements FormsStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async insertForm(row: FormRow): Promise<FormRow> {
    await this.db.insert(forms).values({
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
    });
    return row;
  }

  async findFormById(formId: string): Promise<FormRow | null> {
    const rows = await this.db
      .select()
      .from(forms)
      .where(eq(forms.id, formId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      status: row.status as FormStatus,
      createdAt: row.createdAt,
    };
  }

  async findFormsByEventId(eventId: string): Promise<FormRow[]> {
    const rows = await this.db
      .select()
      .from(forms)
      .where(eq(forms.eventId, eventId));
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      status: row.status as FormStatus,
      createdAt: row.createdAt,
    }));
  }

  async updateFormStatus(formId: string, status: FormStatus): Promise<void> {
    await this.db
      .update(forms)
      .set({ status })
      .where(eq(forms.id, formId));
  }

  async insertVersion(row: FormVersionRow): Promise<FormVersionRow> {
    await this.db.insert(formVersions).values({
      id: row.id,
      formId: row.formId,
      versionNum: row.versionNum,
      welcomeMd: row.welcomeMd,
      thankYouMd: row.thankYouMd,
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      submissionLimit: row.submissionLimit,
      minSpeakers: row.minSpeakers ?? 1,
      maxSpeakers: row.maxSpeakers ?? 5,
      publishedAt: row.publishedAt,
      snapshotJson: row.snapshotJson,
    });
    return row;
  }

  async findDraftVersion(formId: string): Promise<FormVersionRow | null> {
    const rows = await this.db
      .select()
      .from(formVersions)
      .where(
        and(
          eq(formVersions.formId, formId),
          eq(formVersions.versionNum, FORM_DRAFT_VERSION_NUM),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapVersion(row);
  }

  async findPublishedVersions(formId: string): Promise<FormVersionRow[]> {
    const rows = await this.db
      .select()
      .from(formVersions)
      .where(eq(formVersions.formId, formId))
      .orderBy(desc(formVersions.versionNum));
    return rows
      .filter((r) => r.versionNum > 0)
      .map(mapVersion);
  }

  async findLatestPublishedVersion(
    formId: string,
  ): Promise<FormVersionRow | null> {
    const list = await this.findPublishedVersions(formId);
    return list[0] ?? null;
  }

  async findVersionById(versionId: string): Promise<FormVersionRow | null> {
    const rows = await this.db
      .select()
      .from(formVersions)
      .where(eq(formVersions.id, versionId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapVersion(row);
  }

  async updateDraftVersionMeta(
    versionId: string,
    patch: {
      welcomeMd: string | null;
      thankYouMd: string | null;
      opensAt: string | null;
      closesAt: string | null;
      submissionLimit: number | null;
      minSpeakers: number;
      maxSpeakers: number;
    },
  ): Promise<boolean> {
    const existing = await this.findVersionById(versionId);
    if (!existing) return false;
    if (
      existing.publishedAt != null ||
      existing.versionNum !== FORM_DRAFT_VERSION_NUM
    ) {
      return false;
    }
    await this.db
      .update(formVersions)
      .set({
        welcomeMd: patch.welcomeMd,
        thankYouMd: patch.thankYouMd,
        opensAt: patch.opensAt,
        closesAt: patch.closesAt,
        submissionLimit: patch.submissionLimit,
        minSpeakers: patch.minSpeakers,
        maxSpeakers: patch.maxSpeakers,
      })
      .where(
        and(
          eq(formVersions.id, versionId),
          eq(formVersions.versionNum, FORM_DRAFT_VERSION_NUM),
        ),
      );
    return true;
  }

  async replaceFields(
    formVersionId: string,
    fieldRows: FormFieldRow[],
  ): Promise<void> {
    const version = await this.findVersionById(formVersionId);
    const existing = await this.listFields(formVersionId);
    if (
      version &&
      version.publishedAt != null &&
      existing.length > 0
    ) {
      throw new Error("Cannot replace fields on published form_version");
    }
    await this.db
      .delete(formFields)
      .where(eq(formFields.formVersionId, formVersionId));
    for (const f of fieldRows) {
      await this.db.insert(formFields).values({
        id: f.id,
        formVersionId: f.formVersionId,
        fieldKey: f.fieldKey,
        type: f.type,
        label: f.label,
        required: f.required ? 1 : 0,
        optionsJson: f.options ? JSON.stringify(f.options) : null,
        sortOrder: f.sortOrder,
        conditionsJson: f.conditions ? JSON.stringify(f.conditions) : null,
        helpText: f.helpText ?? null,
        placeholder: f.placeholder ?? null,
        maxChars: f.maxChars ?? null,
      });
    }
  }

  async listFields(formVersionId: string): Promise<FormFieldRow[]> {
    const rows = await this.db
      .select()
      .from(formFields)
      .where(eq(formFields.formVersionId, formVersionId));
    return rows
      .map((row) => ({
        id: row.id,
        formVersionId: row.formVersionId,
        fieldKey: row.fieldKey,
        type: row.type as FormFieldType,
        label: row.label,
        required: row.required === 1,
        options: parseOptions(row.optionsJson),
        sortOrder: row.sortOrder,
        conditions: parseConditions(row.conditionsJson),
        helpText: row.helpText ?? null,
        placeholder: row.placeholder ?? null,
        maxChars: row.maxChars ?? null,
      }))
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.fieldKey.localeCompare(b.fieldKey),
      );
  }

  async replaceRules(
    formVersionId: string,
    ruleRows: FormRuleRow[],
  ): Promise<void> {
    const version = await this.findVersionById(formVersionId);
    const existing = await this.listRules(formVersionId);
    if (
      version &&
      version.publishedAt != null &&
      existing.length > 0
    ) {
      throw new Error("Cannot replace rules on published form_version");
    }
    await this.db
      .delete(formRules)
      .where(eq(formRules.formVersionId, formVersionId));
    for (const r of ruleRows) {
      await this.db.insert(formRules).values({
        id: r.id,
        formVersionId: r.formVersionId,
        whenJson: JSON.stringify(r.when),
        routeToCategory: r.routeToCategory,
      });
    }
  }

  async listRules(formVersionId: string): Promise<FormRuleRow[]> {
    const rows = await this.db
      .select()
      .from(formRules)
      .where(eq(formRules.formVersionId, formVersionId));
    return rows.map((row) => ({
      id: row.id,
      formVersionId: row.formVersionId,
      when: parseWhen(row.whenJson),
      routeToCategory: row.routeToCategory,
    }));
  }

  async tryMutatePublishedSnapshot(
    versionId: string,
    snapshotJson: string,
  ): Promise<boolean> {
    const existing = await this.findVersionById(versionId);
    if (!existing) return false;
    if (existing.publishedAt != null) {
      // Immutability: refuse UPDATE on published rows.
      return false;
    }
    await this.db
      .update(formVersions)
      .set({ snapshotJson })
      .where(eq(formVersions.id, versionId));
    return true;
  }
}

function mapVersion(row: {
  id: string;
  formId: string;
  versionNum: number;
  welcomeMd: string | null;
  thankYouMd: string | null;
  opensAt: string | null;
  closesAt: string | null;
  submissionLimit: number | null;
  minSpeakers?: number | null;
  maxSpeakers?: number | null;
  publishedAt: string | null;
  snapshotJson: string | null;
}): FormVersionRow {
  const minSpeakers = Number(row.minSpeakers);
  const maxSpeakers = Number(row.maxSpeakers);
  return {
    id: row.id,
    formId: row.formId,
    versionNum: row.versionNum,
    welcomeMd: row.welcomeMd ?? null,
    thankYouMd: row.thankYouMd ?? null,
    opensAt: row.opensAt ?? null,
    closesAt: row.closesAt ?? null,
    submissionLimit: row.submissionLimit ?? null,
    minSpeakers:
      Number.isFinite(minSpeakers) && minSpeakers > 0 ? minSpeakers : 1,
    maxSpeakers:
      Number.isFinite(maxSpeakers) && maxSpeakers > 0 ? maxSpeakers : 5,
    publishedAt: row.publishedAt ?? null,
    snapshotJson: row.snapshotJson ?? null,
  };
}

export function newFormId(): string {
  return uuidv7();
}

export function newFormVersionId(): string {
  return uuidv7();
}

export function newFormFieldId(): string {
  return uuidv7();
}

export function newFormRuleId(): string {
  return uuidv7();
}

/** Parse snapshot_json for consumers (publish proof / public). */
export function parseSnapshot(json: string | null): FormSnapshot | null {
  if (json == null || json === "") return null;
  return JSON.parse(json) as FormSnapshot;
}
