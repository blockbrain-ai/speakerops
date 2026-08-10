/**
 * Full human path: Update profile CTA → fill fields → Save → choose headshot.
 * Catches regressions where Save unmounts the form or Choose file is inert.
 */
import { test, expect, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TURNSTILE = "XXXX.DUMMY.TOKEN";
const MINI_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
  "base64",
);

function guards(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  return {
    assertClean: () =>
      expect(pageErrors, pageErrors.join(" | ")).toEqual([]),
  };
}

async function magic(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
  expect(res.ok()).toBeTruthy();
}

async function token(
  request: import("@playwright/test").APIRequestContext,
  email: string,
) {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  const body = (await res.json()) as { link: { token: string } };
  return body.link.token;
}

async function session(
  request: import("@playwright/test").APIRequestContext,
  tok: string,
) {
  const res = await request.post("/api/auth/exchange", { data: { token: tok } });
  expect(res.status()).toBe(200);
  const m = (res.headers()["set-cookie"] ?? "").match(
    /speakerops_session=([^;]+)/,
  );
  return m![1]!;
}

test("speaker profile: Update profile focuses bio, Save persists, Choose file works", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const g = guards(page);
  const run = Date.now();
  const adminEmail = `e2e-prof-admin-${run}@example.com`;
  const speakerEmail = `e2e-prof-speaker-${run}@example.com`;

  await magic(request, adminEmail, "admin");
  const adminSess = await session(request, await token(request, adminEmail));

  const ev = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${adminSess}`,
      "content-type": "application/json",
    },
    data: {
      name: `Profile Flow ${run}`,
      timezone: "UTC",
      startsAt: "2026-11-01T09:00:00.000Z",
      endsAt: "2026-11-02T17:00:00.000Z",
    },
  });
  expect(ev.status()).toBe(201);
  const { event } = (await ev.json()) as {
    event: { id: string; slug: string };
  };

  await request.post(`/api/events/${event.id}/task-templates`, {
    headers: {
      cookie: `speakerops_session=${adminSess}`,
      "content-type": "application/json",
    },
    data: {
      title: "Upload headshot",
      description: "x",
      trigger: "on_accept",
      dueOffsetDays: 3,
    },
  });

  const form = await request.post(`/api/events/${event.id}/forms`, {
    headers: {
      cookie: `speakerops_session=${adminSess}`,
      "content-type": "application/json",
    },
    data: { name: `CFP ${run}` },
  });
  const formId = ((await form.json()) as { form: { id: string } }).form.id;
  await request.put(`/api/forms/${formId}/draft`, {
    headers: {
      cookie: `speakerops_session=${adminSess}`,
      "content-type": "application/json",
    },
    data: {
      fields: [
        {
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
          required: true,
          sortOrder: 0,
        },
      ],
    },
  });
  const pub = await request.post(`/api/forms/${formId}/publish`, {
    headers: {
      cookie: `speakerops_session=${adminSess}`,
      "content-type": "application/json",
    },
    data: {},
  });
  const formVersionId = (
    (await pub.json()) as { formVersion: { id: string } }
  ).formVersion.id;

  const sub = await request.post(`/api/public/cfp/${event.slug}/submissions`, {
    data: {
      formVersionId,
      title: `Talk ${run}`,
      answers: [{ fieldKey: "abstract", value: "A" }],
      speakers: [{ name: "Prof Speaker", email: speakerEmail }],
      turnstileToken: TURNSTILE,
    },
  });
  expect(sub.status()).toBe(201);
  const subId = ((await sub.json()) as { submission: { id: string } })
    .submission.id;

  const dec = await request.post(`/api/submissions/${subId}/decision`, {
    headers: {
      cookie: `speakerops_session=${adminSess}`,
      "content-type": "application/json",
    },
    data: { decision: "accept" },
  });
  expect(dec.status()).toBe(200);

  await magic(request, speakerEmail, "speaker", event.id);
  const speakerSess = await session(
    request,
    await token(request, speakerEmail),
  );
  await context.addCookies([
    {
      name: "speakerops_session",
      value: speakerSess,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });

  // Update profile CTA → profile + focus bio (not just silent scroll)
  const cta = page.getByTestId("portal-next-profile-cta");
  if (await cta.isVisible().catch(() => false)) {
    await cta.click();
  } else {
    await page.getByTestId("portal-nav-profile").click();
  }
  await expect(page.getByTestId("portal-profile")).toBeVisible();
  await expect(page.getByTestId("portal-bio-input")).toBeFocused({
    timeout: 5_000,
  });

  // Save must stay mounted and show Saved
  await page.getByTestId("portal-bio-input").fill(`Bio complete ${run}`);
  await page.getByTestId("portal-company-input").fill("Acme Co");
  await page.getByTestId("portal-title-input").fill("Engineer");

  const save = page.getByTestId("portal-bio-save");
  await expect(save).toBeEnabled();
  await save.click();

  // Form must still be visible (soft refresh — no full unmount)
  await expect(page.getByTestId("portal-bio-form")).toBeVisible();
  await expect(page.getByTestId("portal-bio-status")).toContainText(/Saved/i, {
    timeout: 15_000,
  });

  // Choose file: button must open filechooser (human path)
  await expect(page.getByTestId("portal-headshot-choose")).toBeEnabled();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("portal-headshot-choose").click();
  const chooser = await chooserPromise;

  const dir = join(tmpdir(), `portal-prof-${run}`);
  mkdirSync(dir, { recursive: true });
  const jpegPath = join(dir, "h.jpg");
  writeFileSync(jpegPath, MINI_JPEG);
  await chooser.setFiles(jpegPath);

  await expect(page.getByTestId("portal-headshot-status")).toContainText(
    /Headshot|uploaded/i,
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("portal-headshot-preview")).toBeVisible({
    timeout: 10_000,
  });

  // Reload: bio still present (durable)
  await page.reload();
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("portal-nav-profile").click();
  await expect(page.getByTestId("portal-bio-input")).toHaveValue(
    new RegExp(`Bio complete ${run}`),
  );

  g.assertClean();
});

test("speaker profile: empty participation shows recovery, not dead form", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 9;
  const email = `e2e-orphan-speaker-${run}@example.com`;
  // Open membership without accept/participation
  await magic(request, email, "speaker");
  const sess = await session(request, await token(request, email));
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sess,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  // Use dogfood event id if present; otherwise create event as admin and only grant speaker membership
  await magic(request, `e2e-orphan-admin-${run}@example.com`, "admin");
  const adminSess = await session(
    request,
    await token(request, `e2e-orphan-admin-${run}@example.com`),
  );
  const ev = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${adminSess}`,
      "content-type": "application/json",
    },
    data: {
      name: `Orphan ${run}`,
      timezone: "UTC",
      startsAt: "2026-12-01T09:00:00.000Z",
      endsAt: "2026-12-02T17:00:00.000Z",
    },
  });
  const eventId = ((await ev.json()) as { event: { id: string } }).event.id;
  // Re-login speaker against that event (membership only, no participation)
  await magic(request, email, "speaker", eventId);
  const sess2 = await session(request, await token(request, email));
  await context.clearCookies();
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sess2,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("portal-nav-profile").click();
  await expect(page.getByTestId("portal-bio-no-participation")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("portal-bio-save")).toBeDisabled();
  await expect(page.getByTestId("portal-headshot-choose")).toBeDisabled();
  await expect(page.getByTestId("portal-bio-input")).toBeDisabled();
});
