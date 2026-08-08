/**
 * Airtable HTTP client for one-way projection (section 7.3 / S-AIRTABLE).
 *
 * Env **names** only (E10): AIRTABLE_API_KEY, AIRTABLE_BASE_ID,
 * AIRTABLE_TABLE_* (optional overrides).
 *
 * Never called from the request path — only airtableConsumer / queue drain.
 * When key/base unset → paused (no crash, no network).
 * On HTTP 429 → throw RateLimitedError so outbox row stays pending (no drop).
 */

import {
  DEFAULT_AIRTABLE_TABLES,
  type AirtableEntityType,
} from "@speakerops/shared";

export type AirtableClientEnv = {
  /** Env name only — never commit values (E10). */
  AIRTABLE_API_KEY?: string;
  AIRTABLE_BASE_ID?: string;
  AIRTABLE_TABLE_SUBMISSIONS?: string;
  AIRTABLE_TABLE_SPEAKERS?: string;
  AIRTABLE_TABLE_SESSIONS?: string;
  AIRTABLE_TABLE_TASKS?: string;
  AIRTABLE_TABLE_SCHEDULE?: string;
  AIRTABLE_TABLE_EVENTS?: string;
};

export type AirtableUpsertInput = {
  entityType: AirtableEntityType;
  /** Stable D1 id — always written as Airtable field `internal_id`. */
  internalId: string;
  fields: Record<string, unknown>;
  /** Prior Airtable record id when known (patch vs create). */
  externalId?: string | null;
};

export type AirtableUpsertResult = {
  externalId: string;
  created: boolean;
};

export type AirtableClient = {
  readonly name: "airtable" | "paused" | "sandbox";
  readonly configured: boolean;
  readonly paused: boolean;
  upsert(input: AirtableUpsertInput): Promise<AirtableUpsertResult>;
};

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor(message = "Airtable rate limited (429)") {
    super(message);
    this.name = "RateLimitedError";
  }
}

export class AirtableHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AirtableHttpError";
    this.status = status;
  }
}

export function resolveAirtableConfigured(
  env: AirtableClientEnv = {},
): boolean {
  const key =
    typeof env.AIRTABLE_API_KEY === "string" ? env.AIRTABLE_API_KEY.trim() : "";
  const base =
    typeof env.AIRTABLE_BASE_ID === "string" ? env.AIRTABLE_BASE_ID.trim() : "";
  return key.length > 0 && base.length > 0;
}

export function tableNameForEntity(
  entityType: AirtableEntityType,
  env: AirtableClientEnv = {},
): string {
  switch (entityType) {
    case "submission":
      return (
        env.AIRTABLE_TABLE_SUBMISSIONS?.trim() ||
        DEFAULT_AIRTABLE_TABLES.submission
      );
    case "speaker":
      return (
        env.AIRTABLE_TABLE_SPEAKERS?.trim() || DEFAULT_AIRTABLE_TABLES.speaker
      );
    case "session":
      return (
        env.AIRTABLE_TABLE_SESSIONS?.trim() || DEFAULT_AIRTABLE_TABLES.session
      );
    case "task":
      return env.AIRTABLE_TABLE_TASKS?.trim() || DEFAULT_AIRTABLE_TABLES.task;
    case "schedule":
      return (
        env.AIRTABLE_TABLE_SCHEDULE?.trim() || DEFAULT_AIRTABLE_TABLES.schedule
      );
    case "event":
      return (
        env.AIRTABLE_TABLE_EVENTS?.trim() || DEFAULT_AIRTABLE_TABLES.event
      );
    default: {
      const _exhaustive: never = entityType;
      return _exhaustive;
    }
  }
}

/**
 * Paused client — used when AIRTABLE_API_KEY / AIRTABLE_BASE_ID unset.
 * upsert() throws so caller must not call it when paused; drain skips instead.
 */
export class PausedAirtableClient implements AirtableClient {
  readonly name = "paused" as const;
  readonly configured = false;
  readonly paused = true;

  async upsert(_input: AirtableUpsertInput): Promise<AirtableUpsertResult> {
    throw new Error(
      "Airtable paused: AIRTABLE_API_KEY or AIRTABLE_BASE_ID unset (S-AIRTABLE)",
    );
  }
}

/**
 * Sandbox client — records upserts without network (unit tests / local drain).
 * Always uses internal_id as the stable key (I16).
 */
export class SandboxAirtableClient implements AirtableClient {
  readonly name = "sandbox" as const;
  readonly configured = true;
  readonly paused = false;
  /** Captured upserts for assertions (no secrets). */
  readonly upserts: Array<{
    entityType: AirtableEntityType;
    internalId: string;
    fields: Record<string, unknown>;
    externalId: string;
  }> = [];

