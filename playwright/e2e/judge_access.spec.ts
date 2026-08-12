/**
 * B07 — judge access entry (`/judge`) — competition shared demo.
 *
 * Named assertions:
 * - assert role-only submit (no access code) lands on /admin shell
 * - assert judge session can switch roles via existing switcher machinery
 *
 * Demo personas are seeded on demand via the open-bootstrap role switcher
 * (allowCreate) before entry.
 */
import { test, expect } from "@playwright/test";

test("@inv:B07 e2e/public/judge-access open role entry for demo session", async ({
  page,
  request,
  context,
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
  await expect(page.getByTestId("judge-code")).toHaveCount(0);

  await page.getByTestId("judge-role-admin").check();
  await page.getByTestId("judge-submit").click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  // assert judge session can switch roles via existing switcher machinery:
  // drive the top-bar role switcher to evaluator and land on the /eval shell.
  await expect(page.getByTestId("role-switcher-select")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("role-switcher-select").selectOption("evaluator");
  await expect(page).toHaveURL(/\/eval/, { timeout: 15_000 });
  await expect(page.getByTestId("evaluator-queue")).toBeVisible({
    timeout: 15_000,
  });

  // TTL guard: the switched session cookie must expire within the origin
  // judge session's 4h window — a role-switch hop must never mint the
  // 14-day default (session-laundering regression).
  const cookies = await context.cookies();
  const sess = cookies.find((c) => c.name === "speakerops_session");
  expect(sess).toBeTruthy();
  expect(sess!.expires).toBeGreaterThan(0);
  const remainingSeconds = sess!.expires - Date.now() / 1000;
  expect(remainingSeconds).toBeGreaterThan(0);
  expect(remainingSeconds).toBeLessThanOrEqual(4 * 60 * 60);
});
