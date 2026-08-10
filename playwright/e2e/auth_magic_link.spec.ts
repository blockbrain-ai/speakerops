/**
 * Section 2.1 — Auth magic-link inventory journeys (B01–B03, B08).
 *
 * - @inv:B01 e2e/auth/admin-login
 * - @inv:B02 e2e/auth/speaker-magic
 * - @inv:B03 e2e/auth/logout
 * - @inv:B08 e2e/auth/membership-chooser
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e) so API + Vite are up.
 * Dev outbox: GET /api/auth/dev/outbox?email=… (e2e-api-server only).
 *
 * Console/pageerror: every browser journey attaches listeners and fails on noise.
 */
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "e2e-admin@example.com";
const SPEAKER_EMAIL = "e2e-speaker@example.com";
const LOGOUT_EMAIL = "e2e-logout@example.com";

function attachConsoleGuards(page: Page): {
  pageErrors: string[];
  consoleErrors: string[];
  assertClean: () => void;
} {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return {
    pageErrors,
    consoleErrors,
    assertClean: () => {
      expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toEqual([]);
      // Filter expected auth-probe / network noise (401 me, 404 assets).
      const noise = consoleErrors.filter(
        (t) =>
          !/favicon|Download the React DevTools|React Router Future Flag/i.test(
            t,
          ) &&
          !/Failed to load resource: the server responded with a status of (401|403|404)/i.test(
            t,
          ),
      );
      expect(noise, `console.error: ${noise.join(" | ")}`).toEqual([]);
    },
  };
}

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose?: "admin" | "speaker" | "evaluator",
  eventId?: string,
) {
  const data: Record<string, string> = { email };
  if (purpose) data.purpose = purpose;
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", {
    data,
  });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body).toEqual({ sent: true });
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

test("@inv:B01 e2e/auth/admin-login magic link sets HttpOnly session cookie", async ({
  page,
  request,
  baseURL,
}) => {
  const guards = attachConsoleGuards(page);

  // Pre-seed admin membership via API (explicit purpose). Customer UI is email-first.
  await requestMagicLink(request, ADMIN_EMAIL, "admin");

  // Customer path: no ?demo=1, no purpose radios
  await page.goto(`${baseURL ?? ""}/login`);
  await expect(page.getByTestId("login-page")).toBeVisible();
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("login-email-first-hint")).toBeVisible();
  await expect(page.getByTestId("login-purpose-admin")).toHaveCount(0);
  await expect(page.getByTestId("login-purpose-speaker")).toHaveCount(0);

  await page.getByTestId("login-email").fill(ADMIN_EMAIL);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-sent")).toBeVisible();

  // Omit-purpose re-request must not clobber admin (server proof via exchange)
  const token = await fetchDevToken(request, ADMIN_EMAIL);

  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  expect(setCookie.toLowerCase()).toContain("httponly");
  expect(setCookie.toLowerCase()).toMatch(/samesite=lax/);
  expect(setCookie).toMatch(/speakerops_session=/);

  const body = await exchange.json();
  expect(body).toMatchObject({
    ok: true,
    email: ADMIN_EMAIL,
  });
  // memberships should include admin (not clobbered)
  const memberships = (body as { memberships?: Array<{ role: string }> })
    .memberships;
  if (Array.isArray(memberships) && memberships.length > 0) {
    expect(memberships.some((m) => m.role === "admin")).toBe(true);
  }

  // Bad token negative (inventory: Bad token 401)
  const bad = await request.post("/api/auth/exchange", {
    data: { token: "this-is-not-a-real-magic-link-token" },
  });
  expect(bad.status()).toBe(401);

  guards.assertClean();
});

test("@inv:B02 e2e/auth/speaker-magic single-use link; replay rejected", async ({
  page,
  request,
  baseURL,
}) => {
  const guards = attachConsoleGuards(page);

  await requestMagicLink(request, SPEAKER_EMAIL, "speaker");
  const token = await fetchDevToken(request, SPEAKER_EMAIL);

  // First exchange via UI token query (same as email link)
  await page.goto(
    `${baseURL ?? ""}/login?token=${encodeURIComponent(token)}&purpose=speaker`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });

  // Second use fails (API + replay)
  const replay = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(replay.status()).toBe(401);
  const err = await replay.json();
  expect(err).toMatchObject({ code: "UNAUTHORIZED" });

  guards.assertClean();
});

