import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  INTERNAL_ERROR,
} from "./errors.js";

describe("@speakerops/shared E4 error envelope", () => {
  it("builds a valid envelope without details", () => {
    const body = errorEnvelope("Not signed in", UNAUTHORIZED);
    expect(body).toEqual({ error: "Not signed in", code: "UNAUTHORIZED" });
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it("includes optional details for validation failures", () => {
    const body = errorEnvelope("Invalid body", VALIDATION_ERROR, {
      fieldErrors: { email: ["Required"] },
    });
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details).toEqual({ fieldErrors: { email: ["Required"] } });
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it("rejects envelopes missing code", () => {
    const bad = { error: "boom" };
    expect(ErrorEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("exposes INTERNAL_ERROR without leaking stack to client shape", () => {
    const body = errorEnvelope("Unexpected error", INTERNAL_ERROR);
    expect(body).toEqual({ error: "Unexpected error", code: "INTERNAL_ERROR" });
    expect(JSON.stringify(body)).not.toMatch(/stack|at Object/i);
  });
});
