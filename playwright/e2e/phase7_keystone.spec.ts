/**
 * Section 7.4 — CLI Airtable proof (I12 keystone).
 *
 * Soul paths (S-CLI + S-AIRTABLE):
 *   keys mint/revoke/secret-once/authz (K*) →
 *   CLI07 reports-only schedule place exit 2 →
 *   Airtable pause survival + O06 status lag.
 *
 * Proof owner for phase-7 inventory (implementation tags stay 1:1 on 7.1/7.3):
 * - @inv:K01 e2e/keys/create
 * - @inv:K02 e2e/keys/revoke
 * - @inv:K03 e2e/keys/secret-once
 * - @inv:K04 e2e/keys/authz
 * - @inv:O06 e2e/settings/airtable-status
 *
 * Active `@inv` ownership remains on implementation specs (duplicate owners
 * forbidden by inventory law). This keystone stitches the multi-step soul path
 * and documents K01–K04 / O06 coverage for phase-7 proof.
 *
 * Named assertions (spec 7.4):
 * - assert phase7 keystone includes CLI07 deny and airtable pause
 *
 * Non-browser proofs also in CI:
 * - CLI07 unit: packages/cli/src/cli.test.ts (vitest via pnpm test:ci)
 * - Airtable pause unit: apps/api/src/modules/airtable/airtable.test.ts
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * @see docs/sections/7.4-cli-airtable-e2e.md
 * @see KMS-competition/initiative/evidence/phase7-e2e.txt
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
} from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KEYSTONE_ADMIN = `e2e-keystone74-admin-${RUN}@example.com`;
const KEYSTONE_SPEAKER = `e2e-keystone74-spk-${RUN}@example.com`;
const API_PORT = Number(process.env.E2E_API_PORT || 8787);
const API_BASE = `http://127.0.0.1:${API_PORT}`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_DIST = join(ROOT, "packages", "cli", "dist", "main.js");

function cookieHeader(sessionValue: string): string {
  return `speakerops_session=${sessionValue}`;
}

async function loginAs(
  request: APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  purpose: "admin" | "speaker" | "evaluator",
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, purpose);
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await seedSessionCookie(context, baseURL, session);
  return { session, userId: link.userId };
}

async function createEvent(
  request: APIRequestContext,
  session: string,
  name: string,
): Promise<{ id: string; version: number }> {
  const res = await request.post("/api/events", {
    headers: sessionHeaders(session),
    data: {
      name,
      timezone: "UTC",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; version: number };
  };
  return { id: body.event.id, version: body.event.version };
}

/**
 * Ensure CLI dist exists so keystone can spawn `speakerops` against the live
 * e2e API (CLI07 deny). Builds once if missing.
 */
function ensureCliDist(): string {
  if (!existsSync(CLI_DIST)) {
    const build = spawnSync(
      "pnpm",
      ["--filter", "@speakerops/cli", "build"],
      { cwd: ROOT, encoding: "utf8", shell: false },
    );
    expect(
      build.status,
      `CLI build failed: ${build.stderr || build.stdout}`,
    ).toBe(0);
  }
  expect(existsSync(CLI_DIST), "packages/cli/dist/main.js").toBe(true);
  return CLI_DIST;
}

/**
 * Spawn speakerops CLI against the e2e API (not Vite proxy).
 * Returns process exit status and stdout/stderr (never logs secrets).
 */
