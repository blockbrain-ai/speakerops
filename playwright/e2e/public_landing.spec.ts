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
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /conference programme|end to end/i,
    );
    // Must NOT be the admin shell or session-expired card
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.getByText(/session expired/i)).toHaveCount(0);
  });

  test("judge access CTA routes to /judge", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("landing-cta-judge").click();
    await expect(page).toHaveURL(/\/judge/);
  });
});
