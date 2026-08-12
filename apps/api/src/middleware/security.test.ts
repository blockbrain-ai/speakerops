/**
 * Section 8.3 — Security headers + CSP (Vitest).
 *
 * Named assertions from spec:
 * - assert Content-Security-Policy header present on HTML
 * - CSP + companion headers on all responses (JSON health too)
 * - Cookie Secure/HttpOnly/SameSite production flags
 * - assert rate limit returns 429 after threshold in test
 * - XSS storage stays text (A10 review); logo SVG reject remains C09 e2e
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
  ErrorEnvelopeSchema,
  RATE_LIMITED,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
  SubmissionCreateResponseSchema,
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  FormUpdateDraftResponseSchema,
} from "@speakerops/shared";
import {
  applySecurityHeaders,
  securityHeadersMiddleware,
} from "./security.js";
import { createApp, createAppWithAuth } from "../index.js";
import { CfpRateLimiter } from "../modules/publicCfp/rateLimit.js";
import { buildSessionSetCookie } from "../modules/auth/cookies.js";

const env = { APP_VERSION: "0.1.0" };

const openFields = [
  {
    fieldKey: "talk_title",
    type: "text" as const,
    label: "Talk title",
    required: true,
    sortOrder: 0,
  },
  {
    fieldKey: "category",
    type: "select" as const,
    label: "Category",
    required: true,
    sortOrder: 1,
    options: [
      { value: "ai", label: "AI" },
      { value: "infra", label: "Infrastructure" },
    ],
  },
  {
    fieldKey: "abstract",
    type: "textarea" as const,
    label: "Abstract",
    required: false,
    sortOrder: 2,
  },
];

async function magicLinkCookie(
  app: ReturnType<typeof createAppWithAuth>["app"],
  outbox: ReturnType<typeof createAppWithAuth>["outbox"],
  email: string,
): Promise<string> {
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
  return `${SESSION_COOKIE_NAME}=${sessionValue}`;
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name: string,
  slug: string,
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-evt-83",
      },
      body: JSON.stringify({ name, timezone: "UTC", slug }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const parsed = EventResponseSchema.parse(await res.json());
  return { id: parsed.event.id, slug: parsed.event.slug };
}

async function publishOpenForm(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  eventId: string,
): Promise<{ formId: string; formVersionId: string }> {
  const create = await app.request(
    `http://localhost/api/events/${eventId}/forms`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ name: "Public CFP" }),
    },
    env,
  );
  expect(create.status).toBe(201);
  const created = FormCreateResponseSchema.parse(await create.json());

  const draft = await app.request(
    `http://localhost/api/forms/${created.form.id}/draft`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        fields: openFields,
        rules: [],
        welcomeMd: "Welcome",
        thankYouMd: "Thanks",
        opensAt: null,
        closesAt: null,
      }),
    },
    env,
  );
  expect(draft.status).toBe(200);
  FormUpdateDraftResponseSchema.parse(await draft.json());

  const pub = await app.request(
    `http://localhost/api/forms/${created.form.id}/publish`,
    {
      method: "POST",
      headers: { cookie },
    },
    env,
  );
  expect(pub.status).toBe(200);
  const published = FormPublishResponseSchema.parse(await pub.json());
  return {
    formId: created.form.id,
    formVersionId: published.formVersion.id,
  };
}

function baseSubmitBody(
  formVersionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    formVersionId,
    title: "My Talk",
    answers: [
      { fieldKey: "talk_title", value: "My Talk" },
      { fieldKey: "category", value: "ai" },
    ],
    speakers: [
      { name: "Ada Lovelace", email: "ada@example.com", isPrimary: true },
    ],
    turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    ...overrides,
  };
}

describe("8.3 security headers middleware", () => {
  it("assert Content-Security-Policy header present on HTML", async () => {
    const app = new Hono();
    app.use("*", securityHeadersMiddleware);
    app.get("/doc", (c) =>
      c.html("<!doctype html><html><body><p>ok</p></body></html>"),
    );

    const res = await app.request("http://localhost/doc");
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType.toLowerCase()).toMatch(/text\/html/);

    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toBe(CONTENT_SECURITY_POLICY);
    expect(csp).toMatch(/default-src\s+'self'/);
    expect(csp).toMatch(/frame-ancestors\s+'none'/);
    expect(csp).toMatch(/object-src\s+'none'/);
    expect(csp).toMatch(/challenges\.cloudflare\.com/);
    // Cloudflare Web Analytics beacon (zone-injected) must not CSP-block console
    expect(csp).toMatch(/static\.cloudflareinsights\.com/);
    expect(csp).toMatch(/cloudflareinsights\.com/);

    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Permissions-Policy")).toMatch(/camera=\(\)/);
  });

  it("CSP present on composition-root health JSON (all responses)", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/health", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBe(
      CONTENT_SECURITY_POLICY,
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("embed routes are framable (frame-ancestors *; no X-Frame-Options DENY)", async () => {
    const app = createApp();
    const res = await app.request(
      "http://localhost/embed/demo/sessions",
      {},
      env,
    );
    // SPA or 200/404 still must carry embed CSP when path is /embed/*
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/frame-ancestors\s+\*/);
    expect(csp).toMatch(/frame-src[^;]*'self'/);
    const xfo = res.headers.get("X-Frame-Options");
    expect(xfo == null || xfo === "").toBe(true);
  });

  it("CSP present on 404 envelope", async () => {
    const app = createApp();
    const res = await app.request(
      "http://localhost/no-such-route-8-3",
      {},
      env,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe("NOT_FOUND");
  });

  it("applySecurityHeaders writes every SECURITY_HEADERS entry", () => {
    const got: Record<string, string> = {};
    applySecurityHeaders((name, value) => {
      got[name] = value;
    });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(got[name]).toBe(value);
    }
  });
});

