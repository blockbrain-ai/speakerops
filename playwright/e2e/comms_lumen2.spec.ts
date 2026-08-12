/**
 * Section 11.2 — Communications campaign workflow + scale (S-L2-COMMS).
 *
 * Named ACs:
 * - AC-11.2-UI    four steps Audience→Message→Review→Send + L2 primitives
 * - AC-11.2-SCALE 150 recipients operable; page ≤25 (no raw checkbox wall)
 * - AC-11.2-SEL   selection stable across filter/page; audience edit invalidates
 * - AC-11.2-SEND  preview required; idempotent send; double-submit guarded
 * - AC-11.2-AUTHZ non-admin cannot send; unauthenticated blocked
 * - AC-11.2-Jxx   J01–J10 remain owned by comms_admin / comms_keystone
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";
import {
  ensureEvent,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
} from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN = `e2e-l2comms-admin-${RUN}@example.com`;
const EVAL = `e2e-l2comms-eval-${RUN}@example.com`;
const TEMPLATE_KEY = `l2comms-${RUN.slice(-6)}`;

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, "admin");
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await seedSessionCookie(context, baseURL, session);
  return { session, userId: link.userId };
}

/** Seed N accepted speakers via Session.CreateDirect (max 20 per call). */
async function seedSpeakerCount(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  count: number,
  emailPrefix: string,
): Promise<void> {
  const batchSize = 20;
  let remaining = count;
  let batch = 0;
  while (remaining > 0) {
    const n = Math.min(batchSize, remaining);
    const speakers = Array.from({ length: n }, (_, i) => {
      const idx = batch * batchSize + i + 1;
      return {
        name: `Scale Speaker ${idx}`,
        email: `${emailPrefix}-${idx}-${RUN}@example.com`,
      };
    });
    const res = await request.post(
      `/api/events/${encodeURIComponent(eventId)}/sessions/direct`,
      {
        headers: sessionHeaders(session),
        data: {
          title: `L2 Comms batch ${batch + 1} ${RUN}`,
          speakers,
        },
      },
    );
    expect(res.status(), await res.text()).toBe(201);
    remaining -= n;
    batch += 1;
  }
}

