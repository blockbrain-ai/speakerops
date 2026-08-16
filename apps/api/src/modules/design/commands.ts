/**
 * Design + File domain commands (section 2.4).
 *
 * Design.Get / Design.SetDraft / Design.Publish
 * File.PresignUpload / File.Upload / File.GetPublic (purpose=logo, PNG only)
 * Public published design for CFP (draft isolation)
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  DEFAULT_DESIGN_TOKENS,
  FILE_UPLOAD_MAX_BYTES,
  FILE_PRESIGN_TTL_MS,
  validateContrastGate,
  designTokensToCssVariables,
  softTintFromBrand,
  mimeAllowlistForPurpose,
  isBlockedUploadMime,
  invalidFileSignature,
  VIRUS_SCAN_UNSCANNED,
  type DesignTokens,
  type DesignSetDraftBody,
  type FilePresignBody,
  type FilePurpose,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import {
  type DesignStore,
  type DesignDraftRow,
  type DesignPublishedRow,
  type FileAssetRow,
  FILE_UPLOAD_PENDING,
  newFileId,
} from "./store.js";

export type DesignCommandDeps = {
  design: DesignStore;
  events: EventsStore;
  auth: AuthStore;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

function normalizeTokens(partial: DesignTokens): DesignTokens {
  return {
    brand: partial.brand,
    brandSoft: partial.brandSoft ?? softTintFromBrand(partial.brand),
    radius: partial.radius ?? "soft",
    wordmark: partial.wordmark ?? null,
    logoFileId: partial.logoFileId ?? null,
    brandFg: partial.brandFg ?? null,
  };
}

function toDraftDto(row: DesignDraftRow) {
  return {
    eventId: row.eventId,
    tokens: row.tokens,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toPublishedDto(row: DesignPublishedRow) {
  return {
    eventId: row.eventId,
    tokens: row.tokens,
    version: row.version,
    publishedAt: row.publishedAt,
  };
}

/**
 * Design.Get — draft + published for admin.
 */
export async function getDesign(
  deps: DesignCommandDeps,
  eventId: string,
): Promise<
  CommandOk<{
    draft: ReturnType<typeof toDraftDto> | null;
    published: ReturnType<typeof toPublishedDto> | null;
  }>
  | CommandErr
> {
  const event = await deps.events.findEventById(eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const draft = await deps.design.findDraft(eventId);
  const published = await deps.design.findPublished(eventId);

  return {
    ok: true,
    value: {
      draft: draft ? toDraftDto(draft) : null,
      published: published ? toPublishedDto(published) : null,
    },
  };
}

export type SetDraftInput = DesignSetDraftBody & {
  eventId: string;
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
  correlationId: string;
};

/**
 * Design.SetDraft — save draft tokens (no contrast gate; gate runs on publish).
 */
export async function setDesignDraft(
  deps: DesignCommandDeps,
  input: SetDraftInput,
): Promise<
  CommandOk<{ draft: ReturnType<typeof toDraftDto> }> | CommandErr
> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const existing = await deps.design.findDraft(input.eventId);
  if (existing && input.expectedVersion !== undefined) {
    if (existing.version !== input.expectedVersion) {
      return {
        ok: false,
        status: 409,
        error: "Version conflict",
        code: "CONFLICT",
        details: {
          expectedVersion: input.expectedVersion,
          actual: existing.version,
        },
      };
    }
  }

  // Reject freeform CSS keys if client sneaks them (defense in depth)
  const raw = input.tokens as DesignTokens & { css?: unknown; customCss?: unknown };
  if (raw.css !== undefined || raw.customCss !== undefined) {
    return {
      ok: false,
      status: 400,
      error: "Freeform CSS is not allowed",
      code: "VALIDATION_ERROR",
      details: { forbidden: ["css", "customCss"] },
    };
  }

  if (input.tokens.logoFileId) {
    const file = await deps.design.findFile(
      input.eventId,
      input.tokens.logoFileId,
    );
    if (!file || file.purpose !== "logo" || !file.uploaded) {
      return {
        ok: false,
        status: 400,
        error:
          "logoFileId must reference an uploaded logo file for this event",
        code: "VALIDATION_ERROR",
        details: { logoFileId: input.tokens.logoFileId },
      };
    }
  }

  const now = new Date().toISOString();
  const tokens = normalizeTokens(input.tokens);
  const row: DesignDraftRow = existing
    ? {
        ...existing,
        tokens,
        version: existing.version + 1,
        updatedAt: now,
      }
    : {
        eventId: input.eventId,
        tokens,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };

  const written = await deps.design.upsertDraft(
    row,
    existing ? (input.expectedVersion ?? existing.version) : undefined,
  );
  if (!written) {
    const latest = await deps.design.findDraft(input.eventId);
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion ?? existing?.version,
        actual: latest?.version ?? existing?.version,
      },
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
    action: "Design.SetDraft",
    entityType: "design_token_draft",
    entityId: input.eventId,
    beforeJson: existing
      ? JSON.stringify({ tokens: existing.tokens, version: existing.version })
      : null,
    afterJson: JSON.stringify({ tokens: row.tokens, version: row.version }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { draft: toDraftDto(row) } };
}

