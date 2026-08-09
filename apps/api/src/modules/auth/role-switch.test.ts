/**
 * Section 8.4 — Auth.DevRoleSwitch (dogfood/dev only).
 *
 * - Zod validation → 400
 * - Route absent when flag off → 404
 * - Success issues session + audit with correlationId
 * - Controlled (production dogfood): unauthenticated → 401 (no open admin mint)
 * - Controlled + non-admin session → 403 (no privilege escalation)
 * - Controlled + admin session → 200
 * - Missing demo user without allowCreate → 404 (when admin session present)
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
  FORBIDDEN,
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

  it("controlled mode rejects non-admin session (no privilege escalation)", async () => {
    // Seed demo users + establish evaluator session via open-bootstrap harness.
    const { store } = createAppWithAuth({ enableRoleSwitcher: true });
    const seedApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "open",
      enableDevOutbox: true,
    });
    for (const role of ["admin", "evaluator", "speaker"] as const) {
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
    const evalRes = await seedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "evaluator" }),
      },
    );
    expect(evalRes.status).toBe(200);
    const evalCookie = sessionCookieFromResponse(evalRes);

    const gatedApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "controlled",
      enableDevOutbox: false,
    });

    const deniedUnauth = await gatedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(deniedUnauth.status).toBe(401);

    // Evaluator (or speaker) must not escalate to admin.
    const deniedEval = await gatedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: evalCookie,
        },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(deniedEval.status).toBe(403);
    const body = ErrorEnvelopeSchema.parse(await deniedEval.json());
    expect(body.code).toBe(FORBIDDEN);
    expect(body.error).toMatch(/admin role required/i);
    const setCookie = deniedEval.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(new RegExp(`${SESSION_COOKIE_NAME}=[^;]+`));
  });

  it("controlled mode rejects admin of event A switching into event B (E2 isolation)", async () => {
    // Admin membership on one event must not authorize demo sessions on another.
    const { store } = createAppWithAuth({ enableRoleSwitcher: true });
    const openApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "open",
      enableDevOutbox: true,
    });
    // Seed demo admin on default bootstrap event only.
    const seed = await openApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(seed.status).toBe(200);
    const adminCookie = sessionCookieFromResponse(seed);

    // Create a second event the actor does not administer.
    const otherEventId = "evt_other_isolation";
    // Ensure actor is only admin on the bootstrap event (default), not otherEventId.
    const memberships = await store.listMembershipsForUser(
      // Resolve actor user from demo admin email after seed
      (await store.findUserByEmail(DEMO_ROLE_EMAILS.admin))!.id,
    );
    expect(memberships.some((m) => m.role === "admin")).toBe(true);
    expect(
      memberships.every((m) => m.eventId !== otherEventId),
    ).toBe(true);

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
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ role: "evaluator", eventId: otherEventId }),
      },
    );
    expect(denied.status).toBe(403);
    const body = ErrorEnvelopeSchema.parse(await denied.json());
    expect(body.code).toBe(FORBIDDEN);
    expect(body.error).toMatch(/admin role required|target event/i);
    const setCookie = denied.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(new RegExp(`${SESSION_COOKIE_NAME}=[^;]+`));
  });

  it("controlled mode allows role-switch when caller is event admin", async () => {
    const { store } = createAppWithAuth({ enableRoleSwitcher: true });
    const seedApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "open",
      enableDevOutbox: true,
    });
    for (const role of ["admin", "evaluator", "speaker"] as const) {
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
    const adminRes = await seedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(adminRes.status).toBe(200);
    const adminCookie = sessionCookieFromResponse(adminRes);

    const gatedApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "controlled",
      enableDevOutbox: false,
    });

    // Admin (judge) may switch to evaluator for dogfood walkthrough.
    const toEval = await gatedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ role: "evaluator" }),
      },
    );
    expect(toEval.status).toBe(200);
    const evalBody = DevRoleSwitchResponseSchema.parse(await toEval.json());
    expect(evalBody.role).toBe("evaluator");
    expect(evalBody.email).toBe(DEMO_ROLE_EMAILS.evaluator);

    // Fresh admin session again, then switch to admin demo account.
    const adminRes2 = await seedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    const adminCookie2 = sessionCookieFromResponse(adminRes2);
    const toAdmin = await gatedApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie2,
        },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(toAdmin.status).toBe(200);
    const adminBody = DevRoleSwitchResponseSchema.parse(await toAdmin.json());
    expect(adminBody.role).toBe("admin");
    expect(adminBody.email).toBe(DEMO_ROLE_EMAILS.admin);
  });

  it("missing demo user without create returns 404 when admin authenticated", async () => {
    // Seed admin only (open) so controlled path has a judge session, then
    // request a role whose demo user was never created → 404.
    const { store } = createAppWithAuth({ enableRoleSwitcher: true });
    const openApp = createApp({
      authStore: store,
      enableRoleSwitcher: true,
      bootstrapPolicy: "open",
      enableDevOutbox: true,
    });
    const onlyAdmin = await openApp.request(
      "http://localhost/api/auth/dev/role-switch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(onlyAdmin.status).toBe(200);
    const cookie = sessionCookieFromResponse(onlyAdmin);

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
        // Evaluator demo user was never seeded in this store.
        body: JSON.stringify({ role: "evaluator" }),
      },
    );
    expect(res.status).toBe(404);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toMatch(/NOT_FOUND|ROLE_SWITCH/);
  });
});
