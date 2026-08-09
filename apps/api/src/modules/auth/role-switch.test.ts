/**
 * Section 8.4 — Auth.DevRoleSwitch (dogfood/dev only).
 *
 * - Zod validation → 400
 * - Route absent when flag off → 404
 * - Success issues session + audit with correlationId
 * - Controlled (production dogfood): unauthenticated → 401 (no open admin mint)
 * - Controlled + valid session → 200
 * - Missing demo user without allowCreate → 404 (when session present)
 * - No plaintext token in audit afterJson
 */
import { describe, it, expect } from "vitest";
import {
  createApp,
  createAppWithAuth,
} from "../../index.js";
import {
  DevRoleSwitchResponseSchema,
  ErrorEnvelopeSchema,
  DEMO_ROLE_EMAILS,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  SESSION_COOKIE_NAME,
} from "@speakerops/shared";

function sessionCookieFromResponse(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) {
    throw new Error("expected session Set-Cookie on response");
  }
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}

describe("8.4 Auth.DevRoleSwitch", () => {
  it("returns 404 when role switcher is disabled", async () => {
    const app = createApp({ enableRoleSwitcher: false });
    const res = await app.request("http://localhost/api/auth/dev/role-switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(404);
  });

  it("validation error returns 400 with machine-readable code", async () => {
    const { app } = createAppWithAuth({ enableRoleSwitcher: true });
    const res = await app.request("http://localhost/api/auth/dev/role-switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "superadmin" }),
    });
    expect(res.status).toBe(400);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(VALIDATION_ERROR);
  });

  it("switches to demo admin and sets session cookie + audit", async () => {
    // Open bootstrap (createAppWithAuth): unauthenticated allowed for local e2e.
    const { app, store } = createAppWithAuth({ enableRoleSwitcher: true });
    const res = await app.request("http://localhost/api/auth/dev/role-switch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": "corr_role_switch_test",
      },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(200);
    const parsed = DevRoleSwitchResponseSchema.parse(await res.json());
    expect(parsed.ok).toBe(true);
    expect(parsed.role).toBe("admin");
    expect(parsed.email).toBe(DEMO_ROLE_EMAILS.admin);
    expect(parsed.redirectTo).toBe("/admin");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const audits = await store.listAudits();
    const switchAudit = audits.find((a) => a.action === "Auth.DevRoleSwitch");
    expect(switchAudit).toBeTruthy();
    expect(switchAudit!.correlationId).toBe("corr_role_switch_test");
    expect(switchAudit!.afterJson ?? "").not.toMatch(/sessionToken|tokenHash/i);
    const cookieMatch = setCookie.match(
      new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`),
    );
    expect(cookieMatch?.[1]).toBeTruthy();
    expect(switchAudit!.afterJson ?? "").not.toContain(cookieMatch![1]!);
  });

  it("switches evaluator and speaker roles", async () => {
    const { app } = createAppWithAuth({ enableRoleSwitcher: true });
    for (const role of ["evaluator", "speaker"] as const) {
      const res = await app.request(
        "http://localhost/api/auth/dev/role-switch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      expect(res.status).toBe(200);
      const body = DevRoleSwitchResponseSchema.parse(await res.json());
      expect(body.role).toBe(role);
      expect(body.email).toBe(DEMO_ROLE_EMAILS[role]);
    }
  });

  it("controlled mode rejects unauthenticated role-switch (no open admin mint)", async () => {
    // Production dogfood: ROLE_SWITCHER_ENABLED + controlled bootstrap.
    // workers.dev is not private — unauthenticated callers must not mint admin.
    const app = createApp({
      enableRoleSwitcher: true,
      bootstrapPolicy: "controlled",
    });
    const res = await app.request("http://localhost/api/auth/dev/role-switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(401);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(UNAUTHORIZED);
    expect(body.error).toMatch(/authentication required/i);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(new RegExp(`${SESSION_COOKIE_NAME}=[^;]+`));
  });

  it("controlled mode allows role-switch when caller has a valid session", async () => {
    // Seed demo users + establish a session via open-bootstrap harness app.
    const { store } = createAppWithAuth({ enableRoleSwitcher: true });
    const seedApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "open",
      enableDevOutbox: true,
    });
    // Seed admin + evaluator demo accounts (controlled path will not allowCreate)
    for (const role of ["admin", "evaluator"] as const) {
      const r = await seedApp.request(
        "http://localhost/api/auth/dev/role-switch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      expect(r.status).toBe(200);
    }
    // Fresh evaluator session cookie for the gated call
    const seedRes = await seedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "evaluator" }),
      },
    );
    expect(seedRes.status).toBe(200);
    const cookie = sessionCookieFromResponse(seedRes);

    // Same store, controlled policy (production dogfood gate).
    const gatedApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "controlled",
      enableDevOutbox: false,
    });

    const denied = await gatedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(denied.status).toBe(401);

    const allowed = await gatedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(allowed.status).toBe(200);
    const body = DevRoleSwitchResponseSchema.parse(await allowed.json());
    expect(body.role).toBe("admin");
    expect(body.email).toBe(DEMO_ROLE_EMAILS.admin);
  });

  it("missing demo user without create returns 404 when authenticated", async () => {
    // Speaker-only seed (open) → controlled switch to admin without create → 404.
    const { store } = createAppWithAuth({ enableRoleSwitcher: true });
    const openApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "open",
      enableDevOutbox: true,
    });
    const onlySpeaker = await openApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "speaker" }),
      },
    );
    expect(onlySpeaker.status).toBe(200);
    const cookie = sessionCookieFromResponse(onlySpeaker);

    const controlled = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "controlled",
    });
    const res = await controlled.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    // Speaker seed does not create admin user; controlled allowCreate=false → 404
    expect(res.status).toBe(404);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toMatch(/NOT_FOUND|ROLE_SWITCH/);
  });
});
