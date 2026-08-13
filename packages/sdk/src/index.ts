export {
  HttpClient,
  ApiClient,
  resolveBaseUrl,
  resolveApiKey,
  missingKeyResult,
  type HttpClientConfig,
  type ApiClientConfig,
  type HttpResult,
  type ApiResult,
} from "./http.js";
export {
  EXIT_OK,
  EXIT_VALIDATION,
  EXIT_AUTHZ,
  EXIT_CONFLICT,
  EXIT_NETWORK,
  exitCodeFromHttp,
  type CliExitCode,
} from "./exit-codes.js";
export { SpeakerOpsError, unwrap } from "./error.js";
export { SpeakerOps, type SpeakerOpsConfig } from "./client.js";
export {
  parsePublishedProgramme,
  toProgrammeProjection,
  type ProgrammeProjection,
  type ProgrammeProjectionSpeaker,
  type ProgrammeProjectionSession,
} from "./project.js";
