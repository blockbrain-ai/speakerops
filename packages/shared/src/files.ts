import { z } from "zod";
import {
  FilePurposeSchema,
  FILE_UPLOAD_MAX_BYTES,
  FILE_PRESIGN_TTL_MS,
  LOGO_MIME_ALLOWLIST,
  SafeUploadFilenameSchema,
} from "./design.js";

/**
 * File upload DTOs (section 4.2 — R2 portal uploads).
 * Commands: File.PresignUpload / File.Upload / File.CompleteUpload / File.GetPublic
 * Presign body/response schemas live in design.ts (2.4); complete + mime maps here.
 */

/** Virus scan status stub (SCHEMA.md file_assets.virus_scan_status). */
export const VirusScanStatusSchema = z.enum([
  "unscanned",
  "clean",
  "infected",
  "error",
]);
export type VirusScanStatus = z.infer<typeof VirusScanStatusSchema>;

export const VIRUS_SCAN_UNSCANNED = "unscanned" as const;

/** Headshot mime allowlist — JPEG + PNG (AC: headshot jpeg ok). */
export const HEADSHOT_MIME_ALLOWLIST = ["image/jpeg", "image/png"] as const;
export type HeadshotMime = (typeof HEADSHOT_MIME_ALLOWLIST)[number];

/** Slides mime allowlist — PDF only in dogfood. */
export const SLIDES_MIME_ALLOWLIST = ["application/pdf"] as const;
export type SlidesMime = (typeof SLIDES_MIME_ALLOWLIST)[number];

/**
 * Explicitly blocked executable / script types (AC: exe rejected).
 * application/x-msdownload is Windows PE; also block common script containers.
 */
export const BLOCKED_UPLOAD_MIMES = [
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-dosexec",
  "application/vnd.microsoft.portable-executable",
  "application/x-sh",
  "application/x-bat",
  "application/x-msi",
  "application/javascript",
  "text/javascript",
  "text/html",
  "image/svg+xml",
] as const;

/** Resolve purpose → mime allowlist (closed set; no freeform). */
export function mimeAllowlistForPurpose(
  purpose: z.infer<typeof FilePurposeSchema>,
): readonly string[] {
  switch (purpose) {
    case "logo":
      return LOGO_MIME_ALLOWLIST;
    case "headshot":
      return HEADSHOT_MIME_ALLOWLIST;
    case "slides":
      return SLIDES_MIME_ALLOWLIST;
    case "other":
      // CFP path uses its own allowlist; portal "other" stays closed.
      return [...HEADSHOT_MIME_ALLOWLIST, ...SLIDES_MIME_ALLOWLIST];
    default:
      return [];
  }
}

/** True when mime is on the blocklist (executables / XSS vectors). */
export function isBlockedUploadMime(mime: string): boolean {
  const m = mime.trim().toLowerCase();
  return (BLOCKED_UPLOAD_MIMES as readonly string[]).includes(m);
}

/** Full PNG signature (89 50 4E 47 0D 0A 1A 0A). */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Magic-byte check for declared image/pdf bodies (CFP + authenticated upload).
 * Returns an error string when the payload does not match `mime`; null if ok
 * or when `mime` is not a signed type we know how to verify.
 */
export function invalidFileSignature(
  bytes: Uint8Array,
  mime: string,
): string | null {
  const m = mime.trim().toLowerCase();
  if (m === "image/png") {
    if (
      bytes.length < PNG_SIG.length ||
      PNG_SIG.some((b, i) => bytes[i] !== b)
    ) {
      return "PNG body signature invalid";
    }
    return null;
  }
  if (m === "image/jpeg") {
    if (
      bytes.length < 3 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[2] !== 0xff
    ) {
      return "JPEG body signature invalid";
    }
    return null;
  }
  if (m === "application/pdf") {
    if (
      bytes.length < 4 ||
      bytes[0] !== 0x25 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x44 ||
      bytes[3] !== 0x46
    ) {
      return "PDF body signature invalid";
    }
    return null;
  }
  return null;
}

/**
 * Safe Content-Disposition filename token. Hostile CR/LF/" / \\ become
 * `file`; empty after strip also falls back.
 */
export function sanitizeContentDispositionFilename(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/^_+|_+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  return cleaned.slice(0, 180);
}

/**
 * File.CompleteUpload body — POST /api/files/:fileId/complete
 * Sets content checksum; optional filename for I16 field-flow.
 */
export const FileCompleteBodySchema = z.object({
  /** Content digest (hex sha-256 preferred; opaque string accepted ≤128). */
  checksum: z.string().min(1).max(128),
  /** Optional event scope hint (validated against file row when present). */
  eventId: z.string().min(1).optional(),
  /** Optional final filename (portal I16: CompleteUpload → file_assets.filename). */
  filename: SafeUploadFilenameSchema.optional(),
});
export type FileCompleteBody = z.infer<typeof FileCompleteBodySchema>;

/** file_assets metadata DTO (never includes bytes). */
export const FileAssetDtoSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  ownerParticipationId: z.string().nullable(),
  r2Key: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  checksum: z.string().nullable(),
  purpose: FilePurposeSchema,
  createdAt: z.string().min(1),
  uploaded: z.number().int().min(0).max(2),
  virusScanStatus: VirusScanStatusSchema,
});
export type FileAssetDto = z.infer<typeof FileAssetDtoSchema>;

/** File.CompleteUpload response */
export const FileCompleteResponseSchema = z.object({
  file: FileAssetDtoSchema,
});
export type FileCompleteResponse = z.infer<typeof FileCompleteResponseSchema>;

export { FILE_UPLOAD_MAX_BYTES, FILE_PRESIGN_TTL_MS, LOGO_MIME_ALLOWLIST };
