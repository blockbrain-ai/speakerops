/**
 * Thin HTTPS client for speakerops CLI → Worker API.
 * Auth: Authorization: Bearer <SPEAKEROPS_API_KEY>
 * Same domain commands as SPA (COMMANDS.md); scopes enforced server-side (E8).
 */
import {
  exitCodeFromHttp,
  EXIT_NETWORK,
  EXIT_VALIDATION,
  type CliExitCode,
} from "./exit-codes.js";

export type ApiClientConfig = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Optional correlation id for audit chain (E3). */
  correlationId?: string;
};

export type ApiResult = {
  status: number;
  body: unknown;
  headers: Headers;
  exitCode: CliExitCode;
  ok: boolean;
};

export function resolveBaseUrl(override?: string): string {
  const raw =
    override ??
    process.env.SPEAKEROPS_API_URL ??
    process.env.SPEAKEROPS_BASE_URL ??
    "http://127.0.0.1:8787";
  return raw.replace(/\/+$/, "");
}

export function resolveApiKey(override?: string): string | null {
  const key = override ?? process.env.SPEAKEROPS_API_KEY ?? null;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

export class ApiClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly correlationId: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.correlationId =
      config.correlationId ??
      process.env.SPEAKEROPS_CORRELATION_ID ??
      `cli_${Date.now().toString(36)}`;
  }

  async request(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | undefined>;
      body?: unknown;
      rawBody?: Uint8Array | ArrayBuffer | string;
      contentType?: string;
    } = {},
  ): Promise<ApiResult> {
    const url = new URL(
      path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`,
    );
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "x-correlation-id": this.correlationId,
    };
    // OpenAPI is public; only attach Bearer when a key is configured.
    if (this.apiKey.length > 0) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    let body: string | Uint8Array | ArrayBuffer | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
      if (options.contentType) headers["content-type"] = options.contentType;
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { method, headers, body });
    } catch (err) {
      return {
        status: 0,
        body: {
          error: err instanceof Error ? err.message : "Network error",
          code: "NETWORK_ERROR",
        },
        headers: new Headers(),
        exitCode: EXIT_NETWORK,
        ok: false,
      };
    }

    const ct = res.headers.get("content-type") ?? "";
    let parsed: unknown;
    if (ct.includes("application/json")) {
      try {
        parsed = await res.json();
      } catch {
        parsed = {
          error: "Invalid JSON response",
          code: "NETWORK_ERROR",
        };
      }
    } else {
      const text = await res.text();
      parsed =
        text.length > 0
          ? { raw: text }
          : { error: res.statusText || "Empty response", code: "EMPTY" };
    }

    const code =
      parsed &&
      typeof parsed === "object" &&
      "code" in parsed &&
      typeof (parsed as { code: unknown }).code === "string"
        ? (parsed as { code: string }).code
        : undefined;

    return {
      status: res.status,
      body: parsed,
      headers: res.headers,
      exitCode: exitCodeFromHttp(res.status, code),
      ok: res.status >= 200 && res.status < 300,
    };
  }

  get(path: string, query?: Record<string, string | undefined>) {
    return this.request("GET", path, { query });
  }

  post(path: string, body?: unknown) {
    return this.request("POST", path, { body });
  }

  put(path: string, body?: unknown) {
    return this.request("PUT", path, { body });
  }

  patch(path: string, body?: unknown) {
    return this.request("PATCH", path, { body });
  }

  delete(path: string) {
    return this.request("DELETE", path);
  }
}

/** Missing API key → validation exit (config error, not authz from server). */
export function missingKeyResult(): ApiResult {
  return {
    status: 0,
    body: {
      error:
        "SPEAKEROPS_API_KEY is required (or pass --api-key). Mint via admin UI or keys create.",
      code: "VALIDATION_ERROR",
    },
    headers: new Headers(),
    exitCode: EXIT_VALIDATION,
    ok: false,
  };
}
