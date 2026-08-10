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
  // Optional bind headshot onto speaker participation (Speakers.UpdateProfile)
  const bindProfile =
    ctx.args.flags.has("bind-profile") ||
    ctx.args.flags.has("bind") ||
    Boolean(requireOption(ctx.args, "bind-profile"));
  if (bindProfile && purpose === "headshot" && ownerParticipationId) {
    const detail = await client.get(
      `/api/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(ownerParticipationId)}`,
    );
    if (!detail.ok) {
      return emitResult(ctx.io, detail, ctx.json);
    }
    const part = (detail.body as { participation?: { version?: number } })
      .participation;
    if (!part?.version) {
      return emitError(
        ctx.io,
        "Speaker detail missing version for profile bind",
        "VALIDATION_ERROR",
        EXIT_VALIDATION,
        ctx.json,
      );
    }
    const patch = await client.request(
      "PATCH",
      `/api/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(ownerParticipationId)}`,
      {
        body: {
          headshotFileId: presignData.fileId,
          expectedVersion: part.version,
        },
      },
    );
    if (!patch.ok) {
      return emitResult(ctx.io, patch, ctx.json);
    }
    (out as { headshotBound?: boolean }).headshotBound = true;
  }

  if (ctx.json) {
    ctx.io.writeOut(`${JSON.stringify(out)}\n`);
    return EXIT_OK;
  }
  ctx.io.writeOut(
    `fileId=${presignData.fileId}${
      (out as { headshotBound?: boolean }).headshotBound ? " headshotBound=true" : ""
    }\n`,
  );
  return EXIT_OK;
}

// ─── Speakers.UpdateProfile (admin / CLI) ────────────────────────────────────