describe("8.3 cookie flags production-ready", () => {
  it("session Set-Cookie is HttpOnly Secure SameSite=Lax", async () => {
    const { app, outbox } = createAppWithAuth({ cookieSecure: true });
    const cookie = await magicLinkCookie(app, outbox, "sec-cookie@example.com");
    expect(cookie).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=`));

    // Re-exchange is one-shot; assert flags via builder + a fresh exchange path
    const built = buildSessionSetCookie("tok");
    expect(built.toLowerCase()).toContain("httponly");
    expect(built.toLowerCase()).toContain("secure");
    expect(built.toLowerCase()).toMatch(/samesite=lax/);
    expect(built).toMatch(/Path=\//);
  });

  it("exchange response Set-Cookie includes production flags", async () => {
    const { app, outbox } = createAppWithAuth({ cookieSecure: true });
    const email = "sec-cookie-flags@example.com";
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
    const res = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie!.toLowerCase()).toContain("httponly");
    expect(setCookie!.toLowerCase()).toContain("secure");
    expect(setCookie!.toLowerCase()).toMatch(/samesite=lax/);
    // CSP still present on auth responses
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });
});

describe("8.3 rate limit returns 429 after threshold", () => {
  it("assert rate limit returns 429 after threshold in test", async () => {
    const limiter = new CfpRateLimiter(2, 60_000);
    const { app, outbox } = createAppWithAuth({
      cookieSecure: true,
      rateLimiter: limiter,
    });
    const cookie = await magicLinkCookie(app, outbox, "rl-83@example.com");
    const event = await createEvent(app, cookie, "RL 8.3 Event", "rl-83-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);
    const ip = "198.51.100.83";

    const first = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-rl-1",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify(baseSubmitBody(formVersionId)),
      },
      env,
    );
    expect(first.status).toBe(201);
    SubmissionCreateResponseSchema.parse(await first.json());
    expect(first.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(first.headers.get("Content-Security-Policy")).toBeTruthy();

    const second = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-rl-2",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            speakers: [
              {
                name: "Speaker Two",
                email: "speaker-rl-2@example.com",
                isPrimary: true,
              },
            ],
          }),
        ),
      },
      env,
    );
    expect(second.status).toBe(201);

    const third = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-rl-3",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            speakers: [
              {
                name: "Speaker Three",
                email: "speaker-rl-3@example.com",
                isPrimary: true,
              },
            ],
          }),
        ),
      },
      env,
    );
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toBeTruthy();
    expect(third.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(third.headers.get("Content-Security-Policy")).toBeTruthy();
    const err = ErrorEnvelopeSchema.parse(await third.json());
    expect(err.code).toBe(RATE_LIMITED);
    expect(err.error.toLowerCase()).toMatch(/rate/);
  });
});

describe("8.3 XSS review (A10 unit anchor)", () => {
  it("script payload stored as plain text answer (A10 server path)", async () => {
    const limiter = new CfpRateLimiter(50, 60_000);
    const { app, outbox, submissions } = createAppWithAuth({
      cookieSecure: true,
      rateLimiter: limiter,
    });
    const cookie = await magicLinkCookie(app, outbox, "xss-a10@example.com");
    const event = await createEvent(app, cookie, "XSS Event", "xss-83");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const xss = `<script>window.__xss=1</script><img src=x onerror="window.__xss=1">`;
    const submit = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-xss-a10",
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            answers: [
              { fieldKey: "talk_title", value: "XSS Talk" },
              { fieldKey: "category", value: "ai" },
              { fieldKey: "abstract", value: xss },
            ],
            speakers: [
              {
                name: "Safe Speaker",
                email: "safe-xss@example.com",
                isPrimary: true,
              },
            ],
          }),
        ),
      },
      env,
    );
    expect(submit.status).toBe(201);
    const created = SubmissionCreateResponseSchema.parse(await submit.json());
    const abstract = created.answers.find((a) => a.fieldKey === "abstract");
    expect(abstract?.value).toBe(xss);
    const rows = await submissions.listAnswers(created.submission.id);
    const stored = rows.find((r) => r.fieldKey === "abstract");
    expect(stored?.valueJson).toContain("script");
    expect(JSON.parse(stored!.valueJson)).toBe(xss);
  });
});
