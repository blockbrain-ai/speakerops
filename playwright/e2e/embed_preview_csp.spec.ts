/**
 * Q07 — embed preview CSP: frame-src includes 'self'; embed routes are framable.
 */
import { test, expect } from "@playwright/test";

test.describe("Embed preview CSP", () => {
  test("@inv:Q07 e2e/embeds/preview-frame admin frame-src self + embed frame-ancestors", async ({
    request,
  }) => {
    const root = await request.get("/");
    expect(root.status()).toBe(200);
    const rootCsp = root.headers()["content-security-policy"] ?? "";
    expect(rootCsp).toMatch(/frame-src[^;]*'self'/);
    expect(rootCsp).toMatch(/frame-ancestors\s+'none'/);

    const embed = await request.get("/embed/demo/sessions");
    expect(embed.status()).toBe(200);
    const embedCsp = embed.headers()["content-security-policy"] ?? "";
    expect(embedCsp).toMatch(/frame-ancestors\s+\*/);
    // Embed must not send X-Frame-Options: DENY
    const xfo = embed.headers()["x-frame-options"];
    expect(xfo == null || xfo === "" || xfo.toUpperCase() === "ALLOWALL").toBe(
      true,
    );
  });
});
