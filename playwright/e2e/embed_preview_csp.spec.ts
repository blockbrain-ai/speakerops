/**
 * Q07 — embed preview CSP: frame-src includes 'self'; embed routes are framable.
 * Local Vite + production-shaped Worker asset headers must both allow preview.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
} from "./helpers/cfp-eval-seed.js";

test.describe("Embed preview CSP", () => {
  test("@inv:Q07 e2e/embeds/preview-frame admin frame-src self + embed frame-ancestors", async ({
    page,
    request,
    context,
    baseURL,
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
    const xfo = embed.headers()["x-frame-options"];
    expect(xfo == null || xfo === "" || xfo.toUpperCase() === "ALLOWALL").toBe(
      true,
    );

    // Browser: same-origin iframe can load embed path under admin shell
    const adminEmail = `embed-q07-${Date.now()}@example.com`;
    const { session } = await loginAs(
      request,
      context,
      baseURL,
      adminEmail,
      "admin",
    );
    await ensureEvent(
      request,
      session,
      `Embed Event ${Date.now()}`,
      `embed-${Date.now()}`,
    );
    await page.goto("/admin");
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    // Inject a same-origin preview iframe and assert it loads (CSP frame-src self)
    const ok = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const iframe = document.createElement("iframe");
        iframe.src = "/embed/demo/sessions";
        iframe.setAttribute("data-testid", "embed-preview-frame");
        iframe.onload = () => resolve(true);
        iframe.onerror = () => resolve(false);
        document.body.appendChild(iframe);
        setTimeout(() => resolve(false), 5000);
      });
    });
    expect(ok).toBe(true);
  });
});
