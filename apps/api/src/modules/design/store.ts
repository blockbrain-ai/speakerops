/**
 * Design token draft/published + file_assets persistence (section 2.4).
 *
 * MemoryDesignStore is the test / local e2e default (no D1 required).
 * D1DesignStore wraps the Worker DB binding (+ optional R2 FILES) for production.
 * All event-owned queries take eventId (E2).
 *
 * Draft updates use optimistic version in WHERE (E1). Upload readiness uses the
 * dedicated `uploaded` column — never the checksum field.
 */
import { eq, and } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import type { DesignTokens } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  designTokenDrafts,
  designTokenPublished,
  fileAssets,
} from "@speakerops/db";
import type { R2BucketLike } from "../../env.js";
import { d1Changes } from "../auth/store.js";

export type DesignDraftRow = {
  eventId: string;
  tokens: DesignTokens;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type DesignPublishedRow = {
  eventId: string;
  tokens: DesignTokens;
  version: number;
  publishedAt: string;
  publishedBy: string | null;
};

export type FileAssetRow = {
  id: string;
  eventId: string;
  ownerParticipationId: string | null;
  r2Key: string;
  filename: string;
  mime: string;
  size: number;
  checksum: string | null;
  purpose: string;
  createdAt: string;
  /** True after bytes were uploaded via the presigned URL. */
  uploaded: boolean;
};

export type FileBlob = {
  bytes: ArrayBuffer;
  mime: string;
};

export type DesignStore = {
  findDraft(eventId: string): Promise<DesignDraftRow | null>;
  /**
   * Insert or conditional update. On update, expectedVersion must match;
   * returns false on version conflict (no row changed).
   */
  upsertDraft(row: DesignDraftRow, expectedVersion?: number): Promise<boolean>;
  findPublished(eventId: string): Promise<DesignPublishedRow | null>;
  upsertPublished(row: DesignPublishedRow): Promise<DesignPublishedRow>;
  insertFile(row: FileAssetRow): Promise<FileAssetRow>;
  findFile(eventId: string, fileId: string): Promise<FileAssetRow | null>;
  /** Lookup by file id only (public serve path). */
  findFileById(fileId: string): Promise<FileAssetRow | null>;
  updateFileAfterUpload(
    eventId: string,
    fileId: string,
    patch: { size: number; uploaded: boolean },
  ): Promise<FileAssetRow | null>;
  putFileBytes(
    eventId: string,
    fileId: string,
    blob: FileBlob,
  ): Promise<void>;
  getFileBytes(
    eventId: string,
    fileId: string,
  ): Promise<FileBlob | null>;
};

/**
 * In-memory design store — unit tests + e2e-api-server without D1.
 */
export class MemoryDesignStore implements DesignStore {
  private drafts = new Map<string, DesignDraftRow>();
  private published = new Map<string, DesignPublishedRow>();
  private files = new Map<string, FileAssetRow>();
  private filesById = new Map<string, FileAssetRow>();
  private blobs = new Map<string, FileBlob>();

  private fileKey(eventId: string, fileId: string): string {
    return `${eventId}\0${fileId}`;
  }

  async findDraft(eventId: string): Promise<DesignDraftRow | null> {
    return this.drafts.get(eventId) ?? null;
  }

  async upsertDraft(
    row: DesignDraftRow,
    expectedVersion?: number,
  ): Promise<boolean> {
    const prev = this.drafts.get(row.eventId);
    if (prev) {
      const prior =
        expectedVersion !== undefined
          ? expectedVersion
          : row.version === prev.version
            ? prev.version // same-version write (e.g. publish brandFg backfill)
            : row.version - 1;
      if (prev.version !== prior) return false;
    }
    this.drafts.set(row.eventId, row);
    return true;
  }

  async findPublished(eventId: string): Promise<DesignPublishedRow | null> {
    return this.published.get(eventId) ?? null;
  }

  async upsertPublished(row: DesignPublishedRow): Promise<DesignPublishedRow> {
    this.published.set(row.eventId, row);
    return row;
  }

  async insertFile(row: FileAssetRow): Promise<FileAssetRow> {
    const full = {
      ...row,
      uploaded: row.uploaded ?? false,
      checksum: row.checksum ?? null,
    };
    this.files.set(this.fileKey(row.eventId, row.id), full);
    this.filesById.set(row.id, full);
    return full;
  }

  async findFile(
    eventId: string,
    fileId: string,
  ): Promise<FileAssetRow | null> {
    return this.files.get(this.fileKey(eventId, fileId)) ?? null;
  }

  async findFileById(fileId: string): Promise<FileAssetRow | null> {
    return this.filesById.get(fileId) ?? null;
  }

  async updateFileAfterUpload(
    eventId: string,
    fileId: string,
    patch: { size: number; uploaded: boolean },
  ): Promise<FileAssetRow | null> {
    const existing = await this.findFile(eventId, fileId);
    if (!existing) return null;
    const updated: FileAssetRow = {
      ...existing,
      size: patch.size,
      uploaded: patch.uploaded,
      // checksum is never used as an upload-readiness sentinel
      checksum: existing.checksum,
    };
    this.files.set(this.fileKey(eventId, fileId), updated);
    this.filesById.set(fileId, updated);
    return updated;
  }

  async putFileBytes(
    eventId: string,
    fileId: string,
    blob: FileBlob,
  ): Promise<void> {
    this.blobs.set(this.fileKey(eventId, fileId), blob);
  }

  async getFileBytes(
    eventId: string,
    fileId: string,
  ): Promise<FileBlob | null> {
    return this.blobs.get(this.fileKey(eventId, fileId)) ?? null;
  }
}

/**
 * D1 + optional R2 design store — production Worker SoR.
 * Metadata in D1 (file_assets, design tables); bytes in R2 FILES or isolate map.
 */
export class D1DesignStore implements DesignStore {
  private readonly db: SpeakerOpsDb;
  private readonly r2: R2BucketLike | undefined;
  /** Fallback when R2 binding is absent (local miniflare without bucket). */
  private readonly localBlobs = new Map<string, FileBlob>();

  constructor(d1: D1DatabaseLike, r2?: R2BucketLike) {
    this.db = createDb(d1);
    this.r2 = r2;
  }

  private blobKey(eventId: string, fileId: string): string {
    return `${eventId}\0${fileId}`;
  }

  async findDraft(eventId: string): Promise<DesignDraftRow | null> {
    const rows = await this.db
      .select()
      .from(designTokenDrafts)
      .where(eq(designTokenDrafts.eventId, eventId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      eventId: row.eventId,
      tokens: JSON.parse(row.tokensJson) as DesignTokens,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsertDraft(
    row: DesignDraftRow,
    expectedVersion?: number,
  ): Promise<boolean> {
    const existing = await this.findDraft(row.eventId);
    const tokensJson = JSON.stringify(row.tokens);
    if (existing) {
      const prior =
        expectedVersion !== undefined
          ? expectedVersion
          : row.version === existing.version
            ? existing.version // same-version write (e.g. publish brandFg backfill)
            : row.version - 1;
      const result = await this.db
        .update(designTokenDrafts)
        .set({
          tokensJson,
          version: row.version,
          updatedAt: row.updatedAt,
        })
        .where(
          and(
            eq(designTokenDrafts.eventId, row.eventId),
            eq(designTokenDrafts.version, prior),
          ),
        );
      return d1Changes(result) > 0;
    }
    await this.db.insert(designTokenDrafts).values({
      eventId: row.eventId,
      tokensJson,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return true;
  }

  async findPublished(eventId: string): Promise<DesignPublishedRow | null> {
    const rows = await this.db
      .select()
      .from(designTokenPublished)
      .where(eq(designTokenPublished.eventId, eventId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      eventId: row.eventId,
      tokens: JSON.parse(row.tokensJson) as DesignTokens,
      version: row.version,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy ?? null,
    };
  }

  async upsertPublished(row: DesignPublishedRow): Promise<DesignPublishedRow> {
    const existing = await this.findPublished(row.eventId);
    const tokensJson = JSON.stringify(row.tokens);
    if (existing) {
      await this.db
        .update(designTokenPublished)
        .set({
          tokensJson,
          version: row.version,
          publishedAt: row.publishedAt,
          publishedBy: row.publishedBy,
        })
        .where(eq(designTokenPublished.eventId, row.eventId));
    } else {
      await this.db.insert(designTokenPublished).values({
        eventId: row.eventId,
        tokensJson,
        version: row.version,
        publishedAt: row.publishedAt,
        publishedBy: row.publishedBy,
      });
    }
    return row;
  }

  async insertFile(row: FileAssetRow): Promise<FileAssetRow> {
    const full = {
      ...row,
      uploaded: row.uploaded ?? false,
      checksum: row.checksum ?? null,
    };
    await this.db.insert(fileAssets).values({
      id: full.id,
      eventId: full.eventId,
      ownerParticipationId: full.ownerParticipationId,
      r2Key: full.r2Key,
      filename: full.filename,
      mime: full.mime,
      size: full.size,
      checksum: full.checksum,
      purpose: full.purpose,
      createdAt: full.createdAt,
      uploaded: full.uploaded ? 1 : 0,
    });
    return full;
  }

  private mapFile(row: {
    id: string;
    eventId: string;
    ownerParticipationId: string | null;
    r2Key: string;
    filename: string;
    mime: string;
    size: number;
    checksum: string | null;
    purpose: string;
    createdAt: string;
    uploaded?: number | null;
  }): FileAssetRow {
    return {
      id: row.id,
      eventId: row.eventId,
      ownerParticipationId: row.ownerParticipationId ?? null,
      r2Key: row.r2Key,
      filename: row.filename,
      mime: row.mime,
      size: row.size,
      checksum: row.checksum ?? null,
      purpose: row.purpose,
      createdAt: row.createdAt,
      uploaded: (row.uploaded ?? 0) === 1,
    };
  }

  async findFile(
    eventId: string,
    fileId: string,
  ): Promise<FileAssetRow | null> {
    const rows = await this.db
      .select()
      .from(fileAssets)
      .where(and(eq(fileAssets.eventId, eventId), eq(fileAssets.id, fileId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapFile(row);
  }

  async findFileById(fileId: string): Promise<FileAssetRow | null> {
    const rows = await this.db
      .select()
      .from(fileAssets)
      .where(eq(fileAssets.id, fileId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapFile(row);
  }

  async updateFileAfterUpload(
    eventId: string,
    fileId: string,
    patch: { size: number; uploaded: boolean },
  ): Promise<FileAssetRow | null> {
    const existing = await this.findFile(eventId, fileId);
    if (!existing) return null;
    await this.db
      .update(fileAssets)
      .set({
        size: patch.size,
        uploaded: patch.uploaded ? 1 : 0,
      })
      .where(and(eq(fileAssets.eventId, eventId), eq(fileAssets.id, fileId)));
    return {
      ...existing,
      size: patch.size,
      uploaded: patch.uploaded,
    };
  }

  async putFileBytes(
    eventId: string,
    fileId: string,
    blob: FileBlob,
  ): Promise<void> {
    const meta = await this.findFile(eventId, fileId);
    const key = meta?.r2Key ?? `events/${eventId}/logo/${fileId}.png`;
    if (this.r2) {
      await this.r2.put(key, blob.bytes, {
        httpMetadata: { contentType: blob.mime },
      });
    } else {
      this.localBlobs.set(this.blobKey(eventId, fileId), blob);
    }
  }

  async getFileBytes(
    eventId: string,
    fileId: string,
  ): Promise<FileBlob | null> {
    const meta = await this.findFile(eventId, fileId);
    if (!meta) return null;
    if (this.r2) {
      const obj = await this.r2.get(meta.r2Key);
      if (!obj) return null;
      const bytes = await obj.arrayBuffer();
      return {
        bytes,
        mime: obj.httpMetadata?.contentType ?? meta.mime,
      };
    }
    return this.localBlobs.get(this.blobKey(eventId, fileId)) ?? null;
  }
}

export function newFileId(): string {
  return uuidv7();
}
