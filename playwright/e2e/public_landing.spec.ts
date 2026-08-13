/**
 * Wave-1 public landing (/) — front door (owner-approved mock).
 * Anonymous visitors must not land on session-expired /admin chrome.
 */
import { test, expect } from "@playwright/test";

test.describe("public landing front door", () => {
  test("anonymous / renders product landing with judge CTA", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("page-landing")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("landing-hero")).toBeVisible();
    await expect(page.getByTestId("landing-cta-judge")).toBeVisible();
    await expect(page.getByTestId("landing-lifecycle")).toBeVisible();
    await expect(page.getByTestId("landing-pillars")).toBeVisible();
    await expect(page.getByTestId("landing-nav-developers")).toBeVisible();
    await expect(page.getByTestId("landing-sign-in")).toBeVisible();
    await expect(page.getByTestId("landing-judge-access")).toBeVisible();
    const marks = page.getByRole("group", { name: "Source" });
    await expect(marks.getByRole("link", { name: "GitHub" })).toBeVisible();
    await expect(marks.getByRole("link", { name: "SmolForge" })).toBeVisible();
    await expect(page.getByTestId("landing-nav-github")).toHaveAttribute(
      "href",
      "https://github.com/blockbrain-ai/speakerops",
    );
    await expect(page.getByTestId("landing-nav-forge")).toHaveAttribute(
      "href",
      "https://forge.smol.ai/blockbrain_labs/speakerops",
    );
    await expect(page.getByTestId("landing-footer-github")).toBeVisible();
    await expect(page.getByTestId("landing-footer-forge")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /conference programme|end to end/i,
    );
    // Must NOT be the admin shell or session-expired card
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.getByText(/session expired/i)).toHaveCount(0);
  });

  test("source logos have names, 44px targets, and no 390 overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("page-landing")).toBeVisible({
      timeout: 15_000,
    });
    const marks = page.getByRole("group", { name: "Source" });
    const github = marks.getByRole("link", { name: "GitHub" });
    const forge = marks.getByRole("link", { name: "SmolForge" });
    await expect(github).toBeVisible();
    await expect(forge).toBeVisible();
    for (const link of [github, forge]) {
      const box = await link.boundingBox();
      expect(box, "source mark must have a box").toBeTruthy();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflow, "no horizontal overflow at 390").toBe(false);
  });

  test("judge access CTA routes to /judge", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("landing-cta-judge").click();
    await expect(page).toHaveURL(/\/judge/);
  });
});
