/**
 * B07 — Auth.JudgeAccess (competition judge entry).
 *
 * Named assertions:
 * - correct code + seeded persona → 200, role session cookie with 4h Max-Age,
 *   DB session expiry ≈ 4h (cookie and credential share the TTL)
 * - wrong code → generic 401 (no cause detail)
 * - unseeded persona → generic 401 (indistinguishable from wrong code)
 * - judgeAccessCode unset → route absent (404)
 * - enableRoleSwitcher off → route absent (404) even with a code
 * - rate limit: >10 attempts in window → 429
 * - audit event Auth.JudgeAccess recorded on mint (no token in payload)
 * - shared-demo blast radius: demo persona session cannot Keys.Create (403)
 * - membership re-entry regression: accepted (provisioned) email NOT on the
 *   magic-link allowlist still receives a link (programReentry)
 */
import { describe, it, expect } from "vitest";
import {
  DEMO_ROLE_EMAILS,
  DEFAULT_BOOTSTRAP_EVENT_ID,
  SESSION_COOKIE_NAME,
  JUDGE_SESSION_COOKIE_NAME,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { requestMagicLink } from "./commands.js";

const JUDGE_CODE = "unit-judge-code-0123456789";

async function seedPersona(
  store: {
    createUser: (u: { email: string; name?: string }) => Promise<{ id: string }>;
    upsertMembership: (m: {
      eventId: string;
      userId: string;
      role: "admin" | "evaluator" | "speaker";
    }) => Promise<unknown>;
  },
  role: "admin" | "evaluator" | "speaker",
) {
  const user = await store.createUser({
    email: DEMO_ROLE_EMAILS[role],
    name: `Demo ${role}`,
  });
  await store.upsertMembership({
    eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
    userId: user.id,
    role,
  });
  return user;
}

function judgeBody(role: string, code: string = JUDGE_CODE) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, role }),
  };
}

