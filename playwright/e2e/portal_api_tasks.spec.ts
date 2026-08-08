/**
 * Section 4.1 — Portal API tasks inventory journeys.
 *
 * - @inv:O05 e2e/settings/task-templates
 * - @inv:N01 e2e/admin/speakers-list
 * - @inv:N02 e2e/admin/speakers-filter
 * - @inv:N03 e2e/admin/speakers-detail
 * - @inv:N04 e2e/admin/speakers-files
 *
 * Named assertions (API + UI):
 * - assert templates CRUD admin only (API also in portal.test.ts)
 * - assert speakers list scoped by eventId
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

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

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<string> {
  await requestMagicLink(request, email, "admin");
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

async function acceptSpeaker(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  speakerEmail: string,
  speakerName: string,
  title: string,
): Promise<{ participationId: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: `CFP ${title}` },
  });
  expect(create.status()).toBe(201);
  const form = (await create.json()) as { form: { id: string } };

  const draft = await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(session),
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
      rules: [],
    },
  });
  expect(draft.status()).toBe(200);

  const publish = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(session),
    data: {},
  });
  expect(publish.status()).toBe(200);
  const pub = (await publish.json()) as {
    formVersion: { id: string };
  };

  const submit = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: pub.formVersion.id,
      title,
      speakers: [
        { name: speakerName, email: speakerEmail, isPrimary: true },
      ],
      answers: [{ fieldKey: "abstract", value: "E2E abstract" }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  });
  expect(submit.status()).toBe(201);
  const sub = (await submit.json()) as { submission: { id: string } };

  const decision = await request.post(
    `/api/submissions/${sub.submission.id}/decision`,
    {
      headers: sessionHeaders(session),
      data: { decision: "accept" },
    },
  );
  expect(decision.status()).toBe(200);
  const body = (await decision.json()) as {
    participations: Array<{ id: string }>;
  };
  expect(body.participations.length).toBeGreaterThanOrEqual(1);
  return { participationId: body.participations[0]!.id };
}

async function waitForEventSelect(page: import("@playwright/test").Page) {
  const switcher = page.getByTestId("event-context");
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () => {
        const tag = await switcher.evaluate((el) => el.tagName.toLowerCase());
        return tag;
      },
      { timeout: 15_000 },
    )
    .toBe("select");
  return switcher;
}

test("@inv:O05 e2e/settings/task-templates Task templates CRUD on accept", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-o05-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(
    request,
    session,
    `O05 Templates Event ${run}`,
  );

  // Speaker cannot CRUD (API proof)
  await requestMagicLink(
    request,
    `e2e-o05-speaker-${run}@example.com`,
    "speaker",
    event.id,
  );
  const speakerLink = await fetchDevLink(
    request,
    `e2e-o05-speaker-${run}@example.com`,
  );
  const speakerSession = await exchangeForCookie(request, speakerLink.token);
  const speakerCreate = await request.post(
    `/api/events/${event.id}/task-templates`,
    {
      headers: sessionHeaders(speakerSession),
      data: { title: "Forbidden", trigger: "on_accept" },
    },
  );
  expect(speakerCreate.status()).toBe(403);

  await page.goto(`${baseURL ?? ""}/admin/settings/task-templates`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });

  await expect(page.getByTestId("page-task-templates")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("task-templates-form")).toBeVisible();

  const title = `E2E Headshot ${run}`;
  await page.getByTestId("task-template-title-input").fill(title);
  await page
    .getByTestId("task-template-description-input")
    .fill("Upload headshot for programme");
  await page.getByTestId("task-template-trigger-input").selectOption("on_accept");
  await page.getByTestId("task-template-due-input").fill("14");
  await page.getByTestId("task-template-create").click();

  await expect(page.getByTestId("task-templates-status")).toContainText(
    "created",
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("task-templates-list")).toContainText(title);

  // API list confirms
  const list = await request.get(`/api/events/${event.id}/task-templates`, {
    headers: { cookie: `speakerops_session=${session}` },
  });
  expect(list.status()).toBe(200);
  const listBody = (await list.json()) as {
    templates: Array<{ id: string; title: string }>;
  };
  const tpl = listBody.templates.find((t) => t.title === title);
  expect(tpl).toBeTruthy();
});

test("@inv:N01 e2e/admin/speakers-list List speakers for event", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-n01-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `N01 Speakers ${run}`);
  await acceptSpeaker(
    request,
    session,
    event.id,
    event.slug,
    `n01-spk-${run}@example.com`,
    "N01 Speaker",
    `N01 Talk ${run}`,
  );

  // API scoped list
  const api = await request.get(`/api/events/${event.id}/speakers`, {
    headers: { cookie: `speakerops_session=${session}` },
  });
  expect(api.status()).toBe(200);
  const body = (await api.json()) as {
    eventId: string;
    speakers: Array<{ participation: { personName: string | null } }>;
  };
  expect(body.eventId).toBe(event.id);
  expect(body.speakers.length).toBe(1);
  expect(body.speakers[0]!.participation.personName).toBe("N01 Speaker");

  await page.goto(`${baseURL ?? ""}/admin/speakers`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });
  await expect(page.getByTestId("page-speakers")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("speakers-list")).toContainText("N01 Speaker", {
    timeout: 10_000,
  });
});

test("@inv:N02 e2e/admin/speakers-filter Search/filter speakers", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-n02-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `N02 Filter ${run}`);
  await acceptSpeaker(
    request,
    session,
    event.id,
    event.slug,
    `n02-alice-${run}@example.com`,
    "Alice Filter",
    `N02 Talk A ${run}`,
  );

  await page.goto(`${baseURL ?? ""}/admin/speakers`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });
  await expect(page.getByTestId("speakers-list")).toContainText("Alice Filter", {
    timeout: 10_000,
  });

  await page.getByTestId("speakers-search").fill("Alice");
  await expect(page.getByTestId("speakers-list")).toContainText("Alice Filter");

  await page.getByTestId("speakers-search").fill("zzz-nomatch");
  await expect(page.getByTestId("speakers-empty")).toBeVisible({
    timeout: 10_000,
  });
});

test("@inv:N03 e2e/admin/speakers-detail Detail: tasks + files", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-n03-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(request, session, `N03 Detail ${run}`);
  const { participationId } = await acceptSpeaker(
    request,
    session,
    event.id,
    event.slug,
    `n03-spk-${run}@example.com`,
    "Detail Speaker",
    `N03 Talk ${run}`,
  );

  const detailApi = await request.get(
    `/api/events/${event.id}/speakers/${participationId}`,
    { headers: { cookie: `speakerops_session=${session}` } },
  );
  expect(detailApi.status()).toBe(200);
  const detail = (await detailApi.json()) as {
    tasks: unknown[];
    files: unknown[];
  };
  expect(detail.tasks.length).toBeGreaterThanOrEqual(1);

  await page.goto(`${baseURL ?? ""}/admin/speakers`);
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption({ value: event.id });
  await page.getByTestId(`speaker-open-${participationId}`).click();
  await expect(page.getByTestId("speakers-detail")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("speakers-detail-tasks")).toBeVisible();
  await expect(page.getByTestId("speakers-detail-files")).toBeVisible();
});

test("@inv:N04 e2e/admin/speakers-files Open headshot/slides metadata; no cross-speaker leak", async ({
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const adminEmail = `e2e-n04-admin-${run}@example.com`;
  const session = await loginAsAdmin(request, context, baseURL, adminEmail);
  const eventA = await ensureEvent(request, session, `N04 Event A ${run}`);
  const eventB = await ensureEvent(request, session, `N04 Event B ${run}`);

  const speakerAEmail = `n04-a-${run}@example.com`;
  const speakerA2Email = `n04-a2-${run}@example.com`;
  const a = await acceptSpeaker(
    request,
    session,
    eventA.id,
    eventA.slug,
    speakerAEmail,
    "Speaker A",
    `N04 Talk A ${run}`,
  );
  const a2 = await acceptSpeaker(
    request,
    session,
    eventA.id,
    eventA.slug,
    speakerA2Email,
    "Speaker A2",
    `N04 Talk A2 ${run}`,
  );
  await acceptSpeaker(
    request,
    session,
    eventB.id,
    eventB.slug,
    `n04-b-${run}@example.com`,
    "Speaker B",
    `N04 Talk B ${run}`,
  );

  // Upload headshot + slides for speaker A (admin path; ownership bound to participation)
  const miniJpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
  const miniPdf = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xc7, 0xec,
  ]);

  async function uploadPortalFile(
    purpose: "headshot" | "slides",
    participationId: string,
    mime: string,
    bytes: Uint8Array,
    filename: string,
  ): Promise<string> {
    const presign = await request.post("/api/files/presign", {
      headers: sessionHeaders(session),
      data: {
        eventId: eventA.id,
        purpose,
        mime,
        size: bytes.byteLength,
        filename,
        ownerParticipationId: participationId,
      },
    });
    expect(presign.status(), `presign ${purpose}`).toBe(200);
    const p = (await presign.json()) as { fileId: string; url: string };

    const upload = await request.put(p.url, {
      headers: {
        cookie: `speakerops_session=${session}`,
        "content-type": mime,
      },
      data: bytes,
    });
    expect(upload.status(), `upload ${purpose}`).toBe(200);

    const complete = await request.post(`/api/files/${p.fileId}/complete`, {
      headers: sessionHeaders(session),
      data: {
        eventId: eventA.id,
        checksum: `sha256:n04-${purpose}-${run}`,
        filename,
      },
    });
    expect(complete.status(), `complete ${purpose}`).toBe(200);
    return p.fileId;
  }

  const headshotId = await uploadPortalFile(
    "headshot",
    a.participationId,
    "image/jpeg",
    miniJpeg,
    "a-headshot.jpg",
  );
  const slidesId = await uploadPortalFile(
    "slides",
    a.participationId,
    "application/pdf",
    miniPdf,
    "a-slides.pdf",
  );
  // Other speaker in same event gets their own headshot (must not leak into A's detail)
  await uploadPortalFile(
    "headshot",
    a2.participationId,
    "image/jpeg",
    miniJpeg,
    "a2-headshot.jpg",
  );

  // Bind headshot on profile (speaker session) so headshotFileId path is also covered
  await requestMagicLink(request, speakerAEmail, "speaker", eventA.id);
  const spLink = await fetchDevLink(request, speakerAEmail);
  const spSession = await exchangeForCookie(request, spLink.token);
  const home = await request.get(
    `/api/portal/home?eventId=${encodeURIComponent(eventA.id)}`,
    { headers: { cookie: `speakerops_session=${spSession}` } },
  );
  expect(home.status()).toBe(200);
  const homeBody = (await home.json()) as {
    participations: Array<{ id: string; version: number }>;
  };
  const part = homeBody.participations.find((p) => p.id === a.participationId);
  expect(part).toBeTruthy();
  const patch = await request.patch(
    `/api/portal/participations/${a.participationId}`,
    {
      headers: sessionHeaders(spSession),
      data: {
        headshotFileId: headshotId,
        expectedVersion: part!.version,
      },
    },
  );
  expect(patch.status()).toBe(200);

  // Speakers.Get for A exposes headshot + slides metadata only for A
  const ok = await request.get(
    `/api/events/${eventA.id}/speakers/${a.participationId}`,
    { headers: { cookie: `speakerops_session=${session}` } },
  );
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as {
    participation: { eventId: string; headshotFileId: string | null };
    files: Array<{
      id: string;
      eventId: string;
      ownerParticipationId: string | null;
      purpose: string;
      uploaded: number;
    }>;
  };
  expect(body.participation.eventId).toBe(eventA.id);
  expect(body.participation.headshotFileId).toBe(headshotId);
  expect(body.files.length).toBeGreaterThanOrEqual(2);
  const fileIds = body.files.map((f) => f.id);
  expect(fileIds).toContain(headshotId);
  expect(fileIds).toContain(slidesId);
  for (const f of body.files) {
    expect(f.eventId).toBe(eventA.id);
    expect(f.ownerParticipationId).toBe(a.participationId);
    expect(f.uploaded).toBe(1);
  }
  // Same-event cross-speaker leakage blocked
  expect(fileIds).not.toContainEqual(
    body.files.find((f) => f.ownerParticipationId === a2.participationId)?.id,
  );
  const purposes = new Set(body.files.map((f) => f.purpose));
  expect(purposes.has("headshot")).toBeTruthy();
  expect(purposes.has("slides")).toBeTruthy();

  // A2 detail must not include A's files
  const a2Detail = await request.get(
    `/api/events/${eventA.id}/speakers/${a2.participationId}`,
    { headers: { cookie: `speakerops_session=${session}` } },
  );
  expect(a2Detail.status()).toBe(200);
  const a2Body = (await a2Detail.json()) as {
    files: Array<{ id: string; ownerParticipationId: string | null }>;
  };
  expect(a2Body.files.map((f) => f.id)).not.toContain(headshotId);
  expect(a2Body.files.map((f) => f.id)).not.toContain(slidesId);
  for (const f of a2Body.files) {
    expect(f.ownerParticipationId).toBe(a2.participationId);
  }

  // Cross-event leak blocked
  const leak = await request.get(
    `/api/events/${eventB.id}/speakers/${a.participationId}`,
    { headers: { cookie: `speakerops_session=${session}` } },
  );
  expect(leak.status()).toBe(404);
});
