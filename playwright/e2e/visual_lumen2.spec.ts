/**
 * Section 11.8 — Visual regression suite + taste score gates (S-L2-SCORE).
 *
 * Nine fixed-viewport artifact classes (SPEAKEROPS_DESIGN_AUDIT Phase 5):
 *  1. Lumen component state sheet
 *  2. Admin overview
 *  3. CFP builder
 *  4. Public CFP (desktop + mobile)
 *  5. Submissions selected / bulk-action state
 *  6. Schedule conflict state
 *  7. Communications audience
 *  8. Speaker portal (desktop + mobile)
 *  9. Loading / empty / error / session-expired states
 *
 * Named ACs:
 * - AC-11.8-SUITE  nine artifact classes written under docs/audits/visual-lumen2/
 * - AC-11.8-VIEWPORT fixed desktop 1440×1000 (+ mobile 390×844 where required)
 * - AC-11.8-AUTHZ  unauthenticated cannot read privileged admin surfaces
 * - AC-11.8-SCORE  paired with docs/audits/LUMEN2_TASTE_SCORE.md (governance gate)
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e / pnpm test:e2e:visual).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
  selectAdminEvent,
} from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN = `e2e-l2visual-admin-${RUN}@example.com`;
const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "docs", "audits", "visual-lumen2");

/** Nine artifact classes (filename stem → human label). */
const ARTIFACTS = {
  "01-state-sheet": "Lumen component state sheet",
  "02-overview": "Admin overview",
  "03-cfp-builder": "CFP builder",
  "04-public-cfp-desktop": "Public CFP desktop",
  "04-public-cfp-mobile": "Public CFP mobile",
  "05-submissions-bulk": "Submissions bulk selection",
  "06-schedule-conflict": "Schedule conflict",
  "07-comms-audience": "Communications audience",
  "08-portal-desktop": "Speaker portal desktop",
  "08-portal-mobile": "Speaker portal mobile",
  "09-error-states": "Loading/empty/error/session-expired states",
} as const;

type ArtifactKey = keyof typeof ARTIFACTS;

const EVENT_START = "2026-09-01T09:00:00.000Z";
const EVENT_END = "2026-09-02T17:00:00.000Z";
const SLOT_10 = "2026-09-01T10:00:00.000Z";
const SLOT_11 = "2026-09-01T11:00:00.000Z";
const ROOM_A = "room_hall_a";
const ROOM_B = "room_hall_b";

function artifactPath(key: ArtifactKey): string {
  return join(OUT_DIR, `${key}.png`);
}

async function capture(
  page: Page,
  key: ArtifactKey,
  fullPage = false,
): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = artifactPath(key);
  await page.screenshot({ path, fullPage, animations: "disabled" });
  const st = statSync(path);
  expect(
    st.size,
    `artifact ${key} (${ARTIFACTS[key]}) must be non-empty PNG`,
  ).toBeGreaterThan(2_000);
}