describe("B07 judge access", () => {
  it("correct code + seeded persona mints a 4h session (cookie and DB agree)", async () => {
    const { app, store } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
    await seedPersona(store, "admin");

    const before = Date.now();
    const res = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      role: string;
      eventId: string;
      redirectTo: string;
    };
    expect(body.ok).toBe(true);
    expect(body.role).toBe("admin");
    expect(body.eventId).toBe(DEFAULT_BOOTSTRAP_EVENT_ID);
    expect(body.redirectTo).toContain("/admin");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Max-Age=14400");

    // DB session row expiry matches the 4h TTL (± 60s tolerance).
    const sessions = await store.listSessions();
    expect(sessions.length).toBe(1);
    const expMs = new Date(sessions[0]!.expiresAt).getTime();
    const fourH = 4 * 60 * 60 * 1000;
    expect(Math.abs(expMs - (before + fourH))).toBeLessThan(60_000);
  });

  it("wrong code and unseeded persona are the same generic 401", async () => {
    const { app, store } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
    await seedPersona(store, "admin");

    const bad = await app.request(
      "/api/auth/judge-access",
      judgeBody("admin", "wrong-code-wrong-code"),
    );
    expect(bad.status).toBe(401);
    const badBody = (await bad.json()) as { error: string };

    // evaluator persona NOT seeded → same failure shape
    const unseeded = await app.request(
      "/api/auth/judge-access",
      judgeBody("evaluator"),
    );
    expect(unseeded.status).toBe(401);
    const unseededBody = (await unseeded.json()) as { error: string };
    expect(unseededBody.error).toBe(badBody.error);
  });

  it("route is absent (404) without a configured code or with switcher off", async () => {
    const { app: noCode } = createAppWithAuth({});
    const res1 = await noCode.request(
      "/api/auth/judge-access",
      judgeBody("admin"),
    );
    expect(res1.status).toBe(404);

    const { app: switcherOff } = createAppWithAuth({
      enableRoleSwitcher: false,
      judgeAccessCode: JUDGE_CODE,
    });
    const res2 = await switcherOff.request(
      "/api/auth/judge-access",
      judgeBody("admin"),
    );
    expect(res2.status).toBe(404);
  });

  it("rate-limits repeated attempts from one client", async () => {
    const { app } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.request("/api/auth/judge-access", {
        ...judgeBody("admin", "wrong-code-wrong-code"),
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.7",
        },
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("records an Auth.JudgeAccess audit event without the token", async () => {
    const { app, store } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
    await seedPersona(store, "evaluator");
    const res = await app.request(
      "/api/auth/judge-access",
      judgeBody("evaluator"),
    );
    expect(res.status).toBe(200);
    const audits = await store.listAudits();
    const mint = audits.find((a) => a.action === "Auth.JudgeAccess");
    expect(mint).toBeTruthy();
    expect(mint!.afterJson ?? "").not.toContain(
      (res.headers.get("set-cookie") ?? "").split("=")[1]?.split(";")[0] ?? "@",
    );
  });

  it("demo persona session cannot create API keys (shared-demo blast radius)", async () => {
    const { app, store } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
    await seedPersona(store, "admin");
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;

    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "judge-should-fail",
        scopes: ["events:read"],
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("demo");
  });

  it("role switch never extends the judge 4h TTL (child session ≤ authorizing session)", async () => {
    const { app, store } = createAppWithAuth({
      judgeAccessCode: JUDGE_CODE,
      // Controlled path: role switch requires an authorizing admin session.
      roleSwitcherAllowUnauthenticated: false,
    });
    await seedPersona(store, "admin");
    await seedPersona(store, "evaluator");

    // Origin: judge access mints a 4h admin session.
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const judgeToken = (mint.headers.get("set-cookie") ?? "").match(
      new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`),
    )![1]!;
    const originRow = (await store.listSessions())[0]!;
    const originExpMs = new Date(originRow.expiresAt).getTime();

    const parseMaxAge = (cookie: string): number => {
      const m = cookie.match(/Max-Age=(\d+)/);
      expect(m, `Max-Age missing in: ${cookie}`).toBeTruthy();
      return Number(m![1]);
    };

    // Hop 1: judge admin → evaluator.
    const hop1 = await app.request("/api/auth/dev/role-switch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${judgeToken}`,
      },
      body: JSON.stringify({ role: "evaluator" }),
    });
    expect(hop1.status).toBe(200);
    const hop1Cookies = hop1.headers.getSetCookie();
    const hop1Active = hop1Cookies.find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    )!;
    const hop1Judge = hop1Cookies.find((c) =>
      c.startsWith(`${JUDGE_SESSION_COOKIE_NAME}=`),
    )!;
    expect(hop1Active).toBeTruthy();
    expect(hop1Judge).toBeTruthy();
    // Both cookies (active demo session AND preserved judge cookie) must not
    // outlive the origin's 4h — never the 14-day default.
    expect(parseMaxAge(hop1Active)).toBeLessThanOrEqual(4 * 60 * 60);
    expect(parseMaxAge(hop1Judge)).toBeLessThanOrEqual(4 * 60 * 60);

    // New DB session row expires no later than the origin (±1s floor skew).
    const afterHop1 = await store.listSessions();
    expect(afterHop1.length).toBe(2);
    const hop1Row = afterHop1.find((s) => s.id !== originRow.id)!;
    const hop1ExpMs = new Date(hop1Row.expiresAt).getTime();
    expect(hop1ExpMs).toBeLessThanOrEqual(originExpMs + 1000);

    // Hop 2: evaluator (active) + preserved judge cookie → back to admin.
    const hop1Token = hop1Active.split(";")[0]!.split("=").slice(1).join("=");
    const hop2 = await app.request("/api/auth/dev/role-switch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${hop1Token}; ${JUDGE_SESSION_COOKIE_NAME}=${judgeToken}`,
      },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(hop2.status).toBe(200);
    const hop2Cookies = hop2.headers.getSetCookie();
    const hop2Active = hop2Cookies.find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    )!;
    expect(parseMaxAge(hop2Active)).toBeLessThanOrEqual(4 * 60 * 60);

    const afterHop2 = await store.listSessions();
    expect(afterHop2.length).toBe(3);
    const hop2Row = afterHop2.find(
      (s) => s.id !== originRow.id && s.id !== hop1Row.id,
    )!;
    expect(new Date(hop2Row.expiresAt).getTime()).toBeLessThanOrEqual(
      originExpMs + 1000,
    );
  });

  it("demo persona session cannot revoke API keys; real admin revoke still works", async () => {
    const { app, store, outbox } = createAppWithAuth({
      judgeAccessCode: JUDGE_CODE,
    });
    await seedPersona(store, "admin");

    // Real admin via magic link (open bootstrap) creates a real key.
    const adminEmail = "real-admin-revoke@example.com";
    await app.request("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: adminEmail, purpose: "admin" }),
    });
    const linkToken = outbox.lastForEmail(adminEmail)!.token;
    const exchange = await app.request("/api/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: linkToken }),
    });
    expect(exchange.status).toBe(200);
    const adminCookie = (exchange.headers.get("set-cookie") ?? "").split(";")[0]!;

    const create = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        name: "revoke-guard-target",
        scopes: ["events:read"],
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string };

    // Judge-minted demo admin session must NOT be able to revoke it.
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const demoCookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;
    const denied = await app.request(
      `/api/keys/${encodeURIComponent(created.id)}`,
      { method: "DELETE", headers: { cookie: demoCookie } },
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { error: string };
    expect(deniedBody.error.toLowerCase()).toContain("demo");
    expect(deniedBody.error.toLowerCase()).toContain("revoke");

    // Key untouched; real admin revoke still works.
    const revoke = await app.request(
      `/api/keys/${encodeURIComponent(created.id)}`,
      { method: "DELETE", headers: { cookie: adminCookie } },
    );
    expect(revoke.status).toBe(200);
  });

  it("membership re-entry: provisioned email off the allowlist still gets a link", async () => {
    const { store, outbox } = createAppWithAuth({});
    const email = "accepted-speaker-offlist@example.com";
    const user = await store.createUser({ email });
    await store.upsertMembership({
      eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
      userId: user.id,
      role: "speaker",
    });

    const res = await requestMagicLink(
      { store, outbox, bootstrapPolicy: "controlled" },
      {
        email,
        correlationId: "test-reentry",
        magicLinkAllowlist: ["owner-only@example.com"],
      },
    );
    expect(res.sent).toBe(true);
    const links = await store.listMagicLinks();
    expect(
      links.some((l) => l.userId === user.id),
      "provisioned member off-allowlist must still receive a magic-link row (programReentry)",
    ).toBe(true);
  });
});
