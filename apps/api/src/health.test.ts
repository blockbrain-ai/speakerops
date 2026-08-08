/**
 * Section 1.2 — Worker API health (Vitest / Hono worker request).
 *
 * Named assertions from spec:
 * - assert GET /health returns 200 and body.ok===true
 * - assert unknown path returns 404 JSON with code field
 *
 * Uses Hono `app.request()` (Worker-compatible fetch) — no network, no watch.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  HealthResponseSchema,
  NOT_FOUND,
  INTERNAL_ERROR,
  TURNSTILE_TEST_SECRET_FAIL,
  TURNSTILE_TEST_SECRET_PASS,
  TURNSTILE_TEST_SITE_KEY,
} from "@speakerops/shared";
import { createApp, createAppFromBindings, DEFAULT_APP_VERSION } from "./index.js";
import { onErrorHandler } from "./middleware/errors.js";
import type { WorkerBindings } from "./env.js";

describe("1.2 Worker API health", () => {
  it("assert GET /health returns 200 and body.ok===true", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    expect(body).toMatchObject({ ok: true });
    const parsed = HealthResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(true);
      expect(typeof parsed.data.version).toBe("string");
      expect(parsed.data.version.length).toBeGreaterThan(0);
      expect(parsed.data.version).toBe(DEFAULT_APP_VERSION);
    }
  });

  it("assert unknown path returns 404 JSON with code field", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/this-route-does-not-exist");
    expect(res.status).toBe(404);

    const body: unknown = await res.json();
    const parsed = ErrorEnvelopeSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe(NOT_FOUND);
      expect(typeof parsed.data.error).toBe("string");
      expect(parsed.data.error.length).toBeGreaterThan(0);
    }
    // No stack leak in 404 envelope
    expect(JSON.stringify(body)).not.toMatch(/\bat\s+\w+|stackTrace|Error: /i);
  });

  it("onError returns 500 E4 envelope without stack leakage", async () => {
    const app = createApp();
    app.get("/__test_throw", () => {
      throw new Error("boom secret-should-not-leak stack");
    });
    // Re-bind handlers after route registration (Hono keeps onError)
    app.onError(onErrorHandler);

    const res = await app.request("http://localhost/__test_throw");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    const parsed = ErrorEnvelopeSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe(INTERNAL_ERROR);
      expect(parsed.data.error).toBe("Unexpected error");
    }
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/boom|stack|secret-should-not-leak/i);
  });

  it("propagates correlationId header (E3)", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/health", {
      headers: { "x-correlation-id": "test-corr-1.2" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBe("test-corr-1.2");
  });

  it("generates UUIDv7 correlationId when header absent (E3)", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);
    const id = res.headers.get("x-correlation-id");
    expect(id).toBeTruthy();
    // UUIDv7: version nibble 7, RFC variant 8/9/a/b — not crypto.randomUUID() v4
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(id!.charAt(14)).toBe("7");
  });

  it("truly unregistered domain routes remain 404 (scope guard)", async () => {
    const app = createApp();
    // Paths that must stay unregistered until a later section owns them
    for (const path of ["/api/oauth/clients", "/api/not-a-command"]) {
      const res = await app.request(`http://localhost${path}`, { method: "GET" });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe(NOT_FOUND);
    }
  });

  it("GET /api/events without session returns 401 (2.2 role gate registered)", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/api/events", { method: "GET" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("GET /api/keys without session returns 401 (7.1 keys gate registered)", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/api/keys", { method: "GET" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("createAppFromBindings rejects missing TURNSTILE_SECRET_KEY (fail closed)", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SITE_KEY: "prod-site-key",
      // TURNSTILE_SECRET_KEY omitted intentionally
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it("createAppFromBindings rejects empty TURNSTILE_SECRET_KEY", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SECRET_KEY: "   ",
      TURNSTILE_SITE_KEY: "prod-site-key",
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it("createAppFromBindings rejects missing TURNSTILE_SITE_KEY (fail closed)", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SECRET_KEY: "prod-secret",
      // TURNSTILE_SITE_KEY omitted — would fall back to test UI + DEV_PASS_TOKEN
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).toThrow(/TURNSTILE_SITE_KEY/);
  });

  it("createAppFromBindings rejects empty TURNSTILE_SITE_KEY", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SECRET_KEY: "prod-secret",
      TURNSTILE_SITE_KEY: "   ",
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).toThrow(/TURNSTILE_SITE_KEY/);
  });

  it("createAppFromBindings rejects test site key", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SECRET_KEY: "prod-secret",
      TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).toThrow(/TURNSTILE_SITE_KEY/);
  });

  it("createAppFromBindings rejects literal development secret \"test\"", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SECRET_KEY: "test",
      TURNSTILE_SITE_KEY: "prod-site-key",
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it("createAppFromBindings rejects Cloudflare always-pass test secret", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_PASS,
      TURNSTILE_SITE_KEY: "prod-site-key",
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it("createAppFromBindings rejects Cloudflare always-fail test secret", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_FAIL,
      TURNSTILE_SITE_KEY: "prod-site-key",
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it("createAppFromBindings accepts real production Turnstile bindings", () => {
    const env = {
      DB: {} as WorkerBindings["DB"],
      TURNSTILE_SECRET_KEY: "prod-secret-not-a-test-value",
      TURNSTILE_SITE_KEY: "prod-site-key-not-a-test-value",
    } as WorkerBindings;
    expect(() => createAppFromBindings(env)).not.toThrow();
  });
});