async function loginAsAdmin(
  request: APIRequestContext,
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

async function loginAsSpeaker(
  request: APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  eventId: string,
): Promise<void> {
  await requestMagicLink(request, email, "speaker", eventId);
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await context.clearCookies();
  await seedSessionCookie(context, baseURL, session);
}

async function publishMinimalCfp(
  request: APIRequestContext,
  session: string,
  eventId: string,
): Promise<{ formVersionId: string }> {
  const createRes = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/forms`,
    {
      headers: sessionHeaders(session),
      data: { name: `L2 Visual CFP ${RUN}` },
    },
  );
  expect(createRes.status(), await createRes.text()).toBe(201);
  const created = (await createRes.json()) as { form: { id: string } };
  const formId = created.form.id;

  const draftRes = await request.put(
    `/api/forms/${encodeURIComponent(formId)}/draft`,
    {
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
        welcomeMd: "Welcome to the Lumen 2 visual suite CFP",
        thankYouMd: "Thanks for submitting.",
        opensAt: "2020-01-01T00:00:00.000Z",
        closesAt: "2099-12-31T23:59:59.000Z",
      },
    },
  );
  expect(draftRes.status(), await draftRes.text()).toBe(200);

  const pubRes = await request.post(
    `/api/forms/${encodeURIComponent(formId)}/publish`,
    {
      headers: sessionHeaders(session),
      data: {},
    },
  );
  expect(pubRes.status(), await pubRes.text()).toBe(200);
  const published = (await pubRes.json()) as {
    formVersion: { id: string };
  };
  return { formVersionId: published.formVersion.id };
}

async function seedSubmissions(
  request: APIRequestContext,
  slug: string,
  formVersionId: string,
  titles: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i]!;
    const res = await request.post(`/api/public/cfp/${slug}/submissions`, {
      data: {
        formVersionId,
        title,
        answers: [{ fieldKey: "abstract", value: `Abstract for ${title}` }],
        speakers: [
          {
            name: `Visual Speaker ${i + 1}`,
            email: `l2vis-sp-${i}-${RUN}@example.com`,
            isPrimary: true,
          },
        ],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { submission: { id: string } };
    ids.push(body.submission.id);
  }
  return ids;
}

async function seedSpeakers(
  request: APIRequestContext,
  session: string,
  eventId: string,
  count: number,
): Promise<void> {
  const batchSize = 20;
  let remaining = count;
  let batch = 0;
  while (remaining > 0) {
    const n = Math.min(batchSize, remaining);
    const speakers = Array.from({ length: n }, (_, i) => {
      const idx = batch * batchSize + i + 1;
      return {
        name: `Vis Audience ${idx}`,
        email: `l2vis-aud-${idx}-${RUN}@example.com`,
      };
    });
    const res = await request.post(
      `/api/events/${encodeURIComponent(eventId)}/sessions/direct`,
      {
        headers: sessionHeaders(session),
        data: {
          title: `Visual comms batch ${batch + 1} ${RUN}`,
          speakers,
        },
      },
    );
    expect(res.status(), await res.text()).toBe(201);
    remaining -= n;
    batch += 1;
  }
}

async function upsertRoom(
  request: APIRequestContext,
  session: string,
  eventId: string,
  roomId: string,
  name: string,
) {
  const res = await request.put(
    `/api/events/${encodeURIComponent(eventId)}/rooms/${encodeURIComponent(roomId)}`,
    {
      headers: sessionHeaders(session),
      data: { name, capacity: 80 },
    },
  );
  expect(res.status(), await res.text()).toBe(200);
}

async function createSession(
  request: APIRequestContext,
  session: string,
  eventId: string,
  title: string,
  speakers: { name: string; email: string }[],
): Promise<string> {
  const res = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/sessions/direct`,
    {
      headers: sessionHeaders(session),
      data: { title, speakers },
    },
  );
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { session: { id: string } };
  return body.session.id;
}

async function placeViaApi(
  request: APIRequestContext,
  session: string,
  eventId: string,
  sessionId: string,
  roomId: string,
  startsAt: string,
  endsAt: string,
) {
  const res = await request.post(
    `/api/events/${encodeURIComponent(eventId)}/schedule/place`,
    {
      headers: sessionHeaders(session),
      data: { sessionId, roomId, startsAt, endsAt },
    },
  );
  expect(res.status(), await res.text()).toBe(201);
}

