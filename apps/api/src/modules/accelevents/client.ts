/**
 * Accelevents HTTP client — one-way only (E7). Never on request path.
 * Auth: header `Key` only (developer.accelevents.com OpenAPI).
 * Modes: http | paused (no key) | sandbox (tests, no network).
 */

export type AcceleventsEnv = {
  ACCELEVENTS_API_KEY?: string;
};

export type RecordedCall = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type AcceleventsListSpeaker = {
  id: string;
  email: string | null;
};

export type AcceleventsListSession = {
  id: string;
  title: string | null;
  startTime: string | null;
};

export type AcceleventsClient = {
  readonly mode: "http" | "paused" | "sandbox";
  readonly credentialPresent: boolean;
  pingSpeakers(
    eventUrl: string,
    eventId: string,
  ): Promise<{ ok: boolean; error?: string }>;
  createSpeaker(
    eventUrl: string,
    body: Record<string, unknown>,
  ): Promise<{ externalId: string }>;
  updateSpeaker(
    eventUrl: string,
    speakerId: string,
    body: Record<string, unknown>,
  ): Promise<void>;
  listSpeakers(
    eventUrl: string,
    eventId: string,
  ): Promise<AcceleventsListSpeaker[]>;
  createSession(
    eventUrl: string,
    body: Record<string, unknown>,
  ): Promise<{ externalId: string }>;
  updateSession(
    eventUrl: string,
    sessionId: string,
    body: Record<string, unknown>,
  ): Promise<void>;
  listSessions(
    eventUrl: string,
    eventId: string,
  ): Promise<AcceleventsListSession[]>;
  recorded?: RecordedCall[];
};

export class AcceleventsDupEmailError extends Error {
  readonly code = "4068906" as const;
  constructor() {
    super("4068906");
    this.name = "AE_DUP_EMAIL";
  }
}

export class AcceleventsAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AE_AMBIGUOUS";
  }
}

export function resolveAcceleventsKey(env: AcceleventsEnv = {}): string {
  return typeof env.ACCELEVENTS_API_KEY === "string"
    ? env.ACCELEVENTS_API_KEY.trim()
    : "";
}

function extractId(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("id" in o) return extractId(o.id);
    if ("speakerId" in o) return extractId(o.speakerId);
    if ("sessionId" in o) return extractId(o.sessionId);
    if ("data" in o) return extractId(o.data);
  }
  return "";
}

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.content)) return o.content;
    if (Array.isArray(o.speakers)) return o.speakers;
    if (Array.isArray(o.sessions)) return o.sessions;
    if (o.data && typeof o.data === "object") return asArray(o.data);
  }
  return [];
}

function emailOf(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const e = o.email ?? o.emailId ?? o.speakerEmail;
  return typeof e === "string" && e.trim() ? e.trim() : null;
}

export class SandboxAcceleventsClient implements AcceleventsClient {
  readonly mode = "sandbox" as const;
  readonly credentialPresent = false;
  readonly recorded: RecordedCall[] = [];
  private seq = 1;
  speakers: AcceleventsListSpeaker[] = [];
  sessions: AcceleventsListSession[] = [];
  dupEmail = false;
  failPing: string | null = null;

  async pingSpeakers(eventUrl: string, eventId: string) {
    this.recorded.push({
      method: "GET",
      path: `/rest/host/event/${eventUrl}/speaker?eventId=${eventId}&page=0&size=1&expand=`,
      headers: { Key: "(sandbox)" },
    });
    if (this.failPing) return { ok: false, error: this.failPing };
    return { ok: true };
  }
  async createSpeaker(eventUrl: string, body: Record<string, unknown>) {
    this.recorded.push({
      method: "POST",
      path: `/rest/host/event/${eventUrl}/speaker`,
      headers: { Key: "(sandbox)" },
      body,
    });
    if (this.dupEmail) throw new AcceleventsDupEmailError();
    const id = String(this.seq++);
    this.speakers.push({
      id,
      email: typeof body.email === "string" ? body.email : null,
    });
    return { externalId: id };
  }
  async updateSpeaker(
    eventUrl: string,
    speakerId: string,
    body: Record<string, unknown>,
  ) {
    this.recorded.push({
      method: "PUT",
      path: `/rest/host/event/${eventUrl}/speaker/${speakerId}`,
      headers: { Key: "(sandbox)" },
      body,
    });
  }
  async listSpeakers(eventUrl: string, eventId: string) {
    this.recorded.push({
      method: "GET",
      path: `/rest/host/event/${eventUrl}/speaker?eventId=${eventId}&page=0&size=50&expand=`,
      headers: { Key: "(sandbox)" },
    });
    return [...this.speakers];
  }
  async createSession(eventUrl: string, body: Record<string, unknown>) {
    this.recorded.push({
      method: "POST",
      path: `/rest/host/event/${eventUrl}/session`,
      headers: { Key: "(sandbox)" },
      body,
    });
    const id = String(this.seq++);
    this.sessions.push({
      id,
      title: typeof body.title === "string" ? body.title : null,
      startTime: typeof body.startTime === "string" ? body.startTime : null,
    });
    return { externalId: id };
  }
  async updateSession(
    eventUrl: string,
    sessionId: string,
    body: Record<string, unknown>,
  ) {
    this.recorded.push({
      method: "PUT",
      path: `/rest/host/event/${eventUrl}/session/${sessionId}`,
      headers: { Key: "(sandbox)" },
      body,
    });
  }
  async listSessions(eventUrl: string, eventId: string) {
    this.recorded.push({
      method: "GET",
      path: `/rest/host/event/${eventUrl}/session?eventId=${eventId}`,
      headers: { Key: "(sandbox)" },
    });
    return [...this.sessions];
  }
}

