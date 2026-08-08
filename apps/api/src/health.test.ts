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
} from "@speakerops/shared";
import { createApp, DEFAULT_APP_VERSION } from "./index.js";
import { onErrorHandler } from "./middleware/errors.js";

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

  it("health is the only product route registered in 1.2 (scope guard)", async () => {
    const app = createApp();
    // Auth / domain routes must remain 404 until their sections
    for (const path of [
      "/api/auth/magic-link",
      "/api/events",
      "/api/public/cfp/demo",
    ]) {
      const res = await app.request(`http://localhost${path}`, { method: "GET" });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe(NOT_FOUND);
    }
  });
});
