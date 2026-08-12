import { chromium } from "@playwright/test";
import { DOGFOOD_ORIGIN, loginDogfoodRole } from "../playwright/e2e/helpers/dogfood-session.js";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await loginDogfoodRole(context, "admin", DOGFOOD_ORIGIN);
const page = await context.newPage();
const routes = ["/admin", "/admin/team", "/admin/evaluations", "/admin/comms"];
const output: Record<string, unknown> = {};
for (const route of routes) {
  await page.goto(`${DOGFOOD_ORIGIN}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  output[route] = {
    text: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 2600),
    loading: await page.locator('[data-testid*="loading"]:visible, [aria-busy="true"]:visible').count(),
    errors: await page.locator('[data-testid*="error"]:visible, [role="alert"]:visible').allInnerTexts(),
  };
}
console.log(JSON.stringify(output, null, 2));
await browser.close();