export class PausedAcceleventsClient implements AcceleventsClient {
  readonly mode = "paused" as const;
  readonly credentialPresent = false;
  async pingSpeakers() {
    return { ok: false, error: "paused — no API key" };
  }
  async createSpeaker(): Promise<{ externalId: string }> {
    throw new Error("paused");
  }
  async updateSpeaker(): Promise<void> {
    throw new Error("paused");
  }
  async listSpeakers(): Promise<AcceleventsListSpeaker[]> {
    return [];
  }
  async createSession(): Promise<{ externalId: string }> {
    throw new Error("paused");
  }
  async updateSession(): Promise<void> {
    throw new Error("paused");
  }
  async listSessions(): Promise<AcceleventsListSession[]> {
    return [];
  }
}

const HTTP_TIMEOUT_MS = 15_000;

export class HttpAcceleventsClient implements AcceleventsClient {
  readonly mode = "http" as const;
  readonly credentialPresent = true;
  constructor(
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers() {
    return {
      Key: this.key,
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  private async request(
    method: string,
    url: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; text: string; json: unknown }> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new AcceleventsAmbiguousError("upstream timeout");
      }
      throw err;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.status === 406 || text.includes("4068906")) {
      throw new AcceleventsDupEmailError();
    }
    return { status: res.status, text, json };
  }

  async pingSpeakers(eventUrl: string, eventId: string) {
    const url = `https://api.accelevents.com/rest/host/event/${encodeURIComponent(eventUrl)}/speaker?eventId=${encodeURIComponent(eventId)}&page=0&size=1&expand=`;
    try {
      const res = await this.request("GET", url);
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof AcceleventsAmbiguousError) {
        return { ok: false, error: err.message };
      }
      return { ok: false, error: err instanceof Error ? err.message : "ping failed" };
    }
  }

  async createSpeaker(eventUrl: string, body: Record<string, unknown>) {
    const url = `https://api.accelevents.com/rest/host/event/${encodeURIComponent(eventUrl)}/speaker`;
    const res = await this.request("POST", url, body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
    const id = extractId(res.json);
    if (!id) throw new AcceleventsAmbiguousError("missing speaker id");
    return { externalId: id };
  }

  async updateSpeaker(
    eventUrl: string,
    speakerId: string,
    body: Record<string, unknown>,
  ) {
    const url = `https://api.accelevents.com/rest/host/event/${encodeURIComponent(eventUrl)}/speaker/${encodeURIComponent(speakerId)}`;
    const res = await this.request("PUT", url, body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async listSpeakers(eventUrl: string, eventId: string) {
    const out: AcceleventsListSpeaker[] = [];
    for (let page = 0; page < 5; page += 1) {
      const url = `https://api.accelevents.com/rest/host/event/${encodeURIComponent(eventUrl)}/speaker?eventId=${encodeURIComponent(eventId)}&page=${page}&size=50&expand=`;
      const res = await this.request("GET", url);
      if (res.status < 200 || res.status >= 300) break;
      const rows = asArray(res.json);
      if (rows.length === 0) break;
      for (const row of rows) {
        const id = extractId(row);
        if (id) out.push({ id, email: emailOf(row) });
      }
      if (rows.length < 50) break;
    }
    return out;
  }

  async createSession(eventUrl: string, body: Record<string, unknown>) {
    const url = `https://api.accelevents.com/rest/host/event/${encodeURIComponent(eventUrl)}/session`;
    const res = await this.request("POST", url, body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
    const id = extractId(res.json);
    if (!id) throw new AcceleventsAmbiguousError("missing session id");
    return { externalId: id };
  }

  async updateSession(
    eventUrl: string,
    sessionId: string,
    body: Record<string, unknown>,
  ) {
    const url = `https://api.accelevents.com/rest/host/event/${encodeURIComponent(eventUrl)}/session/${encodeURIComponent(sessionId)}`;
    const res = await this.request("PUT", url, body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async listSessions(eventUrl: string, eventId: string) {
    const url = `https://api.accelevents.com/rest/host/event/${encodeURIComponent(eventUrl)}/session?eventId=${encodeURIComponent(eventId)}`;
    const res = await this.request("GET", url);
    if (res.status < 200 || res.status >= 300) return [];
    return asArray(res.json).map((row) => {
      const o = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        id: extractId(row),
        title: typeof o.title === "string" ? o.title : null,
        startTime:
          typeof o.startTime === "string"
            ? o.startTime
            : typeof o.start_time === "string"
              ? o.start_time
              : null,
      };
    }).filter((s) => s.id);
  }
}

export function createAcceleventsClient(
  env: AcceleventsEnv,
  opts?: { sandbox?: boolean },
): AcceleventsClient {
  if (opts?.sandbox) return new SandboxAcceleventsClient();
  const key = resolveAcceleventsKey(env);
  if (!key) return new PausedAcceleventsClient();
  return new HttpAcceleventsClient(key);
}
