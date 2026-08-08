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
  UNAUTHORIZED,
  VALIDATION_ERROR,
  NOT_FOUND,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { hashToken } from "./crypto.js";
import { assertNoPlaintextTokenInStore } from "./commands.js";
import { buildSessionSetCookie, buildClearSessionCookie } from "./cookies.js";

const env = { APP_VERSION: "0.1.0" };

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

  it("controlled bootstrap: unknown email does not self-provision admin after first admin", async () => {
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
    });

    // First admin on empty system is allowed
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
      env,
    );
    expect(outbox.lastForEmail("first-admin@example.com")).toBeTruthy();
    expect(await store.countMembershipsByRole("admin")).toBe(1);

    // Second random admin purpose: still sent:true but no user / no link
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
});
