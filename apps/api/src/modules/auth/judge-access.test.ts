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