export type PublishInput = {
  eventId: string;
  expectedVersion: number;
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
  correlationId: string;
};

/**
 * Design.Publish — contrast gate then copy draft → published.
 */
export async function publishDesign(
  deps: DesignCommandDeps,
  input: PublishInput,
): Promise<
  CommandOk<{ published: ReturnType<typeof toPublishedDto> }> | CommandErr
> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const draft = await deps.design.findDraft(input.eventId);
  if (!draft) {
    return {
      ok: false,
      status: 400,
      error: "No draft to publish",
      code: "VALIDATION_ERROR",
    };
  }

  if (draft.version !== input.expectedVersion) {
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion,
        actual: draft.version,
      },
    };
  }

  const gate = validateContrastGate(draft.tokens);
  if (!gate.ok) {
    return {
      ok: false,
      status: 400,
      error: gate.error,
      code: gate.code,
      details: gate.details,
    };
  }

  const now = new Date().toISOString();
  const prev = await deps.design.findPublished(input.eventId);
  const published: DesignPublishedRow = {
    eventId: input.eventId,
    tokens: gate.tokens,
    version: (prev?.version ?? 0) + 1,
    publishedAt: now,
    publishedBy: input.actorUserId,
  };

  // Persist derived brandFg back onto draft so admin preview matches public
  // Same-version write; gate on the draft version we just validated.
  const draftWritten = await deps.design.upsertDraft(
    {
      ...draft,
      tokens: gate.tokens,
      updatedAt: now,
    },
    draft.version,
  );
  if (!draftWritten) {
    const latest = await deps.design.findDraft(input.eventId);
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion,
        actual: latest?.version ?? draft.version,
      },
    };
  }
  await deps.design.upsertPublished(published);

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
    action: "Design.Publish",
    entityType: "design_token_published",
    entityId: input.eventId,
    beforeJson: prev
      ? JSON.stringify({ tokens: prev.tokens, version: prev.version })
      : null,
    afterJson: JSON.stringify({
      tokens: published.tokens,
      version: published.version,
      brandFg: gate.brandFg,
      contrastRatio: gate.ratio,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { published: toPublishedDto(published) } };
}

/**
 * Public design by event slug — published only (never draft).
 */
export async function getPublicDesign(
  deps: DesignCommandDeps,
  slug: string,
): Promise<
  CommandOk<{
    eventId: string;
    slug: string;
    published: ReturnType<typeof toPublishedDto> | null;
    cssVariables: string | null;
  }>
  | CommandErr
> {
  const event = await deps.events.findEventBySlug(slug);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const published = await deps.design.findPublished(event.id);
  if (!published) {
    return {
      ok: true,
      value: {
        eventId: event.id,
        slug: event.slug,
        published: null,
        cssVariables: null,
      },
    };
  }

  return {
    ok: true,
    value: {
      eventId: event.id,
      slug: event.slug,
      published: toPublishedDto(published),
      cssVariables: designTokensToCssVariables(published.tokens),
    },
  };
}

