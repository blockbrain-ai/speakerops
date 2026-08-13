/**
 * CLI HTTP client — re-exports the first-party SDK client.
 * Auth: Authorization: Bearer <SPEAKEROPS_API_KEY>
 */
export {
  HttpClient as ApiClient,
  type HttpClientConfig as ApiClientConfig,
  type HttpResult as ApiResult,
  resolveBaseUrl,
  resolveApiKey,
  missingKeyResult,
} from "@speakerops/sdk";
