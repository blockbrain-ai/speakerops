/**
 * Programme publication store (F7).
 */
import { eq } from "drizzle-orm";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  programmePublications,
} from "@speakerops/db";

export type ProgrammePublicationRow = {
  eventId: string;
  publishedAt: string;
  publishedBy: string | null;
  version: number;
  snapshotJson: string | null;
  updatedAt: string;
};

export type ProgrammeStore = {
  findByEventId(eventId: string): Promise<ProgrammePublicationRow | null>;
  /**
   * Insert or update. When expectedVersion is number, CAS on version
   * (insert only when missing; update only when version matches).
   */
  upsert(
    row: ProgrammePublicationRow & { expectedVersion?: number | null },
  ): Promise<"ok" | "version">;
};

export class MemoryProgrammeStore implements ProgrammeStore {
  private rows = new Map<string, ProgrammePublicationRow>();

  async findByEventId(
    eventId: string,
  ): Promise<ProgrammePublicationRow | null> {
    return this.rows.get(eventId) ?? null;
  }

  async upsert(
    row: ProgrammePublicationRow & { expectedVersion?: number | null },
  ): Promise<"ok" | "version"> {
    const cur = this.rows.get(row.eventId);
    if (row.expectedVersion != null) {
      if (!cur && row.expectedVersion !== 0 && row.expectedVersion !== null) {
        /* first publish: expected null treated as insert */
      }
      if (cur && cur.version !== row.expectedVersion) return "version";
      if (!cur && row.expectedVersion !== null && row.expectedVersion > 0) {
        return "version";
      }
    }
    const { expectedVersion: _e, ...rest } = row as ProgrammePublicationRow & {
      expectedVersion?: number | null;
    };
    void _e;
    this.rows.set(row.eventId, { ...rest });
    return "ok";
  }
}

export class D1ProgrammeStore implements ProgrammeStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async findByEventId(
    eventId: string,
  ): Promise<ProgrammePublicationRow | null> {
    const rows = await this.db
      .select()
      .from(programmePublications)
      .where(eq(programmePublications.eventId, eventId))
      .limit(1)
      .all();
    const r = rows[0];
    if (!r) return null;
    return {
      eventId: r.eventId,
      publishedAt: r.publishedAt,
      publishedBy: r.publishedBy ?? null,
      version: r.version,
      snapshotJson: r.snapshotJson ?? null,
      updatedAt: r.updatedAt,
    };
  }

  async upsert(
    row: ProgrammePublicationRow & { expectedVersion?: number | null },
  ): Promise<"ok" | "version"> {
    const existing = await this.findByEventId(row.eventId);
    if (existing) {
      if (
        row.expectedVersion != null &&
        existing.version !== row.expectedVersion
      ) {
        return "version";
      }
      await this.db
        .update(programmePublications)
        .set({
          publishedAt: row.publishedAt,
          publishedBy: row.publishedBy,
          version: row.version,
          snapshotJson: row.snapshotJson,
          updatedAt: row.updatedAt,
        })
        .where(eq(programmePublications.eventId, row.eventId))
        .run();
    } else {
      if (row.expectedVersion != null && row.expectedVersion > 0) {
        return "version";
      }
      await this.db
        .insert(programmePublications)
        .values({
          eventId: row.eventId,
          publishedAt: row.publishedAt,
          publishedBy: row.publishedBy,
          version: row.version,
          snapshotJson: row.snapshotJson,
          updatedAt: row.updatedAt,
        })
        .run();
    }
    return "ok";
  }
}