export async function cmdSpeakersUpdateProfile(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  const participationId = requireOption(ctx.args, "participation", [
    "participation-id",
    "speaker",
    "id",
  ]);
  if (!eventId || !participationId) {
    return emitError(
      ctx.io,
      "speakers update-profile requires --event and --participation",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  const bio = requireOption(ctx.args, "bio");
  const company = requireOption(ctx.args, "company");
  const title = requireOption(ctx.args, "title");
  const headshotFileId = requireOption(ctx.args, "headshot-file-id", [
    "headshotFileId",
    "headshot",
  ]);
  const expectedVersionRaw = requireOption(ctx.args, "expected-version", [
    "version",
  ]);

  if (
    bio === undefined &&
    company === undefined &&
    title === undefined &&
    headshotFileId === undefined
  ) {
    return emitError(
      ctx.io,
      "Provide at least one of --bio --company --title --headshot-file-id",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }

  let expectedVersion = expectedVersionRaw
    ? Number(expectedVersionRaw)
    : undefined;
  if (expectedVersion === undefined || !Number.isFinite(expectedVersion)) {
    const detail = await client.get(
      `/api/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(participationId)}`,
    );
    if (!detail.ok) {
      return emitResult(ctx.io, detail, ctx.json);
    }
    const part = (detail.body as { participation?: { version?: number } })
      .participation;
    if (!part?.version) {
      return emitError(
        ctx.io,
        "Could not resolve expectedVersion from Speakers.Get",
        "VALIDATION_ERROR",
        EXIT_VALIDATION,
        ctx.json,
      );
    }
    expectedVersion = part.version;
  }

  const body: Record<string, unknown> = { expectedVersion };
  if (bio !== undefined) body.bio = bio === "" ? null : bio;
  if (company !== undefined) body.company = company === "" ? null : company;
  if (title !== undefined) body.title = title === "" ? null : title;
  if (headshotFileId !== undefined) {
    body.headshotFileId = headshotFileId === "" ? null : headshotFileId;
  }

  const result = await client.request(
    "PATCH",
    `/api/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(participationId)}`,
    { body },
  );
  return emitResult(ctx.io, result, ctx.json, (b) => {
    const p = b as {
      participation?: {
        id?: string;
        version?: number;
        bio?: string | null;
        company?: string | null;
        title?: string | null;
        headshotFileId?: string | null;
      };
    };
    const part = p.participation;
    return `updated ${part?.id ?? participationId} v${part?.version ?? "?"}\n`;
  });
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

// ─── forms (cfp:read / cfp:write) ────────────────────────────────────────────

export async function cmdFormsList(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  if (!eventId) {
    return emitError(
      ctx.io,
      "forms list requires --event <eventId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const result = await client.get(
    `/api/events/${encodeURIComponent(eventId)}/forms`,
  );
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const forms =
      body &&
      typeof body === "object" &&
      "forms" in body &&
      Array.isArray((body as { forms: unknown }).forms)
        ? (body as { forms: Array<{ id: string; name: string; status?: string }> })
            .forms
        : [];
    if (forms.length === 0) return "No forms.\n";
    return (
      forms.map((f) => `${f.id}\t${f.name}\t${f.status ?? ""}`).join("\n") +
      "\n"
    );
  });
}

export async function cmdFormsGet(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const formId =
    requireOption(ctx.args, "form", ["formId", "id"]) ??
    ctx.args.positionals[0];
  if (!formId) {
    return emitError(
      ctx.io,
      "forms get requires --form <formId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const result = await client.get(`/api/forms/${encodeURIComponent(formId)}`);
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const b = body as {
      form?: { id?: string; name?: string; status?: string };
      draft?: { fields?: unknown[] };
    };
    return `form=${b.form?.id ?? formId} name=${b.form?.name ?? "?"} status=${b.form?.status ?? "?"} fields=${b.draft?.fields?.length ?? 0}\n`;
  });
}

export async function cmdFormsCreate(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  const name = requireOption(ctx.args, "name");
  if (!eventId || !name) {
    return emitError(
      ctx.io,
      "forms create requires --event <eventId> --name <name>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const result = await client.post(
    `/api/events/${encodeURIComponent(eventId)}/forms`,
    { name },
  );
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const b = body as { form?: { id?: string; name?: string } };
    return `created ${b.form?.id ?? "ok"} name=${b.form?.name ?? name}\n`;
  });
}

export async function cmdFormsDraft(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const formId =
    requireOption(ctx.args, "form", ["formId", "id"]) ??
    ctx.args.positionals[0];
  const fieldsJson = requireOption(ctx.args, "fields", ["fields-json"]);
  if (!formId || !fieldsJson) {
    return emitError(
      ctx.io,
      "forms draft requires --form <formId> --fields <json-array>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  let fields: unknown;
  try {
    fields = JSON.parse(fieldsJson);
  } catch {
    return emitError(
      ctx.io,
      "forms draft --fields must be valid JSON",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const body: Record<string, unknown> = { fields };
  const rulesJson = requireOption(ctx.args, "rules", ["rules-json"]);
  if (rulesJson) {
    try {
      body.rules = JSON.parse(rulesJson);
    } catch {
      return emitError(
        ctx.io,
        "forms draft --rules must be valid JSON",
        "VALIDATION_ERROR",
        EXIT_VALIDATION,
        ctx.json,
      );
    }
  }
  const welcomeMd = requireOption(ctx.args, "welcome-md", ["welcomeMd"]);
  if (welcomeMd !== undefined && welcomeMd !== null) body.welcomeMd = welcomeMd;
  const thankYouMd = requireOption(ctx.args, "thank-you-md", ["thankYouMd"]);
  if (thankYouMd !== undefined && thankYouMd !== null) {
    body.thankYouMd = thankYouMd;
  }
  const opensAt = requireOption(ctx.args, "opens-at", ["opensAt"]);
  if (opensAt !== undefined && opensAt !== null) body.opensAt = opensAt;
  const closesAt = requireOption(ctx.args, "closes-at", ["closesAt"]);
  if (closesAt !== undefined && closesAt !== null) body.closesAt = closesAt;
  const submissionLimit = requireOption(ctx.args, "submission-limit", [
    "submissionLimit",
  ]);
  if (submissionLimit) {
    const n = Number(submissionLimit);
    if (!Number.isFinite(n) || n < 1) {
      return emitError(
        ctx.io,
        "forms draft --submission-limit must be a positive integer",
        "VALIDATION_ERROR",
        EXIT_VALIDATION,
        ctx.json,
      );
    }
    body.submissionLimit = Math.trunc(n);
  }
  const result = await client.request(
    "PUT",
    `/api/forms/${encodeURIComponent(formId)}/draft`,
    { body },
  );
  return emitResult(ctx.io, result, ctx.json, () => `draft updated ${formId}\n`);
}

export async function cmdFormsPublish(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const formId =
    requireOption(ctx.args, "form", ["formId", "id"]) ??
    ctx.args.positionals[0];
  if (!formId) {
    return emitError(
      ctx.io,
      "forms publish requires --form <formId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const result = await client.post(
    `/api/forms/${encodeURIComponent(formId)}/publish`,
    {},
  );
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const b = body as {
      formVersion?: { id?: string; versionNum?: number };
    };
    return `published ${formId} version=${b.formVersion?.versionNum ?? "?"}\n`;
  });
}

// ─── submissions (submissions:read / write / decisions:write) ────────────────

export async function cmdSubmissionsList(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  if (!eventId) {
    return emitError(
      ctx.io,
      "submissions list requires --event <eventId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const query: Record<string, string | undefined> = {
    status: requireOption(ctx.args, "status") ?? undefined,
    category: requireOption(ctx.args, "category") ?? undefined,
    q: requireOption(ctx.args, "q", ["search"]) ?? undefined,
    limit: requireOption(ctx.args, "limit") ?? undefined,
    offset: requireOption(ctx.args, "offset") ?? undefined,
  };
  const result = await client.get(
    `/api/events/${encodeURIComponent(eventId)}/submissions`,
    query,
  );
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const b = body as {
      submissions?: Array<{
        id: string;
        title: string;
        status: string;
        category?: string | null;
      }>;
      total?: number;
    };
    const rows = b.submissions ?? [];
    if (rows.length === 0) return `total=${b.total ?? 0}\n(no rows)\n`;
    return (
      `total=${b.total ?? rows.length}\n` +
      rows
        .map(
          (r) =>
            `${r.id}\t${r.status}\t${r.category ?? ""}\t${r.title}`,
        )
        .join("\n") +
      "\n"
    );
  });
}

export async function cmdSubmissionsGet(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const submissionId =
    requireOption(ctx.args, "submission", ["submissionId", "id"]) ??
    ctx.args.positionals[0];
  if (!submissionId) {
    return emitError(
      ctx.io,
      "submissions get requires --submission <id>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const result = await client.get(
    `/api/submissions/${encodeURIComponent(submissionId)}`,
  );
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const b = body as {
      submission?: { id?: string; title?: string; status?: string };
    };
    return `id=${b.submission?.id ?? submissionId} status=${b.submission?.status ?? "?"} title=${b.submission?.title ?? "?"}\n`;
  });
}

export async function cmdSubmissionsAssign(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const submissionId =
    requireOption(ctx.args, "submission", ["submissionId", "id"]) ??
    ctx.args.positionals[0];
  const usersRaw =
    requireOption(ctx.args, "users", ["user-ids", "userIds"]) ??
    requireOption(ctx.args, "user", ["user-id", "userId"]);
  if (!submissionId || !usersRaw) {
    return emitError(
      ctx.io,
      "submissions assign requires --submission <id> --users <userId[,userId…]>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const userIds = usersRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (userIds.length === 0) {
    return emitError(
      ctx.io,
      "submissions assign --users must list at least one user id",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const result = await client.post(
    `/api/submissions/${encodeURIComponent(submissionId)}/assign`,
    { userIds },
  );
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const b = body as { assignments?: unknown[] };
    return `assigned ${b.assignments?.length ?? 0} on ${submissionId}\n`;
  });
}

export async function cmdSubmissionsDecision(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const submissionId =
    requireOption(ctx.args, "submission", ["submissionId", "id"]) ??
    ctx.args.positionals[0];
  const decision = requireOption(ctx.args, "decision", ["value"]);
  if (!submissionId || !decision) {
    return emitError(
      ctx.io,
      "submissions decision requires --submission <id> --decision accept|reject|waitlist",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  if (!["accept", "reject", "waitlist"].includes(decision)) {
    return emitError(
      ctx.io,
      "submissions decision --decision must be accept|reject|waitlist",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const reason = requireOption(ctx.args, "reason");
  const body: Record<string, unknown> = { decision };
  if (reason !== undefined) body.reason = reason;
  const result = await client.post(
    `/api/submissions/${encodeURIComponent(submissionId)}/decision`,
    body,
  );
  return emitResult(ctx.io, result, ctx.json, (b) => {
    const p = b as {
      decision?: { value?: string };
      idempotent?: boolean;
    };
    return `decision=${p.decision?.value ?? decision}${p.idempotent ? " (idempotent)" : ""}\n`;
  });
}

export async function cmdSubmissionsBulkDecision(
  ctx: CommandContext,
): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  const decision = requireOption(ctx.args, "decision", ["value"]);
  const idsRaw =
    requireOption(ctx.args, "ids", ["submission-ids", "submissionIds"]) ??
    requireOption(ctx.args, "submissions");
  if (!eventId || !decision || !idsRaw) {
    return emitError(
      ctx.io,
      "submissions bulk-decision requires --event --decision accept|reject|waitlist --ids id1,id2",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  if (!["accept", "reject", "waitlist"].includes(decision)) {
    return emitError(
      ctx.io,
      "submissions bulk-decision --decision must be accept|reject|waitlist",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const submissionIds = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (submissionIds.length === 0) {
    return emitError(
      ctx.io,
      "submissions bulk-decision --ids must list at least one id",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const reason = requireOption(ctx.args, "reason");
  const body: Record<string, unknown> = { submissionIds, decision };
  if (reason !== undefined) body.reason = reason;
  const result = await client.post(
    `/api/events/${encodeURIComponent(eventId)}/submissions/bulk-decision`,
    body,
  );
  return emitResult(ctx.io, result, ctx.json, (b) => {
    const p = b as { applied?: number; failed?: number; decision?: string };
    return `applied=${p.applied ?? 0} failed=${p.failed ?? 0} decision=${p.decision ?? decision}\n`;
  });
}

// ─── eval (submissions:read) ─────────────────────────────────────────────────

export async function cmdEvalRollup(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  if (!eventId) {
    return emitError(
      ctx.io,
      "eval rollup requires --event <eventId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const sort = requireOption(ctx.args, "sort") ?? undefined;
  const result = await client.get(
    `/api/events/${encodeURIComponent(eventId)}/eval/rollup`,
    { sort },
  );
  return emitResult(ctx.io, result, ctx.json, (body) => {
    const b = body as {
      submissions?: Array<{
        submissionId: string;
        title: string;
        aggregateScore?: number | null;
        status?: string;
      }>;
      round?: { id?: string } | null;
    };
    const rows = b.submissions ?? [];
    if (rows.length === 0) {
      return `round=${b.round?.id ?? "none"} submissions=0\n`;
    }
    return (
      `round=${b.round?.id ?? "none"} submissions=${rows.length}\n` +
      rows
        .map(
          (r) =>
            `${r.submissionId}\t${r.aggregateScore ?? ""}\t${r.status ?? ""}\t${r.title}`,
        )
        .join("\n") +
      "\n"
    );
  });
}

export async function cmdEvalExport(ctx: CommandContext): Promise<CliExitCode> {
  const client = needClient(ctx);
  if (typeof client === "number") return client;

  const eventId = requireOption(ctx.args, "event", ["eventId", "e"]);
  if (!eventId) {
    return emitError(
      ctx.io,
      "eval export requires --event <eventId>",
      "VALIDATION_ERROR",
      EXIT_VALIDATION,
      ctx.json,
    );
  }
  const sort = requireOption(ctx.args, "sort") ?? "score_desc";
  // CSV response: client wraps non-JSON as { raw: text }
  const result = await client.request(
    "GET",
    `/api/events/${encodeURIComponent(eventId)}/eval/export`,
    { query: { sort } },
  );
  if (!result.ok) {
    return emitResult(ctx.io, result, ctx.json);
  }
  let csv = "";
  if (typeof result.body === "string") {
    csv = result.body;
  } else if (
    result.body &&
    typeof result.body === "object" &&
    "raw" in result.body &&
    typeof (result.body as { raw: unknown }).raw === "string"
  ) {
    csv = (result.body as { raw: string }).raw;
  } else {
    csv = JSON.stringify(result.body);
  }
  if (ctx.json) {
    ctx.io.writeOut(`${JSON.stringify({ csv, eventId, sort })}\n`);
  } else {
    ctx.io.writeOut(csv.endsWith("\n") ? csv : `${csv}\n`);
  }
  return EXIT_OK;
}

/** Re-export parseArgs for main. */
export { parseArgs };
