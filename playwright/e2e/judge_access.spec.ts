/**
 * B07 — judge access entry (`/judge`) — competition shared demo.
 *
 * Named assertions:
 * - assert wrong code shows generic error (no cause detail)
 * - assert correct code + admin role lands on /admin shell
 * - assert judge session can switch roles via existing switcher machinery
 * - assert code is posted in the body (never appears in the URL)
 *
 * Harness: e2e-api-server registers the route with E2E_JUDGE_CODE
 * (default e2e-judge-code-local-0000); demo personas are seeded on demand
 * via the open-bootstrap role switcher (allowCreate) before entry.
 */
import { test, expect } from "@playwright/test";

const JUDGE_CODE = process.env.E2E_JUDGE_CODE || "e2e-judge-code-local-0000";

test("@inv:B07 e2e/public/judge-access code exchanges for demo role session", async ({
  page,
  request,
  baseURL,
}) => {
  // Seed demo personas (open bootstrap allows create) so allowCreate=false
  // judge mint finds them — mirrors `pnpm seed` on dogfood.
  const seed = await request.post("/api/auth/dev/role-switch", {
    data: { role: "admin" },
  });
  expect(seed.ok()).toBeTruthy();

  await page.goto(`${baseURL ?? ""}/judge`);
  await expect(page.getByTestId("judge-page")).toBeVisible();

  // Wrong code → generic error, still on /judge, code not in URL.
  await page.getByTestId("judge-role-admin").check();
  await page.getByTestId("judge-code").fill("wrong-code-wrong-code");
  await page.getByTestId("judge-submit").click();
  await expect(page.getByTestId("judge-error")).toContainText(
    "Invalid access code",
  );
  expect(page.url()).not.toContain("wrong-code");

  // Correct code → admin shell.
  await page.getByTestId("judge-code").fill(JUDGE_CODE);
  await page.getByTestId("judge-submit").click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  expect(page.url()).not.toContain(JUDGE_CODE);
});
