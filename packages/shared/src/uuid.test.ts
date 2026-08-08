import { describe, it, expect } from "vitest";
import { isUuidv7, uuidv7 } from "./uuid.js";

describe("uuidv7 (E3)", () => {
  it("generates UUIDv7 layout (version nibble 7, RFC variant)", () => {
    const id = uuidv7();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(isUuidv7(id)).toBe(true);
    // Not a UUIDv4 (version nibble is 7, not 4)
    expect(id.charAt(14)).toBe("7");
  });

  it("rejects UUIDv4 and non-UUID strings", () => {
    // crypto.randomUUID() is v4 — version nibble 4
    const v4 = crypto.randomUUID();
    expect(v4.charAt(14)).toBe("4");
    expect(isUuidv7(v4)).toBe(false);
    expect(isUuidv7("not-a-uuid")).toBe(false);
    expect(isUuidv7("")).toBe(false);
  });

  it("produces distinct ids", () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a).not.toBe(b);
  });
});