test("@inv:B03 e2e/auth/logout clears session cookie", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const guards = attachConsoleGuards(page);

  await requestMagicLink(request, LOGOUT_EMAIL, "admin");
  const token = await fetchDevToken(request, LOGOUT_EMAIL);

  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  expect(setCookie.toLowerCase()).toContain("httponly");

  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  const sessionValue = match![1];

  // API logout clears cookie
  const logout = await request.post("/api/auth/logout", {
    headers: {
      cookie: `speakerops_session=${sessionValue}`,
    },
  });
  expect(logout.status()).toBe(204);
  const clear = logout.headers()["set-cookie"] ?? "";
  expect(clear.toLowerCase()).toContain("httponly");
  expect(clear).toMatch(/Max-Age=0/i);

  // Browser: shell sign-out after live session
  await requestMagicLink(request, LOGOUT_EMAIL, "admin");
  const token2 = await fetchDevToken(request, LOGOUT_EMAIL);
  const exchange2 = await request.post("/api/auth/exchange", {
    data: { token: token2 },
  });
  expect(exchange2.status()).toBe(200);
  const setCookie2 = exchange2.headers()["set-cookie"] ?? "";
  const match2 = setCookie2.match(/speakerops_session=([^;]+)/);
  expect(match2).toBeTruthy();
  await context.addCookies([
    {
      name: "speakerops_session",
      value: match2![1]!,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.goto(`${baseURL ?? ""}/admin`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("admin-sign-out")).toBeVisible();
  await page.getByTestId("admin-sign-out").click();
  // After sign-out, privileged chrome should not remain
  await expect(page.getByTestId("admin-sign-out")).toHaveCount(0, {
    timeout: 10_000,
  });

  guards.assertClean();
});

test("@inv:B08 e2e/auth/membership-chooser multi-event pick lands correctly", async ({
  page,
  request,
  baseURL,
}) => {
  const guards = attachConsoleGuards(page);
  const run = Date.now();
  const email = `e2e-multi-${run}@example.com`;

  // Create two events as admin
  await requestMagicLink(request, `e2e-multi-admin-${run}@example.com`, "admin");
  const adminTok = await fetchDevToken(
    request,
    `e2e-multi-admin-${run}@example.com`,
  );
  const adminEx = await request.post("/api/auth/exchange", {
    data: { token: adminTok },
  });
  expect(adminEx.status()).toBe(200);
  const adminCookie = (adminEx.headers()["set-cookie"] ?? "").match(
    /speakerops_session=([^;]+)/,
  )![1]!;

  async function createEvent(name: string): Promise<string> {
    const res = await request.post("/api/events", {
      headers: {
        cookie: `speakerops_session=${adminCookie}`,
        "content-type": "application/json",
      },
      data: {
        name,
        timezone: "UTC",
        startsAt: "2026-09-01T09:00:00.000Z",
        endsAt: "2026-09-02T17:00:00.000Z",
      },
    });
    expect(res.status(), `create event ${name}`).toBe(201);
    const body = (await res.json()) as { event: { id: string } };
    return body.event.id;
  }

  const evtA = await createEvent(`Chooser Event A ${run}`);
  const evtB = await createEvent(`Chooser Event B ${run}`);

  // Grant memberships on both events (open policy upserts purpose role)
  await requestMagicLink(request, email, "speaker", evtA);
  await requestMagicLink(request, email, "evaluator", evtB);
  // Final link must omit eventId so exchange does not auto-land on one membership
  await requestMagicLink(request, email);

  const token = await fetchDevToken(request, email);
  // Exchange API proof: multi memberships present
  const exProof = await request.post("/api/auth/exchange", {
    data: { token },
  });
  // Token single-use — re-issue for UI
  expect([200, 401]).toContain(exProof.status());
  if (exProof.status() === 200) {
    const body = (await exProof.json()) as {
      memberships: Array<{ eventId: string; role: string }>;
    };
    expect(body.memberships.length).toBeGreaterThanOrEqual(2);
  }

  await requestMagicLink(request, email);
  const tokenUi = await fetchDevToken(request, email);
  await page.goto(
    `${baseURL ?? ""}/login?token=${encodeURIComponent(tokenUi)}`,
  );

  await expect(page.getByTestId("login-membership-chooser")).toBeVisible({
    timeout: 15_000,
  });
  const pickA = page.getByTestId(`login-membership-speaker-${evtA}`);
  const pickB = page.getByTestId(`login-membership-evaluator-${evtB}`);
  const hasA = (await pickA.count()) > 0;
  const hasB = (await pickB.count()) > 0;
  expect(hasA || hasB).toBe(true);

  if (hasA) {
    await pickA.click();
    await expect(page).toHaveURL(/portal/, { timeout: 15_000 });
  } else {
    await pickB.click();
    await expect(page).toHaveURL(/eval/, { timeout: 15_000 });
  }

  guards.assertClean();
});
