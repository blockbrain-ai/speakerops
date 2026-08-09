/**
 * Section 10.3 — Public CFP DEMO captcha + closed window proof.
 *
 * AC-10.3-A: DEMO_MODE path — valid submit succeeds (test site key + DEV_PASS)
 * AC-10.3-B: Closed window — public-cfp-closed + POST 4xx
 *
 * Does **not** re-own inventory @inv:A06 / @inv:A07 (those stay in
 * public_cfp.spec.ts). This file is the named DEMO/closed keystone proof
 * for S-CFP-SUBMIT / S-CFP-CLOSED (see livability matrix).
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
) {
  const res = await request.post("/api/auth/magic-link", {
    data: { email, purpose: "admin" },
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
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { link: { token: string } | null };
  expect(body.link?.token).toBeTruthy();
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

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  await requestMagicLink(request, email);
  const token = await fetchDevToken(request, email);
  return exchangeForCookie(request, token);
}

function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
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
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

async function publishCfp(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  opts?: {
    closesAt?: string | null;
    opensAt?: string | null;
    welcomeMd?: string;
  },
): Promise<{ formVersionId: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: "DEMO CFP 10.3" },
  });
  expect(create.status()).toBe(201);
  const created = (await create.json()) as { form: { id: string } };

  const draft = await request.put(`/api/forms/${created.form.id}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "talk_title",
          type: "text",
          label: "Talk title",
          required: true,
          sortOrder: 0,
        },
        {
          fieldKey: "category",
          type: "select",
          label: "Category",
          required: true,
          sortOrder: 1,
          options: [
            { value: "ai", label: "AI" },
            { value: "ops", label: "Ops" },
          ],
        },
      ],
      rules: [],
      welcomeMd: opts?.welcomeMd ?? "Welcome to DEMO CFP",
      thankYouMd: "Thanks for submitting under DEMO_MODE",
      opensAt: opts?.opensAt ?? null,
      closesAt: opts?.closesAt ?? null,
    },
  });
  expect(draft.status()).toBe(200);

  const pub = await request.post(`/api/forms/${created.form.id}/publish`, {
    headers: sessionHeaders(session),
  });
  expect(pub.status()).toBe(200);
  const published = (await pub.json()) as {
    formVersion: { id: string };
  };
  return { formVersionId: published.formVersion.id };
}

async function fillHappyPath(page: import("@playwright/test").Page) {
  await page.getByTestId("cfp-title").fill("DEMO Mode Proposal");
  await page.getByTestId("cfp-field-talk_title").fill("DEMO Mode Proposal");
  await page.getByTestId("cfp-field-category").selectOption("ai");
  await page.getByTestId("cfp-speaker-name-0").fill("Demo Speaker");
  await page.getByTestId("cfp-speaker-email-0").fill("demo-speaker@example.com");
  // DEMO / test Turnstile control (DEMO_MODE forces test site key)
  await page.getByTestId("cfp-turnstile-check").check();
}

test.describe("10.3 Public CFP DEMO captcha + closed window", () => {
  test("AC-10.3-A DEMO_MODE submit succeeds without captcha dead-end", async ({
    page,
    request,
    baseURL,
  }) => {
    const session = await loginAsAdmin(request, "e2e-10-3-a@example.com");
    const event = await ensureEvent(request, session, "10.3 DEMO Submit Event");
    await publishCfp(request, session, event.id);

    // Public form exposes test site key under DEMO_MODE
    const pub = await request.get(`/api/public/cfp/${event.slug}`);
    expect(pub.status()).toBe(200);
    const pubBody = (await pub.json()) as {
      windowState: string;
      turnstileSiteKey: string;
    };
    expect(pubBody.windowState).toBe("open");
    // Cloudflare always-pass test site key
    expect(pubBody.turnstileSiteKey).toBe("1x00000000000000000000AA");

    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("cfp-turnstile")).toHaveAttribute(
      "data-turnstile-mode",
      "test",
    );

    await fillHappyPath(page);
    await page.getByTestId("public-cfp-primary").click();
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("public-cfp-thankyou")).toContainText(
      /Thanks|Thank you|DEMO/i,
    );
  });

  test("AC-10.3-B closed window: public-cfp-closed + POST 4xx", async ({
    page,
    request,
    baseURL,
  }) => {
    const session = await loginAsAdmin(request, "e2e-10-3-b@example.com");
    const event = await ensureEvent(request, session, "10.3 Closed CFP Event");
    const { formVersionId } = await publishCfp(request, session, event.id, {
      closesAt: "2020-01-01T00:00:00.000Z",
    });

    // UI closed banner (S-CFP-CLOSED)
    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-closed")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("public-cfp-closed")).toContainText(
      /closed/i,
    );
    await expect(page.getByTestId("public-cfp-form")).toHaveCount(0);
    await expect(page.getByTestId("public-cfp-primary")).toBeDisabled();

    // API reject (must-not: closed CFP accepts new submit)
    const submit = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "e2e-10-3-closed",
        },
        data: {
          formVersionId,
          title: "Should be rejected",
          speakers: [
            { name: "Closed Out", email: "closed-out@example.com" },
          ],
          answers: [
            { fieldKey: "talk_title", value: "Should be rejected" },
            { fieldKey: "category", value: "ai" },
          ],
          turnstileToken: "XXXX.DUMMY.TOKEN",
        },
      },
    );
    expect(submit.status()).toBeGreaterThanOrEqual(400);
    expect(submit.status()).toBeLessThan(500);
    const err = (await submit.json()) as {
      error?: string;
      code?: string;
      details?: { windowState?: string };
    };
    expect(err.error?.toLowerCase() ?? "").toMatch(/closed/);
    if (err.details?.windowState) {
      expect(err.details.windowState).toBe("closed");
    }
  });
});
