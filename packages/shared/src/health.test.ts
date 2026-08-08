/**
 * Shared health DTO Zod contract (section 1.2).
 */
import { describe, it, expect } from "vitest";
import { HealthResponseSchema, HEALTH_OK } from "./health.js";

describe("@speakerops/shared HealthResponseSchema", () => {
  it("accepts { ok: true, version }", () => {
    const parsed = HealthResponseSchema.safeParse({
      ok: true,
      version: "0.1.0",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects missing version", () => {
    expect(HealthResponseSchema.safeParse({ ok: true }).success).toBe(false);
    expect(HealthResponseSchema.safeParse(HEALTH_OK).success).toBe(false);
  });

  it("rejects ok:false", () => {
    expect(
      HealthResponseSchema.safeParse({ ok: false, version: "0.1.0" }).success,
    ).toBe(false);
  });
});
