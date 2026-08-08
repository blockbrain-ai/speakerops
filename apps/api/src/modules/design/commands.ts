/**
 * Design + File domain commands (section 2.4).
 *
 * Design.Get / Design.SetDraft / Design.Publish
 * File.PresignUpload (purpose=logo, PNG only)
 * Public published design for CFP (draft isolation)
 */
import {
  uuidv7,
  DEFAULT_DESIGN_TOKENS,
  LOGO_MIME_ALLOWLIST,
  validateContrastGate,
  designTokensToCssVariables,
  softTintFromBrand,
  type DesignTokens,
  type DesignSetDraftBody,
  type FilePresignBody,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import {
  type DesignStore,
  type DesignDraftRow,
  type DesignPublishedRow,
  type FileAssetRow,
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

  await deps.design.upsertDraft(row);

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
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
  await deps.design.upsertDraft({
    ...draft,
    tokens: gate.tokens,
    updatedAt: now,
  });
  await deps.design.upsertPublished(published);

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
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
  correlationId: string;
};

/**
 * File.PresignUpload — purpose=logo requires image/png only (SVG rejected).
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

  const mime = input.mime.trim().toLowerCase();

  if (input.purpose === "logo") {
    // Explicit SVG / scripty rejection (C09)
    if (
      mime === "image/svg+xml" ||
      mime.includes("svg") ||
      mime === "text/html" ||
      mime === "application/javascript" ||
      mime === "text/javascript"
    ) {
      return {
        ok: false,
        status: 400,
        error: "SVG and executable logo types are not allowed",
        code: "VALIDATION_ERROR",
        details: {
          mime: input.mime,
          allowlist: [...LOGO_MIME_ALLOWLIST],
        },
      };
    }
    if (!(LOGO_MIME_ALLOWLIST as readonly string[]).includes(mime)) {
      return {
        ok: false,
        status: 400,
        error: "Logo upload allows image/png only",
        code: "VALIDATION_ERROR",
        details: {
          mime: input.mime,
          allowlist: [...LOGO_MIME_ALLOWLIST],
        },
      };
    }
  } else {
    // Other purposes reserved for later sections; deny for now
    return {
      ok: false,
      status: 400,
      error: "Only purpose=logo is supported in this section",
      code: "VALIDATION_ERROR",
      details: { purpose: input.purpose },
    };
  }

  const now = new Date().toISOString();
  const fileId = newFileId();
  const filename = input.filename?.trim() || `logo-${fileId}.png`;
  const r2Key = `events/${input.eventId}/logo/${fileId}.png`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Metadata only until client PUTs bytes to the upload URL (not "ready" yet).
  const row: FileAssetRow = {
    id: fileId,
    eventId: input.eventId,
    ownerParticipationId: null,
    r2Key,
    filename,
    mime,
    size: input.size,
    checksum: null,
    purpose: "logo",
    createdAt: now,
    uploaded: false,
  };
  await deps.design.insertFile(row);

  // Local/dev and production share the same upload handler path.
  const url = `/api/files/${encodeURIComponent(fileId)}/upload?eventId=${encodeURIComponent(input.eventId)}`;

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "File.PresignUpload",
    entityType: "file_asset",
    entityId: fileId,
    afterJson: JSON.stringify({
      purpose: "logo",
      mime,
      size: input.size,
      r2Key,
      uploaded: false,
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
      purpose: "logo",
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
  correlationId: string;
};

/**
 * PUT body to presign URL — store PNG bytes; mark file uploaded.
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
  if (!file || file.purpose !== "logo") {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const mime = (input.contentType ?? file.mime).trim().toLowerCase();
  if (!(LOGO_MIME_ALLOWLIST as readonly string[]).includes(mime)) {
    return {
      ok: false,
      status: 400,
      error: "Logo upload allows image/png only",
      code: "VALIDATION_ERROR",
      details: { mime, allowlist: [...LOGO_MIME_ALLOWLIST] },
    };
  }

  // PNG magic bytes check (defense in depth against content-type spoof)
  const bytes = new Uint8Array(input.body);
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (!isPng) {
    return {
      ok: false,
      status: 400,
      error: "Logo body must be a PNG image",
      code: "VALIDATION_ERROR",
    };
  }

  if (bytes.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Empty upload body",
      code: "VALIDATION_ERROR",
    };
  }

  await deps.design.putFileBytes(input.eventId, input.fileId, {
    bytes: input.body,
    mime: "image/png",
  });
  await deps.design.updateFileAfterUpload(input.eventId, input.fileId, {
    size: bytes.length,
    uploaded: true,
  });

  const now = new Date().toISOString();
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "File.Upload",
    entityType: "file_asset",
    entityId: input.fileId,
    afterJson: JSON.stringify({
      purpose: "logo",
      mime: "image/png",
      size: bytes.length,
      uploaded: true,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: { fileId: input.fileId, uploaded: true, size: bytes.length },
  };
}

/**
 * Public logo bytes by fileId (only if uploaded).
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
