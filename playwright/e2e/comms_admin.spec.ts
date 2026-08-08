/**
 * Section 5.3 — Comms admin UI trust-before-send inventory journeys J01–J10.
 *
 * J01 lives in comms_template.spec.ts (5.1); this file owns J02–J10.
 * - @inv:J02 e2e/comms/segment
 * - @inv:J03 e2e/comms/preview
 * - @inv:J04 e2e/comms/send-idempotent
 * - @inv:J05 e2e/comms/log
 * - @inv:J06 e2e/comms/ics
 * - @inv:J07 e2e/comms/authz
 * - @inv:J08 e2e/comms/preview-required
 * - @inv:J09 e2e/comms/preview-invalidate
 * - @inv:J10 e2e/comms/ics-update
 *
 * Named assertions:
 * - assert send button disabled until preview
 * - assert @inv:J01-J10
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
}

async function fetchDevLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<{ token: string; userId: string }> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    link: { token: string; userId?: string } | null;
  };
  expect(body.link?.token).toBeTruthy();
  return { token: body.link!.token, userId: body.link!.userId ?? "" };
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

function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
}

async function loginAs(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
  eventId?: string,
): Promise<string> {
  await requestMagicLink(request, email, purpose, eventId);
  const link = await fetchDevLink(request, email);
  const sessionValue = await exchangeForCookie(request, link.token);
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

async function ensureEvent(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await request.post("/api/events", {
    headers: sessionHeaders(session),
    data: {
      name,
      timezone: "UTC",
      startsAt: "2026-09-01T09:00:00.000Z",
      endsAt: "2026-09-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

/** Seed accepted speakers via Session.CreateDirect for segment/preview. */
async function seedSpeakers(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  speakers: { name: string; email: string }[],
): Promise<void> {
  const res = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/sessions/direct`,
    {
      headers: sessionHeaders(session),
      data: {
        title: `Seed session ${Date.now()}`,
        speakers,
      },
    },
  );
  expect(res.status(), await res.text()).toBe(201);
}

async function openComms(
  page: import("@playwright/test").Page,
  eventId: string,
) {
  await page.addInitScript((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  await page.goto("/admin/comms");
  await expect(page.getByTestId("page-comms")).toBeVisible();
}

async function saveTemplate(
  page: import("@playwright/test").Page,
  key: string,
  subject: string,
  body: string,
) {
  await page.getByTestId("comms-template-key-input").fill(key);
  await page.getByTestId("comms-template-subject-input").fill(subject);
  await page.getByTestId("comms-template-body-input").fill(body);
  await page.getByTestId("comms-template-save").click();
  await expect(page.getByTestId("comms-template-status")).toContainText(
    "saved",
    { ignoreCase: true },
  );
  await expect(page.getByTestId("comms-template-id")).toBeVisible();
}

test.describe("5.3 Comms admin UI J02–J10", () => {
  test("@inv:J02 e2e/comms/segment audience count", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j02-${Date.now()}@example.com`;
    const session = await loginAs(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J02 Segment Event");
    await seedSpeakers(request, session, event.id, [
      { name: "Ada Segment", email: `ada-j02-${Date.now()}@example.com` },
      { name: "Grace Segment", email: `grace-j02-${Date.now()}@example.com` },
    ]);

    await openComms(page, event.id);
    await expect(page.getByTestId("comms-segment-builder")).toBeVisible();
    await expect(page.getByTestId("comms-segment-count")).toBeVisible();
    // Wait for speakers list to load (count ≥ 2 for accepted)
    await expect(page.getByTestId("comms-segment-count")).toHaveAttribute(
      "data-count",
      /[1-9]/,
      { timeout: 15_000 },
    );
    const countText = await page.getByTestId("comms-segment-count").innerText();
    expect(countText).toMatch(/Audience count:\s*[1-9]/);
  });

  test("@inv:J03 e2e/comms/preview all recipients + body", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j03-${Date.now()}@example.com`;
    const session = await loginAs(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J03 Preview Event");
    const speakerEmail = `speaker-j03-${Date.now()}@example.com`;
    await seedSpeakers(request, session, event.id, [
      { name: "Preview Speaker", email: speakerEmail },
    ]);

    await openComms(page, event.id);
    await saveTemplate(
      page,
      "j03-preview",
      "Hello {{name}} — {{eventName}}",
      "Body for {{name}} at {{eventName}}.",
    );

    // assert send button disabled until preview
    await expect(page.getByTestId("comms-send-button")).toBeDisabled();

    await page.getByTestId("comms-preview-run").click();
    await expect(page.getByTestId("comms-preview-results")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-preview-recipients")).toContainText(
      speakerEmail,
    );
    await expect(page.getByTestId("comms-preview-bodies")).toContainText(
      "Preview Speaker",
    );
    await expect(page.getByTestId("comms-send-button")).toBeEnabled();
  });

  test("@inv:J04 e2e/comms/send-idempotent send once; second send same job", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j04-${Date.now()}@example.com`;
    const session = await loginAs(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J04 Idempotent Event");
    await seedSpeakers(request, session, event.id, [
      {
        name: "Idem Speaker",
        email: `idem-j04-${Date.now()}@example.com`,
      },
    ]);

    await openComms(page, event.id);
    await saveTemplate(
      page,
      "j04-idem",
      "Idem {{name}}",
      "Send once {{name}}",
    );
    await page.getByTestId("comms-preview-run").click();
    await expect(page.getByTestId("comms-send-button")).toBeEnabled({
      timeout: 15_000,
    });

    await page.getByTestId("comms-send-button").click();
    await expect(page.getByTestId("comms-send-status")).toContainText(
      /Enqueued|job/i,
      { timeout: 15_000 },
    );
    const jobId1 = await page
      .getByTestId("comms-send-status")
      .getAttribute("data-job-id");
    expect(jobId1).toBeTruthy();

    // Second click reuses same idempotency key → same job
    await page.getByTestId("comms-send-button").click();
    await expect(page.getByTestId("comms-send-status")).toContainText(
      /Idempotent|same job/i,
      { timeout: 15_000 },
    );
    const jobId2 = await page
      .getByTestId("comms-send-status")
      .getAttribute("data-job-id");
    expect(jobId2).toBe(jobId1);
  });

  test("@inv:J05 e2e/comms/log delivery log visible", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j05-${Date.now()}@example.com`;
    const session = await loginAs(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J05 Log Event");
    await seedSpeakers(request, session, event.id, [
      { name: "Log Speaker", email: `log-j05-${Date.now()}@example.com` },
    ]);

    await openComms(page, event.id);
    await saveTemplate(page, "j05-log", "Log {{name}}", "Log body {{name}}");
    await page.getByTestId("comms-preview-run").click();
    await expect(page.getByTestId("comms-send-button")).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByTestId("comms-send-button").click();
    await expect(page.getByTestId("comms-send-status")).toContainText(/job/i, {
      timeout: 15_000,
    });

    await page.getByTestId("comms-log-refresh").click();
    await expect(page.getByTestId("comms-log-table")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-delivery-log")).toContainText(
      /queued|sent|preview/i,
    );
  });

  test("@inv:J06 e2e/comms/ics ICS attach for scheduled session", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j06-${Date.now()}@example.com`;
    const session = await loginAs(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J06 ICS Event");

    await openComms(page, event.id);
    await expect(page.getByTestId("comms-ics-panel")).toBeVisible();
    await page.getByTestId("comms-ics-placement-input").fill("plc_j06_1");
    await page.getByTestId("comms-ics-summary-input").fill("Keynote Slot");
    await page
      .getByTestId("comms-ics-starts-input")
      .fill("2026-09-01T10:00:00.000Z");
    await page
      .getByTestId("comms-ics-ends-input")
      .fill("2026-09-01T11:00:00.000Z");
    await page.getByTestId("comms-ics-generate").click();

    await expect(page.getByTestId("comms-ics-status")).toContainText("UID", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-ics-invite-plc_j06_1")).toBeVisible();
    await expect(page.getByTestId("comms-ics-invite-plc_j06_1")).toHaveAttribute(
      "data-sequence",
      "0",
    );
    await expect(page.getByTestId("comms-ics-body-plc_j06_1")).toContainText(
      "BEGIN:VCALENDAR",
    );
  });

  test("@inv:J07 e2e/comms/authz role without comms:send cannot send", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // Admin creates event + preview job
    const adminEmail = `comms-j07-admin-${Date.now()}@example.com`;
    const adminSession = await loginAs(
      request,
      context,
      baseURL,
      adminEmail,
      "admin",
    );
    const event = await ensureEvent(request, adminSession, "J07 Authz Event");
    await seedSpeakers(request, adminSession, event.id, [
      {
        name: "Authz Speaker",
        email: `authz-j07-${Date.now()}@example.com`,
      },
    ]);

    const tplRes = await request.put(
      `/api/events/${event.id}/templates/j07-authz`,
      {
        headers: sessionHeaders(adminSession),
        data: {
          subject: "Authz {{name}}",
          body: "Body {{name}}",
        },
      },
    );
    expect(tplRes.status()).toBe(201);
    const tpl = (await tplRes.json()) as { template: { id: string } };

    const previewRes = await request.post("/api/comms/preview", {
      headers: sessionHeaders(adminSession),
      data: {
        templateId: tpl.template.id,
        segment: { status: "accepted" },
      },
    });
    expect(previewRes.status()).toBe(200);
    const preview = (await previewRes.json()) as { previewId: string };

    // Evaluator on same event — cannot send (403 or 404 policy)
    await context.clearCookies();
    const evalEmail = `comms-j07-eval-${Date.now()}@example.com`;
    const evalSession = await loginAs(
      request,
      context,
      baseURL,
      evalEmail,
      "evaluator",
      event.id,
    );

    const denied = await request.post("/api/comms/send", {
      headers: sessionHeaders(evalSession),
      data: {
        previewId: preview.previewId,
        idempotencyKey: `j07-denied-${Date.now()}`,
      },
    });
    // Wrong role → 403 (or 404 if membership isolation)
    expect([403, 404]).toContain(denied.status());
    const err = (await denied.json()) as { code?: string };
    expect(err.code).toMatch(/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/);

    // UI: evaluator must not reach admin comms send control (access denied)
    await page.goto("/admin/comms");
    await expect(page.getByTestId("access-denied")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-send-button")).toHaveCount(0);
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  });

  test("@inv:J08 e2e/comms/preview-required send without preview blocked", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j08-${Date.now()}@example.com`;
    const session = await loginAs(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J08 Preview Req Event");
    await seedSpeakers(request, session, event.id, [
      {
        name: "Blocked Speaker",
        email: `block-j08-${Date.now()}@example.com`,
      },
    ]);

    await openComms(page, event.id);
    await saveTemplate(
      page,
      "j08-block",
      "Block {{name}}",
      "No send {{name}}",
    );

    // assert send button disabled until preview
    await expect(page.getByTestId("comms-send-button")).toBeDisabled();
    await expect(page.getByTestId("comms-send-blocked-reason")).toContainText(
      /preview/i,
    );

    // API proof: send without previewId → 400
    const bad = await request.post("/api/comms/send", {
      headers: sessionHeaders(session),
      data: { idempotencyKey: "j08-missing-preview" },
    });
    expect(bad.status()).toBe(400);
  });

  test("@inv:J09 e2e/comms/preview-invalidate edit audience invalidates preview", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j09-${Date.now()}@example.com`;
    const session = await loginAs(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J09 Invalidate Event");
    await seedSpeakers(request, session, event.id, [
      {
        name: "Inv Speaker",
        email: `inv-j09-${Date.now()}@example.com`,
      },
    ]);

    await openComms(page, event.id);
    await saveTemplate(
      page,
      "j09-inv",
      "Inv {{name}}",
      "Invalidate {{name}}",
    );
    await page.getByTestId("comms-preview-run").click();
    await expect(page.getByTestId("comms-send-button")).toBeEnabled({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-preview-results")).toBeVisible();

    // Change audience → preview invalid → send disabled
    await page.getByTestId("comms-segment-status").selectOption("waitlisted");
    await expect(page.getByTestId("comms-send-button")).toBeDisabled();
    await expect(page.getByTestId("comms-preview-results")).toHaveCount(0);
    await expect(page.getByTestId("comms-send-blocked-reason")).toContainText(
      /preview/i,
    );
  });

  test("@inv:J10 e2e/comms/ics-update reschedule keeps UID bumps SEQUENCE", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j10-${Date.now()}@example.com`;
    const session = await loginAs(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J10 ICS Update Event");

    await openComms(page, event.id);
    await page.getByTestId("comms-ics-placement-input").fill("plc_j10_1");
    await page.getByTestId("comms-ics-summary-input").fill("Talk A");
    await page
      .getByTestId("comms-ics-starts-input")
      .fill("2026-09-01T14:00:00.000Z");
    await page
      .getByTestId("comms-ics-ends-input")
      .fill("2026-09-01T14:45:00.000Z");
    await page.getByTestId("comms-ics-generate").click();
    await expect(page.getByTestId("comms-ics-invite-plc_j10_1")).toBeVisible({
      timeout: 15_000,
    });
    const uid1 = await page
      .getByTestId("comms-ics-invite-plc_j10_1")
      .getAttribute("data-uid");
    expect(uid1).toBeTruthy();
    await expect(page.getByTestId("comms-ics-invite-plc_j10_1")).toHaveAttribute(
      "data-sequence",
      "0",
    );

    // Reschedule
    await page
      .getByTestId("comms-ics-starts-input")
      .fill("2026-09-01T15:00:00.000Z");
    await page
      .getByTestId("comms-ics-ends-input")
      .fill("2026-09-01T15:45:00.000Z");
    await page.getByTestId("comms-ics-generate").click();
    await expect(page.getByTestId("comms-ics-status")).toContainText(
      "SEQUENCE 1",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("comms-ics-invite-plc_j10_1")).toHaveAttribute(
      "data-sequence",
      "1",
    );
    const uid2 = await page
      .getByTestId("comms-ics-invite-plc_j10_1")
      .getAttribute("data-uid");
    expect(uid2).toBe(uid1);
    await expect(page.getByTestId("comms-ics-body-plc_j10_1")).toContainText(
      "SEQUENCE:1",
    );
  });
});
