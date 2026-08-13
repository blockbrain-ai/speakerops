/**
 * First-party SpeakerOps client — typed wrappers over Worker commands.
 * Each method maps to a documented HTTP path. OpenAPI is a subset.
 */
import {
  HttpClient,
  resolveApiKey,
  resolveBaseUrl,
  type HttpClientConfig,
  type HttpResult,
} from "./http.js";
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
};

function enc(value: string): string {
  return encodeURIComponent(value);
}

export class SpeakerOps {
  readonly http: HttpClient;

  constructor(config: SpeakerOpsConfig = {}) {
    const cfg: HttpClientConfig = {
      baseUrl: resolveBaseUrl(config.baseUrl),
      apiKey: config.apiKey ?? resolveApiKey() ?? "",
      fetchImpl: config.fetchImpl,
      correlationId: config.correlationId,
    };
    this.http = new HttpClient(cfg);
  }

  request(
    method: string,
    path: string,
    options?: Parameters<HttpClient["request"]>[2],
  ): Promise<HttpResult> {
    return this.http.request(method, path, options);
  }

  readonly events = {
    list: () => this.http.get("/api/events"),
    get: (eventId: string) => this.http.get(`/api/events/${enc(eventId)}`),
  };

  readonly programme = {
    /** Public published snapshot — no API key required. */
    getPublished: (slug: string) =>
      this.http.get(`/api/public/programme/${enc(slug)}`),
    /** Fetch + parse + flatten for an outbound projector. */
    projectPublished: async (slug: string): Promise<ProgrammeProjection> => {
      const result = await this.programme.getPublished(slug);
      const body = unwrap(result);
      return toProgrammeProjection(parsePublishedProgramme(body));
    },
    status: (eventId: string) =>
      this.http.get(`/api/events/${enc(eventId)}/programme/status`),
    publish: (eventId: string) =>
      this.http.post(`/api/events/${enc(eventId)}/programme/publish`, {}),
  };

  readonly reports = {
    readiness: (eventId: string, opts?: { overdueOnly?: boolean }) =>
      this.http.get(`/api/events/${enc(eventId)}/readiness`, {
        overdueOnly: opts?.overdueOnly ? "true" : undefined,
      }),
  };

  readonly speakers = {
    list: (eventId: string, query?: { q?: string; status?: string }) =>
      this.http.get(`/api/events/${enc(eventId)}/speakers`, query),
    get: (eventId: string, participationId: string) =>
      this.http.get(
        `/api/events/${enc(eventId)}/speakers/${enc(participationId)}`,
      ),
    updateProfile: (
      eventId: string,
      participationId: string,
      body: {
        bio?: string;
        company?: string;
        title?: string;
        headshotFileId?: string;
        expectedVersion?: number;
      },
    ) =>
      this.http.patch(
        `/api/events/${enc(eventId)}/speakers/${enc(participationId)}`,
        body,
      ),
  };

  readonly schedule = {
    list: (eventId: string, view?: string) =>
      this.http.get(
        `/api/events/${enc(eventId)}/schedule`,
        view ? { view } : undefined,
      ),
    place: (
      eventId: string,
      body: {
        sessionId: string;
        roomId: string;
        startsAt: string;
        endsAt: string;
        expectedVersion?: number;
      },
    ) => this.http.post(`/api/events/${enc(eventId)}/schedule/place`, body),
    move: (
      eventId: string,
      body: {
        placementId: string;
        roomId: string;
        startsAt: string;
        endsAt: string;
        expectedVersion: number;
      },
    ) => this.http.post(`/api/events/${enc(eventId)}/schedule/move`, body),
    unschedule: (
      eventId: string,
      body: { placementId: string; expectedVersion: number },
    ) =>
      this.http.post(`/api/events/${enc(eventId)}/schedule/unschedule`, body),
  };

  readonly submissions = {
    list: (
      eventId: string,
      query?: { status?: string; q?: string; category?: string },
    ) => this.http.get(`/api/events/${enc(eventId)}/submissions`, query),
    get: (submissionId: string) =>
      this.http.get(`/api/submissions/${enc(submissionId)}`),
    assign: (submissionId: string, body: { userIds: string[] }) =>
      this.http.post(`/api/submissions/${enc(submissionId)}/assign`, body),
    decision: (
      submissionId: string,
      body: { decision: "accept" | "reject" | "waitlist"; reason?: string },
    ) => this.http.post(`/api/submissions/${enc(submissionId)}/decision`, body),
  };

  readonly forms = {
    list: (eventId: string) =>
      this.http.get(`/api/events/${enc(eventId)}/forms`),
    get: (formId: string) => this.http.get(`/api/forms/${enc(formId)}`),
    create: (eventId: string, body: { name: string }) =>
      this.http.post(`/api/events/${enc(eventId)}/forms`, body),
    publish: (formId: string) =>
      this.http.post(`/api/forms/${enc(formId)}/publish`, {}),
  };

  readonly design = {
    get: (eventId: string) =>
      this.http.get(`/api/events/${enc(eventId)}/design`),
    setDraft: (eventId: string, body: unknown) =>
      this.http.put(`/api/events/${enc(eventId)}/design`, body),
    publish: (eventId: string, body?: { expectedVersion?: number }) =>
      this.http.post(`/api/events/${enc(eventId)}/design/publish`, body ?? {}),
  };

  readonly integrations = {
    status: (eventId: string) =>
      this.http.get(`/api/events/${enc(eventId)}/integrations`),
    saveAccelevents: (
      eventId: string,
      body: {
        eventUrl: string;
        externalEventId: string;
        enabled: boolean;
        expectedVersion?: number;
      },
    ) =>
      this.http.put(
        `/api/events/${enc(eventId)}/integrations/accelevents`,
        body,
      ),
    verifyAccelevents: (
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
    create: (body: { name: string; scopes: string[] }) =>
      this.http.post("/api/keys", body),
  };

  readonly files = {
    presign: (body: unknown) => this.http.post("/api/files/presign", body),
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
