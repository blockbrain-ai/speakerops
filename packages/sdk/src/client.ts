/**
 * First-party SpeakerOps client — typed wrappers over Worker commands.
 */
import {
  AdminSpeakersListResponseSchema,
  AdminSpeakerDetailResponseSchema,
  DecisionRecordBodySchema,
  DesignGetResponseSchema,
  DesignPublishBodySchema,
  DesignPublishResponseSchema,
  EventCreateBodySchema,
  EventListResponseSchema,
  EventResponseSchema,
  FormCreateResponseSchema,
  FormListResponseSchema,
  FormUpdateDraftBodySchema,
  IntegrationsStatusResponseSchema,
  KeysCreateBodySchema,
  KeysCreateResponseSchema,
  KeysListResponseSchema,
  KeysRevokeResponseSchema,
  ProgrammePublishResponseSchema,
  ProgrammeStatusResponseSchema,
  PublicProgrammeResponseSchema,
  ReportsReadinessResponseSchema,
  SaveAcceleventsBodySchema,
  ScheduleListResponseSchema,
  SchedulePlaceBodySchema,
  SchedulePlaceResponseSchema,
  SpeakersUpdateProfileBodySchema,
  SpeakersUpdateProfileResponseSchema,
  SubmissionAssignBodySchema,
  SubmissionDetailResponseSchema,
  SubmissionListResponseSchema,
  type DecisionRecordBody,
  type DesignPublishBody,
  type EventCreateBody,
  type FormUpdateDraftBody,
  type KeysCreateBody,
  type SaveAcceleventsBody,
  type SchedulePlaceBody,
  type SpeakersUpdateProfileBody,
} from "@speakerops/shared";
import {
  HttpClient,
  resolveApiKey,
  resolveBaseUrl,
  validationResult,
  type HttpClientConfig,
  type HttpRequestOptions,
  type HttpResult,
} from "./http.js";
import { asResult, type Parseable, type SdkResult } from "./result.js";
import {
  parsePublishedProgramme,
  toProgrammeProjection,
  type ProgrammeProjection,
} from "./project.js";
import { unwrap } from "./error.js";

export type SpeakerOpsConfig = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  correlationId?: string;
  correlationPrefix?: "cli" | "sdk";
};

function enc(value: string): string {
  return encodeURIComponent(value);
}

function parsedBody<T>(result: HttpResult, schema: Parseable<T>): SdkResult<T> {
  return asResult(result, schema);
}

export class SpeakerOps {
  readonly http: HttpClient;

  constructor(config: SpeakerOpsConfig = {}) {
    const cfg: HttpClientConfig = {
      baseUrl: resolveBaseUrl(config.baseUrl),
      apiKey: config.apiKey ?? resolveApiKey() ?? "",
      fetchImpl: config.fetchImpl,
      correlationId: config.correlationId,
      correlationPrefix: config.correlationPrefix ?? "sdk",
    };
    this.http = new HttpClient(cfg);
  }

  request(
    method: string,
    path: string,
    options?: HttpRequestOptions,
  ): Promise<HttpResult> {
    return this.http.request(method, path, options);
  }

