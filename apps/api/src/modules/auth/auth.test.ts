/**
 * Section 2.1 — session auth magic link (Vitest).
 *
 * Named assertions from spec:
 * - assert magic link token stored only as hash
 * - assert reused exchange returns 401
 * - assert Set-Cookie contains HttpOnly
 * - assert unknown email still returns sent:true
 *
 * Plus: audit_events + correlationId, Zod/E4 validation, no token in logs.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  RequestMagicLinkResponseSchema,
  ExchangeMagicLinkResponseSchema,
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
  UNAUTHORIZED,
  VALIDATION_ERROR,
  NOT_FOUND,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { hashToken } from "./crypto.js";
import { assertNoPlaintextTokenInStore } from "./commands.js";
import {
  buildSessionSetCookie,
  buildClearSessionCookie,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "./cookies.js";

const env = { APP_VERSION: "0.1.0" };

describe("10.4 session cookie options (dogfood / www.speakerops.org)", () => {
  it("buildSessionSetCookie sets Path=/ HttpOnly SameSite=Lax Secure Max-Age and no Domain", () => {
    const built = buildSessionSetCookie("session-token-value", { secure: true });
    expect(built).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=session-token-value;`));
    expect(built).toMatch(/Path=\//);
    expect(built.toLowerCase()).toContain("httponly");
    expect(built.toLowerCase()).toMatch(/samesite=lax/);
    expect(built.toLowerCase()).toContain("secure");
    expect(built).toMatch(
      new RegExp(`Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`),
    );
    // Host-only: must not set Domain= (shares / leaks across sibling hosts)
    expect(built.toLowerCase()).not.toMatch(/;\s*domain=/);
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(SESSION_TTL_DAYS * 24 * 60 * 60);
  });

  it("buildSessionSetCookie can disable Secure only when explicitly opted out (tests)", () => {
    const built = buildSessionSetCookie("tok", { secure: false });
    expect(built.toLowerCase()).not.toMatch(/(?:^|;\s*)secure(?:;|$)/);
    expect(built).toMatch(/Path=\//);
    expect(built.toLowerCase()).toContain("httponly");
  });

  it("buildClearSessionCookie clears with Max-Age=0 and matching Path/SameSite", () => {
    const clear = buildClearSessionCookie({ secure: true });
    expect(clear).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=;`));
    expect(clear).toMatch(/Max-Age=0/);
    expect(clear).toMatch(/Path=\//);
    expect(clear.toLowerCase()).toMatch(/samesite=lax/);
    expect(clear.toLowerCase()).toContain("httponly");
    expect(clear.toLowerCase()).toContain("secure");
    expect(clear.toLowerCase()).not.toMatch(/;\s*domain=/);
  });

  it("exchange Set-Cookie uses full dogfood-safe attributes including Max-Age", async () => {
    const { app, outbox } = createAppWithAuth({ cookieSecure: true });
    const email = "cookie-attrs@example.com";
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
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toMatch(/samesite=lax/);
    expect(setCookie.toLowerCase()).toContain("secure");
    expect(setCookie).toMatch(
      new RegExp(`Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`),
    );
    expect(setCookie.toLowerCase()).not.toMatch(/;\s*domain=/);
  });
});

describe("2.1 session auth magic link", () => {
  it("assert magic link token stored only as hash", async () => {
    const { app, store, outbox } = createAppWithAuth();
    const email = "admin@example.com";

    const res = await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-hash-1",
        },
        body: JSON.stringify({ email, purpose: "admin" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(RequestMagicLinkResponseSchema.parse(body)).toEqual({ sent: true });

    const captured = outbox.lastForEmail(email);
    expect(captured).toBeTruthy();
    const plaintext = captured!.token;
    expect(plaintext.length).toBeGreaterThan(16);

    const links = await store.listMagicLinks();
    expect(links.length).toBe(1);
    const row = links[0]!;
    // Plaintext must not equal stored hash field content
    expect(row.tokenHash).not.toBe(plaintext);
    // Stored value must be SHA-256 hex of token
    const expectedHash = await hashToken(plaintext);
    expect(row.tokenHash).toBe(expectedHash);
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const ok = await assertNoPlaintextTokenInStore(store, plaintext);
    expect(ok).toBe(true);

    // Audit without token
    const audits = await store.listAudits();
    expect(audits.some((a) => a.action === "Auth.RequestMagicLink")).toBe(true);
    const audit = audits.find((a) => a.action === "Auth.RequestMagicLink")!;
    expect(audit.correlationId).toBe("corr-hash-1");
    expect(JSON.stringify(audit)).not.toContain(plaintext);
  });

  it("assert reused exchange returns 401", async () => {
    const { app, outbox } = createAppWithAuth();
    const email = "speaker@example.com";

    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "speaker" }),
      },
      env,
    );

    const token = outbox.lastForEmail(email)!.token;

    const first = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-ex-1",
        },
        body: JSON.stringify({ token }),
      },
      env,
    );
    expect(first.status).toBe(200);
    const firstBody = ExchangeMagicLinkResponseSchema.parse(await first.json());
    expect(firstBody.ok).toBe(true);
    expect(firstBody.purpose).toBe("speaker");
    expect(firstBody.email).toBe(email);

    const second = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      },
      env,
    );
    expect(second.status).toBe(401);
    const err = ErrorEnvelopeSchema.parse(await second.json());
    expect(err.code).toBe(UNAUTHORIZED);
  });

  it("re-issue invalidates the unused prior magic link", async () => {
    const { app, outbox } = createAppWithAuth();
    const email = "reissue@example.com";
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "speaker" }),
      },
      env,
    );
    const firstToken = outbox.lastForEmail(email)!.token;
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "speaker" }),
      },
      env,
    );
    const secondToken = outbox.lastForEmail(email)!.token;
    expect(secondToken).not.toBe(firstToken);

    const stale = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: firstToken }),
      },
      env,
    );
    expect(stale.status).toBe(401);

    const fresh = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: secondToken }),
      },
      env,
    );
    expect(fresh.status).toBe(200);
  });

  it("assert Set-Cookie contains HttpOnly", async () => {
    const { app, outbox } = createAppWithAuth({ cookieSecure: true });
    const email = "cookie@example.com";

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
    expect(setCookie!).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=`));
    expect(setCookie!.toLowerCase()).toContain("httponly");
    expect(setCookie!.toLowerCase()).toContain("secure");
    expect(setCookie!.toLowerCase()).toMatch(/samesite=lax/);
    expect(setCookie!).toMatch(/Path=\//);

    // Unit-level cookie builder also includes flags
    const built = buildSessionSetCookie("tok", { secure: true });
    expect(built.toLowerCase()).toContain("httponly");
    expect(built.toLowerCase()).toContain("secure");
  });

  it("assert unknown email still returns sent:true", async () => {
    const { app, store } = createAppWithAuth();
    // Email never seen before (open bootstrap creates user for e2e)
    const res = await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "brand-new-unknown@example.org",
          purpose: "admin",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sent: true });
    // Open policy (createAppWithAuth): user is created for dogfood e2e
    const user = await store.findUserByEmail("brand-new-unknown@example.org");
    expect(user).toBeTruthy();
  });

  it("controlled bootstrap: default-deny when BOOTSTRAP_ADMIN_EMAIL unset", async () => {
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
    });

    // No BOOTSTRAP_ADMIN_EMAIL on env → first admin claim is denied (no side effects)
    const res = await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "attacker@example.com",
          purpose: "admin",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(await store.findUserByEmail("attacker@example.com")).toBeNull();
    expect(outbox.lastForEmail("attacker@example.com")).toBeNull();
    expect(await store.countMembershipsByRole("admin")).toBe(0);
  });

  it("controlled bootstrap: allowlisted email may claim first admin once", async () => {
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
    });
    const bootstrapEnv = {
      ...env,
      BOOTSTRAP_ADMIN_EMAIL: "first-admin@example.com",
    };

    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "first-admin@example.com",
          purpose: "admin",
        }),
      },
      bootstrapEnv,
    );
    expect(outbox.lastForEmail("first-admin@example.com")).toBeTruthy();
    expect(await store.countMembershipsByRole("admin")).toBe(1);

    // Non-allowlisted email still denied even on empty-looking request after first admin
    const res = await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "attacker@example.com",
          purpose: "admin",
        }),
      },
      bootstrapEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(await store.findUserByEmail("attacker@example.com")).toBeNull();
    expect(outbox.lastForEmail("attacker@example.com")).toBeNull();
    expect(await store.countMembershipsByRole("admin")).toBe(1);
  });

  it("controlled bootstrap: purpose does not elevate existing user membership", async () => {
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
    });

    // Seed speaker via open path on a throwaway store first is hard; seed manually
    const user = await store.createUser({ email: "speaker-elevate@example.com" });
    await store.upsertMembership({
      eventId: "evt_dogfood",
      userId: user.id,
      role: "speaker",
    });

    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "speaker-elevate@example.com",
          purpose: "admin",
        }),
      },
      env,
    );
    expect(outbox.lastForEmail("speaker-elevate@example.com")).toBeTruthy();
    const m = await store.findMembership("evt_dogfood", user.id);
    expect(m?.role).toBe("speaker");
  });

  it("bad token exchange returns 401 E4 envelope", async () => {
    const { app } = createAppWithAuth();
    const res = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "definitely-not-a-valid-token-xx" }),
      },
      env,
    );
    expect(res.status).toBe(401);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(UNAUTHORIZED);
  });

  it("invalid body returns 400 VALIDATION_ERROR", async () => {
    const { app } = createAppWithAuth();
    const res = await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email", purpose: "admin" }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
  });

  it("logout clears cookie (Set-Cookie Max-Age=0 + HttpOnly)", async () => {
    const { app, outbox } = createAppWithAuth();
    const email = "logout@example.com";
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
    const sessionCookie = exchange.headers.get("set-cookie")!;
    const sessionValue = sessionCookie
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=");

    const logout = await app.request(
      "http://localhost/api/auth/logout",
      {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
          "x-correlation-id": "corr-logout-1",
        },
      },
      env,
    );
    expect(logout.status).toBe(204);
    const clear = logout.headers.get("set-cookie");
    expect(clear).toBeTruthy();
    expect(clear!.toLowerCase()).toContain("httponly");
    expect(clear!).toMatch(/Max-Age=0/i);

    const clearBuilt = buildClearSessionCookie({ secure: true });
    expect(clearBuilt).toMatch(/Max-Age=0/);
  });

  it("exchange writes audit_events with correlationId", async () => {
    const { app, store, outbox } = createAppWithAuth();
    const email = "audit@example.com";
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-req",
        },
        body: JSON.stringify({ email, purpose: "admin" }),
      },
      env,
    );
    const token = outbox.lastForEmail(email)!.token;
    await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-exchange-xyz",
        },
        body: JSON.stringify({ token }),
      },
      env,
    );
    const audits = await store.listAudits();
    const exchangeAudit = audits.find(
      (a) => a.action === "Auth.ExchangeMagicLink",
    );
    expect(exchangeAudit).toBeTruthy();
    expect(exchangeAudit!.correlationId).toBe("corr-exchange-xyz");
    expect(exchangeAudit!.entityType).toBe("auth_session");
  });

  it("dev outbox returns token only when enabled", async () => {
    const { app, outbox } = createAppWithAuth({ enableDevOutbox: true });
    const email = "devbox@example.com";
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "admin" }),
      },
      env,
    );
    const res = await app.request(
      `http://localhost/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: { token: string } | null };
    expect(body.link?.token).toBe(outbox.lastForEmail(email)!.token);
  });

  it("dev outbox route is 404 when disabled", async () => {
    const { app } = createAppWithAuth({ enableDevOutbox: false });
    // createAppWithAuth with false — need createApp directly
    const res = await app.request(
      "http://localhost/api/auth/dev/outbox",
      {},
      env,
    );
    // When enableDevOutbox false, route not registered → 404
    expect(res.status).toBe(404);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(NOT_FOUND);
  });

  it("I16 field-flow: same email after exchange", async () => {
    const { app, outbox } = createAppWithAuth();
    const email = "flow@example.com";
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
    const body = ExchangeMagicLinkResponseSchema.parse(await res.json());
    expect(body.email).toBe(email);
  });

  it("omit purpose: open existing admin membership is not clobbered to speaker", async () => {
    const { app, store, outbox } = createAppWithAuth();
    const email = "admin-omit@example.com";
    // Seed admin via explicit purpose
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "admin" }),
      },
      env,
    );
    const user = await store.findUserByEmail(email);
    expect(user).toBeTruthy();
    const before = await store.findMembership("evt_dogfood", user!.id);
    expect(before?.role).toBe("admin");

    // Customer path: email only
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      },
      env,
    );
    const after = await store.findMembership("evt_dogfood", user!.id);
    expect(after?.role).toBe("admin");
    const link = outbox.lastForEmail(email)!;
    expect(link.purpose).toBe("admin");
    expect(link.eventId).toBeNull();
  });

  it("omit purpose: open new user creates account with zero memberships", async () => {
    const { app, store, outbox } = createAppWithAuth();
    const email = "fresh-omit@example.com";
    const res = await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    const user = await store.findUserByEmail(email);
    expect(user).toBeTruthy();
    const memberships = await store.listMembershipsForUser(user!.id);
    expect(memberships).toEqual([]);
    const link = outbox.lastForEmail(email)!;
    expect(link.purpose).toBe("speaker"); // metadata only
    expect(link.eventId).toBeNull();
  });

  it("supplied purpose admin still grants under open", async () => {
    const { app, store } = createAppWithAuth();
    const email = "grant-admin@example.com";
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "admin" }),
      },
      env,
    );
    const user = await store.findUserByEmail(email);
    const m = await store.findMembership("evt_dogfood", user!.id);
    expect(m?.role).toBe("admin");
  });

  it("controlled + allowlist: omit purpose does not clobber existing admin", async () => {
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
    });
    const email = "allow-admin@example.com";
    const user = await store.createUser({ email });
    await store.upsertMembership({
      eventId: "evt_dogfood",
      userId: user.id,
      role: "admin",
    });
    const allowEnv = {
      ...env,
      MAGIC_LINK_ALLOWLIST: email,
    };
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      },
      allowEnv,
    );
    expect(outbox.lastForEmail(email)).toBeTruthy();
    const m = await store.findMembership("evt_dogfood", user.id);
    expect(m?.role).toBe("admin");
  });

  it("controlled + allowlist: new user omit purpose creates user without membership", async () => {
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
    });
    const email = "allow-new-omit@example.com";
    const allowEnv = {
      ...env,
      MAGIC_LINK_ALLOWLIST: email,
    };
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      },
      allowEnv,
    );
    expect(outbox.lastForEmail(email)).toBeTruthy();
    const user = await store.findUserByEmail(email);
    expect(user).toBeTruthy();
    expect(await store.listMembershipsForUser(user!.id)).toEqual([]);
  });

  it("controlled: non-default event membership re-entry without allowlist when purpose omitted", async () => {
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
    });
    const email = "other-event@example.com";
    const user = await store.createUser({ email });
    await store.upsertMembership({
      eventId: "evt_other_conf",
      userId: user.id,
      role: "evaluator",
    });
    // Allowlist present but email not on it — program reentry via any membership
    const allowEnv = {
      ...env,
      MAGIC_LINK_ALLOWLIST: "someone-else@example.com",
    };
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      },
      allowEnv,
    );
    const link = outbox.lastForEmail(email);
    expect(link).toBeTruthy();
    expect(link!.purpose).toBe("evaluator");
    expect(link!.eventId).toBeNull();
    const m = await store.findMembership("evt_other_conf", user.id);
    expect(m?.role).toBe("evaluator");
  });

  it("omit purpose + eventId sets link eventId without injecting dogfood default", async () => {
    const { app, store, outbox } = createAppWithAuth();
    const email = "evt-scoped@example.com";
    const user = await store.createUser({ email });
    await store.upsertMembership({
      eventId: "evt_scoped",
      userId: user.id,
      role: "speaker",
    });
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, eventId: "evt_scoped" }),
      },
      env,
    );
    const link = outbox.lastForEmail(email)!;
    expect(link.eventId).toBe("evt_scoped");
    expect(link.purpose).toBe("speaker");
    // No clobber of other events
    expect(await store.findMembership("evt_dogfood", user.id)).toBeNull();
  });
});