export type PresignInput = FilePresignBody & {
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
  correlationId: string;
};

function extensionForMime(mime: string, purpose: FilePurpose): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "application/pdf") return "pdf";
  if (purpose === "logo") return "png";
  if (purpose === "headshot") return "jpg";
  if (purpose === "slides") return "pdf";
  return "bin";
}

/**
 * File.PresignUpload — signed upload metadata (D1 only; bytes go to R2 via File.Upload).
 * purpose=logo: PNG only (2.4). purpose=headshot|slides: portal mime allowlists (4.2).
 * Executables (application/x-msdownload etc.) always rejected.
 */
export async function presignFileUpload(
  deps: DesignCommandDeps,
  input: PresignInput,
): Promise<
  CommandOk<{
    fileId: string;
    url: string;
    mime: string;
    purpose: string;
    expiresAt: string;
  }>
  | CommandErr
> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const purpose = input.purpose as FilePurpose;
  const mime = input.mime.trim().toLowerCase();

  // Hard block executables / scripty types (AC: exe rejected)
  if (isBlockedUploadMime(mime) || mime.includes("svg")) {
    return {
      ok: false,
      status: 400,
      error: "Executable or unsafe mime type is not allowed",
      code: "VALIDATION_ERROR",
      details: {
        mime: input.mime,
        purpose,
        allowlist: [...mimeAllowlistForPurpose(purpose)],
      },
    };
  }

  const allowlist = mimeAllowlistForPurpose(purpose);
  if (!allowlist.includes(mime)) {
    const purposeLabel =
      purpose === "logo"
        ? "Logo upload allows image/png only"
        : purpose === "headshot"
          ? "Headshot upload allows image/jpeg or image/png only"
          : purpose === "slides"
            ? "Slides upload allows application/pdf only"
            : "Mime type not allowed for purpose";
    return {
      ok: false,
      status: 400,
      error: purposeLabel,
      code: "VALIDATION_ERROR",
      details: {
        mime: input.mime,
        purpose,
        allowlist: [...allowlist],
      },
    };
  }

  if (input.size > FILE_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      status: 400,
      error: "Declared size exceeds maximum upload size",
      code: "VALIDATION_ERROR",
      details: { size: input.size, max: FILE_UPLOAD_MAX_BYTES },
    };
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const fileId = newFileId();
  const ext = extensionForMime(mime, purpose);
  const defaultName =
    purpose === "logo"
      ? `logo-${fileId}.${ext}`
      : purpose === "headshot"
        ? `headshot-${fileId}.${ext}`
        : purpose === "slides"
          ? `slides-${fileId}.${ext}`
          : `file-${fileId}.${ext}`;
  const filename = input.filename?.trim() || defaultName;
  // R2 object key only — never store bytes in D1 (AC: metadata in D1 not bytes)
  const r2Key = `events/${input.eventId}/${purpose}/${fileId}.${ext}`;
  // expiresAt is created_at + FILE_PRESIGN_TTL_MS (File.Upload enforces the same deadline).
  const expiresAt = new Date(nowMs + FILE_PRESIGN_TTL_MS).toISOString();

  // Portal headshot/slides/other must bind owner_participation_id; logo stays null.
  // purpose=other is used for file-request fulfilment — never null-owner.
  const ownerParticipationId =
    purpose === "logo"
      ? null
      : (input.ownerParticipationId?.trim() || null);
  if (
    (purpose === "headshot" || purpose === "slides" || purpose === "other") &&
    !ownerParticipationId
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "ownerParticipationId is required for headshot, slides, and other uploads",
      code: "VALIDATION_ERROR",
      details: { purpose },
    };
  }

  // Metadata only until client PUTs bytes via File.Upload (not "ready" yet).
  const row: FileAssetRow = {
    id: fileId,
    eventId: input.eventId,
    ownerParticipationId,
    r2Key,
    filename,
    mime,
    size: input.size,
    checksum: null,
    purpose,
    createdAt: now,
    uploaded: false,
    virusScanStatus: VIRUS_SCAN_UNSCANNED,
  };
  await deps.design.insertFile(row);

  // Worker-hosted File.Upload target (COMMANDS.md). Production may later return R2 signed PUT.
  const url = `/api/files/${encodeURIComponent(fileId)}/upload?eventId=${encodeURIComponent(input.eventId)}`;

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
    action: "File.PresignUpload",
    entityType: "file_asset",
    entityId: fileId,
    afterJson: JSON.stringify({
      purpose,
      mime,
      size: input.size,
      r2Key,
      ownerParticipationId,
      uploaded: false,
      virusScanStatus: VIRUS_SCAN_UNSCANNED,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      fileId,
      url,
      mime,
      purpose,
      expiresAt,
    },
  };
}

