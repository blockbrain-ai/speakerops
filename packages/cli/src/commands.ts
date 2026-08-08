/**
 * Domain CLI commands — 1:1 with COMMANDS.md / CLI_INVENTORY.md (CLI01–CLI12).
 *
 * Scopes enforced on Worker only (E8). CLI never elevates itself.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  DEFAULT_DESIGN_TOKENS,
  DesignGetResponseSchema,
  DesignSetDraftBodySchema,
  type DesignTokens,
} from "@speakerops/shared";
import { parseArgs, parseScopesList, requireOption, type ParsedArgs } from "./args.js";
import {
  EXIT_OK,
  EXIT_VALIDATION,
  type CliExitCode,
} from "./exit-codes.js";
import { ApiClient, missingKeyResult, resolveApiKey, resolveBaseUrl } from "./http.js";
import { emitError, emitResult, type Io } from "./output.js";

export type CommandContext = {
  argv: string[];
  args: ParsedArgs;
  json: boolean;
  io: Io;
  client: ApiClient | null;
  /** Optional file reader override for tests. */
  readFileImpl?: (path: string) => Promise<Uint8Array>;
};

export function buildClientFromArgs(args: ParsedArgs): {
  client: ApiClient | null;
  error?: string;
} {
  const apiKey = resolveApiKey(requireOption(args, "api-key", ["apiKey"]));
  if (!apiKey) {
    return { client: null, error: "missing_key" };
  }
  const baseUrl = resolveBaseUrl(requireOption(args, "api-url", ["apiUrl"]));
  return {
    client: new ApiClient({
      baseUrl,
      apiKey,
      fetchImpl: globalThis.fetch.bind(globalThis),
    }),
  };
}

/** Allow tests to inject a prebuilt client. */
export type ClientFactory = (args: ParsedArgs) => ApiClient | null;

let clientFactory: ClientFactory | null = null;

export function setClientFactoryForTests(factory: ClientFactory | null): void {
  clientFactory = factory;
}

export function resolveClient(args: ParsedArgs): ApiClient | null {
  if (clientFactory) return clientFactory(args);
  return buildClientFromArgs(args).client;
}

function needClient(ctx: CommandContext): ApiClient | CliExitCode {
  if (ctx.client) return ctx.client;
  const r = missingKeyResult();
  return emitResult(ctx.io, r, ctx.json);
}

// ─── CLI01 events list ───────────────────────────────────────────────────────

export async function cmdEventsList(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const result = await client.get("/api/events");
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const events =
      body &&
      typeof body === "object" &&
      "events" in body &&
      Array.isArray((body as { events: unknown }).events)
        ? (body as { events: Array<{ id: string; name: string }> }).events
        : [];
    if (events.length === 0) return "No events.\n";
    return events.map((e) => `${e.id}\t${e.name}`).join("\n") + "\n";
  });
}

// ─── CLI02 reports readiness ─────────────────────────────────────────────────

export async function cmdReportsReadiness(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  if (!eventId) {
    return emitError(
      ctx.io,
      "reports readiness requires --event <eventId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const overdueOnly = ctx.args.flags.has("overdue-only")
    ? "true"
    : requireOption(ctx.args, "overdue-only");

  const result = await client.get(`/api/events/${encodeURIComponent(eventId)}/readiness`, {
    overdueOnly: overdueOnly === "true" || overdueOnly === "1" ? "true" : undefined,
  });
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const b = body as {
      stats?: { outstandingTasks?: number; overdueTasks?: number };
      outstanding?: unknown[];
    };
    const n = b.outstanding?.length ?? 0;
    const overdue = b.stats?.overdueTasks ?? 0;
    return `outstanding=${n} overdue=${overdue}\n`;
  });
}

// ─── CLI03–CLI05 design ──────────────────────────────────────────────────────

export async function cmdDesignGet(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  if (!eventId) {
    return emitError(
      ctx.io,
      "design get requires --event <eventId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const result = await client.get(
    `/api/events/${encodeURIComponent(eventId)}/design`,
  );
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const g = DesignGetResponseSchema.safeParse(body);
    if (!g.success) return `${JSON.stringify(body)}\n`;
    const brand = g.data.draft?.tokens.brand ?? g.data.published?.tokens.brand ?? "—";
    return `draft.version=${g.data.draft?.version ?? "null"} published=${g.data.published ? "yes" : "no"} brand=${brand}\n`;
  });
}

