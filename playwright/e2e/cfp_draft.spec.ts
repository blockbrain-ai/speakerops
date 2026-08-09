/**
 * Section 10.5 — Public CFP draft save and resume (S-CFP-DRAFT).
 *
 * AC-10.5-A: Save draft with minimal title persists
 * AC-10.5-B: Reload / resume restores fields
 * Closed: draft save control disabled when CFP closed
 *
 * Inventory: @inv:A17
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
    data: { name: "E2E Draft CFP" },
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
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
          required: false,
          sortOrder: 1,
        },
      ],
      rules: [],
      welcomeMd: opts?.welcomeMd ?? "Welcome — draft save e2e",
      thankYouMd: "Thanks",
      opensAt: opts?.opensAt === undefined ? null : opts.opensAt,
      closesAt: opts?.closesAt === undefined ? null : opts.closesAt,
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

test.describe("10.5 public CFP draft save/resume", () => {
  test("@inv:A17 e2e/public/cfp-draft save title-only and resume on reload", async ({
    page,
    request,
  }) => {
    const email = `e2e-draft-${Date.now()}@example.com`;
    const session = await loginAsAdmin(request, email);
    const event = await ensureEvent(
      request,
      session,
      `Draft CFP ${Date.now()}`,
    );
    await publishCfp(request, session, event.id);

    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("page-public-cfp")).toBeVisible();
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    await expect(page.getByTestId("cfp-draft-save")).toBeVisible();
    await expect(page.getByTestId("cfp-draft-save")).toBeEnabled();

    const draftTitle = `E2E Draft Title ${Date.now()}`;
    await page.getByTestId("cfp-title").fill(draftTitle);
    // Optional field — proves snapshot restores more than title
    await page.getByTestId("cfp-field-abstract").fill("Partial abstract draft");

    const [saveRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/public/cfp/${event.slug}/drafts`) &&
          r.request().method() === "POST",
      ),
      page.getByTestId("cfp-draft-save").click(),
    ]);
    expect(saveRes.status(), "draft save HTTP").toBe(201);
    const saveBody = (await saveRes.json()) as {
      submission: { id: string; status: string; title: string };
      snapshot: { title: string };
    };
    expect(saveBody.submission.status).toBe("draft");
    expect(saveBody.submission.title).toBe(draftTitle);
    expect(saveBody.snapshot.title).toBe(draftTitle);

    await expect(page.getByTestId("cfp-draft-confirmation")).toBeVisible();
    await expect(page.getByTestId("cfp-draft-confirmation-title")).toHaveText(
      draftTitle,
    );
    await expect(page.getByTestId("cfp-draft-id")).toContainText(
      saveBody.submission.id,
    );

    // Reload — resume from localStorage / ?draft=
    await page.reload();
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    await expect(page.getByTestId("cfp-title")).toHaveValue(draftTitle, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("cfp-field-abstract")).toHaveValue(
      "Partial abstract draft",
    );
    await expect(page.getByTestId("cfp-draft-confirmation")).toBeVisible();
  });

  // Closed-window negative for A17 (primary @inv:A17 on save/resume test above).
  test("e2e/public/cfp-draft closed disables draft save", async ({
    page,
    request,
  }) => {
    const email = `e2e-draft-closed-${Date.now()}@example.com`;
    const session = await loginAsAdmin(request, email);
    const event = await ensureEvent(
      request,
      session,
      `Closed Draft CFP ${Date.now()}`,
    );
    await publishCfp(request, session, event.id, {
      closesAt: "2020-01-01T00:00:00.000Z",
    });

    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("page-public-cfp")).toBeVisible();
    await expect(page.getByTestId("public-cfp-closed")).toBeVisible();
    await expect(page.getByTestId("cfp-draft-save")).toBeVisible();
    await expect(page.getByTestId("cfp-draft-save")).toBeDisabled();

    // API must-not: closed rejects draft POST
    const formRes = await request.get(`/api/public/cfp/${event.slug}`);
    expect(formRes.ok()).toBeTruthy();
    const formBody = (await formRes.json()) as {
      formVersion: { id: string } | null;
      windowState: string;
    };
    expect(formBody.windowState).toBe("closed");
    expect(formBody.formVersion?.id).toBeTruthy();

    const draftRes = await request.post(
      `/api/public/cfp/${event.slug}/drafts`,
      {
        data: {
          formVersionId: formBody.formVersion!.id,
          title: "Should Fail Closed",
        },
      },
    );
    expect(draftRes.status()).toBe(400);
  });
});
