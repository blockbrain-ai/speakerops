/**
 * Public developer kit — X01 / X02.
 */
import { test, expect } from "@playwright/test";

test("@inv:X01 e2e/public/developers-page kit loads with honesty and chrome", async ({
  page,
}) => {
  await page.goto("/developers");
  await expect(page.getByTestId("page-developers")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /connect your tools/i,
  );
  await expect(page.getByTestId("developers-paths")).toBeVisible();
  await expect(page.getByTestId("developers-path-sdk")).toBeVisible();
  await expect(page.getByTestId("developers-path-cli")).toBeVisible();
  await expect(page.getByTestId("developers-path-connect")).toBeVisible();
  await expect(page.getByTestId("developers-sdk")).toBeVisible();
  await expect(page.getByTestId("developers-http")).toBeVisible();
  await expect(page.getByTestId("developers-cli")).toBeVisible();
  await expect(page.getByTestId("developers-connect")).toBeVisible();
  await expect(page.getByTestId("developers-starter")).toContainText(
    'from "@speakerops/sdk"',
  );

  const honesty = page.getByTestId("developers-honesty");
  await expect(honesty).toBeVisible();
  await expect(honesty).toContainText(/not published to the public npm registry/i);
  await expect(honesty).toContainText(/no inbound webhooks/i);
  await expect(honesty).toContainText(/OpenAPI is a subset/i);
  await expect(honesty).toContainText(/untested without a live API key/i);
  await expect(honesty).toContainText(/server-side only/i);

  const cli = page.getByTestId("developers-cli-snippet");
  await expect(cli).toContainText("node packages/cli/dist/main.js");
  await expect(cli).not.toContainText("pnpm exec speakerops");
  await expect(page.getByTestId("page-developers")).not.toContainText(
    "npm i @speakerops/sdk",
  );
  await expect(page.getByTestId("page-developers")).not.toContainText(
    "npm install @speakerops/sdk",
  );

  await expect(page.getByTestId("developers-honesty")).toContainText(
    /GitHub is the primary source host/i,
  );
  await expect(page.getByTestId("developers-honesty")).toContainText(
    /mirror lives on SmolForge/i,
  );

  await expect(page.getByTestId("developers-nav-docs")).toHaveAttribute(
    "href",
    /learn\.speakerops\.org/,
  );
  await expect(page.getByTestId("developers-openapi")).toHaveAttribute(
    "href",
    "/openapi.json",
  );
  await expect(page.getByTestId("developers-cli-learn")).toHaveAttribute(
    "href",
    /learn\.speakerops\.org\/agents\/cli-and-keys/,
  );
  await expect(page.getByTestId("developers-connect")).toContainText(
    "/api/public/programme/:slug",
  );

  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  await page.getByTestId("developers-brand").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("page-landing")).toBeVisible();
});

test("@inv:X02 e2e/public/developers-nav landing nav and footer route to /developers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("page-landing")).toBeVisible({
    timeout: 15_000,
  });
  const nav = page.getByTestId("landing-nav-developers");
  const footer = page.getByTestId("landing-footer-developers");
  const agents = page.getByTestId("landing-agents-developers");
  await expect(nav).toBeVisible();
  await expect(footer).toBeVisible();
  await expect(agents).toBeVisible();
  await expect(nav).toHaveAttribute("href", /\/developers$/);
  await expect(footer).toHaveAttribute("href", /\/developers$/);
  await expect(agents).toHaveAttribute("href", /\/developers$/);
  await expect(page.getByTestId("landing-sign-in")).toBeVisible();
  await expect(page.getByTestId("landing-judge-access")).toBeVisible();
  await expect(page.getByTestId("landing-nav-docs")).toBeVisible();

  await nav.click();
  await expect(page).toHaveURL(/\/developers/);
  await expect(page.getByTestId("page-developers")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("page-landing")).toBeVisible({
    timeout: 15_000,
  });
  const mobileNav = page.getByTestId("landing-nav-developers");
  await expect(mobileNav).toBeVisible();
  await expect(page.getByTestId("landing-footer-developers")).toBeVisible();
  await expect(page.getByTestId("landing-agents-developers")).toBeVisible();
  const box = await mobileNav.boundingBox();
  expect(box, "Developers nav must have a box").toBeTruthy();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow, "no horizontal overflow at 390").toBe(false);
  await mobileNav.click();
  await expect(page).toHaveURL(/\/developers/);
  await expect(page.getByTestId("page-developers")).toBeVisible();
});

test("developers chrome source logos are named and 44px at 390", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/developers");
  await expect(page.getByTestId("page-developers")).toBeVisible({
    timeout: 15_000,
  });
  const marks = page.getByRole("group", { name: "Source" });
  const github = marks.getByRole("link", { name: "GitHub" });
  const forge = marks.getByRole("link", { name: "SmolForge" });
  await expect(github).toBeVisible();
  await expect(forge).toBeVisible();
  await expect(page.getByTestId("developers-nav-github")).toHaveAttribute(
    "href",
    "https://github.com/blockbrain-ai/speakerops",
  );
  await expect(page.getByTestId("developers-nav-forge")).toHaveAttribute(
    "href",
    "https://forge.smol.ai/blockbrain_labs/speakerops",
  );
  await expect(page.getByTestId("developers-footer-forge")).toBeVisible();
  for (const link of [github, forge]) {
    const box = await link.boundingBox();
    expect(box, "source mark must have a box").toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