async function openComms(
  page: import("@playwright/test").Page,
  eventId: string,
  baseURL: string | undefined,
) {
  await page.addInitScript((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  await page.goto(`${baseURL ?? ""}/admin/comms`);
  await expect(page.getByTestId("page-comms")).toBeVisible({ timeout: 15_000 });
}

test.describe("11.2 comms campaign lumen2", () => {
  test("AC-11.2-UI four steps + summary rail", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAsAdmin(request, context, baseURL, ADMIN);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Comms UI ${RUN}`,
      `l2-comms-ui-${RUN}`,
    );
    await seedSpeakerCount(request, admin.session, event.id, 3, "ui");

    await openComms(page, event.id, baseURL);

    await expect(page.getByTestId("page-comms")).toHaveAttribute(
      "data-section",
      "11.2",
    );
    await expect(page.getByTestId("comms-wizard-steps")).toBeVisible();
    await expect(page.getByTestId("comms-step-nav-audience")).toBeVisible();
    await expect(page.getByTestId("comms-step-nav-message")).toBeVisible();
    await expect(page.getByTestId("comms-step-nav-review")).toBeVisible();
    await expect(page.getByTestId("comms-step-nav-send")).toBeVisible();

    // Exclusive wizard: only the active step mounts
    await expect(page.getByTestId("comms-segment-builder")).toHaveAttribute(
      "data-step",
      "audience",
    );
    await expect(page.getByTestId("comms-template-editor")).toHaveCount(0);
    await expect(page.getByTestId("comms-preview-panel")).toHaveCount(0);
    await expect(page.getByTestId("comms-send-panel")).toHaveCount(0);

    // Summary count always visible
    await expect(page.getByTestId("comms-campaign-summary")).toBeVisible();
    await expect(page.getByTestId("comms-summary-count")).toBeVisible();
    await expect(page.getByTestId("comms-segment-count")).toHaveAttribute(
      "data-count",
      /[1-9]/,
      { timeout: 15_000 },
    );

    // Step nav focuses message when audience is valid
    await page.getByTestId("comms-step-nav-message").click();
    await expect(page.getByTestId("comms-step-nav-message")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(page.getByTestId("comms-template-editor")).toBeVisible();
    await expect(page.getByTestId("comms-wizard-next")).toBeVisible();
    await expect(page.getByTestId("comms-wizard-back")).toBeEnabled();
  });

  test("@inv:J15 e2e/comms/wizard-gate exclusive steps + send blocked without preview", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `e2e-l2comms-j15-${RUN}@example.com`;
    const admin = await loginAsAdmin(request, context, baseURL, email);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Comms J15 ${RUN}`,
      `l2-comms-j15-${RUN}`,
    );
    await seedSpeakerCount(request, admin.session, event.id, 2, "j15");
    await openComms(page, event.id, baseURL);

    await expect(page.getByTestId("comms-segment-builder")).toBeVisible();
    await expect(page.getByTestId("comms-send-panel")).toHaveCount(0);
    await expect(page.getByTestId("comms-step-nav-send")).toBeDisabled();

    await expect(page.getByTestId("comms-summary-count")).toHaveAttribute(
      "data-count",
      /[1-9]/,
      { timeout: 15_000 },
    );
    await page.getByTestId("comms-wizard-next").click();
    await expect(page.getByTestId("comms-template-editor")).toBeVisible();
    await page.getByTestId("comms-wizard-next").click();
    await expect(page.getByTestId("comms-preview-panel")).toBeVisible();
    await expect(page.getByTestId("comms-wizard-next")).toBeDisabled();
    await expect(page.getByTestId("comms-step-nav-send")).toBeDisabled();
  });

  test("AC-11.2-SCALE 150 audience without 150-checkbox wall", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `e2e-l2comms-scale-${RUN}@example.com`;
    const admin = await loginAsAdmin(request, context, baseURL, email);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Comms Scale ${RUN}`,
      `l2-comms-scale-${RUN}`,
    );
    await seedSpeakerCount(request, admin.session, event.id, 150, "scale");

    await openComms(page, event.id, baseURL);

    // Wait for speakers to load into count
    await expect(page.getByTestId("comms-segment-count")).toHaveAttribute(
      "data-count",
      "150",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("comms-summary-count")).toHaveAttribute(
      "data-count",
      "150",
    );

    const list = page.getByTestId("comms-segment-speakers");
    await expect(list).toHaveAttribute("data-total", "150");
    await expect(list).toHaveAttribute("data-page-size", "25");

    const visible = Number(await list.getAttribute("data-visible-count"));
    expect(visible).toBeLessThanOrEqual(25);
    expect(visible).toBeGreaterThan(0);

    // DOM checkboxes for segment picks ≤ 25 (no wall of 150)
    const checkboxes = page.locator(
      '[data-testid="comms-segment-speakers"] input[type="checkbox"]',
    );
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toBeLessThanOrEqual(25);
    expect(checkboxCount).toBe(visible);

    // Pager present and advances without growing the wall
    await expect(page.getByTestId("comms-audience-pager")).toBeVisible();
    await page.getByTestId("comms-audience-next").click();
    await expect(page.getByTestId("comms-audience-page-meta")).toHaveAttribute(
      "data-page",
      "2",
    );
    const visibleP2 = Number(await list.getAttribute("data-visible-count"));
    expect(visibleP2).toBeLessThanOrEqual(25);

    // Search narrows list
    await page.getByTestId("comms-audience-search").fill("Scale Speaker 1");
    await expect(list).not.toHaveAttribute("data-total", "150");
    const filteredTotal = Number(await list.getAttribute("data-total"));
    expect(filteredTotal).toBeGreaterThan(0);
    expect(filteredTotal).toBeLessThan(150);
    const filteredVisible = Number(
      await list.getAttribute("data-visible-count"),
    );
    expect(filteredVisible).toBeLessThanOrEqual(25);
  });

  test("AC-11.2-SEL selection stable across page; audience edit invalidates", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `e2e-l2comms-sel-${RUN}@example.com`;
    const admin = await loginAsAdmin(request, context, baseURL, email);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Comms Sel ${RUN}`,
      `l2-comms-sel-${RUN}`,
    );
    await seedSpeakerCount(request, admin.session, event.id, 40, "sel");

    await openComms(page, event.id, baseURL);
    await expect(page.getByTestId("comms-segment-count")).toHaveAttribute(
      "data-count",
      /[1-9]/,
      { timeout: 20_000 },
    );

    // Save template so we can preview (wizard: message step)
    await page.getByTestId("comms-step-nav-message").click();
    await page.getByTestId("comms-template-key-input").fill(TEMPLATE_KEY);
    await page
      .getByTestId("comms-template-subject-input")
      .fill("Hello {{name}} — {{eventName}}");
    await page
      .getByTestId("comms-template-body-input")
      .fill("Hi {{name}}, welcome.");
    await page.getByTestId("comms-template-save").click();
    await expect(page.getByTestId("comms-template-id")).toBeVisible({
      timeout: 15_000,
    });

    // Selection lives on Audience step
    await page.getByTestId("comms-step-nav-audience").click();

    // Select first visible row
    const firstPick = page
      .locator('[data-testid^="comms-segment-pick-"]')
      .first();
    await firstPick.check();
    await expect(page.getByTestId("comms-segment-count")).toHaveAttribute(
      "data-count",
      "1",
    );
    const pickTestId = await firstPick.getAttribute("data-testid");
    expect(pickTestId).toBeTruthy();

    // Page forward — selection count stays 1 (stable across page)
    await page.getByTestId("comms-audience-next").click();
    await expect(page.getByTestId("comms-segment-count")).toHaveAttribute(
      "data-count",
      "1",
    );
    await expect(page.getByTestId("comms-summary-selection-mode")).toBeVisible();

    // Back to page 1 — same checkbox still checked
    await page.getByTestId("comms-audience-prev").click();
    await expect(page.getByTestId(pickTestId!)).toBeChecked();

    // Preview then invalidate by clearing selection (audience edit)
    await page.getByTestId("comms-preview-run").click();
    await expect(page.getByTestId("comms-preview-results")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-send-button")).toBeEnabled();

    await page.getByTestId("comms-segment-clear").click();
    await expect(page.getByTestId("comms-send-button")).toBeDisabled();
    await expect(page.getByTestId("comms-preview-results")).toHaveCount(0);
    await expect(page.getByTestId("comms-send-blocked-reason")).toContainText(
      /preview/i,
    );
  });

  test("AC-11.2-SEND preview required + idempotent send + double-submit guard", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `e2e-l2comms-send-${RUN}@example.com`;
    const admin = await loginAsAdmin(request, context, baseURL, email);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Comms Send ${RUN}`,
      `l2-comms-send-${RUN}`,
    );
    await seedSpeakerCount(request, admin.session, event.id, 2, "send");

    await openComms(page, event.id, baseURL);
    await expect(page.getByTestId("comms-summary-count")).toHaveAttribute(
      "data-count",
      /[1-9]/,
      { timeout: 15_000 },
    );

    await page.getByTestId("comms-step-nav-message").click();
    await page
      .getByTestId("comms-template-key-input")
      .fill(`send-${TEMPLATE_KEY}`);
    await page
      .getByTestId("comms-template-subject-input")
      .fill("Send proof {{name}}");
    await page
      .getByTestId("comms-template-body-input")
      .fill("Body for {{name}}");
    await page.getByTestId("comms-template-save").click();
    await expect(page.getByTestId("comms-template-id")).toBeVisible({
      timeout: 15_000,
    });

    // Preview required (J08 / AC-11.2-SEND) — Send step gated until preview
    await expect(page.getByTestId("comms-step-nav-send")).toBeDisabled();

    await page.getByTestId("comms-step-nav-review").click();
    await page.getByTestId("comms-preview-run").click();
    await expect(page.getByTestId("comms-preview-results")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("comms-step-nav-send").click();
    await expect(page.getByTestId("comms-send-button")).toBeEnabled({
      timeout: 15_000,
    });

    await page.getByTestId("comms-send-button").click();
    await expect(page.getByTestId("comms-send-status")).toContainText(/job/i, {
      timeout: 15_000,
    });
    const firstJobId = await page
      .getByTestId("comms-send-status")
      .getAttribute("data-job-id");
    expect(firstJobId).toBeTruthy();

    // Idempotent second send — same job id
    await page.getByTestId("comms-send-button").click();
    await expect(page.getByTestId("comms-send-status")).toContainText(
      /idempotent|same job|enqueued|job/i,
      { timeout: 15_000 },
    );
    const secondJobId = await page
      .getByTestId("comms-send-status")
      .getAttribute("data-job-id");
    expect(secondJobId).toBe(firstJobId);

    // API unauthenticated send denied
    const unauth = await request.post("/api/comms/send", {
      headers: { "content-type": "application/json" },
      data: {
        previewId: "prv_missing",
        idempotencyKey: `unauth-l2-${RUN}`,
      },
    });
    expect(unauth.status()).toBe(401);
  });

  test("AC-11.2-AUTHZ non-admin cannot send", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `e2e-l2comms-authz-admin-${RUN}@example.com`;
    const admin = await loginAsAdmin(request, context, baseURL, adminEmail);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Comms Authz ${RUN}`,
      `l2-comms-authz-${RUN}`,
    );

    // Create template + preview as admin for a real previewId
    const tplRes = await request.put(
      `/api/events/${event.id}/templates/authz-${TEMPLATE_KEY}`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          subject: "Authz {{name}}",
          body: "Hello {{name}}",
        },
      },
    );
    expect(tplRes.status()).toBe(201);
    const tplBody = (await tplRes.json()) as { template: { id: string } };

    await seedSpeakerCount(request, admin.session, event.id, 1, "authz");

    const previewRes = await request.post("/api/comms/preview", {
      headers: sessionHeaders(admin.session),
      data: {
        templateId: tplBody.template.id,
        segment: { status: "accepted" },
      },
    });
    expect(previewRes.status()).toBe(200);
    const previewBody = (await previewRes.json()) as { previewId: string };

    // Evaluator on same event — cannot send (403/404 policy)
    await context.clearCookies();
    await requestMagicLink(request, EVAL, "evaluator", event.id);
    const evalLink = await fetchDevLink(request, EVAL);
    const evalSession = await exchangeForCookie(request, evalLink.token);
    await seedSessionCookie(context, baseURL, evalSession);

    const denied = await request.post("/api/comms/send", {
      headers: sessionHeaders(evalSession),
      data: {
        previewId: previewBody.previewId,
        idempotencyKey: `eval-deny-${RUN}`,
      },
    });
    expect([403, 404]).toContain(denied.status());
    const err = (await denied.json()) as { code?: string };
    expect(err.code).toMatch(/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/);

    // UI: evaluator must not reach admin comms send control
    await page.goto(`${baseURL ?? ""}/admin/comms`);
    await expect(page.getByTestId("access-denied")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-send-button")).toHaveCount(0);
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  });
});