async function seedTaskTemplate(
  request: APIRequestContext,
  session: string,
  eventId: string,
) {
  const res = await request.post(`/api/events/${eventId}/task-templates`, {
    headers: sessionHeaders(session),
    data: {
      title: `Upload headshot ${RUN}`,
      description: "Visual suite portal task",
      trigger: "on_accept",
      dueOffsetDays: 14,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function acceptSpeakerForPortal(
  request: APIRequestContext,
  session: string,
  slug: string,
  formVersionId: string,
  speakerEmail: string,
  speakerName: string,
  title: string,
) {
  const submit = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId,
      title,
      speakers: [{ name: speakerName, email: speakerEmail, isPrimary: true }],
      answers: [{ fieldKey: "abstract", value: "Visual portal abstract" }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  });
  expect(submit.status(), await submit.text()).toBe(201);
  const sub = (await submit.json()) as { submission: { id: string } };

  const decision = await request.post(
    `/api/submissions/${sub.submission.id}/decision`,
    {
      headers: sessionHeaders(session),
      data: { decision: "accept" },
    },
  );
  expect(decision.status(), await decision.text()).toBe(200);
}

test.describe("11.8 visual lumen2 suite", () => {
  test("AC-11.8-SUITE nine artifact classes captured at fixed viewport", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    mkdirSync(OUT_DIR, { recursive: true });

    const admin = await loginAsAdmin(request, context, baseURL, ADMIN);

    // Event with fixed dates for schedule + CFP + portal
    const createRes = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `L2 Visual Suite ${RUN}`,
        slug: `l2-visual-${RUN}`,
        timezone: "America/New_York",
        startsAt: EVENT_START,
        endsAt: EVENT_END,
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = (await createRes.json()) as {
      event: { id: string; slug: string };
    };
    const event = { id: created.event.id, slug: created.event.slug };

    const { formVersionId } = await publishMinimalCfp(
      request,
      admin.session,
      event.id,
    );
    const [subA, subB] = await seedSubmissions(
      request,
      event.slug,
      formVersionId,
      [`Visual Talk A ${RUN}`, `Visual Talk B ${RUN}`],
    );
    await seedSpeakers(request, admin.session, event.id, 30);
    await seedTaskTemplate(request, admin.session, event.id);

    // ---------- 1. State sheet ----------
    await page.setViewportSize(DESKTOP);
    await page.goto("/admin/settings/l2-state-sheet", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("l2-state-sheet")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("l2-sheet-buttons")).toBeVisible();
    await capture(page, "01-state-sheet", true);

    // ---------- 2. Overview ----------
    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto(`${baseURL ?? ""}/admin`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("page-readiness")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("overview-metrics")).toBeVisible({
      timeout: 15_000,
    });
    await capture(page, "02-overview");

    // ---------- 3. CFP builder ----------
    await selectAdminEvent(page, baseURL, event.id, "/admin/cfp");
    await expect(page.getByTestId("page-cfp")).toBeVisible({
      timeout: 15_000,
    });
    // Create a form so workspace regions are visible
    await page.getByTestId("form-create-name").fill(`Visual Builder ${RUN}`);
    await page.getByTestId("form-create-submit").click();
    await expect(page.getByTestId("form-builder-workspace")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("builder-outline")).toBeVisible();
    await expect(page.getByTestId("builder-canvas")).toBeVisible();
    await capture(page, "03-cfp-builder");

    // ---------- 4. Public CFP desktop + mobile ----------
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("page-public-cfp")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("public-cfp-intro")).toBeVisible();
    await capture(page, "04-public-cfp-desktop", true);

    await page.setViewportSize(MOBILE);
    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("page-public-cfp")).toBeVisible({
      timeout: 15_000,
    });
    await capture(page, "04-public-cfp-mobile", true);

    // ---------- 5. Submissions bulk ----------
    await page.setViewportSize(DESKTOP);
    await selectAdminEvent(page, baseURL, event.id, "/admin/submissions");
    await expect(page.getByTestId("page-submissions")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`submission-select-${subA}`).check();
    await page.getByTestId(`submission-select-${subB}`).check();
    await expect(page.getByTestId("submissions-table-bulk")).toBeVisible();
    await capture(page, "05-submissions-bulk");

    // ---------- 6. Schedule conflict ----------
    await upsertRoom(request, admin.session, event.id, ROOM_A, "Hall A");
    await upsertRoom(request, admin.session, event.id, ROOM_B, "Hall B");
    const s1 = await createSession(
      request,
      admin.session,
      event.id,
      "Conflict First Visual",
      [{ name: "C1", email: `l2vis-c1-${RUN}@example.com` }],
    );
    const s2 = await createSession(
      request,
      admin.session,
      event.id,
      "Conflict Second Visual",
      [{ name: "C2", email: `l2vis-c2-${RUN}@example.com` }],
    );
    await placeViaApi(
      request,
      admin.session,
      event.id,
      s1,
      ROOM_A,
      SLOT_10,
      SLOT_11,
    );

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto("/admin/schedule");
    await expect(page.getByTestId("page-schedule")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("schedule-view-day").click();
    await expect(page.getByTestId("schedule-board")).toBeVisible({
      timeout: 15_000,
    });
    // Keyboard place into occupied slot → conflict chrome
    await page.getByTestId(`schedule-tray-item-${s2}`).click();
    await page.getByTestId(`schedule-slot-${ROOM_A}|${SLOT_10}`).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("schedule-conflict-toast")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("schedule-conflict-summary")).toBeVisible();
    await capture(page, "06-schedule-conflict");

    // ---------- 7. Comms audience ----------
    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto(`${baseURL ?? ""}/admin/comms`);
    await expect(page.getByTestId("page-comms")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("comms-segment-builder")).toBeVisible();
    // Wait for audience count (30 seeded speakers + portal/accepted speakers)
    await expect(page.getByTestId("comms-segment-count")).toHaveAttribute(
      "data-count",
      /[1-9]/,
      { timeout: 30_000 },
    );
    await capture(page, "07-comms-audience");

    // ---------- 8. Portal desktop + mobile ----------
    const speakerEmail = `e2e-l2visual-spk-${RUN}@example.com`;
    const speakerName = `Visual Portal Speaker ${RUN}`;
    await acceptSpeakerForPortal(
      request,
      admin.session,
      event.slug,
      formVersionId,
      speakerEmail,
      speakerName,
      `Portal Talk ${RUN}`,
    );
    await loginAsSpeaker(request, context, baseURL, speakerEmail, event.id);

    await page.setViewportSize(DESKTOP);
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-next-task")).toBeVisible();
    await capture(page, "08-portal-desktop", true);

    await page.setViewportSize(MOBILE);
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-bottom-nav")).toBeVisible();
    await capture(page, "08-portal-mobile", true);

    // ---------- 9. Error / session-expired / empty states ----------
    // Prefer state sheet global-state fixtures (stable, no network flake) +
    // live session-expired recovery panel after logout.
    await context.clearCookies();
    await page.setViewportSize(DESKTOP);
    // Re-auth as admin solely to open state sheet, then show session-expired live
    await loginAsAdmin(
      request,
      context,
      baseURL,
      `e2e-l2visual-states-${RUN}@example.com`,
    );
    await page.goto("/admin/settings/l2-state-sheet", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("l2-sheet-global-states")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("l2-state-sheet-session-expired")).toBeVisible();
    await expect(page.getByTestId("l2-state-sheet-network-error")).toBeVisible();
    await expect(page.getByTestId("l2-state-sheet-empty")).toBeVisible();
    await expect(page.getByTestId("l2-state-sheet-loading")).toBeVisible();
    // Scroll global states into view for the capture
    await page.getByTestId("l2-sheet-global-states").scrollIntoViewIfNeeded();
    await capture(page, "09-error-states", true);

    // Live session-expired recovery (not inside admin shell)
    await request.post("/api/auth/logout");
    await context.clearCookies();
    await page.goto(`${baseURL ?? ""}/admin/settings`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByTestId("session-expired-panel")).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);

    // ---------- Assert all nine classes on disk ----------
    const requiredStems = [
      "01-state-sheet",
      "02-overview",
      "03-cfp-builder",
      "04-public-cfp-desktop",
      "05-submissions-bulk",
      "06-schedule-conflict",
      "07-comms-audience",
      "08-portal-desktop",
      "09-error-states",
    ] as const satisfies readonly ArtifactKey[];

    for (const stem of requiredStems) {
      const p = artifactPath(stem);
      expect(existsSync(p), `missing artifact ${stem}`).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(2_000);
    }
    // Mobile companions also present
    for (const stem of [
      "04-public-cfp-mobile",
      "08-portal-mobile",
    ] as const) {
      expect(existsSync(artifactPath(stem))).toBe(true);
    }
  });

  test("AC-11.8-AUTHZ unauthenticated cannot read admin visual surfaces", async ({
    page,
  }) => {
    // must-not: unauthenticated user reads admin submissions / evaluations / shell
    await page.setViewportSize(DESKTOP);
    for (const path of [
      "/admin",
      "/admin/submissions",
      "/admin/evaluations",
      "/admin/schedule",
      "/admin/comms",
      "/admin/settings/l2-state-sheet",
    ]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("admin-shell")).toHaveCount(0);
      await expect(page.getByTestId("page-submissions")).toHaveCount(0);
      await expect(page.getByTestId("page-evaluations")).toHaveCount(0);
      await expect(page.getByTestId("l2-state-sheet")).toHaveCount(0);
    }
  });

  test("AC-11.8-SCORE taste score document gates overall ≥8.0", async () => {
    // File-level gate (also covered by tests/governance/11.8-visual-score-gates.test.mjs)
    const scorePath = join(ROOT, "docs", "audits", "LUMEN2_TASTE_SCORE.md");
    expect(existsSync(scorePath), "LUMEN2_TASTE_SCORE.md must exist").toBe(
      true,
    );
    const { readFileSync } = await import("node:fs");
    const body = readFileSync(scorePath, "utf8");

    const overall = body.match(
      /\*\*Overall(?: weighted)? score:\*\*\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i,
    );
    expect(overall, "overall score line required").toBeTruthy();
    const overallN = Number(overall![1]);
    expect(overallN, `overall ${overallN} must be ≥ 8.0`).toBeGreaterThanOrEqual(
      8.0,
    );

    // Primary surfaces table rows: | Surface | score |
    const primaryBlock = body.match(
      /## Primary surface scores[\s\S]*?(?=\n## |$)/i,
    );
    expect(primaryBlock, "primary surface scores section").toBeTruthy();
    const rowRe = /^\|\s*([^|]+?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|/gm;
    let m: RegExpExecArray | null;
    let rows = 0;
    while ((m = rowRe.exec(primaryBlock![0]!)) !== null) {
      const label = m[1]!.trim();
      if (/^-+$/.test(label) || /surface/i.test(label)) continue;
      const score = Number(m[2]);
      expect(
        score,
        `primary surface "${label}" score ${score} must be ≥ 7.0`,
      ).toBeGreaterThanOrEqual(7.0);
      rows += 1;
    }
    expect(rows, "expected ≥9 primary surface rows").toBeGreaterThanOrEqual(9);
  });
});
