/**
 * Section 8.4 — Auth.DevRoleSwitch (dogfood/dev only).
 *
 * - Zod validation → 400
 * - Route absent when flag off → 404
 * - Success issues session + audit with correlationId
 * - Missing demo user without allowCreate → 404
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
  SESSION_COOKIE_NAME,
} from "@speakerops/shared";

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
    // No raw cookie token in audit
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

  it("missing demo user without create returns 404", async () => {
    const app = createApp({
      enableRoleSwitcher: true,
      bootstrapPolicy: "controlled",
    });
    // roleSwitcherAllowCreate is false when bootstrap is controlled via createApp
    // routes: roleSwitcherAllowCreate: bootstrapPolicy === "open" → false
    const res = await app.request("http://localhost/api/auth/dev/role-switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(404);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toMatch(/NOT_FOUND|ROLE_SWITCH/);
  });
});
