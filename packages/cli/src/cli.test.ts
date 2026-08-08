/**
 * Section 7.2 — OpenAPI + CLI (CLI01–CLI12).
 *
 * Named assertions:
 * - assert CLI01–CLI12 from CLI_INVENTORY.md covered by tests
 * - assert reports-only key schedule place exit code 2
 * - assert readiness --json parses
 * - assert openapi.json includes /api/events
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ReportsReadinessResponseSchema,
  EventListResponseSchema,
  DesignGetResponseSchema,
  SESSION_COOKIE_NAME,
  DEFAULT_DESIGN_TOKENS,
  type ApiScope,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../../apps/api/src/index.js";
import {
  main,
  EXIT_OK,
  EXIT_VALIDATION,
  EXIT_AUTHZ,
  EXIT_CONFLICT,
  exitCodeFromHttp,
  ApiClient,
} from "./main.js";
import { setClientFactoryForTests } from "./commands.js";

const env = { APP_VERSION: "0.1.0" };

type Capture = { out: string; err: string };

function captureIo(): Capture & {
  io: { writeOut: (s: string) => void; writeErr: (s: string) => void };
} {
  const c: Capture = { out: "", err: "" };
  return {
    ...c,
    io: {
      writeOut: (s) => {
        c.out += s;
      },
      writeErr: (s) => {
        c.err += s;
      },
    },
    get out() {
      return c.out;
    },
    get err() {
      return c.err;
    },
  };
}

/** Bridge Hono app.request → fetch-compatible client. */
function honoFetch(
  app: ReturnType<typeof createAppWithAuth>["app"],
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    let body: BodyInit | undefined = init?.body as BodyInit | undefined;
    // Hono request expects absolute URL
    const abs = url.startsWith("http") ? url : `http://localhost${url}`;
    const res = await app.request(
      abs,
      {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : body instanceof Uint8Array
              ? body
              : body instanceof ArrayBuffer
                ? body
                : typeof body === "string"
                  ? body
                  : body,
      },
      env,
    );
    return res;
  };
}

async function adminSession(email: string) {
  const ctx = createAppWithAuth({ cookieSecure: true });
  const { app, store, keys, outbox, events } = ctx;

  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose: "admin" }),
    },
    env,
  );
  const token = outbox.lastForEmail(email)!.token;
  const exchange = await app.request(
    "http://localhost/api/auth/exchange",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    },
    env,
  );
  expect(exchange.status).toBe(200);
  const setCookie = exchange.headers.get("set-cookie")!;
  const sessionValue = setCookie.split(";")[0]!.split("=").slice(1).join("=");
  const cookie = `${SESSION_COOKIE_NAME}=${sessionValue}`;
  const user = await store.findUserByEmail(email);
  expect(user).toBeTruthy();

  // Ensure a concrete event exists for schedule/design
  const createEvt = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-cli-evt",
      },
      body: JSON.stringify({
        name: "CLI Dogfood Event",
        timezone: "UTC",
      }),
    },
    env,
  );
  // Event.Create may 201; if bootstrap already has membership-only event, list still works
  let eventId = "evt_dogfood";
  if (createEvt.status === 201 || createEvt.status === 200) {
    const body = (await createEvt.json()) as { event?: { id: string }; id?: string };
    eventId = body.event?.id ?? body.id ?? eventId;
  } else {
    const list = await app.request(
      "http://localhost/api/events",
      { headers: { cookie } },
      env,
    );
    const lb = (await list.json()) as { events: Array<{ id: string }> };
    if (lb.events?.[0]?.id) eventId = lb.events[0].id;
  }

  return { app, store, keys, events, cookie, userId: user!.id, eventId };
}