  readonly events = {
    list: async () =>
      parsedBody(await this.http.get("/api/events"), EventListResponseSchema),
    get: async (eventId: string) =>
      parsedBody(
        await this.http.get(`/api/events/${enc(eventId)}`),
        EventResponseSchema,
      ),
    create: async (body: EventCreateBody) => {
      const checked = EventCreateBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(validationResult("Invalid Event.Create body"));
      }
      return parsedBody(
        await this.http.post("/api/events", checked.data),
        EventResponseSchema,
      );
    },
  };

  readonly programme = {
    /** Public published snapshot — no API key required. */
    getPublished: async (slug: string) =>
      parsedBody(
        await this.http.get(`/api/public/programme/${enc(slug)}`),
        PublicProgrammeResponseSchema,
      ),
    /** Fetch + parse + flatten for an outbound projector. */
    projectPublished: async (slug: string): Promise<ProgrammeProjection> => {
      const result = await this.programme.getPublished(slug);
      const body = unwrap(result);
      return toProgrammeProjection(parsePublishedProgramme(body));
    },
    /** Bearer events:read|write or admin session. */
    status: async (eventId: string) =>
      parsedBody(
        await this.http.get(`/api/events/${enc(eventId)}/programme/status`),
        ProgrammeStatusResponseSchema,
      ),
    /** Bearer events:write or admin session. */
    publish: async (eventId: string) =>
      parsedBody(
        await this.http.post(`/api/events/${enc(eventId)}/programme/publish`, {}),
        ProgrammePublishResponseSchema,
      ),
  };

  readonly reports = {
    readiness: async (eventId: string, opts?: { overdueOnly?: boolean }) =>
      parsedBody(
        await this.http.get(`/api/events/${enc(eventId)}/readiness`, {
          overdueOnly: opts?.overdueOnly ? "true" : undefined,
        }),
        ReportsReadinessResponseSchema,
      ),
  };

  readonly speakers = {
    list: async (eventId: string, query?: { q?: string; status?: string }) =>
      parsedBody(
        await this.http.get(`/api/events/${enc(eventId)}/speakers`, query),
        AdminSpeakersListResponseSchema,
      ),
    get: async (eventId: string, participationId: string) =>
      parsedBody(
        await this.http.get(
          `/api/events/${enc(eventId)}/speakers/${enc(participationId)}`,
        ),
        AdminSpeakerDetailResponseSchema,
      ),
    updateProfile: async (
      eventId: string,
      participationId: string,
      body: SpeakersUpdateProfileBody,
    ) => {
      const checked = SpeakersUpdateProfileBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(
          validationResult(
            "Invalid Speakers.UpdateProfile body (expectedVersion is required)",
          ),
        );
      }
      return parsedBody(
        await this.http.patch(
          `/api/events/${enc(eventId)}/speakers/${enc(participationId)}`,
          checked.data,
        ),
        SpeakersUpdateProfileResponseSchema,
      );
    },
  };

  readonly schedule = {
    list: async (eventId: string, view?: string) =>
      parsedBody(
        await this.http.get(
          `/api/events/${enc(eventId)}/schedule`,
          view ? { view } : undefined,
        ),
        ScheduleListResponseSchema,
      ),
    place: async (eventId: string, body: SchedulePlaceBody) => {
      const checked = SchedulePlaceBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(validationResult("Invalid Schedule.Place body"));
      }
      return parsedBody(
        await this.http.post(
          `/api/events/${enc(eventId)}/schedule/place`,
          checked.data,
        ),
        SchedulePlaceResponseSchema,
      );
    },
    move: async (
      eventId: string,
      body: {
        placementId: string;
        roomId: string;
        startsAt: string;
        endsAt: string;
        expectedVersion: number;
      },
    ) =>
      this.http.post(`/api/events/${enc(eventId)}/schedule/move`, body),
    unschedule: async (
      eventId: string,
      body: { placementId: string; expectedVersion: number },
    ) =>
      this.http.post(`/api/events/${enc(eventId)}/schedule/unschedule`, body),
  };

  readonly submissions = {
    list: async (
      eventId: string,
      query?: { status?: string; q?: string; category?: string },
    ) =>
      parsedBody(
        await this.http.get(`/api/events/${enc(eventId)}/submissions`, query),
        SubmissionListResponseSchema,
      ),
    get: async (submissionId: string) =>
      parsedBody(
        await this.http.get(`/api/submissions/${enc(submissionId)}`),
        SubmissionDetailResponseSchema,
      ),
    assign: async (submissionId: string, body: { userIds: string[] }) => {
      const checked = SubmissionAssignBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(validationResult("Invalid Submission.Assign body"));
      }
      return this.http.post(
        `/api/submissions/${enc(submissionId)}/assign`,
        checked.data,
      );
    },
    decision: async (submissionId: string, body: DecisionRecordBody) => {
      const checked = DecisionRecordBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(validationResult("Invalid Decision.Record body"));
      }
      return this.http.post(
        `/api/submissions/${enc(submissionId)}/decision`,
        checked.data,
      );
    },
  };

  readonly forms = {
    list: async (eventId: string) =>
      parsedBody(
        await this.http.get(`/api/events/${enc(eventId)}/forms`),
        FormListResponseSchema,
      ),
    get: async (formId: string) =>
      this.http.get(`/api/forms/${enc(formId)}`),
    create: async (eventId: string, body: { name: string }) =>
      parsedBody(
        await this.http.post(`/api/events/${enc(eventId)}/forms`, body),
        FormCreateResponseSchema,
      ),
    updateDraft: async (formId: string, body: FormUpdateDraftBody) => {
      const checked = FormUpdateDraftBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(validationResult("Invalid Form.UpdateDraft body"));
      }
      return this.http.request(
        "PUT",
        `/api/forms/${enc(formId)}/draft`,
        { body: checked.data },
      );
    },
    publish: async (formId: string) =>
      this.http.post(`/api/forms/${enc(formId)}/publish`, {}),
  };

  readonly design = {
    get: async (eventId: string) =>
      parsedBody(
        await this.http.get(`/api/events/${enc(eventId)}/design`),
        DesignGetResponseSchema,
      ),
    setDraft: async (eventId: string, body: unknown) =>
      this.http.put(`/api/events/${enc(eventId)}/design`, body),
    publish: async (eventId: string, body: DesignPublishBody) => {
      const checked = DesignPublishBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(
          validationResult(
            "Invalid Design.Publish body (expectedVersion is required)",
          ),
        );
      }
      return parsedBody(
        await this.http.post(
          `/api/events/${enc(eventId)}/design/publish`,
          checked.data,
        ),
        DesignPublishResponseSchema,
      );
    },
  };

  readonly integrations = {
    status: async (eventId: string) =>
      parsedBody(
        await this.http.get(`/api/events/${enc(eventId)}/integrations`),
        IntegrationsStatusResponseSchema,
      ),
    saveAccelevents: async (eventId: string, body: SaveAcceleventsBody) => {
      const checked = SaveAcceleventsBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(
          validationResult(
            "Invalid Accelevents identity (eventUrl is the event slug, not a full URL)",
          ),
        );
      }
      return this.http.put(
        `/api/events/${enc(eventId)}/integrations/accelevents`,
        checked.data,
      );
    },
    verifyAccelevents: async (
      eventId: string,
      body?: { expectedVersion?: number },
    ) =>
      this.http.post(
        `/api/events/${enc(eventId)}/integrations/accelevents/verify`,
        body ?? {},
      ),
  };

  readonly airtable = {
    status: (eventId: string) =>
      this.http.get(`/api/events/${enc(eventId)}/airtable/status`),
  };

  readonly comms = {
    templates: (eventId: string) =>
      this.http.get(`/api/events/${enc(eventId)}/templates`),
    preview: (body: unknown) => this.http.post("/api/comms/preview", body),
    send: (body: unknown) => this.http.post("/api/comms/send", body),
  };

  readonly members = {
    list: (eventId: string, role?: string) =>
      this.http.get(
        `/api/events/${enc(eventId)}/members`,
        role ? { role } : undefined,
      ),
    invite: (
      eventId: string,
      body: { email: string; role?: "admin" | "evaluator" | "speaker" },
    ) => this.http.post(`/api/events/${enc(eventId)}/invites`, body),
    setRole: (
      eventId: string,
      userId: string,
      body: { role: "admin" | "evaluator" | "speaker" },
    ) =>
      this.http.patch(`/api/events/${enc(eventId)}/members/${enc(userId)}`, body),
  };

  readonly keys = {
    list: async () =>
      parsedBody(await this.http.get("/api/keys"), KeysListResponseSchema),
    create: async (body: KeysCreateBody) => {
      const checked = KeysCreateBodySchema.safeParse(body);
      if (!checked.success) {
        return asResult(validationResult("Invalid Keys.Create body"));
      }
      return parsedBody(
        await this.http.post("/api/keys", checked.data),
        KeysCreateResponseSchema,
      );
    },
    revoke: async (keyId: string) =>
      parsedBody(
        await this.http.delete(`/api/keys/${enc(keyId)}`),
        KeysRevokeResponseSchema,
      ),
  };

  readonly files = {
    presign: (body: unknown) => this.http.post("/api/files/presign", body),
    /** PUT bytes. Bearer is attached only when the URL is the API origin. */
    upload: (
      url: string,
      rawBody: Uint8Array | ArrayBuffer,
      contentType: string,
    ) => this.http.request("PUT", url, { rawBody, contentType }),
    complete: (fileId: string, body: unknown) =>
      this.http.post(`/api/files/${enc(fileId)}/complete`, body),
  };

  readonly eval = {
    rollup: (eventId: string, sort?: string) =>
      this.http.get(`/api/events/${enc(eventId)}/eval/rollup`, { sort }),
  };

  readonly openapi = {
    get: () => this.http.get("/openapi.json"),
  };
}
