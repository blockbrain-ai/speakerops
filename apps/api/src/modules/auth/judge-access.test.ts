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
 * - shared-demo blast radius: demo Keys.Create is expiry-clamped (≤4h,
 *   capped by the authorizing credential) and quota-bounded (25 active /
 *   100 mints per 24h); revoke limited to demo-created keys
 * - membership re-entry regression: accepted (provisioned) email NOT on the
 *   magic-link allowlist still receives a link (programReentry)
 */
import { describe, it, expect, vi } from "vitest";
import {
  DEMO_ROLE_EMAILS,
  DEFAULT_BOOTSTRAP_EVENT_ID,
  DEFAULT_ORG_ID,
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

  it("demo persona session mints keys with expiry clamped to 4h (shared-demo blast radius)", async () => {
    const { app, store } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
    const demoUser = await seedPersona(store, "admin");
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;

    const FOUR_H = 4 * 60 * 60 * 1000;
    const createKey = (body: Record<string, unknown>) =>
      app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          scopes: ["events:read"],
          eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
          ...body,
        }),
      });

    // No expiresAt requested → server forces now + 4h.
    const before = Date.now();
    const absent = await createKey({ name: "judge-key-no-expiry" });
    expect(absent.status).toBe(201);
    const absentBody = (await absent.json()) as { expiresAt: string | null };
    expect(absentBody.expiresAt).toBeTruthy();
    expect(
      Math.abs(Date.parse(absentBody.expiresAt!) - (before + FOUR_H)),
    ).toBeLessThan(60_000);

    // 30 days requested → clamped down to now + 4h.
    const thirtyDays = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const clampStart = Date.now();
    const clamped = await createKey({
      name: "judge-key-30d",
      expiresAt: thirtyDays,
    });
    expect(clamped.status).toBe(201);
    const clampedBody = (await clamped.json()) as { expiresAt: string | null };
    expect(clampedBody.expiresAt).toBeTruthy();
    expect(clampedBody.expiresAt).not.toBe(thirtyDays);
    expect(
      Math.abs(Date.parse(clampedBody.expiresAt!) - (clampStart + FOUR_H)),
    ).toBeLessThan(60_000);

    // 1 hour requested (below the cap) → honored unchanged.
    const oneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const short = await createKey({
      name: "judge-key-1h",
      expiresAt: oneHour,
    });
    expect(short.status).toBe(201);
    const shortBody = (await short.json()) as { expiresAt: string | null };
    expect(shortBody.expiresAt).toBe(oneHour);

    // Audit trail attributes every demo-minted key to the demo persona.
    const audits = await store.listAudits();
    const creates = audits.filter((a) => a.action === "Keys.Create");
    expect(creates.length).toBe(3);
    for (const a of creates) {
      expect(a.actorId).toBe(demoUser.id);
      expect(a.actorType).toBe("user");
    }
  });

  it("demo persona can revoke a demo-created key (audit records demo actor)", async () => {
    const { app, store } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
    const demoUser = await seedPersona(store, "admin");
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;

    const create = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "judge-revoke-own",
        scopes: ["events:read"],
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; secret: string };

    const revoke = await app.request(
      `/api/keys/${encodeURIComponent(created.id)}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(revoke.status).toBe(200);

    // Revoked demo key can no longer authenticate.
    const denied = await app.request("/api/keys", {
      headers: { authorization: `Bearer ${created.secret}` },
    });
    expect(denied.status).toBe(401);

    const audits = await store.listAudits();
    const revokeAudit = audits.find((a) => a.action === "Keys.Revoke");
    expect(revokeAudit).toBeTruthy();
    expect(revokeAudit!.actorId).toBe(demoUser.id);
    expect(revokeAudit!.entityId).toBe(created.id);
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

  it("demo persona cannot revoke seeded (non-demo-created) keys; real admin revoke still works", async () => {
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
    const created = (await create.json()) as {
      id: string;
      expiresAt: string | null;
    };
    // Non-demo sessions are unchanged: no forced expiry.
    expect(created.expiresAt).toBeNull();

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
    expect(deniedBody.error).toContain(
      "Seeded demo keys can't be revoked — create your own key to try revocation.",
    );

    // Key untouched; real admin revoke still works.
    const revoke = await app.request(
      `/api/keys/${encodeURIComponent(created.id)}`,
      { method: "DELETE", headers: { cookie: adminCookie } },
    );
    expect(revoke.status).toBe(200);
  });

  it("bearer keys minted by demo sessions stay demo-bounded (child clamp + seeded revoke 403)", async () => {
    const { app, store, outbox } = createAppWithAuth({
      judgeAccessCode: JUDGE_CODE,
    });
    await seedPersona(store, "admin");

    // Seeded key from a real admin (target the demo bearer must not revoke).
    const adminEmail = "real-admin-bearer-guard@example.com";
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
    const adminCookie = (exchange.headers.get("set-cookie") ?? "").split(";")[0]!;
    const seeded = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        name: "seeded-bearer-guard-target",
        scopes: ["events:read"],
      }),
    });
    expect(seeded.status).toBe(201);
    const seededKey = (await seeded.json()) as { id: string };

    // Demo session mints a keys:admin bearer key (explicit default-deny opt-in).
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const demoCookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;
    const demoCreate = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: demoCookie },
      body: JSON.stringify({
        name: "judge-keys-admin",
        scopes: ["keys:admin"],
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
      }),
    });
    expect(demoCreate.status).toBe(201);
    const demoKey = (await demoCreate.json()) as {
      secret: string;
      expiresAt: string | null;
    };
    expect(demoKey.expiresAt).toBeTruthy();
    const bearer = { authorization: `Bearer ${demoKey.secret}` };

    // Child key minted via the demo bearer is clamped too — and capped at
    // the PARENT key's own expiry, so the 4h bound cannot be escaped by
    // chaining through Bearer keys:admin (no perpetual renewal).
    const child = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer },
      body: JSON.stringify({
        name: "judge-bearer-child",
        scopes: ["events:read"],
      }),
    });
    expect(child.status).toBe(201);
    const childBody = (await child.json()) as { expiresAt: string | null };
    expect(childBody.expiresAt).toBeTruthy();
    expect(Date.parse(childBody.expiresAt!)).toBeLessThanOrEqual(
      Date.parse(demoKey.expiresAt!),
    );

    // Seeded key revoke via the demo bearer stays blocked.
    const denied = await app.request(
      `/api/keys/${encodeURIComponent(seededKey.id)}`,
      { method: "DELETE", headers: bearer },
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { error: string };
    expect(deniedBody.error).toContain("Seeded demo keys can't be revoked");
  });

  it("demo key chain cannot outlive its root: 1h parent → child ≤ 1h → grandchild ≤ child", async () => {
    const { app, store } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
    await seedPersona(store, "admin");
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;

    // Parent: demo session mints a keys:admin key expiring in 1 hour.
    const oneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const parentRes = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "chain-parent-1h",
        scopes: ["keys:admin"],
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        expiresAt: oneHour,
      }),
    });
    expect(parentRes.status).toBe(201);
    const parent = (await parentRes.json()) as {
      secret: string;
      expiresAt: string | null;
    };
    expect(parent.expiresAt).toBe(oneHour);

    // Child minted via the 1h parent (no expiry requested) is capped at the
    // parent's 1h — NOT the generic now + 4h.
    const childRes = await app.request("/api/keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${parent.secret}`,
      },
      body: JSON.stringify({
        name: "chain-child",
        scopes: ["keys:admin"],
      }),
    });
    expect(childRes.status).toBe(201);
    const child = (await childRes.json()) as {
      secret: string;
      expiresAt: string | null;
    };
    expect(child.expiresAt).toBeTruthy();
    expect(Date.parse(child.expiresAt!)).toBeLessThanOrEqual(
      Date.parse(oneHour),
    );
    expect(Date.parse(child.expiresAt!)).toBeGreaterThan(Date.now());

    // Grandchild (30d requested) inherits the cap through the chain.
    const thirtyDays = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const grandchildRes = await app.request("/api/keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${child.secret}`,
      },
      body: JSON.stringify({
        name: "chain-grandchild",
        scopes: ["events:read"],
        expiresAt: thirtyDays,
      }),
    });
    expect(grandchildRes.status).toBe(201);
    const grandchild = (await grandchildRes.json()) as {
      expiresAt: string | null;
    };
    expect(grandchild.expiresAt).toBeTruthy();
    expect(Date.parse(grandchild.expiresAt!)).toBeLessThanOrEqual(
      Date.parse(child.expiresAt!),
    );
  });

  it("session-minted demo keys never outlive the judge session (cap = session expiry)", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(t0);
      const { app, store } = createAppWithAuth({ judgeAccessCode: JUDGE_CODE });
      await seedPersona(store, "admin");
      const mint = await app.request(
        "/api/auth/judge-access",
        judgeBody("admin"),
      );
      expect(mint.status).toBe(200);
      const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;
      const sessionExpMs = new Date(
        (await store.listSessions())[0]!.expiresAt,
      ).getTime();

      // 3 hours into the 4h judge session: a fresh key must be capped at the
      // session's remaining ~1h — not granted a fresh now + 4h.
      vi.setSystemTime(t0 + 3 * 60 * 60 * 1000);
      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "late-session-key",
          scopes: ["events:read"],
          eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { expiresAt: string | null };
      expect(body.expiresAt).toBeTruthy();
      expect(
        Math.abs(Date.parse(body.expiresAt!) - sessionExpMs),
      ).toBeLessThan(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("concurrent demo creates cannot exceed the active cap (atomic insert, no TOCTOU)", async () => {
    const { app, store, keys } = createAppWithAuth({
      judgeAccessCode: JUDGE_CODE,
    });
    const demoUser = await seedPersona(store, "admin");
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;

    // 40 parallel creates race the 25-active cap. The pre-check reads all
    // observe the same low count — only the atomic quota-bounded INSERT can
    // hold the line.
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        app.request("/api/keys", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            name: `race-${i}`,
            scopes: ["events:read"],
            eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
          }),
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201).length).toBe(25);
    expect(statuses.filter((s) => s === 403).length).toBe(15);

    // Durable proof: exactly 25 rows landed in the store.
    expect(
      await keys.countActiveKeysByCreators(
        [demoUser.id],
        new Date().toISOString(),
      ),
    ).toBe(25);
  });

  it("create→revoke loops stop at the non-releasing 24h mint cap (100) with its own copy", async () => {
    const { app, store, keys } = createAppWithAuth({
      judgeAccessCode: JUDGE_CODE,
    });
    const demoUser = await seedPersona(store, "admin");
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;

    // Residue of a create→revoke loop: 99 demo mints inside the window,
    // every one already revoked — the ACTIVE cap sees none of them.
    const nowIso = new Date().toISOString();
    for (let i = 0; i < 99; i++) {
      await keys.insertKey({
        id: `loop_${i}`,
        orgId: DEFAULT_ORG_ID,
        name: `loop-${i}`,
        keyPrefix: `spk_loop${String(i).padStart(4, "0")}`,
        keyHash: `hash_loop_${i}`,
        scopesJson: JSON.stringify(["events:read"]),
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        revokedAt: nowIso,
        createdBy: demoUser.id,
        createdAt: nowIso,
        lastUsedAt: null,
      });
    }

    const createDemoKey = (name: string) =>
      app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name,
          scopes: ["events:read"],
          eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        }),
      });

    // Mint #100 is still inside the cap.
    const hundredth = await createDemoKey("loop-100");
    expect(hundredth.status).toBe(201);
    const created = (await hundredth.json()) as { id: string };

    // Mint #101 blocked by the MINT cap (active count is only 1).
    const over = await createDemoKey("loop-101");
    expect(over.status).toBe(403);
    const overBody = (await over.json()) as { error: string };
    expect(overBody.error).toContain("Demo key mint limit reached for today");
    expect(overBody.error).toContain("Try again later");

    // Revoking does NOT free the mint window (non-releasing).
    const revoke = await app.request(
      `/api/keys/${encodeURIComponent(created.id)}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(revoke.status).toBe(200);
    const retry = await createDemoKey("loop-after-revoke");
    expect(retry.status).toBe(403);
    expect(((await retry.json()) as { error: string }).error).toContain(
      "Demo key mint limit reached for today",
    );
  });

  it("offset-form expiry is normalized to UTC Z and counts as active (no lexical evasion)", async () => {
    const { app, store, keys } = createAppWithAuth({
      judgeAccessCode: JUDGE_CODE,
    });
    const demoUser = await seedPersona(store, "admin");
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;

    // Instant 2h in the future written in -10:00 form: the raw string sorts
    // BEFORE now-Z, so lexical comparisons would treat it as expired.
    const instant = Date.now() + 2 * 60 * 60 * 1000;
    const offsetIso = new Date(instant - 10 * 60 * 60 * 1000)
      .toISOString()
      .replace(/Z$/, "-10:00");
    expect(offsetIso < new Date().toISOString()).toBe(true); // trap is real
    expect(Date.parse(offsetIso)).toBe(instant);

    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "offset-expiry",
        scopes: ["events:read"],
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        expiresAt: offsetIso,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { expiresAt: string | null };
    // Stored/returned in UTC Z-form, same instant.
    expect(body.expiresAt).toBeTruthy();
    expect(body.expiresAt!.endsWith("Z")).toBe(true);
    expect(Date.parse(body.expiresAt!)).toBe(instant);

    // Counts toward the active quota despite the offset form.
    expect(
      await keys.countActiveKeysByCreators(
        [demoUser.id],
        new Date().toISOString(),
      ),
    ).toBe(1);

    // Offset-form PAST expiry is still rejected as expired (numeric parse).
    const pastOffset = new Date(
      Date.now() - 30 * 60 * 1000 - 10 * 60 * 60 * 1000,
    )
      .toISOString()
      .replace(/Z$/, "-10:00");
    const past = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "offset-past",
        scopes: ["events:read"],
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        expiresAt: pastOffset,
      }),
    });
    expect(past.status).toBe(400);
  });

  it("durable demo mint quota: 25 active demo keys max; revoke frees quota; real admins unaffected", async () => {
    const { app, store, outbox } = createAppWithAuth({
      judgeAccessCode: JUDGE_CODE,
    });
    await seedPersona(store, "admin");
    const mint = await app.request("/api/auth/judge-access", judgeBody("admin"));
    expect(mint.status).toBe(200);
    const cookie = (mint.headers.get("set-cookie") ?? "").split(";")[0]!;

    const createDemoKey = (name: string) =>
      app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name,
          scopes: ["events:read"],
          eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        }),
      });

    // Boundary: creates 1..25 succeed.
    let lastId = "";
    for (let i = 1; i <= 25; i++) {
      const res = await createDemoKey(`quota-key-${i}`);
      expect(res.status, `create #${i} should succeed`).toBe(201);
      lastId = ((await res.json()) as { id: string }).id;
    }

    // 26th is rejected with human copy pointing at revocation.
    const over = await createDemoKey("quota-key-26");
    expect(over.status).toBe(403);
    const overBody = (await over.json()) as { error: string };
    expect(overBody.error).toContain("Demo key limit reached");
    expect(overBody.error).toContain("Revoke keys you no longer need");

    // Revoking a demo key frees quota (active-count design).
    const revoke = await app.request(
      `/api/keys/${encodeURIComponent(lastId)}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(revoke.status).toBe(200);
    const retry = await createDemoKey("quota-key-after-revoke");
    expect(retry.status).toBe(201);

    // Real admins are not subject to the demo quota even while it is full.
    const adminEmail = "real-admin-quota@example.com";
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
    const adminCookie = (exchange.headers.get("set-cookie") ?? "").split(";")[0]!;
    const adminCreate = await app.request("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        name: "real-admin-at-demo-cap",
        scopes: ["events:read"],
      }),
    });
    expect(adminCreate.status).toBe(201);
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
