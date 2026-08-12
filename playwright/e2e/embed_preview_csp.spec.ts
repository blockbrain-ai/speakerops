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

    // H4: drive the real EmbedConfigurator (not a synthetic iframe inject).
    const adminEmail = `embed-q07-${Date.now()}@example.com`;
    const { session } = await loginAs(
      request,
      context,
      baseURL,
      adminEmail,
      "admin",
    );
    const event = await ensureEvent(
      request,
      session,
      `Embed Event ${Date.now()}`,
      `embed-${Date.now()}`,
    );
    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto("/admin/embeds");
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("page-embeds")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("embeds-config")).toBeVisible();
    await page.getByTestId("embed-type-select").selectOption("speakers");
    await expect(page.getByTestId("embed-url-preview")).toContainText(
      `/embed/${event.slug}/speakers`,
    );
    await page.getByTestId("embed-height-input").fill("480");
    const code = page.getByTestId("embed-code");
    await expect(code).toHaveValue(/iframe[\s\S]*speakers/);
    await expect(code).toHaveValue(/height="480"/);

    const preview = page.getByTestId("embed-live-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute(
      "src",
      new RegExp(`/embed/${event.slug}/speakers`),
    );
    // Live preview iframe must load under admin frame-src 'self' + embed frame-ancestors *
    await expect
      .poll(async () => {
        return preview.evaluate((el) => {
          const iframe = el as HTMLIFrameElement;
          try {
            return Boolean(
              iframe.contentDocument?.body ||
                iframe.contentWindow?.document?.body,
            );
          } catch {
            return false;
          }
        });
      }, { timeout: 10_000 })
      .toBe(true);
  });
});
