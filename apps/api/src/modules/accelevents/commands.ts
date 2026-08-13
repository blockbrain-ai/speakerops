import {
  SaveAcceleventsBodySchema,
  uuidv7,
  type IntegrationConnection,
  type SaveAcceleventsBody,
} from "@speakerops/shared";
import { resolveAcceleventsKey, type AcceleventsEnv } from "./client.js";
import { enqueueAcceleventsJob } from "./enqueue.js";
import type { ConnectionRow, IntegrationsStore } from "./store.js";

export function toConnectionDto(
  row: ConnectionRow,
  credentialPresent: boolean,
): IntegrationConnection {
  const metadataComplete = Boolean(row.eventUrl && row.externalEventId);
  let pausedReason: string | null = null;
  if (!credentialPresent) pausedReason = "paused — no API key";
  else if (!metadataComplete) pausedReason = "event URL and numeric event id required";
  else if (!row.enabled) pausedReason = "projection disabled";
  return {
    id: row.id,
    eventId: row.eventId,
    provider: row.provider,
    enabled: row.enabled,
    eventUrl: row.eventUrl,
    externalEventId: row.externalEventId,
    connectionGeneration: row.connectionGeneration,
    verificationState: row.verificationState,
    lastAttemptAt: row.lastAttemptAt,
    lastVerifiedAt: row.lastVerifiedAt,
    lastError: row.lastError,
    version: row.version,
    credentialPresent,
    metadataComplete,
    pausedReason,
  };
}

function placeholderRow(eventId: string, keyPresent: boolean): ConnectionRow {
  return {
    id: "ae-placeholder",
    eventId,
    provider: "accelevents",
    enabled: false,
    eventUrl: null,
    externalEventId: null,
    connectionGeneration: 1,
    verificationState: keyPresent ? "never" : "paused",
    lastAttemptAt: null,
    lastVerifiedAt: null,
    lastError: keyPresent ? null : "paused — no API key",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listIntegrations(
  store: IntegrationsStore,
  env: AcceleventsEnv,
  eventId: string,
) {
  const rows = await store.listConnections(eventId);
  const key = resolveAcceleventsKey(env);
  const haveAe = rows.some((r) => r.provider === "accelevents");
  if (!haveAe) {
    return {
      connections: [toConnectionDto(placeholderRow(eventId, Boolean(key)), Boolean(key))],
    };
  }
  return {
    connections: rows.map((r) => toConnectionDto(r, Boolean(key))),
  };
}

export async function saveAcceleventsConnection(
  store: IntegrationsStore,
  env: AcceleventsEnv,
  eventId: string,
  body: SaveAcceleventsBody,
): Promise<
  | { ok: true; connection: IntegrationConnection }
  | { ok: false; status: 400 | 409; error: string; code: string }
> {
  const parsed = SaveAcceleventsBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Validation failed",
      code: "VALIDATION_ERROR",
    };
  }
  const now = new Date().toISOString();
  const existing = await store.getConnection(eventId, "accelevents");
  if (
    existing &&
    parsed.data.expectedVersion &&
    parsed.data.expectedVersion !== existing.version
  ) {
    return { ok: false, status: 409, error: "Version conflict", code: "VERSION" };
  }
  const eventChanged =
    existing &&
    (existing.eventUrl !== parsed.data.eventUrl ||
      existing.externalEventId !== parsed.data.externalEventId);
  const key = resolveAcceleventsKey(env);
  const row: ConnectionRow = {
    id: existing?.id ?? uuidv7(),
    eventId,
    provider: "accelevents",
    enabled: parsed.data.enabled,
    eventUrl: parsed.data.eventUrl,
    externalEventId: parsed.data.externalEventId,
    connectionGeneration: eventChanged
      ? existing!.connectionGeneration + 1
      : (existing?.connectionGeneration ?? 1),
    verificationState: key ? (eventChanged ? "never" : (existing?.verificationState ?? "never")) : "paused",
    lastAttemptAt: existing?.lastAttemptAt ?? null,
    lastVerifiedAt: eventChanged ? null : (existing?.lastVerifiedAt ?? null),
    lastError: key ? (eventChanged ? null : (existing?.lastError ?? null)) : "paused — no API key",
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const saved = await store.upsertConnection(row);
  if (saved.enabled && key) {
    await enqueueAcceleventsJob(store, {
      kind: "project",
      eventId,
      correlationId: `ae-save:${saved.id}:${saved.version}`,
    });
  }
  return {
    ok: true,
    connection: toConnectionDto(saved, Boolean(key)),
  };
}

export async function queueAcceleventsVerify(
  store: IntegrationsStore,
  env: AcceleventsEnv,
  eventId: string,
  expectedVersion?: number,
): Promise<
  | { ok: true; connection: IntegrationConnection }
  | { ok: false; status: 400 | 409; error: string; code: string }
> {
  const existing = await store.getConnection(eventId, "accelevents");
  if (!existing?.eventUrl || !existing.externalEventId) {
    return {
      ok: false,
      status: 400,
      error: "Save event URL and numeric event id before verifying",
      code: "VALIDATION_ERROR",
    };
  }
  if (expectedVersion && expectedVersion !== existing.version) {
    return { ok: false, status: 409, error: "Version conflict", code: "VERSION" };
  }
  const now = new Date().toISOString();
  const next: ConnectionRow = {
    ...existing,
    verificationState: "pending",
    lastAttemptAt: now,
    version: existing.version + 1,
    updatedAt: now,
  };
  const saved = await store.upsertConnection(next);
  await enqueueAcceleventsJob(store, {
    kind: "verify",
    eventId,
    correlationId: `ae-verify:${saved.id}:${saved.version}`,
  });
  return {
    ok: true,
    connection: toConnectionDto(saved, Boolean(resolveAcceleventsKey(env))),
  };
}