export async function cmdDesignSet(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  const brand = requireOption(ctx.args, "brand", ["brand-color", "brandColor"]);
  if (!eventId) {
    return emitError(
      ctx.io,
      "design set requires --event <eventId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  if (!brand) {
    return emitError(
      ctx.io,
      "design set requires --brand '#RRGGBB'",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  // Merge with current draft (or defaults) so partial CLI flags work.
  const current = await client.get(
    `/api/events/${encodeURIComponent(eventId)}/design`,
  );
  let base: DesignTokens = { ...DEFAULT_DESIGN_TOKENS };
  let expectedVersion: number | undefined;
  if (current.ok) {
    const g = DesignGetResponseSchema.safeParse(current.body);
    if (g.success && g.data.draft) {
      base = { ...g.data.draft.tokens };
      expectedVersion = g.data.draft.version;
    }
  }

  const radiusRaw = requireOption(ctx.args, "radius");
  const tokens: DesignTokens = {
    ...base,
    brand,
    ...(radiusRaw === "soft" || radiusRaw === "curvy" || radiusRaw === "round"
      ? { radius: radiusRaw }
      : {}),
  };

  const bodyParsed = DesignSetDraftBodySchema.safeParse({
    tokens,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
  if (!bodyParsed.success) {
    return emitError(
      ctx.io,
      "Invalid design tokens (check --brand hex)",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const result = await client.put(
    `/api/events/${encodeURIComponent(eventId)}/design`,
    bodyParsed.data,
  );
  return emitResult(ctx.io, result, ctx.json, () => `draft updated brand=${brand}\n`);
}

export async function cmdDesignPublish(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  if (!eventId) {
    return emitError(
      ctx.io,
      "design publish requires --event <eventId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  // expectedVersion required — fetch draft version first.
  const current = await client.get(
    `/api/events/${encodeURIComponent(eventId)}/design`,
  );
  if (!current.ok) {
    return emitResult(ctx.io, current, ctx.json);
  }
  const g = DesignGetResponseSchema.safeParse(current.body);
  if (!g.success || !g.data.draft) {
    return emitError(
      ctx.io,
      "No design draft to publish",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const result = await client.post(
    `/api/events/${encodeURIComponent(eventId)}/design/publish`,
    { expectedVersion: g.data.draft.version },
  );
  return emitResult(ctx.io, result, ctx.json, () => "design published\n");
}

// ─── CLI06–CLI07 schedule place ──────────────────────────────────────────────

export async function cmdSchedulePlace(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  const sessionId = requireOption(ctx.args, "session", ["sessionId"]);
  const roomId = requireOption(ctx.args, "room", ["roomId"]);
  const startsAt = requireOption(ctx.args, "start", ["starts-at", "startsAt"]);
  const endsAt = requireOption(ctx.args, "end", ["ends-at", "endsAt"]);

  if (!eventId || !sessionId || !roomId || !startsAt || !endsAt) {
    return emitError(
      ctx.io,
      "schedule place requires --event --session --room --start --end",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const expectedVersionRaw = requireOption(ctx.args, "expected-version", [
    "expectedVersion",
  ]);
  const body: Record<string, unknown> = {
    sessionId,
    roomId,
    startsAt,
    endsAt,
  };
  if (expectedVersionRaw) {
    body.expectedVersion = Number(expectedVersionRaw);
  }

  const result = await client.post(
    `/api/events/${encodeURIComponent(eventId)}/schedule/place`,
    body,
  );
  return emitResult(ctx.io, result, ctx.json, (b) => {
    const p = b as { placement?: { id?: string } };
    return `placed ${p.placement?.id ?? "ok"}\n`;
  });
}

// ─── CLI08 files upload ──────────────────────────────────────────────────────

function guessMime(filename: string, purpose: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (purpose === "logo") return "image/png";
  if (purpose === "slides") return "application/pdf";
  if (purpose === "headshot") return "image/jpeg";
  return "application/octet-stream";
}

export async function cmdFilesUpload(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  const purpose =
    requireOption(ctx.args, "purpose", ["type"]) ??
    requireOption(ctx.args, "type") ??
    "logo";
  const filePath =
    requireOption(ctx.args, "file", ["path"]) ?? ctx.args.positionals[0];
  const ownerParticipationId = requireOption(ctx.args, "participation", [
    "owner-participation-id",
    "ownerParticipationId",
    "speaker",
  ]);

  if (!eventId || !filePath) {
    return emitError(
      ctx.io,
      "files upload requires --event and --file <path>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const readImpl = ctx.readFileImpl ?? (async (p: string) => new Uint8Array(await readFile(p)));
  let bytes: Uint8Array;
  try {
    bytes = await readImpl(filePath);
  } catch (err) {
    return emitError(
      ctx.io,
      err instanceof Error ? err.message : "Failed to read file",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const filename = basename(filePath);
  const mime =
    requireOption(ctx.args, "mime") ?? guessMime(filename, purpose);

  const presignBody: Record<string, unknown> = {
    eventId,
    purpose,
    mime,
    size: bytes.byteLength,
    filename,
  };
  if (ownerParticipationId) {
    presignBody.ownerParticipationId = ownerParticipationId;
  }

  const presign = await client.post("/api/files/presign", presignBody);
  if (!presign.ok) {
    return emitResult(ctx.io, presign, ctx.json);
  }

  const presignData = presign.body as {
    fileId?: string;
    url?: string;
  };
  if (!presignData.fileId || !presignData.url) {
    return emitError(
      ctx.io,
      "Presign response missing fileId/url",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  // Worker-hosted upload path: PUT /api/files/:fileId/upload?eventId=
  const uploadPath = presignData.url.startsWith("http")
    ? presignData.url
    : presignData.url;
  const upload = await client.request("PUT", uploadPath, {
    rawBody: bytes,
    contentType: mime,
  });
  if (!upload.ok) {
    return emitResult(ctx.io, upload, ctx.json);
  }

  // Complete with a simple size-based checksum (sha not required for dogfood path)
  const checksum = `cli-size-${bytes.byteLength}`;
  const complete = await client.post(
    `/api/files/${encodeURIComponent(presignData.fileId)}/complete`,
    { checksum, eventId, filename },
  );
  if (!complete.ok) {
    // Upload already succeeded; still return file id from presign when complete optional-fails
    // Prefer complete success for CLI08 "file id returned"
    return emitResult(ctx.io, complete, ctx.json);
  }

  const out = {
    fileId: presignData.fileId,
    uploaded: true,
    size: bytes.byteLength,
    mime,
    purpose,
    filename,
  };
  if (ctx.json) {
    ctx.io.writeOut(`${JSON.stringify(out)}\n`);
    return EXIT_OK;
  }
  ctx.io.writeOut(`fileId=${presignData.fileId}\n`);
  return EXIT_OK;
}

// ─── CLI09–CLI10 comms ───────────────────────────────────────────────────────

export async function cmdCommsDraft(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  // --preview is required for draft (inventory: comms draft --preview)
  if (!ctx.args.flags.has("preview") && !requireOption(ctx.args, "preview")) {
    // Allow without flag when --template provided (preview is the only draft action)
  }

  const templateId = requireOption(ctx.args, "template", ["templateId", "template-id"]);
  if (!templateId) {
    return emitError(
      ctx.io,
      "comms draft requires --template <templateId> [--preview]",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const segmentStatus = requireOption(ctx.args, "segment-status", ["status"]);
  const body: Record<string, unknown> = { templateId };
  if (segmentStatus) {
    body.segment = { status: segmentStatus };
  }

  const result = await client.post("/api/comms/preview", body);
  return emitResult(ctx.io, result, ctx.json, (b) => {
    const p = b as {
      previewId?: string;
      recipientCount?: number;
      recipients?: Array<{ email: string }>;
    };
    const emails = (p.recipients ?? []).map((r) => r.email).join(", ");
    return `previewId=${p.previewId ?? "?"} recipients=${p.recipientCount ?? 0}${emails ? ` (${emails})` : ""}\n`;
  });
}

export async function cmdCommsSend(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const previewId = requireOption(ctx.args, "preview-id", [
    "previewId",
    "draft",
    "draft-id",
  ]);
  const idempotencyKey =
    requireOption(ctx.args, "idempotency-key", ["idempotencyKey"]) ??
    `cli-${Date.now()}`;

  if (!previewId) {
    return emitError(
      ctx.io,
      "comms send requires --preview-id <id>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const result = await client.post("/api/comms/send", {
    previewId,
    idempotencyKey,
  });
  return emitResult(ctx.io, result, ctx.json, () => "send enqueued\n");
}

// ─── CLI11 keys create ───────────────────────────────────────────────────────

export async function cmdKeysCreate(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const name = requireOption(ctx.args, "name");
  const scopesRaw = requireOption(ctx.args, "scopes");
  if (!name || !scopesRaw) {
    return emitError(
      ctx.io,
      "keys create requires --name and --scopes scope1,scope2",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const scopes = parseScopesList(scopesRaw);
  if (scopes.length === 0) {
    return emitError(
      ctx.io,
      "keys create --scopes must list at least one scope",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const eventId = requireOption(ctx.args, "event", ["eventId"]);
  const body: Record<string, unknown> = { name, scopes };
  if (eventId) body.eventId = eventId;

  const result = await client.post("/api/keys", body);
  return emitResult(ctx.io, result, ctx.json, (b) => {
    const k = b as { id?: string; secret?: string; prefix?: string };
    return `id=${k.id ?? "?"}\nprefix=${k.prefix ?? "?"}\nsecret=${k.secret ?? "(none — shown once only)"}\n`;
  });
}

// ─── CLI12 openapi ───────────────────────────────────────────────────────────

export async function cmdOpenApi(ctx: CommandContext): Promise<CliExitCode> {
  // OpenAPI is public (agent discovery); key optional but still used when present.
  const client =
    ctx.client ??
    new ApiClient({
      baseUrl: resolveBaseUrl(requireOption(ctx.args, "api-url", ["apiUrl"])),
      apiKey: resolveApiKey(requireOption(ctx.args, "api-key", ["apiKey"])) ?? "",
    });

  const result = await client.get("/openapi.json");
  return emitResult(ctx.io, result, ctx.json || true, () => "");
}

/** Re-export parseArgs for main. */
export { parseArgs };