export type UploadFileInput = {
  eventId: string;
  fileId: string;
  body: ArrayBuffer;
  contentType: string | undefined;
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
  correlationId: string;
};

/**
 * File.Upload — PUT body to presign URL; store PNG bytes; mark file uploaded once.
 *
 * Enforces (COMMANDS.md + FilePresignBodySchema boundary):
 * - presign TTL from created_at + FILE_PRESIGN_TTL_MS (matches returned expiresAt)
 * - body size ≤ presign-declared size and ≤ FILE_UPLOAD_MAX_BYTES (10 MiB)
 * - single-use: atomic claim (uploaded 0→2 in-progress) before any R2 write;
 *   complete (2→1 stored) only after put succeeds. Concurrent losers get 409
 *   without writing bytes or emitting audit. On put failure the claim is
 *   released (2→0) so a client may retry. uploaded=1 never means "claimed only".
 */
export async function uploadFileBytes(
  deps: DesignCommandDeps,
  input: UploadFileInput,
): Promise<
  CommandOk<{ fileId: string; uploaded: true; size: number }> | CommandErr
> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const file = await deps.design.findFile(input.eventId, input.fileId);
  if (!file) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  // Fast-path reject when already stored or claim in flight; authoritative
  // single-use is claimFileUpload (pending→claimed).
  if (file.uploaded || file.uploadState !== FILE_UPLOAD_PENDING) {
    return {
      ok: false,
      status: 409,
      error: "File already uploaded",
      code: "CONFLICT",
      details: { fileId: input.fileId },
    };
  }

  const createdMs = Date.parse(file.createdAt);
  const expiresAtMs = createdMs + FILE_PRESIGN_TTL_MS;
  if (!Number.isFinite(createdMs) || Date.now() > expiresAtMs) {
    return {
      ok: false,
      status: 400,
      error: "Upload URL expired",
      code: "VALIDATION_ERROR",
      details: {
        expiresAt: Number.isFinite(expiresAtMs)
          ? new Date(expiresAtMs).toISOString()
          : null,
      },
    };
  }

  const purpose = file.purpose as FilePurpose;
  const mime = (input.contentType ?? file.mime).trim().toLowerCase();
  if (isBlockedUploadMime(mime)) {
    return {
      ok: false,
      status: 400,
      error: "Executable or unsafe mime type is not allowed",
      code: "VALIDATION_ERROR",
      details: { mime },
    };
  }
  const allowlist = mimeAllowlistForPurpose(purpose);
  if (!allowlist.includes(mime) && mime !== file.mime) {
    return {
      ok: false,
      status: 400,
      error: "Content-Type does not match presigned mime allowlist",
      code: "VALIDATION_ERROR",
      details: { mime, allowlist: [...allowlist], declared: file.mime },
    };
  }
  // Prefer declared presign mime for storage
  const storeMime = file.mime;

  // Size budget: never exceed declared presign size or global 10 MiB cap.
  const declaredSize = file.size;
  const maxAllowed = Math.min(
    Math.max(0, declaredSize),
    FILE_UPLOAD_MAX_BYTES,
  );
  const byteLength = input.body.byteLength;

  if (byteLength === 0) {
    return {
      ok: false,
      status: 400,
      error: "Empty upload body",
      code: "VALIDATION_ERROR",
    };
  }

  if (byteLength > FILE_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      status: 400,
      error: "Upload exceeds maximum size",
      code: "VALIDATION_ERROR",
      details: { max: FILE_UPLOAD_MAX_BYTES, actual: byteLength },
    };
  }

  if (byteLength > maxAllowed) {
    return {
      ok: false,
      status: 400,
      error: "Upload exceeds presigned declared size",
      code: "VALIDATION_ERROR",
      details: {
        declared: declaredSize,
        maxAllowed,
        actual: byteLength,
      },
    };
  }

  // Magic-byte checks for known purposes (defense in depth against content-type spoof)
  const bytes = new Uint8Array(input.body);
  if (purpose === "logo") {
    const sigErr = invalidFileSignature(bytes, "image/png");
    if (sigErr) {
      return {
        ok: false,
        status: 400,
        error: "Logo body must be a PNG image",
        code: "VALIDATION_ERROR",
      };
    }
  } else {
    const sigErr = invalidFileSignature(bytes, storeMime);
    if (sigErr) {
      return {
        ok: false,
        status: 400,
        error: sigErr,
        code: "VALIDATION_ERROR",
      };
    }
  }

  // Claim ownership (pending→claimed) before writing bytes so concurrent PUTs
  // cannot both land. Claimed is not "uploaded" — SetDraft still rejects.
  const claimed = await deps.design.claimFileUpload(
    input.eventId,
    input.fileId,
    { size: byteLength },
  );
  if (!claimed) {
    return {
      ok: false,
      status: 409,
      error: "File already uploaded",
      code: "CONFLICT",
      details: { fileId: input.fileId },
    };
  }

  try {
    await deps.design.putFileBytes(input.eventId, input.fileId, {
      bytes: input.body,
      mime: storeMime,
    });
    // Mark stored only after bytes are durable. Worker death between claim and
    // here leaves uploadState=claimed (not ready), not a false uploaded=1.
    const completed = await deps.design.completeFileUpload(
      input.eventId,
      input.fileId,
    );
    if (!completed) {
      await deps.design.releaseFileUploadClaim(input.eventId, input.fileId, {
        size: declaredSize,
      });
      return {
        ok: false,
        status: 400,
        error: "Upload storage failed",
        code: "VALIDATION_ERROR",
        details: { fileId: input.fileId },
      };
    }
  } catch {
    // Failure recovery: release claim + restore declared size so a client may retry.
    await deps.design.releaseFileUploadClaim(input.eventId, input.fileId, {
      size: declaredSize,
    });
    return {
      ok: false,
      status: 400,
      error: "Upload storage failed",
      code: "VALIDATION_ERROR",
      details: { fileId: input.fileId },
    };
  }

  const now = new Date().toISOString();
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
    action: "File.Upload",
    entityType: "file_asset",
    entityId: input.fileId,
    afterJson: JSON.stringify({
      purpose,
      mime: storeMime,
      size: byteLength,
      uploaded: true,
      virusScanStatus: file.virusScanStatus ?? VIRUS_SCAN_UNSCANNED,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: { fileId: input.fileId, uploaded: true, size: byteLength },
  };
}

/**
 * File.GetPublic — public logo bytes by fileId only when the file is the logo
 * referenced by the event's *published* design tokens (draft-only uploads stay private).
 */
export async function getPublicFileBytes(
  deps: DesignCommandDeps,
  fileId: string,
): Promise<
  CommandOk<{ bytes: ArrayBuffer; mime: string; eventId: string }> | CommandErr
> {
  const file = await deps.design.findFileById(fileId);
  if (!file || !file.uploaded || file.purpose !== "logo") {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const published = await deps.design.findPublished(file.eventId);
  if (!published || published.tokens.logoFileId !== file.id) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const blob = await deps.design.getFileBytes(file.eventId, file.id);
  if (!blob) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  return {
    ok: true,
    value: { bytes: blob.bytes, mime: blob.mime, eventId: file.eventId },
  };
}

/** Ensure draft exists with defaults (optional helper for tests). */
export function defaultTokens(): DesignTokens {
  return { ...DEFAULT_DESIGN_TOKENS };
}
