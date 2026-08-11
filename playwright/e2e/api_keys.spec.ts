/**
 * Section 7.1 — API keys inventory journeys (K01–K05).
 *
 * - @inv:K01 e2e/keys/create
 * - @inv:K02 e2e/keys/revoke
 * - @inv:K03 e2e/keys/secret-once
 * - @inv:K04 e2e/keys/authz
 * - @inv:K05 e2e/keys/demo-clamp
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * Note: Playwright `request` fixture does not share browser context cookies —
 * pass `cookie: speakerops_session=…` on API proofs explicitly.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "e2e-keys-admin@example.com";
const SPEAKER_EMAIL = "e2e-keys-speaker@example.com";
const JUDGE_CODE = process.env.E2E_JUDGE_CODE || "e2e-judge-code-local-0000";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
) {
  const res = await request.post("/api/auth/magic-link", {
    data: { email, purpose },
  });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
}

async function fetchDevToken(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok(), `dev outbox status ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { link: { token: string } | null };
  expect(body.link?.token, "dev outbox must capture token").toBeTruthy();
  return body.link!.token;
}

async function exchangeForCookie(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<string> {
  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  return match![1]!;
}

async function loginAs(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  purpose: "admin" | "speaker" | "evaluator",
): Promise<string> {
  await requestMagicLink(request, email, purpose);
  const token = await fetchDevToken(request, email);
  const sessionValue = await exchangeForCookie(request, token);
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sessionValue,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return sessionValue;
}

function cookieHeader(sessionValue: string): string {
  return `speakerops_session=${sessionValue}`;
}

test("@inv:K01 e2e/keys/create create key with subset of scopes; secret shown once", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const sessionValue = await loginAs(
    request,
    context,
    baseURL,
    ADMIN_EMAIL,
    "admin",
  );

  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("api-keys-page")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("api-key-name-input").fill("E2E agent key");
  // Subset of safe scopes (not default-deny)
  await page.getByTestId("api-key-scope-events:read").check();
  await page.getByTestId("api-key-scope-reports:read").check();
  // Ensure default-deny remain unchecked
  await expect(page.getByTestId("api-key-scope-keys:admin")).not.toBeChecked();
  await expect(page.getByTestId("api-key-scope-comms:send")).not.toBeChecked();
  await expect(
    page.getByTestId("api-key-scope-decisions:write"),
  ).not.toBeChecked();

  await page.getByTestId("api-key-create-submit").click();

  // Secret shown once
  const secretBanner = page.getByTestId("api-key-secret-once");
  await expect(secretBanner).toBeVisible({ timeout: 10_000 });
  const secretInput = page.getByTestId("api-key-secret-value");
  await expect(secretInput).toBeVisible();
  const secret = await secretInput.inputValue();
  expect(secret.length).toBeGreaterThan(20);
  expect(secret.startsWith("spk_")).toBeTruthy();

  const prefix = await page.getByTestId("api-key-prefix-value").innerText();
  expect(secret.startsWith(prefix)).toBeTruthy();

  // Key appears in list with prefix (not full secret). Match by prefix text —
  // parallel workers share the e2e server, so this key is not always first.
  await expect(page.getByTestId("api-keys-list")).toBeVisible();
  await expect(
    page.getByTestId("api-key-row-prefix").filter({ hasText: prefix }).first(),
  ).toBeVisible();
  const listText = await page.getByTestId("api-keys-list").innerText();
  expect(listText).not.toContain(secret);

  // API proof: list body has no secret (request fixture needs cookie)
  const listRes = await request.get("/api/keys", {
    headers: { cookie: cookieHeader(sessionValue) },
  });
  expect(listRes.status()).toBe(200);
  const listBody = await listRes.text();
  expect(listBody).not.toContain(secret);
});

test("@inv:K02 e2e/keys/revoke revoke key", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const sessionValue = await loginAs(
    request,
    context,
    baseURL,
    "e2e-keys-revoke@example.com",
    "admin",
  );

  // Seed via API for stable key id
  const createRes = await request.post("/api/keys", {
    headers: { cookie: cookieHeader(sessionValue) },
    data: {
      name: "revoke-me",
      scopes: ["events:read"],
    },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string; secret: string };

  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("api-keys-page")).toBeVisible({
    timeout: 15_000,
  });

  const revokeBtn = page.getByTestId(`api-key-revoke-${created.id}`);
  await expect(revokeBtn).toBeVisible({ timeout: 10_000 });
  await revokeBtn.click();

  await expect(page.getByTestId("api-key-revoke-status")).toContainText(
    /revoked/i,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId(`api-key-revoked-${created.id}`)).toBeVisible();

  // API proof: revoked key cannot authenticate
  const denied = await request.get("/api/keys", {
    headers: { authorization: `Bearer ${created.secret}` },
  });
  expect(denied.status()).toBe(401);
});

test("@inv:K03 e2e/keys/secret-once copy prefix only after dismiss", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await loginAs(
    request,
    context,
    baseURL,
    "e2e-keys-secret-once@example.com",
    "admin",
  );

  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("api-keys-page")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("api-key-name-input").fill("once-only");
  await page.getByTestId("api-key-scope-design:read").check();
  await page.getByTestId("api-key-create-submit").click();

  await expect(page.getByTestId("api-key-secret-once")).toBeVisible({
    timeout: 10_000,
  });
  const secret = await page.getByTestId("api-key-secret-value").inputValue();
  const prefix = await page.getByTestId("api-key-prefix-value").innerText();

  // Dismiss secret
  await page.getByTestId("api-key-secret-dismiss").click();
  await expect(page.getByTestId("api-key-secret-once")).toHaveCount(0);
  await expect(page.getByTestId("api-key-secret-dismissed")).toBeVisible();

  // Full secret no longer on page; prefix remains. Match by prefix text —
  // parallel workers share the e2e server, so this key is not always first.
  const pageText = await page.getByTestId("api-keys-page").innerText();
  expect(pageText).not.toContain(secret);
  await expect(
    page.getByTestId("api-key-row-prefix").filter({ hasText: prefix }).first(),
  ).toBeVisible();

  // Copy prefix control present after dismiss (scoped to this key's row)
  const row = page
    .locator(`li[data-testid^="api-key-row-"]`, {
      has: page.getByTestId("api-key-row-prefix").filter({ hasText: prefix }),
    })
    .first();
  await expect(row.getByTestId("api-key-row-prefix")).toContainText(prefix);
  await expect(
    row.locator(`[data-testid^="api-key-copy-prefix-"]`),
  ).toBeVisible();
});

test("@inv:K05 e2e/keys/demo-clamp judge demo session mints 4h key, uses and revokes it; seeded key revoke blocked", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  // Seed demo personas (open bootstrap allows create) so judge mint finds
  // them — mirrors `pnpm seed` on dogfood (same setup as @inv:B07).
  const seedPersonas = await request.post("/api/auth/dev/role-switch", {
    data: { role: "admin" },
  });
  expect(seedPersonas.ok()).toBeTruthy();

  // Seeded (owner) key from a real admin — the key the judge must NOT revoke.
  const ownerSession = await loginAs(
    request,
    context,
    baseURL,
    "e2e-keys-demo-owner@example.com",
    "admin",
  );
  const seededRes = await request.post("/api/keys", {
    headers: { cookie: cookieHeader(ownerSession) },
    data: { name: "seeded-owner-key", scopes: ["events:read"] },
  });
  expect(seededRes.status()).toBe(201);
  const seededKey = (await seededRes.json()) as { id: string };

  // Judge access mints a demo admin session (4h TTL).
  const mint = await request.post("/api/auth/judge-access", {
    data: { code: JUDGE_CODE, role: "admin" },
  });
  expect(mint.status()).toBe(200);
  const mintCookie = mint.headers()["set-cookie"] ?? "";
  const demoMatch = mintCookie.match(/speakerops_session=([^;]+)/);
  expect(demoMatch).toBeTruthy();
  const demoSession = demoMatch![1]!;
  await context.clearCookies();
  await context.addCookies([
    {
      name: "speakerops_session",
      value: demoSession,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("api-keys-page")).toBeVisible({
    timeout: 15_000,
  });

  // Demo sessions see the bounded-key copy (4h expiry, demo-only revoke).
  await expect(page.getByTestId("api-keys-demo-note")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("api-keys-demo-note")).toContainText(
    "expire after 4 hours",
  );

  // Judge creates a key via the real UI (explicit keys:admin opt-in so the
  // bearer proof below can call Keys.List).
  await page.getByTestId("api-key-name-input").fill("judge-demo-key");
  await page.getByTestId("api-key-scope-keys:admin").check();
  await page.getByTestId("api-key-create-submit").click();

  const secretBanner = page.getByTestId("api-key-secret-once");
  await expect(secretBanner).toBeVisible({ timeout: 10_000 });
  const secret = await page.getByTestId("api-key-secret-value").inputValue();
  expect(secret.startsWith("spk_")).toBeTruthy();
  const prefix = await page.getByTestId("api-key-prefix-value").innerText();

  // The create flow surfaces the server-side expiry on the secret banner.
  await expect(page.getByTestId("api-key-created-expiry")).toBeVisible();
  await expect(page.getByTestId("api-key-created-expiry")).toContainText(
    /expires/i,
  );

  // Bearer proof: the demo-minted key really works against the API…
  const bearerList = await request.get("/api/keys", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(bearerList.status()).toBe(200);
  const bearerBody = (await bearerList.json()) as {
    keys: { id: string; prefix: string; expiresAt: string | null }[];
  };
  const minted = bearerBody.keys.find((k) => k.prefix === prefix);
  expect(minted).toBeTruthy();

  // …and the server clamped its expiry to at most 4 hours from mint.
  expect(minted!.expiresAt).toBeTruthy();
  const remainingMs = Date.parse(minted!.expiresAt!) - Date.now();
  expect(remainingMs).toBeGreaterThan(0);
  expect(remainingMs).toBeLessThanOrEqual(4 * 60 * 60 * 1000 + 60_000);

  // Key row surfaces the expiry.
  await expect(
    page
      .getByTestId(`api-key-row-${minted!.id}`)
      .getByTestId("api-key-row-expires"),
  ).toContainText(/expires/i);

  // Judge revokes their own demo-created key via the real UI.
  await page.getByTestId(`api-key-revoke-${minted!.id}`).click();
  await expect(page.getByTestId("api-key-revoke-status")).toContainText(
    /revoked/i,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId(`api-key-revoked-${minted!.id}`)).toBeVisible();

  // Revoked demo key can no longer authenticate.
  const deniedBearer = await request.get("/api/keys", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(deniedBearer.status()).toBe(401);

  // Seeded (owner) key revoke stays blocked with human copy.
  const seededRevokeBtn = page.getByTestId(`api-key-revoke-${seededKey.id}`);
  await expect(seededRevokeBtn).toBeVisible({ timeout: 10_000 });
  await seededRevokeBtn.click();
  await expect(page.getByTestId("api-key-revoke-status")).toContainText(
    "Seeded demo keys can't be revoked",
    { timeout: 10_000 },
  );

  // Server-side proof: the seeded key is untouched (still active for its owner).
  const ownerList = await request.get("/api/keys", {
    headers: { cookie: cookieHeader(ownerSession) },
  });
  expect(ownerList.status()).toBe(200);
  const ownerKeys = (await ownerList.json()) as {
    keys: { id: string; revokedAt: string | null }[];
  };
  const seededRow = ownerKeys.keys.find((k) => k.id === seededKey.id);
  expect(seededRow).toBeTruthy();
  expect(seededRow!.revokedAt).toBeNull();
});

test("@inv:K04 e2e/keys/authz non-admin cannot open keys", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const sessionValue = await loginAs(
    request,
    context,
    baseURL,
    SPEAKER_EMAIL,
    "speaker",
  );

  // API proof (cookie required on request fixture)
  const api = await request.get("/api/keys", {
    headers: { cookie: cookieHeader(sessionValue) },
  });
  expect(api.status()).toBe(403);
  const err = await api.json();
  expect(err).toMatchObject({ code: "FORBIDDEN" });

  // UI: speaker hits /admin/settings/api-keys → access denied (AdminGuard)
  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("access-denied")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("api-keys-page")).toHaveCount(0);
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
});