async function mintKey(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name: string,
  scopes: ApiScope[],
): Promise<{ secret: string; id: string }> {
  const res = await app.request(
    "http://localhost/api/keys",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": `corr-mint-${name}`,
      },
      body: JSON.stringify({ name, scopes }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { secret: string; id: string };
  expect(body.secret).toBeTruthy();
  return body;
}

function clientFor(
  app: ReturnType<typeof createAppWithAuth>["app"],
  secret: string,
): ApiClient {
  return new ApiClient({
    baseUrl: "http://localhost",
    apiKey: secret,
    fetchImpl: honoFetch(app),
  });
}

beforeEach(() => {
  setClientFactoryForTests(null);
});

describe("7.2 exit code mapping", () => {
  it("maps HTTP statuses to exit 0–4", () => {
    expect(exitCodeFromHttp(200)).toBe(EXIT_OK);
    expect(exitCodeFromHttp(201)).toBe(EXIT_OK);
    expect(exitCodeFromHttp(400)).toBe(EXIT_VALIDATION);
    expect(exitCodeFromHttp(404)).toBe(EXIT_VALIDATION);
    expect(exitCodeFromHttp(401)).toBe(EXIT_AUTHZ);
    expect(exitCodeFromHttp(403)).toBe(EXIT_AUTHZ);
    expect(exitCodeFromHttp(409)).toBe(EXIT_CONFLICT);
    expect(exitCodeFromHttp(409, "CONFLICT")).toBe(EXIT_CONFLICT);
    expect(exitCodeFromHttp(500)).toBe(4);
    expect(exitCodeFromHttp(0)).toBe(4);
  });
});

describe("7.2 CLI01–CLI12 inventory", () => {
  it("CLI01 speakerops events list --json returns events array", async () => {
    const { app, cookie } = await adminSession("cli01@example.com");
    const key = await mintKey(app, cookie, "events-read", ["events:read"]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    const code = await main(["events", "list", "--json"], { io: cap.io });
    expect(code).toBe(EXIT_OK);
    const body = JSON.parse(cap.out);
    const parsed = EventListResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data!.events)).toBe(true);
  });

  it("CLI02 reports readiness --json parses outstanding[] shape", async () => {
    const { app, cookie, eventId } = await adminSession("cli02@example.com");
    const key = await mintKey(app, cookie, "reports-read", ["reports:read"]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    const code = await main(
      ["reports", "readiness", "--event", eventId, "--json"],
      { io: cap.io },
    );
    expect(code).toBe(EXIT_OK);
    const body = JSON.parse(cap.out);
    const parsed = ReportsReadinessResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data!.outstanding)).toBe(true);
    expect(parsed.data!.eventId).toBe(eventId);
    expect(parsed.data!.stats).toBeDefined();
    expect(typeof parsed.data!.generatedAt).toBe("string");
  });

  it("CLI03 design get --json returns draft+published", async () => {
    const { app, cookie, eventId } = await adminSession("cli03@example.com");
    const key = await mintKey(app, cookie, "design-read", [
      "design:read",
      "design:write",
    ]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    const code = await main(
      ["design", "get", "--event", eventId, "--json"],
      { io: cap.io },
    );
    expect(code).toBe(EXIT_OK);
    const body = JSON.parse(cap.out);
    const parsed = DesignGetResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveProperty("draft");
    expect(parsed.data).toHaveProperty("published");
  });

  it("CLI04 design set --brand updates draft", async () => {
    const { app, cookie, eventId } = await adminSession("cli04@example.com");
    const key = await mintKey(app, cookie, "design-write", ["design:write"]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    const code = await main(
      ["design", "set", "--event", eventId, "--brand", "#4F46E5", "--json"],
      { io: cap.io },
    );
    expect(code).toBe(EXIT_OK);
    const body = JSON.parse(cap.out) as {
      draft?: { tokens?: { brand?: string } };
    };
    expect(body.draft?.tokens?.brand?.toLowerCase()).toBe("#4f46e5");
  });

  it("CLI05 design publish works (contrast gate may 400)", async () => {
    const { app, cookie, eventId } = await adminSession("cli05@example.com");
    const key = await mintKey(app, cookie, "design-pub", ["design:write"]);
    setClientFactoryForTests(() => clientFor(app, key.secret));

    // Seed draft with AA-safe brand from defaults
    await main(
      [
        "design",
        "set",
        "--event",
        eventId,
        "--brand",
        DEFAULT_DESIGN_TOKENS.brand,
        "--json",
      ],
      { io: captureIo().io },
    );

    const cap = captureIo();
    const code = await main(
      ["design", "publish", "--event", eventId, "--json"],
      { io: cap.io },
    );
    // Success 0 or contrast 400→1 — both valid per inventory
    expect([EXIT_OK, EXIT_VALIDATION]).toContain(code);
    if (code === EXIT_OK) {
      const body = JSON.parse(cap.out) as { published?: { tokens?: unknown } };
      expect(body.published).toBeTruthy();
    } else {
      const body = JSON.parse(cap.out) as { code?: string };
      expect(body.code === "CONTRAST_FAILED" || body.code === "VALIDATION_ERROR").toBe(
        true,
      );
    }
  });

  it("CLI06 schedule place returns 0 or exit 3 conflict", async () => {
    const { app, cookie, eventId } = await adminSession("cli06@example.com");
    const key = await mintKey(app, cookie, "sched-write", [
      "schedule:write",
      "events:read",
    ]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    // Place without real session/room → validation or not found (exit 1), not authz
    const code = await main(
      [
        "schedule",
        "place",
        "--event",
        eventId,
        "--session",
        "sess_missing",
        "--room",
        "room_missing",
        "--start",
        "2030-01-01T10:00:00.000Z",
        "--end",
        "2030-01-01T11:00:00.000Z",
        "--json",
      ],
      { io: cap.io },
    );
    // Missing entities → 404 validation mapping (1) or conflict (3); never 2 with valid scope
    expect(code).not.toBe(EXIT_AUTHZ);
    expect([EXIT_OK, EXIT_VALIDATION, EXIT_CONFLICT]).toContain(code);
  });

  it("CLI07 reports-only key schedule place exit code 2", async () => {
    const { app, cookie, eventId } = await adminSession("cli07@example.com");
    const key = await mintKey(app, cookie, "reports-only", [
      "reports:read",
      "events:read",
    ]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    const code = await main(
      [
        "schedule",
        "place",
        "--event",
        eventId,
        "--session",
        "sess_x",
        "--room",
        "room_x",
        "--start",
        "2030-01-01T10:00:00.000Z",
        "--end",
        "2030-01-01T11:00:00.000Z",
        "--json",
      ],
      { io: cap.io },
    );
    expect(code).toBe(EXIT_AUTHZ);
    const body = JSON.parse(cap.out) as { code?: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("CLI08 files upload returns file id", async () => {
    const { app, cookie, eventId } = await adminSession("cli08@example.com");
    const key = await mintKey(app, cookie, "files-write", ["files:write"]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    // Minimal 1x1 PNG
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
      0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const code = await main(
      [
        "files",
        "upload",
        "--event",
        eventId,
        "--file",
        "logo.png",
        "--purpose",
        "logo",
        "--json",
      ],
      {
        io: cap.io,
        readFileImpl: async () => png,
      },
    );
    expect(code).toBe(EXIT_OK);
    const body = JSON.parse(cap.out) as { fileId?: string };
    expect(body.fileId).toBeTruthy();
    expect(typeof body.fileId).toBe("string");
  });

  it("CLI09 comms draft --preview lists recipients shape", async () => {
    const { app, cookie, eventId } = await adminSession("cli09@example.com");
    // Seed template via session
    const tpl = await app.request(
      `http://localhost/api/events/${eventId}/templates/task-reminder`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-cli-tpl",
        },
        body: JSON.stringify({
          subject: "Hello {{name}}",
          body: "Task for {{name}}",
        }),
      },
      env,
    );
    expect([200, 201]).toContain(tpl.status);
    const tplBody = (await tpl.json()) as { template: { id: string } };

    const key = await mintKey(app, cookie, "comms-draft", ["comms:draft"]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    const code = await main(
      [
        "comms",
        "draft",
        "--preview",
        "--template",
        tplBody.template.id,
        "--json",
      ],
      { io: cap.io },
    );
    expect(code).toBe(EXIT_OK);
    const body = JSON.parse(cap.out) as {
      recipients?: unknown[];
      previewId?: string;
    };
    expect(Array.isArray(body.recipients)).toBe(true);
    expect(body.previewId).toBeTruthy();
  });

  it("CLI10 comms send without comms:send exit code 2", async () => {
    const { app, cookie } = await adminSession("cli10@example.com");
    const key = await mintKey(app, cookie, "no-send", [
      "comms:draft",
      "reports:read",
    ]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    const code = await main(
      [
        "comms",
        "send",
        "--preview-id",
        "preview_fake",
        "--idempotency-key",
        "idem-cli10",
        "--json",
      ],
      { io: cap.io },
    );
    expect(code).toBe(EXIT_AUTHZ);
    const body = JSON.parse(cap.out) as { code?: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("CLI11 keys create without keys:admin exit code 2", async () => {
    const { app, cookie } = await adminSession("cli11@example.com");
    const key = await mintKey(app, cookie, "no-keys-admin", [
      "events:read",
      "reports:read",
    ]);
    const cap = captureIo();
    setClientFactoryForTests(() => clientFor(app, key.secret));

    const code = await main(
      [
        "keys",
        "create",
        "--name",
        "should-fail",
        "--scopes",
        "events:read",
        "--json",
      ],
      { io: cap.io },
    );
    expect(code).toBe(EXIT_AUTHZ);
    const body = JSON.parse(cap.out) as { code?: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("CLI12 openapi.json includes /api/events and command paths", async () => {
    const { app } = await adminSession("cli12@example.com");
    const cap = captureIo();
    setClientFactoryForTests(
      () =>
        new ApiClient({
          baseUrl: "http://localhost",
          apiKey: "",
          fetchImpl: honoFetch(app),
        }),
    );

    const code = await main(["openapi", "--json"], { io: cap.io });
    expect(code).toBe(EXIT_OK);
    const doc = JSON.parse(cap.out) as {
      paths?: Record<string, unknown>;
      "x-speakerops-commands"?: string[];
    };
    expect(doc.paths).toBeDefined();
    expect(doc.paths!["/api/events"]).toBeDefined();
    expect(doc.paths!["/api/events/{eventId}/readiness"]).toBeDefined();
    expect(doc.paths!["/api/events/{eventId}/schedule/place"]).toBeDefined();
    expect(doc.paths!["/api/events/{eventId}/design"]).toBeDefined();
    expect(doc["x-speakerops-commands"]).toContain("Event.List");
    expect(doc["x-speakerops-commands"]).toContain("Reports.Readiness");
    expect(doc["x-speakerops-commands"]).toContain("Schedule.Place");
    expect(doc["x-speakerops-commands"]).toContain("Design.Publish");
  });

  it("missing API key → exit 1 validation (not silent success)", async () => {
    const cap = captureIo();
    // Ensure no factory / no env key
    setClientFactoryForTests(() => null);
    const prev = process.env.SPEAKEROPS_API_KEY;
    delete process.env.SPEAKEROPS_API_KEY;
    try {
      const code = await main(["events", "list", "--json"], { io: cap.io });
      expect(code).toBe(EXIT_VALIDATION);
    } finally {
      if (prev !== undefined) process.env.SPEAKEROPS_API_KEY = prev;
    }
  });

  it("--help and --version exit 0", async () => {
    const h = captureIo();
    expect(await main(["--help"], { io: h.io })).toBe(EXIT_OK);
    expect(h.out).toMatch(/speakerops/);
    expect(h.out).toMatch(/CLI01|events list|reports readiness/);

    const v = captureIo();
    expect(await main(["--version"], { io: v.io })).toBe(EXIT_OK);
    expect(v.out).toMatch(/0\.1\.0/);
  });
});

describe("7.2 OpenAPI HTTP GET /openapi.json", () => {
  it("serves document with /api/events", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const res = await app.request("http://localhost/openapi.json", {}, env);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.paths?.["/api/events"]).toBeDefined();
  });
});
