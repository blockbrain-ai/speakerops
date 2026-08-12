/**
 * Thin HTTPS client for speakerops CLI → Worker API.
 * Auth: Authorization: Bearer <SPEAKEROPS_API_KEY>
 * Same domain commands as SPA (COMMANDS.md); scopes enforced server-side (E8).
 */
import { type CliExitCode } from "./exit-codes.js";
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
export declare function resolveBaseUrl(override?: string): string;
export declare function resolveApiKey(override?: string): string | null;
export declare class ApiClient {
    readonly baseUrl: string;
    readonly apiKey: string;
    private readonly fetchImpl;
    private readonly correlationId;
    constructor(config: ApiClientConfig);
    request(method: string, path: string, options?: {
        query?: Record<string, string | undefined>;
        body?: unknown;
        rawBody?: Uint8Array | ArrayBuffer | string;
        contentType?: string;
    }): Promise<ApiResult>;
    get(path: string, query?: Record<string, string | undefined>): Promise<ApiResult>;
    post(path: string, body?: unknown): Promise<ApiResult>;
    put(path: string, body?: unknown): Promise<ApiResult>;
    patch(path: string, body?: unknown): Promise<ApiResult>;
    delete(path: string): Promise<ApiResult>;
}
/** Missing API key → validation exit (config error, not authz from server). */
export declare function missingKeyResult(): ApiResult;
//# sourceMappingURL=http.d.ts.map