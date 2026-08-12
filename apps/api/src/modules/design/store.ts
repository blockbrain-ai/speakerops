/**
 * Design token draft/published + file_assets persistence (section 2.4).
 *
 * MemoryDesignStore is the test / local e2e default (no D1 required).
 * D1DesignStore wraps the Worker DB binding (+ optional R2 FILES) for production.
 * All event-owned queries take eventId (E2).
 *
 * Draft updates use optimistic version in WHERE (E1). Upload readiness uses the
 * dedicated `uploaded` column — never the checksum field.
 *
 * Upload lifecycle on `uploaded` (INTEGER):
 *   0 = pending body
 *   2 = in-progress claim (bytes not yet stored — Design.SetDraft must reject)
 *   1 = bytes stored (only after successful putFileBytes)
 * File.Upload: claim 0→2, put bytes, complete 2→1; on put failure release 2→0.
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
  fileBlobs,
} from "@speakerops/db";
import type { R2BucketLike } from "../../env.js";
import { d1Changes } from "../auth/store.js";

/** DB `uploaded` column values — 1 means bytes stored (SCHEMA readiness). */
export const FILE_UPLOAD_PENDING = 0 as const;
export const FILE_UPLOAD_STORED = 1 as const;
/** In-progress claim: exclusive writer, not ready for Design.SetDraft. */
export const FILE_UPLOAD_CLAIMED = 2 as const;

export type FileUploadDbState =
  | typeof FILE_UPLOAD_PENDING
  | typeof FILE_UPLOAD_STORED
  | typeof FILE_UPLOAD_CLAIMED;

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

