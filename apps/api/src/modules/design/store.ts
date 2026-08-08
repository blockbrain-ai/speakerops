/**
 * Design token draft/published + file_assets persistence (section 2.4).
 *
 * MemoryDesignStore is the test / local e2e default (no D1 required).
 * All event-owned queries take eventId (E2).
 */
import { uuidv7 } from "@speakerops/shared";
import type { DesignTokens } from "@speakerops/shared";

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
};

export type DesignStore = {
  findDraft(eventId: string): Promise<DesignDraftRow | null>;
  upsertDraft(row: DesignDraftRow): Promise<DesignDraftRow>;
  findPublished(eventId: string): Promise<DesignPublishedRow | null>;
  upsertPublished(row: DesignPublishedRow): Promise<DesignPublishedRow>;
  insertFile(row: FileAssetRow): Promise<FileAssetRow>;
  findFile(eventId: string, fileId: string): Promise<FileAssetRow | null>;
};

/**
 * In-memory design store — unit tests + e2e-api-server without D1.
 */
export class MemoryDesignStore implements DesignStore {
  private drafts = new Map<string, DesignDraftRow>();
  private published = new Map<string, DesignPublishedRow>();
  private files = new Map<string, FileAssetRow>();

  private fileKey(eventId: string, fileId: string): string {
    return `${eventId}\0${fileId}`;
  }

  async findDraft(eventId: string): Promise<DesignDraftRow | null> {
    return this.drafts.get(eventId) ?? null;
  }

  async upsertDraft(row: DesignDraftRow): Promise<DesignDraftRow> {
    this.drafts.set(row.eventId, row);
    return row;
  }

  async findPublished(eventId: string): Promise<DesignPublishedRow | null> {
    return this.published.get(eventId) ?? null;
  }

  async upsertPublished(row: DesignPublishedRow): Promise<DesignPublishedRow> {
    this.published.set(row.eventId, row);
    return row;
  }

  async insertFile(row: FileAssetRow): Promise<FileAssetRow> {
    this.files.set(this.fileKey(row.eventId, row.id), row);
    return row;
  }

  async findFile(
    eventId: string,
    fileId: string,
  ): Promise<FileAssetRow | null> {
    return this.files.get(this.fileKey(eventId, fileId)) ?? null;
  }
}

export function newFileId(): string {
  return uuidv7();
}