  async upsert(input: AirtableUpsertInput): Promise<AirtableUpsertResult> {
    // I16: upsert key is always internal_id
    const fields = {
      ...input.fields,
      internal_id: input.internalId,
    };
    const existing = this.upserts.find(
      (u) =>
        u.entityType === input.entityType && u.internalId === input.internalId,
    );
    if (existing) {
      existing.fields = fields;
      return { externalId: existing.externalId, created: false };
    }
    const externalId =
      input.externalId && input.externalId.length > 0
        ? input.externalId
        : `rec_sandbox_${input.entityType}_${input.internalId.slice(0, 8)}`;
    this.upserts.push({
      entityType: input.entityType,
      internalId: input.internalId,
      fields,
      externalId,
    });
    return { externalId, created: true };
  }
}

type FetchLike = typeof fetch;

/**
 * Live Airtable REST client.
 * Upsert strategy: filter by internal_id → PATCH if found, else POST.
 * Never drops rows on 429 — throws RateLimitedError for outbox retry.
 */
export class LiveAirtableClient implements AirtableClient {
  readonly name = "airtable" as const;
  readonly configured = true;
  readonly paused = false;
  private readonly apiKey: string;
  private readonly baseId: string;
  private readonly env: AirtableClientEnv;
  private readonly fetchImpl: FetchLike;

  constructor(
    env: AirtableClientEnv,
    options: { fetchImpl?: FetchLike } = {},
  ) {
    const key = env.AIRTABLE_API_KEY?.trim() ?? "";
    const base = env.AIRTABLE_BASE_ID?.trim() ?? "";
    if (!key || !base) {
      throw new Error("LiveAirtableClient requires AIRTABLE_API_KEY and AIRTABLE_BASE_ID");
    }
    this.apiKey = key;
    this.baseId = base;
    this.env = env;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async upsert(input: AirtableUpsertInput): Promise<AirtableUpsertResult> {
    const table = encodeURIComponent(
      tableNameForEntity(input.entityType, this.env),
    );
    // I16 field-flow: internal_id is the Airtable field used for upsert identity
    const fields: Record<string, unknown> = {
      ...input.fields,
      internal_id: input.internalId,
    };

    if (input.externalId) {
      return this.patchRecord(table, input.externalId, fields);
    }

    const found = await this.findByInternalId(table, input.internalId);
    if (found) {
      return this.patchRecord(table, found, fields);
    }
    return this.createRecord(table, fields);
  }

  private async findByInternalId(
    table: string,
    internalId: string,
  ): Promise<string | null> {
    // formula: {internal_id} = '...'
    const formula = encodeURIComponent(`{internal_id}='${escapeFormula(internalId)}'`);
    const url = `https://api.airtable.com/v0/${this.baseId}/${table}?filterByFormula=${formula}&maxRecords=1`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (res.status === 429) {
      throw new RateLimitedError();
    }
    if (!res.ok) {
      throw new AirtableHttpError(
        res.status,
        `Airtable list failed (${res.status})`,
      );
    }
    const body = (await res.json()) as {
      records?: Array<{ id: string }>;
    };
    return body.records?.[0]?.id ?? null;
  }

  private async createRecord(
    table: string,
    fields: Record<string, unknown>,
  ): Promise<AirtableUpsertResult> {
    const url = `https://api.airtable.com/v0/${this.baseId}/${table}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (res.status === 429) {
      throw new RateLimitedError();
    }
    if (!res.ok) {
      throw new AirtableHttpError(
        res.status,
        `Airtable create failed (${res.status})`,
      );
    }
    const body = (await res.json()) as { id: string };
    return { externalId: body.id, created: true };
  }

  private async patchRecord(
    table: string,
    externalId: string,
    fields: Record<string, unknown>,
  ): Promise<AirtableUpsertResult> {
    const url = `https://api.airtable.com/v0/${this.baseId}/${table}/${encodeURIComponent(externalId)}`;
    const res = await this.fetchImpl(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (res.status === 429) {
      throw new RateLimitedError();
    }
    if (!res.ok) {
      throw new AirtableHttpError(
        res.status,
        `Airtable patch failed (${res.status})`,
      );
    }
    const body = (await res.json()) as { id: string };
    return { externalId: body.id, created: false };
  }
}

function escapeFormula(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Resolve client: paused when unset; sandbox when AIRTABLE_MODE=sandbox;
 * live when key+base set.
 *
 * Tests inject SandboxAirtableClient directly.
 * Production drain uses createAirtableClient(env) — never crashes when unset.
 */
export function createAirtableClient(
  env: AirtableClientEnv = {},
  options: { fetchImpl?: FetchLike; forceSandbox?: boolean } = {},
): AirtableClient {
  if (!resolveAirtableConfigured(env)) {
    return new PausedAirtableClient();
  }
  if (options.forceSandbox) {
    return new SandboxAirtableClient();
  }
  // Prefer live when credentials present (dogfood).
  return new LiveAirtableClient(env, { fetchImpl: options.fetchImpl });
}