/** Default virus scan stub (section 4.2). */
export const VIRUS_SCAN_UNSCANNED = "unscanned" as const;

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
  /**
   * True only when bytes are stored (DB uploaded=1).
   * False while pending (0) or claim-in-progress (2).
   */
  uploaded: boolean;
  /**
   * Raw DB upload state for claim/complete transitions.
   * Optional on insert (derived from `uploaded` when omitted).
   */
  uploadState?: FileUploadDbState;
  /**
   * Virus scan stub (4.2): unscanned | clean | infected | error.
   * Defaults to unscanned on insert; no scanner worker in dogfood.
   */
  virusScanStatus?: string;
  /**
   * Public CFP upload binding (0033): ACTIVE published form version the
   * upload was authorized against. NULL for non-CFP assets (logo/portal).
   * Submission.Create requires it to equal the submission's pinned version.
   */
  formVersionId?: string | null;
  /**
   * File-typed field key the upload answers (paired with formVersionId).
   * Submission.Create requires it to equal the answering field's key.
   */
  fieldKey?: string | null;
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
  /**
   * Files owned by a participation within an event (headshot/slides).
   * Used by Speakers.Get — never returns another participation's files.
   */
  listFilesForParticipation?(
    eventId: string,
    ownerParticipationId: string,
  ): Promise<FileAssetRow[]>;
  /** N6 operator library: all file assets for an event (admin). */
  listFilesForEvent?(eventId: string): Promise<FileAssetRow[]>;
  /**
   * Atomic single-use claim: transition pending (0) → claimed (2) with actual size.
   * Returns the updated row, or null if missing / not pending.
   * Does NOT mark uploaded=1 — bytes are not stored yet. Call completeFileUpload
   * only after putFileBytes succeeds.
   */
  claimFileUpload(
    eventId: string,
    fileId: string,
    patch: { size: number },
  ): Promise<FileAssetRow | null>;
  /**
   * Transition claimed (2) → stored (1) after successful putFileBytes.
   * No-op / returns null if not currently claimed (e.g. already released).
   */
  completeFileUpload(
    eventId: string,
    fileId: string,
  ): Promise<FileAssetRow | null>;
  /**
   * Release a won claim after putFileBytes failure so a client may retry.
   * Restores declared size and pending (0) only while still claimed (2).
   */
  releaseFileUploadClaim(
    eventId: string,
    fileId: string,
    patch: { size: number },
  ): Promise<void>;
  /**
   * File.CompleteUpload — set content checksum (+ optional filename).
   * Does not write bytes; metadata only. Returns null if file missing.
   */
  completeFileChecksum(
    eventId: string,
    fileId: string,
    patch: { checksum: string; filename?: string },
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

function rowFromUploadState(
  base: Omit<FileAssetRow, "uploaded" | "uploadState">,
  uploadState: FileUploadDbState,
): FileAssetRow {
  return {
    ...base,
    virusScanStatus: base.virusScanStatus ?? VIRUS_SCAN_UNSCANNED,
    formVersionId: base.formVersionId ?? null,
    fieldKey: base.fieldKey ?? null,
    uploadState,
    uploaded: uploadState === FILE_UPLOAD_STORED,
  };
}

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
    const uploadState: FileUploadDbState =
      row.uploadState ??
      (row.uploaded ? FILE_UPLOAD_STORED : FILE_UPLOAD_PENDING);
    const full = rowFromUploadState(
      {
        id: row.id,
        eventId: row.eventId,
        ownerParticipationId: row.ownerParticipationId,
        r2Key: row.r2Key,
        filename: row.filename,
        mime: row.mime,
        size: row.size,
        checksum: row.checksum ?? null,
        purpose: row.purpose,
        createdAt: row.createdAt,
        virusScanStatus: row.virusScanStatus ?? VIRUS_SCAN_UNSCANNED,
        formVersionId: row.formVersionId ?? null,
        fieldKey: row.fieldKey ?? null,
      },
      uploadState,
    );
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

  async listFilesForParticipation(
    eventId: string,
    ownerParticipationId: string,
  ): Promise<FileAssetRow[]> {
    return [...this.files.values()]
      .filter(
        (f) =>
          f.eventId === eventId &&
          f.ownerParticipationId === ownerParticipationId,
      )
      .map((f) => ({ ...f }));
  }

  async listFilesForEvent(eventId: string): Promise<FileAssetRow[]> {
    return [...this.files.values()]
      .filter((f) => f.eventId === eventId)
      .map((f) => ({ ...f }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async claimFileUpload(
    eventId: string,
    fileId: string,
    patch: { size: number },
  ): Promise<FileAssetRow | null> {
    // Synchronous check-and-set: atomic under the JS event loop (no await between).
    const existing = this.files.get(this.fileKey(eventId, fileId));
    if (!existing || existing.uploadState !== FILE_UPLOAD_PENDING) return null;
    const updated = rowFromUploadState(
      {
        id: existing.id,
        eventId: existing.eventId,
        ownerParticipationId: existing.ownerParticipationId,
        r2Key: existing.r2Key,
        filename: existing.filename,
        mime: existing.mime,
        size: patch.size,
        // checksum is never used as an upload-readiness sentinel
        checksum: existing.checksum,
        purpose: existing.purpose,
        createdAt: existing.createdAt,
        virusScanStatus: existing.virusScanStatus,
      },
      FILE_UPLOAD_CLAIMED,
    );
    this.files.set(this.fileKey(eventId, fileId), updated);
    this.filesById.set(fileId, updated);
    return updated;
  }

  async completeFileUpload(
    eventId: string,
    fileId: string,
  ): Promise<FileAssetRow | null> {
    const existing = this.files.get(this.fileKey(eventId, fileId));
    if (!existing || existing.uploadState !== FILE_UPLOAD_CLAIMED) return null;
    const updated = rowFromUploadState(
      {
        id: existing.id,
        eventId: existing.eventId,
        ownerParticipationId: existing.ownerParticipationId,
        r2Key: existing.r2Key,
        filename: existing.filename,
        mime: existing.mime,
        size: existing.size,
        checksum: existing.checksum,
        purpose: existing.purpose,
        createdAt: existing.createdAt,
        virusScanStatus: existing.virusScanStatus,
      },
      FILE_UPLOAD_STORED,
    );
    this.files.set(this.fileKey(eventId, fileId), updated);
    this.filesById.set(fileId, updated);
    return updated;
  }

  async releaseFileUploadClaim(
    eventId: string,
    fileId: string,
    patch: { size: number },
  ): Promise<void> {
    const existing = this.files.get(this.fileKey(eventId, fileId));
    if (!existing || existing.uploadState !== FILE_UPLOAD_CLAIMED) return;
    const updated = rowFromUploadState(
      {
        id: existing.id,
        eventId: existing.eventId,
        ownerParticipationId: existing.ownerParticipationId,
        r2Key: existing.r2Key,
        filename: existing.filename,
        mime: existing.mime,
        size: patch.size,
        checksum: existing.checksum,
        purpose: existing.purpose,
        createdAt: existing.createdAt,
        virusScanStatus: existing.virusScanStatus,
      },
      FILE_UPLOAD_PENDING,
    );
    this.files.set(this.fileKey(eventId, fileId), updated);
    this.filesById.set(fileId, updated);
  }

  async completeFileChecksum(
    eventId: string,
    fileId: string,
    patch: { checksum: string; filename?: string },
  ): Promise<FileAssetRow | null> {
    const existing = this.files.get(this.fileKey(eventId, fileId));
    if (!existing) return null;
    const uploadState =
      existing.uploadState ??
      (existing.uploaded ? FILE_UPLOAD_STORED : FILE_UPLOAD_PENDING);
    // A3: only complete checksum when bytes are STORED (reject PENDING/CLAIMED).
    if (uploadState !== FILE_UPLOAD_STORED) return null;
    const updated = rowFromUploadState(
      {
        id: existing.id,
        eventId: existing.eventId,
        ownerParticipationId: existing.ownerParticipationId,
        r2Key: existing.r2Key,
        filename: patch.filename?.trim() || existing.filename,
        mime: existing.mime,
        size: existing.size,
        checksum: patch.checksum,
        purpose: existing.purpose,
        createdAt: existing.createdAt,
        virusScanStatus: existing.virusScanStatus,
      },
      FILE_UPLOAD_STORED,
    );
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
    const uploadState: FileUploadDbState =
      row.uploadState ??
      (row.uploaded ? FILE_UPLOAD_STORED : FILE_UPLOAD_PENDING);
    const full = rowFromUploadState(
      {
        id: row.id,
        eventId: row.eventId,
        ownerParticipationId: row.ownerParticipationId,
        r2Key: row.r2Key,
        filename: row.filename,
        mime: row.mime,
        size: row.size,
        checksum: row.checksum ?? null,
        purpose: row.purpose,
        createdAt: row.createdAt,
        virusScanStatus: row.virusScanStatus ?? VIRUS_SCAN_UNSCANNED,
        formVersionId: row.formVersionId ?? null,
        fieldKey: row.fieldKey ?? null,
      },
      uploadState,
    );
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
      uploaded: full.uploadState,
      virusScanStatus: full.virusScanStatus,
      formVersionId: full.formVersionId ?? null,
      fieldKey: full.fieldKey ?? null,
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
    virusScanStatus?: string | null;
    formVersionId?: string | null;
    fieldKey?: string | null;
  }): FileAssetRow {
    const raw = row.uploaded ?? FILE_UPLOAD_PENDING;
    const uploadState: FileUploadDbState =
      raw === FILE_UPLOAD_STORED
        ? FILE_UPLOAD_STORED
        : raw === FILE_UPLOAD_CLAIMED
          ? FILE_UPLOAD_CLAIMED
          : FILE_UPLOAD_PENDING;
    return rowFromUploadState(
      {
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
        virusScanStatus: row.virusScanStatus ?? VIRUS_SCAN_UNSCANNED,
        formVersionId: row.formVersionId ?? null,
        fieldKey: row.fieldKey ?? null,
      },
      uploadState,
    );
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

  async listFilesForParticipation(
    eventId: string,
    ownerParticipationId: string,
  ): Promise<FileAssetRow[]> {
    const rows = await this.db
      .select()
      .from(fileAssets)
      .where(
        and(
          eq(fileAssets.eventId, eventId),
          eq(fileAssets.ownerParticipationId, ownerParticipationId),
        ),
      );
    return rows.map((r) => this.mapFile(r));
  }

  async listFilesForEvent(eventId: string): Promise<FileAssetRow[]> {
    const rows = await this.db
      .select()
      .from(fileAssets)
      .where(eq(fileAssets.eventId, eventId));
    return rows
      .map((r) => this.mapFile(r))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async claimFileUpload(
    eventId: string,
    fileId: string,
    patch: { size: number },
  ): Promise<FileAssetRow | null> {
    // Conditional D1: only one concurrent winner when still pending (0).
    // Claimed state is 2 — not stored (1) — so SetDraft cannot treat as ready.
    const result = await this.db
      .update(fileAssets)
      .set({
        size: patch.size,
        uploaded: FILE_UPLOAD_CLAIMED,
      })
      .where(
        and(
          eq(fileAssets.eventId, eventId),
          eq(fileAssets.id, fileId),
          eq(fileAssets.uploaded, FILE_UPLOAD_PENDING),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return this.findFile(eventId, fileId);
  }

  async completeFileUpload(
    eventId: string,
    fileId: string,
  ): Promise<FileAssetRow | null> {
    // Only after successful storage: claimed (2) → stored (1).
    const result = await this.db
      .update(fileAssets)
      .set({
        uploaded: FILE_UPLOAD_STORED,
      })
      .where(
        and(
          eq(fileAssets.eventId, eventId),
          eq(fileAssets.id, fileId),
          eq(fileAssets.uploaded, FILE_UPLOAD_CLAIMED),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return this.findFile(eventId, fileId);
  }

  async releaseFileUploadClaim(
    eventId: string,
    fileId: string,
    patch: { size: number },
  ): Promise<void> {
    // Only release while still claimed (2); no-op if pending or already stored.
    await this.db
      .update(fileAssets)
      .set({
        size: patch.size,
        uploaded: FILE_UPLOAD_PENDING,
      })
      .where(
        and(
          eq(fileAssets.eventId, eventId),
          eq(fileAssets.id, fileId),
          eq(fileAssets.uploaded, FILE_UPLOAD_CLAIMED),
        ),
      );
  }

  async completeFileChecksum(
    eventId: string,
    fileId: string,
    patch: { checksum: string; filename?: string },
  ): Promise<FileAssetRow | null> {
    const set: { checksum: string; filename?: string } = {
      checksum: patch.checksum,
    };
    if (patch.filename !== undefined && patch.filename.trim().length > 0) {
      set.filename = patch.filename.trim();
    }
    // A3: predicate includes STORED so PENDING/CLAIMED cannot complete (no TOCTOU).
    const result = await this.db
      .update(fileAssets)
      .set(set)
      .where(
        and(
          eq(fileAssets.eventId, eventId),
          eq(fileAssets.id, fileId),
          eq(fileAssets.uploaded, FILE_UPLOAD_STORED),
        ),
      );
    if (d1Changes(result) === 0) return null;
    return this.findFile(eventId, fileId);
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
      return;
    }
    // Dogfood / no-R2: durable D1 base64 body (isolate Map is not durable).
    const bytesB64 = arrayBufferToBase64(blob.bytes);
    const now = new Date().toISOString();
    const existing = await this.db
      .select()
      .from(fileBlobs)
      .where(eq(fileBlobs.fileId, fileId))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(fileBlobs)
        .set({
          eventId,
          mime: blob.mime,
          size: blob.bytes.byteLength,
          bytesB64,
          createdAt: now,
        })
        .where(eq(fileBlobs.fileId, fileId));
    } else {
      await this.db.insert(fileBlobs).values({
        fileId,
        eventId,
        mime: blob.mime,
        size: blob.bytes.byteLength,
        bytesB64,
        createdAt: now,
      });
    }
    // Keep isolate map as hot cache for the same request chain.
    this.localBlobs.set(this.blobKey(eventId, fileId), blob);
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
    const cached = this.localBlobs.get(this.blobKey(eventId, fileId));
    if (cached) return cached;
    const rows = await this.db
      .select()
      .from(fileBlobs)
      .where(eq(fileBlobs.fileId, fileId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const bytes = base64ToArrayBuffer(row.bytesB64);
    const blob: FileBlob = {
      bytes,
      mime: row.mime || meta.mime,
    };
    this.localBlobs.set(this.blobKey(eventId, fileId), blob);
    return blob;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // Chunked to avoid call-stack limits on large files (headshots stay small).
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function newFileId(): string {
  return uuidv7();
}
