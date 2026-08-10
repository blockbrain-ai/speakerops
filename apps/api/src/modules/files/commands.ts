/**
 * File domain commands — section 4.2 (portal R2 uploads).
 *
 * File.PresignUpload / File.Upload re-exported from design (2.4 + 4.2 purposes).
 * File.CompleteUpload (checksum path) lives here.
 * File.GetPublic remains logo-only (private headshot/slides require auth).
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  VIRUS_SCAN_UNSCANNED,
  FilePurposeSchema,
  type FileCompleteBody,
  type FileAssetDto,
} from "@speakerops/shared";
import type { FileAssetRow } from "../design/store.js";
import {
  presignFileUpload,
  uploadFileBytes,
  getPublicFileBytes,
  type DesignCommandDeps,
  type CommandOk,
  type CommandErr,
} from "../design/commands.js";

export type FilesCommandDeps = DesignCommandDeps;

export { presignFileUpload, uploadFileBytes, getPublicFileBytes };
export type { CommandOk, CommandErr };

/**
 * File.Get — authenticated private file bytes (headshot/slides/logo).
 * Caller must already have event membership; ownership for speakers is
 * enforced at the route layer.
 */
export async function getPrivateFileBytes(
  deps: FilesCommandDeps,
  fileId: string,
): Promise<
  CommandOk<{
    bytes: ArrayBuffer;
    mime: string;
    eventId: string;
    purpose: string;
    ownerParticipationId: string | null;
    filename: string;
  }> | CommandErr
> {
  const file = await deps.design.findFileById(fileId);
  if (!file || !file.uploaded) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  const blob = await deps.design.getFileBytes(file.eventId, file.id);
  if (!blob) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  return {
    ok: true,
    value: {
      bytes: blob.bytes,
      mime: blob.mime,
      eventId: file.eventId,
      purpose: file.purpose,
      ownerParticipationId: file.ownerParticipationId ?? null,
      filename: file.filename,
    },
  };
}

function virusStatus(
  status: string | undefined,
): FileAssetDto["virusScanStatus"] {
  if (
    status === "unscanned" ||
    status === "clean" ||
    status === "infected" ||
    status === "error"
  ) {
    return status;
  }
  return VIRUS_SCAN_UNSCANNED;
}

function rowToDto(row: FileAssetRow): FileAssetDto {
  const purpose = FilePurposeSchema.parse(row.purpose);
  const uploaded =
    typeof row.uploadState === "number"
      ? row.uploadState
      : row.uploaded
        ? 1
        : 0;
  return {
    id: row.id,
    eventId: row.eventId,
    ownerParticipationId: row.ownerParticipationId,
    r2Key: row.r2Key,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    checksum: row.checksum,
    purpose,
    createdAt: row.createdAt,
    uploaded,
    virusScanStatus: virusStatus(row.virusScanStatus),
  };
}

export type CompleteUploadInput = FileCompleteBody & {
  fileId: string;
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
  correlationId: string;
};

/**
 * File.CompleteUpload — set checksum (and optional filename) on a prior presign.
 *
 * Requires an existing file_assets row from File.PresignUpload (complete without
 * presign → 400). Metadata only — never stores bytes. virus_scan_status stays
 * unscanned until a scanner worker exists.
 */
export async function completeFileUpload(
  deps: FilesCommandDeps,
  input: CompleteUploadInput,
): Promise<CommandOk<{ file: FileAssetDto }> | CommandErr> {
  // Lookup by id first; optional eventId must match when provided
  const byId = await deps.design.findFileById(input.fileId);
  if (!byId) {
    // Named assertion: complete without presign → 400 (not 404) so clients
    // cannot probe ids; machine-readable VALIDATION_ERROR.
    return {
      ok: false,
      status: 400,
      error: "No presigned upload found for fileId; call File.PresignUpload first",
      code: "VALIDATION_ERROR",
      details: { fileId: input.fileId },
    };
  }

  if (input.eventId && input.eventId !== byId.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Not found",
      code: "NOT_FOUND",
    };
  }

  const eventId = byId.eventId;
  const event = await deps.events.findEventById(eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const updated = await deps.design.completeFileChecksum(eventId, input.fileId, {
    checksum: input.checksum.trim(),
    filename: input.filename,
  });
  if (!updated) {
    return {
      ok: false,
      status: 400,
      error: "No presigned upload found for fileId; call File.PresignUpload first",
      code: "VALIDATION_ERROR",
      details: { fileId: input.fileId },
    };
  }

  const now = new Date().toISOString();
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
    action: "File.CompleteUpload",
    entityType: "file_asset",
    entityId: input.fileId,
    afterJson: JSON.stringify({
      purpose: updated.purpose,
      checksum: updated.checksum,
      filename: updated.filename,
      r2Key: updated.r2Key,
      virusScanStatus: updated.virusScanStatus ?? VIRUS_SCAN_UNSCANNED,
      // Explicit: no bytes in D1
      bytesStoredInD1: false,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { file: rowToDto(updated) } };
}

/**
 * Roles allowed for portal file purposes (headshot/slides).
 * Logo remains admin-only at the route layer.
 */
export function rolesForFilePurpose(
  purpose: string,
): readonly ("admin" | "speaker")[] {
  if (purpose === "logo") return ["admin"];
  return ["admin", "speaker"];
}