function runSpeakerops(
  args: string[],
  env: { apiKey: string; apiUrl?: string },
): { status: number | null; stdout: string; stderr: string } {
  const bin = ensureCliDist();
  const result = spawnSync("node", [bin, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      SPEAKEROPS_API_KEY: env.apiKey,
      SPEAKEROPS_API_URL: env.apiUrl ?? API_BASE,
      // Avoid inheriting unrelated secrets into child
    },
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function mintKey(
  request: APIRequestContext,
  session: string,
  name: string,
  scopes: string[],
  /** Required when session admin has multiple event memberships. */
  eventId: string,
): Promise<{ id: string; secret: string; prefix: string }> {
  const res = await request.post("/api/keys", {
    headers: sessionHeaders(session),
    data: { name, scopes, eventId },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as {
    id: string;
    secret: string;
    prefix: string;
  };
  expect(body.secret.startsWith("spk_")).toBeTruthy();
  return body;
}

/**
 * Select active event when the shell switcher is present.
 * AdminShell briefly renders a fallback <div data-testid="event-context">
 * while events load; calling selectOption on that div races and fails with
 * "Element is not a <select> element". Wait for a real <select> before acting.
 */
async function selectEventIfPresent(page: Page, eventId: string) {
  // Target the select explicitly — not the loading placeholder div.
  const switcher = page.locator('select[data-testid="event-context"]');
  const visible = await switcher
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
  if (!visible) return;
  await expect(switcher.locator(`option[value="${eventId}"]`)).toHaveCount(1, {
    timeout: 10_000,
  });
  await switcher.selectOption({ value: eventId });
}

test.describe("7.4 phase7 keystone (I12 K* + CLI deny + airtable pause)", () => {
  /**
   * assert phase7 keystone includes CLI07 deny and airtable pause
   *
   * Multi-step soul path:
   *   admin login → K01 create → K03 dismiss secret → K02 revoke →
   *   K04 non-admin deny → CLI07 reports-only schedule place exit 2 →
   *   airtable pause (mutation 200 + pending outbox + O06 lag UI).
   */
  test("keystone: K* keys → CLI07 deny → airtable pause (phase7)", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // Named AC anchor (governance grep + human evidence)
    // assert phase7 keystone includes CLI07 deny and airtable pause

    // ========== Admin login ==========
    const admin = await loginAs(
      request,
      context,
      baseURL,
      KEYSTONE_ADMIN,
      "admin",
    );

    // Authz negatives: unauthenticated keys + airtable status → 401
    const unauthKeys = await request.get("/api/keys");
    expect(unauthKeys.status()).toBe(401);

    const unauthAirtable = await request.get(
      "/api/events/evt_missing/airtable/status",
    );
    expect(unauthAirtable.status()).toBe(401);

    // ========== Event for schedule place + airtable projection ==========
    const event = await createEvent(
      request,
      admin.session,
      `Keystone Phase7 ${RUN}`,
    );

    // ========== K01: create key with subset of scopes; secret shown once ==========
    // (Documents @inv:K01 — active owner remains api_keys.spec.ts)
    await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
    await expect(page.getByTestId("api-keys-page")).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByTestId("api-key-name-input")
      .fill(`phase7-agent-${RUN.slice(-6)}`);
    await page.getByTestId("api-key-scope-events:read").check();
    await page.getByTestId("api-key-scope-reports:read").check();
    await expect(page.getByTestId("api-key-scope-keys:admin")).not.toBeChecked();
    await expect(page.getByTestId("api-key-scope-comms:send")).not.toBeChecked();
    await expect(
      page.getByTestId("api-key-scope-decisions:write"),
    ).not.toBeChecked();

    await page.getByTestId("api-key-create-submit").click();

    const secretBanner = page.getByTestId("api-key-secret-once");
    await expect(secretBanner).toBeVisible({ timeout: 10_000 });
    const secretInput = page.getByTestId("api-key-secret-value");
    await expect(secretInput).toBeVisible();
    const createdSecret = await secretInput.inputValue();
    expect(createdSecret.length).toBeGreaterThan(20);
    expect(createdSecret.startsWith("spk_")).toBeTruthy();
    const prefix = await page.getByTestId("api-key-prefix-value").innerText();
    expect(createdSecret.startsWith(prefix)).toBeTruthy();

    // List must not re-display full secret
    const listText = await page.getByTestId("api-keys-list").innerText();
    expect(listText).not.toContain(createdSecret);

    // ========== K03: copy prefix only after dismiss ==========
    await page.getByTestId("api-key-secret-dismiss").click();
    await expect(page.getByTestId("api-key-secret-once")).toHaveCount(0);
    await expect(page.getByTestId("api-key-secret-dismissed")).toBeVisible();
    const pageTextAfterDismiss = await page
      .getByTestId("api-keys-page")
      .innerText();
    expect(pageTextAfterDismiss).not.toContain(createdSecret);
    await expect(page.getByTestId("api-key-row-prefix").first()).toContainText(
      prefix,
    );
    await expect(
      page.locator(`[data-testid^="api-key-copy-prefix-"]`).first(),
    ).toBeVisible();

    // ========== K02: revoke key (seed dedicated key for stable id) ==========
    const revokeTarget = await mintKey(
      request,
      admin.session,
      `phase7-revoke-${RUN.slice(-6)}`,
      ["events:read"],
      event.id,
    );
    await page.reload();
    await expect(page.getByTestId("api-keys-page")).toBeVisible({
      timeout: 15_000,
    });
    const revokeBtn = page.getByTestId(`api-key-revoke-${revokeTarget.id}`);
    await expect(revokeBtn).toBeVisible({ timeout: 10_000 });
    await revokeBtn.click();
    await expect(page.getByTestId("api-key-revoke-status")).toContainText(
      /revoked/i,
      { timeout: 10_000 },
    );
    await expect(
      page.getByTestId(`api-key-revoked-${revokeTarget.id}`),
    ).toBeVisible();

    // Revoked key cannot authenticate (401)
    const deniedRevoked = await request.get("/api/keys", {
      headers: { authorization: `Bearer ${revokeTarget.secret}` },
    });
    expect(deniedRevoked.status()).toBe(401);

    // ========== K04: non-admin cannot open keys ==========
    // Clear admin session; log in as speaker in a fresh cookie set
    await context.clearCookies();
    const speaker = await loginAs(
      request,
      context,
      baseURL,
      KEYSTONE_SPEAKER,
      "speaker",
    );
    const speakerKeys = await request.get("/api/keys", {
      headers: { cookie: cookieHeader(speaker.session) },
    });
    expect(speakerKeys.status()).toBe(403);
    const speakerErr = (await speakerKeys.json()) as { code?: string };
    expect(speakerErr.code).toBe("FORBIDDEN");

    await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
    await expect(page.getByTestId("access-denied")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("api-keys-page")).toHaveCount(0);

    // Restore admin for CLI07 + airtable steps
    await context.clearCookies();
    const admin2 = await loginAs(
      request,
      context,
      baseURL,
      `e2e-keystone74-admin2-${RUN}@example.com`,
      "admin",
    );
    // Re-create event under second admin is fine; airtable pause is per-event
    const event2 = await createEvent(
      request,
      admin2.session,
      `Keystone Phase7 Airtable ${RUN}`,
    );

    // ========== CLI07 deny: reports-only key schedule place → exit 2 ==========
    // assert phase7 keystone includes CLI07 deny and airtable pause
    const reportsOnly = await mintKey(
      request,
      admin2.session,
      `phase7-reports-only-${RUN.slice(-6)}`,
      ["reports:read", "events:read"],
      event2.id,
    );

    // Server-side path used by CLI (Bearer → 403 FORBIDDEN)
    const placeHttp = await request.post(
      `/api/events/${encodeURIComponent(event2.id)}/schedule/place`,
      {
        headers: {
          authorization: `Bearer ${reportsOnly.secret}`,
          "content-type": "application/json",
        },
        data: {
          sessionId: "sess_cli07",
          roomId: "room_cli07",
          startsAt: "2030-01-01T10:00:00.000Z",
          endsAt: "2030-01-01T11:00:00.000Z",
        },
      },
    );
    expect(placeHttp.status()).toBe(403);
    const placeBody = (await placeHttp.json()) as { code?: string };
    expect(placeBody.code).toBe("FORBIDDEN");

    // Actual CLI process (S-CLI): exit code 2 = EXIT_AUTHZ
    const cli = runSpeakerops(
      [
        "schedule",
        "place",
        "--event",
        event2.id,
        "--session",
        "sess_cli07",
        "--room",
        "room_cli07",
        "--start",
        "2030-01-01T10:00:00.000Z",
        "--end",
        "2030-01-01T11:00:00.000Z",
        "--json",
      ],
      { apiKey: reportsOnly.secret, apiUrl: API_BASE },
    );
    expect(
      cli.status,
      `CLI07 expected exit 2 (AUTHZ); got ${cli.status}; stderr=${cli.stderr}; stdout=${cli.stdout.slice(0, 200)}`,
    ).toBe(2);
    // JSON error envelope on stdout (code FORBIDDEN) — do not assert secret
    expect(cli.stdout).toMatch(/FORBIDDEN|authz|forbidden/i);

    // ========== Airtable pause: mutation 200 + outbox lag + O06 UI ==========
    // assert phase7 keystone includes CLI07 deny and airtable pause
    // (AIRTABLE_API_KEY unset in e2e-api-server — drain pauses, product OK)

    // Event.Create already enqueued airtable.project; Event.Update still 200
    const patch = await request.patch(
      `/api/events/${encodeURIComponent(event2.id)}`,
      {
        headers: {
          ...sessionHeaders(admin2.session),
          "x-correlation-id": `corr-phase7-pause-${RUN}`,
        },
        data: {
          name: `Updated While Paused ${RUN}`,
          expectedVersion: event2.version,
        },
      },
    );
    expect(patch.status(), await patch.text()).toBe(200);

    // Status API: paused + pending lag (S-AIRTABLE)
    const statusRes = await request.get(
      `/api/events/${encodeURIComponent(event2.id)}/airtable/status`,
      {
        headers: {
          cookie: cookieHeader(admin2.session),
          accept: "application/json",
        },
      },
    );
    expect(statusRes.status()).toBe(200);
    const statusBody = (await statusRes.json()) as {
      eventId: string;
      configured: boolean;
      paused: boolean;
      lag: {
        pendingCount: number;
        oldestPendingAt: string | null;
        maxAttempts: number;
      };
      projectedCount: number;
    };
    expect(statusBody.eventId).toBe(event2.id);
    expect(statusBody.paused).toBe(true);
    expect(statusBody.configured).toBe(false);
    expect(statusBody.lag.pendingCount).toBeGreaterThanOrEqual(1);

    // O06 UI path (documents @inv:O06 — active owner airtable_status.spec.ts)
    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event2.id);
    await page.goto(`${baseURL ?? ""}/admin/settings`);
    await expect(page.getByTestId("page-settings")).toBeVisible({
      timeout: 15_000,
    });
    await selectEventIfPresent(page, event2.id);
    await page.getByTestId("settings-airtable-link").click();
    await expect(page.getByTestId("airtable-status-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("airtable-status-section")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("airtable-status-pending-count")).toBeVisible();
    const pendingText = await page
      .getByTestId("airtable-status-pending-count")
      .innerText();
    expect(Number.parseInt(pendingText, 10)).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("airtable-status-paused")).toContainText(
      /Yes|paused/i,
    );
    await expect(page.getByTestId("airtable-status-configured")).toContainText(
      /No|Yes/,
    );

    // Silence unused first event id (created for initial path stability)
    expect(event.id).toBeTruthy();
  });
});
