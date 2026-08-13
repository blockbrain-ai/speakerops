/**
 * Thin HTTPS client for SpeakerOps Worker API.
 * Auth: Authorization: Bearer <SPEAKEROPS_API_KEY> — same origin only.
 * Scopes are enforced server-side (E8).
 */
import { readEnv } from "./env.js";
import {
  exitCodeFromHttp,
  EXIT_NETWORK,
  EXIT_VALIDATION,
  type CliExitCode,
} from "./exit-codes.js";

export type HttpClientConfig = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  correlationId?: string;
  /**
   * Prefix for generated correlation ids (`cli` or `sdk`).
   * Ignored when `correlationId` is set.
   */
  correlationPrefix?: "cli" | "sdk";
};

export type HttpRequestOptions = {
  query?: Record<string, string | undefined>;
  body?: unknown;
  rawBody?: Uint8Array | ArrayBuffer | string;
  contentType?: string;
  /** Override the client-level correlation id for this request. */
  correlationId?: string;
};

export type HttpResult = {
  status: number;
  body: unknown;
  headers: Headers;
  exitCode: CliExitCode;
  ok: boolean;
};

export function resolveBaseUrl(override?: string): string {
  const raw =
    override ??
    readEnv("SPEAKEROPS_API_URL") ??
    readEnv("SPEAKEROPS_BASE_URL") ??
    "http://127.0.0.1:8787";
  return raw.replace(/\/+$/, "");
}

export function resolveApiKey(override?: string): string | null {
  const key = override ?? readEnv("SPEAKEROPS_API_KEY") ?? null;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

function newCorrelationId(prefix: "cli" | "sdk"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function sameOrigin(requestUrl: URL, baseUrl: string): boolean {
  try {
    const base = new URL(baseUrl.includes("://") ? baseUrl : `http://${baseUrl}`);
    return requestUrl.origin === base.origin;
  } catch {
    return false;
  }
}

export class HttpClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly correlationId: string;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.correlationId =
      config.correlationId ??
      readEnv("SPEAKEROPS_CORRELATION_ID") ??
      newCorrelationId(config.correlationPrefix ?? "sdk");
  }

  async request(
    method: string,
    path: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResult> {
    const url = new URL(
      path.startsWith("http")
        ? path
        : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`,
    );
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const attachBearer =
      this.apiKey.length > 0 && sameOrigin(url, this.baseUrl);

    const headers: Record<string, string> = {
      accept: "application/json",
      "x-correlation-id":
        options.correlationId ?? this.correlationId,
    };
    if (attachBearer) {
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

/** Missing API key → validation (config error, not server authz). */
export function missingKeyResult(): HttpResult {
  return {
    status: 0,
    body: {
      error:
        "SPEAKEROPS_API_KEY is required (or pass apiKey). Mint via admin UI or keys create.",
      code: "VALIDATION_ERROR",
    },
    headers: new Headers(),
    exitCode: EXIT_VALIDATION,
    ok: false,
  };
}

export function validationResult(error: string): HttpResult {
  return {
    status: 0,
    body: { error, code: "VALIDATION_ERROR" },
    headers: new Headers(),
    exitCode: EXIT_VALIDATION,
    ok: false,
  };
}

/** CLI-compatible aliases. */
export type ApiClientConfig = HttpClientConfig;
export type ApiResult = HttpResult;
export { HttpClient as ApiClient };
