/**
 * F5 Find — authz isolation, reindex, sanitize, routes.
 */
import { describe, it, expect } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SearchResponseSchema,
  sanitizeFtsQuery,
  makeSnippet,
  searchHitRoute,
  isAllowedSearchRoute,
  escapeLikePattern,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

describe("sanitizeFtsQuery / makeSnippet / routes", () => {
  it("strips hostile FTS syntax and empty operators", () => {
    const out = sanitizeFtsQuery(`foo" OR 1=1 --`);
    expect(out.toUpperCase()).not.toMatch(/\bOR\b/);
    expect(sanitizeFtsQuery("hello world")).toContain('"hello"*');
    expect(sanitizeFtsQuery("%%%")).toBe("");
  });

  it("snippet is plain text around match", () => {
    const s = makeSnippet("alpha beta gamma delta", "beta");
    expect(s.toLowerCase()).toContain("beta");
    expect(s).not.toMatch(/</);
  });

  it("allowlisted routes only", () => {
    expect(searchHitRoute("submission", "s1")).toBe(
      "/admin/submissions?submissionId=s1",
    );
    expect(searchHitRoute("session", "ses1")).toBe(
      "/admin/schedule?sessionId=ses1",
    );
    expect(searchHitRoute("speaker", "p1")).toBe(
      "/admin/speakers?participationId=p1",
    );
    expect(isAllowedSearchRoute("/admin/submissions?submissionId=x")).toBe(
      true,
    );
    expect(isAllowedSearchRoute("https://evil.example/admin")).toBe(false);
    expect(isAllowedSearchRoute("/admin/submissions?open=x")).toBe(false);
    expect(escapeLikePattern("100%_done")).toBe("100\\%\\_done");
  });
});

async function adminSession(
  email: string,
  shared?: ReturnType<typeof createAppWithAuth>,
) {
  const ctx = shared ?? createAppWithAuth({ cookieSecure: true });
  const { app, store, outbox } = ctx;
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
  const sessionValue = setCookie
    .split(";")[0]!
    .split("=")
    .slice(1)
    .join("=");
  const cookie = `${SESSION_COOKIE_NAME}=${sessionValue}`;
  const user = await store.findUserByEmail(email);
  const createRes = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: `F5 ${email}`,
        timezone: "UTC",
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-02T17:00:00.000Z",
      }),
    },
    env,
  );
  expect(createRes.status).toBe(201);
  const body = (await createRes.json()) as { event: { id: string } };
  return {
    app,
    store,
    cookie,
    userId: user!.id,
    eventId: body.event.id,
    submissions: ctx.submissions,
    decisions: ctx.decisions,
    ctx,
  };
}

describe("F5 search HTTP", () => {
  it("admin can reindex and find a submission by title with canonical route", async () => {
    const { app, cookie, eventId, submissions } = await adminSession(
      "f5-admin@example.com",
    );
    await submissions.insertSubmission({
      id: "sub_f5_1",
      eventId,
      formVersionId: "fv_f5",
      title: "Shipping Reliable Find Index",
      category: "keynote",
      status: "submitted",
      submittedAt: "2026-06-01T12:00:00.000Z",
      version: 1,
    });

    const reindex = await app.request(
      `http://localhost/api/events/${eventId}/search/reindex`,
      { method: "POST", headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(reindex.status).toBe(200);

    const res = await app.request(
      `http://localhost/api/events/${eventId}/search?q=Reliable`,
      { headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(res.status).toBe(200);
    const body = SearchResponseSchema.parse(await res.json());
    const hit = body.hits.find((h) => h.entityId === "sub_f5_1");
    expect(hit).toBeTruthy();
    expect(hit!.route).toBe("/admin/submissions?submissionId=sub_f5_1");
    expect(isAllowedSearchRoute(hit!.route)).toBe(true);
  });

  it("empty / operator-only q is validation error", async () => {
    const { app, cookie, eventId } = await adminSession("f5-empty@example.com");
    const res = await app.request(
      `http://localhost/api/events/${eventId}/search?q=`,
      { headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(res.status).toBe(400);
    const res2 = await app.request(
      `http://localhost/api/events/${eventId}/search?q=${encodeURIComponent("OR AND")}`,
      { headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(res2.status).toBe(400);
  });

  it("cross-event isolation on shared app estate", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const a = await adminSession("f5-a@example.com", shared);
    const b = await adminSession("f5-b@example.com", shared);
    await a.submissions.insertSubmission({
      id: "sub_secret_a",
      eventId: a.eventId,
      formVersionId: "fv",
      title: "Secret Alpha Talk",
      category: null,
      status: "submitted",
      submittedAt: "2026-06-01T12:00:00.000Z",
      version: 1,
    });
    await a.app.request(
      `http://localhost/api/events/${a.eventId}/search/reindex`,
      { method: "POST", headers: { cookie: a.cookie } },
      env,
    );

    // B cannot list A's event
    const denied = await b.app.request(
      `http://localhost/api/events/${a.eventId}/search?q=Secret`,
      { headers: { cookie: b.cookie, accept: "application/json" } },
      env,
    );
    expect([403, 404]).toContain(denied.status);

    // B searching own event must not see A's secret
    await b.app.request(
      `http://localhost/api/events/${b.eventId}/search/reindex`,
      { method: "POST", headers: { cookie: b.cookie } },
      env,
    );
    const own = await b.app.request(
      `http://localhost/api/events/${b.eventId}/search?q=Secret`,
      { headers: { cookie: b.cookie, accept: "application/json" } },
      env,
    );
    expect(own.status).toBe(200);
    const body = SearchResponseSchema.parse(await own.json());
    expect(body.hits.some((h) => h.entityId === "sub_secret_a")).toBe(false);
  });

  it("unauthenticated search is 401", async () => {
    const { app, eventId } = await adminSession("f5-unauth@example.com");
    const res = await app.request(
      `http://localhost/api/events/${eventId}/search?q=x`,
      { headers: { accept: "application/json" } },
      env,
    );
    expect([401, 403]).toContain(res.status);
  });
});
