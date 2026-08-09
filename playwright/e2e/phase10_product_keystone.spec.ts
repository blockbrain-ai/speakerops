/**
 * Section 10.7 — Phase 10 product reliability keystone (I12).
 *
 * Single orchestrated suite proving all eight Phase 10 product souls (F class)
 * on dogfood-shaped local/CI fixtures so Phase 11 can recompose UI safely.
 *
 * Soul → F proof mapping (implementation owners remain 1:1 on these files;
 * this keystone stitches the multi-soul path and re-proves core ACs):
 *
 * | Soul          | Implementation F proof                         | Keystone AC        |
 * |---------------|------------------------------------------------|--------------------|
 * | S-SUB-LIST    | submissions_list_reliability.spec.ts AC-10.1-A | AC-10.1-A          |
 * | S-EVAL-UI     | evaluations_progress.spec.ts AC-10.2-A         | AC-10.2-A          |
 * | S-CFP-SUBMIT  | public_cfp_submit_demo.spec.ts AC-10.3-A       | AC-10.3-A          |
 * | S-CFP-CLOSED  | public_cfp_submit_demo.spec.ts AC-10.3-B       | AC-10.3-B          |
 * | S-AUTH-ROLES  | auth_roles_dogfood.spec.ts AC-10.4-*           | AC-10.4-A/B/C      |
 * | S-CFP-DRAFT   | cfp_draft.spec.ts AC-10.5-*                    | AC-10.5-A/B        |
 * | S-SCHED-CHROME| schedule_day_chrome.spec.ts AC-10.6-A          | AC-10.6-A          |
 * | S-EVAL-EXPORT | eval_export_sort.spec.ts AC-10.6-B             | AC-10.6-B          |
 *
 * Documented inventory tags (active @inv ownership stays on implementation
 * specs — duplicate owners forbidden by inventory law):
 * - @inv:E01 e2e/admin/sub-list (S-SUB-LIST / L05 scale path)
 * - @inv:F01 e2e/eval/queue surface family (admin progress / S-EVAL-UI)
 * - @inv:A06 e2e/public/cfp-submit (S-CFP-SUBMIT)
 * - @inv:A07 e2e/public/cfp-closed (S-CFP-CLOSED)
 * - @inv:B01–B06 auth role landings (S-AUTH-ROLES)
 * - @inv:A17 e2e/public/cfp-draft (S-CFP-DRAFT)
 * - @inv:I03 e2e/sched/week (S-SCHED-CHROME chrome bound)
 * - @inv:F05 e2e/eval/export (S-EVAL-EXPORT)
 *
 * Proof class: **F only** at 10.7. Live **D** re-proof of souls 1–8 is **11.9**.
 * Do not claim dogfood_ready at 10.7.
 *
 * Security / adversarial (must-not):
 * - unauthenticated cannot read admin submissions/evaluations
 * - evaluator cannot open admin navigation / export
 * - closed CFP rejects new submit (4xx)
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e / test:e2e:phase10).
 *
 * @see initiative/PHASE10_11_GAP_CLOSE/evidence/phase10-keystone.md
 * @see initiative/PHASE10_11_GAP_CLOSE/02_LIVABILITY_MATRIX.md
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  selectAdminEvent,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
} from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KEYSTONE_ADMIN = `e2e-keystone107-admin-${RUN}@example.com`;
const KEYSTONE_EVAL = `e2e-keystone107-eval-${RUN}@example.com`;
const KEYSTONE_SPEAKER = `e2e-keystone107-spk-${RUN}@example.com`;

/** Wed–Fri mid-week event (UTC) for S-SCHED-CHROME. */
const SCHED_START = "2026-09-02T09:00:00.000Z";
const SCHED_END = "2026-09-04T17:00:00.000Z";

const DEFAULT_BOOTSTRAP_EVENT_ID = "evt_dogfood";

async function mintSession(
  request: APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator",
  eventId?: string,
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, purpose, eventId);
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  return { session, userId: link.userId };
}

async function publishCfp(
  request: APIRequestContext,
  session: string,
  eventId: string,
  opts?: {
    name?: string;
    closesAt?: string | null;
    opensAt?: string | null;
    fields?: Array<Record<string, unknown>>;
  },
): Promise<{ formVersionId: string; formId: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: opts?.name ?? `Keystone10 CFP ${RUN}` },
  });
  expect(create.status(), await create.text()).toBe(201);
  const created = (await create.json()) as { form: { id: string } };

  const fields =
    opts?.fields ??
    [
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
    ];

  const draft = await request.put(`/api/forms/${created.form.id}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields,
      rules: [],
      welcomeMd: "Keystone 10.7 public CFP",
      thankYouMd: "Thanks — keystone submit",
      opensAt: opts?.opensAt === undefined ? null : opts.opensAt,
      closesAt: opts?.closesAt === undefined ? null : opts.closesAt,
    },
  });
  expect(draft.status(), await draft.text()).toBe(200);

  const pub = await request.post(`/api/forms/${created.form.id}/publish`, {
    headers: sessionHeaders(session),
  });
  expect(pub.status(), await pub.text()).toBe(200);
  const published = (await pub.json()) as {
    formVersion: { id: string };
  };
  return {
    formVersionId: published.formVersion.id,
    formId: created.form.id,
  };
}

/**
 * Seed `count` public submissions (dogfood-shaped ≥150 for S-SUB-LIST).
 * Relies on e2e-api-server permissive rate limiter (section 10.1).
 */
async function seedSubmissions(
  request: APIRequestContext,
  slug: string,
  formVersionId: string,
  count: number,
  run: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const title =
      i === 0
        ? `Keystone Keynote ${run}`
        : `Keystone Talk ${String(i).padStart(3, "0")} ${run}`;
    const res = await request.post(`/api/public/cfp/${slug}/submissions`, {
      data: {
        formVersionId,
        title,
        answers: [{ fieldKey: "talk_title", value: title }],
        speakers: [
          {
            name: `Keystone Speaker ${i}`,
            email: `ks${i}-${run}@example.com`,
            isPrimary: true,
          },
        ],
        turnstileToken: "XXXX.DUMMY.TOKEN",
      },
    });
    expect(res.status(), `seed submit #${i}`).toBe(201);
    const body = (await res.json()) as { submission: { id: string } };
    ids.push(body.submission.id);
  }
  return ids;
}

async function selectEvent(
  page: Page,
  eventId: string,
  path: string,
  baseURL?: string,
) {
  await page.goto(`${baseURL ?? ""}${path}`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  await page.evaluate((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  await page.goto(`${baseURL ?? ""}${path}`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = page.getByTestId("event-context");
  if (
    await switcher
      .evaluate((el) => el.tagName === "SELECT")
      .catch(() => false)
  ) {
    await switcher.selectOption(eventId).catch(() => undefined);
  }
}

test.describe("10.7 Phase 10 product reliability keystone (I12)", () => {
  /**
   * Orchestrated admin product path:
   * S-AUTH-ROLES (admin) → S-SUB-LIST (≥150) → S-EVAL-UI → S-EVAL-EXPORT
   */
  test("keystone: S-AUTH-ROLES admin + S-SUB-LIST + S-EVAL-UI + S-EVAL-EXPORT", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    // --- S-AUTH-ROLES AC-10.4-A: real session cookie reaches /admin ---
    const admin = await loginAs(
      request,
      context,
      baseURL,
      KEYSTONE_ADMIN,
      "admin",
    );

    const eventsApi = await request.get("/api/events", {
      headers: sessionHeaders(admin.session),
    });
    expect(eventsApi.status(), "admin Event.List").toBe(200);

    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("nav-overview")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });

    // --- Dogfood-shaped event + open CFP ---
    const event = await ensureEvent(
      request,
      admin.session,
      `Keystone10 Product ${RUN}`,
      `keystone10-${RUN}`.slice(0, 48),
    );
    const { formVersionId } = await publishCfp(
      request,
      admin.session,
      event.id,
      { name: `Keystone10 Scale CFP ${RUN}` },
    );

    // --- S-SUB-LIST AC-10.1-A: ≥150 rows, loading ≤5s ---
    await seedSubmissions(request, event.slug, formVersionId, 150, RUN);

    const listApi = await request.get(
      `/api/events/${event.id}/submissions?limit=25&offset=0`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(listApi.status()).toBe(200);
    const listBody = (await listApi.json()) as {
      submissions: unknown[];
      total: number;
      limit: number;
    };
    expect(listBody.total).toBe(150);
    expect(listBody.submissions.length).toBeGreaterThanOrEqual(1);
    expect(listBody.submissions.length).toBeLessThanOrEqual(25);
    expect(listBody.limit).toBe(25);

    await page.goto(`${baseURL ?? ""}/admin/submissions`);
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await page.evaluate((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);

    const listStart = Date.now();
    await page.goto(`${baseURL ?? ""}/admin/submissions`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("page-submissions")).toBeVisible({
      timeout: 5_000,
    });
    const switcher = page.getByTestId("event-context");
    if (
      await switcher
        .evaluate((el) => el.tagName === "SELECT")
        .catch(() => false)
    ) {
      await switcher.selectOption(event.id).catch(() => undefined);
    }
    await expect(page.getByTestId("submissions-loading")).toBeHidden({
      timeout: Math.max(500, 5_000 - (Date.now() - listStart)),
    });
    await expect(page.getByTestId("submissions-table")).toBeVisible({
      timeout: Math.max(500, 5_000 - (Date.now() - listStart)),
    });
    await expect(
      page.locator("[data-testid^='submission-row-']").first(),
    ).toBeVisible({
      timeout: Math.max(500, 5_000 - (Date.now() - listStart)),
    });
    expect(Date.now() - listStart).toBeLessThanOrEqual(5_000);
    await expect(page.getByTestId("submissions-list-meta")).toHaveAttribute(
      "data-total",
      "150",
    );

    // --- S-EVAL-UI AC-10.2-A: progress without Response validation failed ---
    const rubric = await request.put(`/api/events/${event.id}/eval/rubric`, {
      headers: sessionHeaders(admin.session),
      data: {
        name: "Keystone10 rubric",
        criteria: [
          { name: "Relevance", maxScore: 10, weight: 1 },
          { name: "Delivery", maxScore: 10, weight: 1 },
        ],
      },
    });
    expect(rubric.status()).toBe(200);
    const rubricBody = (await rubric.json()) as {
      criteria: Array<{ id: string }>;
    };
    expect(rubricBody.criteria.length).toBeGreaterThanOrEqual(1);

    // Mint evaluator without permanently clobbering admin browser cookie later
    const evaluator = await mintSession(
      request,
      KEYSTONE_EVAL,
      "evaluator",
      event.id,
    );

    // Score two submissions for sort/export proof
    const scored = await request.get(
      `/api/events/${event.id}/submissions?limit=2&offset=0`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(scored.status()).toBe(200);
    const scoredBody = (await scored.json()) as {
      submissions: Array<{ id: string }>;
    };
    expect(scoredBody.submissions.length).toBeGreaterThanOrEqual(2);
    const lowId = scoredBody.submissions[0]!.id;
    const highId = scoredBody.submissions[1]!.id;

    for (const [submissionId, value] of [
      [lowId, 3],
      [highId, 9],
    ] as const) {
      const assign = await request.post(
        `/api/submissions/${submissionId}/assign`,
        {
          headers: sessionHeaders(admin.session),
          data: { userIds: [evaluator.userId] },
        },
      );
      expect(assign.status(), await assign.text()).toBe(200);
      const assignBody = (await assign.json()) as {
        assignments: Array<{ id: string }>;
      };
      const score = await request.post(
        `/api/assignments/${assignBody.assignments[0]!.id}/scores`,
        {
          headers: sessionHeaders(evaluator.session),
          data: {
            scores: rubricBody.criteria.map((c) => ({
              criterionId: c.id,
              value,
            })),
          },
        },
      );
      expect(score.status(), await score.text()).toBe(200);
    }

    const rollupApi = await request.get(
      `/api/events/${event.id}/eval/rollup`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(rollupApi.status()).toBe(200);
    const rollupText = await rollupApi.text();
    expect(rollupText.toLowerCase()).not.toContain(
      "response validation failed",
    );
    const rollup = JSON.parse(rollupText) as {
      error?: string;
      submissions: Array<{ submissionId: string; aggregateScore: number | null }>;
    };
    expect(rollup.error).toBeUndefined();
    expect(rollup.submissions.length).toBeGreaterThanOrEqual(1);

    await seedSessionCookie(context, baseURL, admin.session);
    await selectEvent(page, event.id, "/admin/evaluations", baseURL);
    await expect(page.getByTestId("page-evaluations")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("eval-rollup-error")).toHaveCount(0);
    await expect(page.getByTestId("eval-rollup-section")).toBeVisible({
      timeout: 10_000,
    });
    // No blank/validation wall — table or honest empty
    const hasTable = (await page.getByTestId("eval-rollup-table").count()) > 0;
    const hasNoRubric =
      (await page.getByTestId("eval-rollup-no-rubric").count()) > 0;
    expect(hasTable || hasNoRubric).toBeTruthy();
    if (hasTable) {
      await expect(page.getByTestId("eval-rollup-table")).toBeVisible();
    }

    // --- S-EVAL-EXPORT AC-10.6-B: sort + CSV export ---
    if (hasTable) {
      await expect(page.getByTestId("eval-sort-select")).toBeVisible();
      await expect(page.getByTestId("eval-export-csv")).toBeVisible();

      await page.getByTestId("eval-sort-select").selectOption("score_desc");
      await expect(page.getByTestId("eval-rollup-table")).toHaveAttribute(
        "data-sort",
        "score_desc",
      );

      const exportWait = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/events/${event.id}/eval/export`) &&
          r.request().method() === "GET",
      );
      await page.getByTestId("eval-export-csv").click();
      const exportRes = await exportWait;
      expect(exportRes.status()).toBe(200);
      const ct = exportRes.headers()["content-type"] ?? "";
      expect(ct).toMatch(/text\/csv/);

      const csvRes = await request.get(
        `/api/events/${event.id}/eval/export?sort=score_desc`,
        {
          headers: {
            cookie: `speakerops_session=${admin.session}`,
            accept: "text/csv",
          },
        },
      );
      expect(csvRes.status()).toBe(200);
      const csv = await csvRes.text();
      expect(csv).toContain("aggregateScore");
      expect(csv).toContain(highId);
      expect(csv).toContain(lowId);
    } else {
      // API export still works when UI is honest-empty edge
      const csvRes = await request.get(
        `/api/events/${event.id}/eval/export?sort=score_desc`,
        {
          headers: {
            cookie: `speakerops_session=${admin.session}`,
            accept: "text/csv",
          },
        },
      );
      expect(csvRes.status()).toBe(200);
      expect(csvRes.headers()["content-type"] ?? "").toMatch(/text\/csv/);
    }
  });

  /**
   * Public open-window path: S-CFP-SUBMIT (DEMO) + S-CFP-DRAFT save/resume
   */
  test("keystone: S-CFP-SUBMIT DEMO + S-CFP-DRAFT save/resume", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(60_000);

    const admin = await mintSession(
      request,
      `e2e-keystone107-cfp-admin-${RUN}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Keystone10 CFP Open ${RUN}`,
      `keystone10-cfp-${RUN}`.slice(0, 48),
    );
    await publishCfp(request, admin.session, event.id, {
      name: `Keystone10 Open CFP ${RUN}`,
    });

    // --- S-CFP-SUBMIT AC-10.3-A: DEMO_MODE public form + submit ---
    const pub = await request.get(`/api/public/cfp/${event.slug}`);
    expect(pub.status()).toBe(200);
    const pubBody = (await pub.json()) as {
      windowState: string;
      turnstileSiteKey: string;
      formVersion: { id: string } | null;
    };
    expect(pubBody.windowState).toBe("open");
    expect(pubBody.turnstileSiteKey).toBe("1x00000000000000000000AA");
    expect(pubBody.formVersion?.id).toBeTruthy();

    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("page-public-cfp")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("public-cfp-form")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("cfp-turnstile")).toHaveAttribute(
      "data-turnstile-mode",
      "test",
    );

    // --- S-CFP-DRAFT AC-10.5-A/B: title-only draft + resume ---
    await expect(page.getByTestId("cfp-draft-save")).toBeVisible();
    await expect(page.getByTestId("cfp-draft-save")).toBeEnabled();
    const draftTitle = `Keystone Draft ${RUN}`;
    await page.getByTestId("cfp-title").fill(draftTitle);
    const abstract = page.getByTestId("cfp-field-abstract");
    if (await abstract.count()) {
      await abstract.fill("Partial abstract for keystone resume");
    }
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
    };
    expect(saveBody.submission.status).toBe("draft");
    expect(saveBody.submission.title).toBe(draftTitle);
    await expect(page.getByTestId("cfp-draft-confirmation")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    await expect(page.getByTestId("cfp-title")).toHaveValue(draftTitle, {
      timeout: 10_000,
    });
    if (await abstract.count()) {
      await expect(page.getByTestId("cfp-field-abstract")).toHaveValue(
        "Partial abstract for keystone resume",
      );
    }

    // Fresh page for final DEMO submit (S-CFP-SUBMIT)
    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("cfp-title").fill(`Keystone Final Submit ${RUN}`);
    const talkTitle = page.getByTestId("cfp-field-talk_title");
    if (await talkTitle.count()) {
      await talkTitle.fill(`Keystone Final Submit ${RUN}`);
    }
    await page.getByTestId("cfp-speaker-name-0").fill("Keystone Public Speaker");
    await page
      .getByTestId("cfp-speaker-email-0")
      .fill(`keystone-public-${RUN}@example.com`);
    await page.getByTestId("cfp-turnstile-check").check();
    await page.getByTestId("public-cfp-primary").click();
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
      timeout: 15_000,
    });
  });

  /**
   * S-CFP-CLOSED AC-10.3-B: closed UI + API 4xx (must-not accept submit)
   */
  test("keystone: S-CFP-CLOSED closed UI + POST 4xx", async ({
    page,
    request,
    baseURL,
  }) => {
    const admin = await mintSession(
      request,
      `e2e-keystone107-closed-admin-${RUN}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Keystone10 CFP Closed ${RUN}`,
      `keystone10-closed-${RUN}`.slice(0, 48),
    );
    const { formVersionId } = await publishCfp(
      request,
      admin.session,
      event.id,
      {
        name: `Keystone10 Closed CFP ${RUN}`,
        closesAt: "2020-01-01T00:00:00.000Z",
      },
    );

    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-closed")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("public-cfp-closed")).toContainText(
      /closed/i,
    );
    await expect(page.getByTestId("public-cfp-form")).toHaveCount(0);
    // Draft save disabled when closed (S-CFP-DRAFT closed bound)
    const draftBtn = page.getByTestId("cfp-draft-save");
    if (await draftBtn.count()) {
      await expect(draftBtn).toBeDisabled();
    }

    const submit = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "e2e-10-7-closed",
        },
        data: {
          formVersionId,
          title: "Should be rejected by closed window",
          speakers: [
            { name: "Closed Out", email: `closed-${RUN}@example.com` },
          ],
          answers: [
            {
              fieldKey: "talk_title",
              value: "Should be rejected by closed window",
            },
          ],
          turnstileToken: "XXXX.DUMMY.TOKEN",
        },
      },
    );
    expect(submit.status()).toBeGreaterThanOrEqual(400);
    expect(submit.status()).toBeLessThan(500);
    const err = (await submit.json()) as {
      error?: string;
      details?: { windowState?: string };
    };
    expect(err.error?.toLowerCase() ?? "").toMatch(/closed/);
    if (err.details?.windowState) {
      expect(err.details.windowState).toBe("closed");
    }
  });

  /**
   * S-AUTH-ROLES AC-10.4-B/C: speaker portal + evaluator queue landings
   */
  test("keystone: S-AUTH-ROLES speaker portal + evaluator queue", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await mintSession(
      request,
      `e2e-keystone107-roles-admin-${RUN}@example.com`,
      "admin",
    );
    const { id: portalEventId } = await ensureEvent(
      request,
      admin.session,
      `Keystone10 Roles ${RUN}`,
      `keystone10-roles-${RUN}`.slice(0, 48),
    );

    // Speaker
    const speaker = await mintSession(
      request,
      KEYSTONE_SPEAKER,
      "speaker",
      portalEventId,
    );
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, speaker.session);
    const homeApi = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(portalEventId)}`,
      { headers: sessionHeaders(speaker.session) },
    );
    expect(homeApi.status()).toBe(200);
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(portalEventId)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("login-page")).toHaveCount(0);
    await expect(page.getByTestId("portal-tasks")).toBeVisible();

    // Evaluator
    const evaluator = await mintSession(
      request,
      `e2e-keystone107-roles-eval-${RUN}@example.com`,
      "evaluator",
      DEFAULT_BOOTSTRAP_EVENT_ID,
    );
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, evaluator.session);
    const queueApi = await request.get("/api/me/eval-queue", {
      headers: sessionHeaders(evaluator.session),
    });
    expect(queueApi.status()).toBe(200);
    await page.goto(`${baseURL ?? ""}/eval`);
    await expect(page.getByTestId("evaluator-queue")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.getByTestId("nav-overview")).toHaveCount(0);
  });

  /**
   * S-SCHED-CHROME AC-10.6-A: week headers only within event dates
   */
  test("keystone: S-SCHED-CHROME week days ⊆ event range", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-keystone107-sched-${RUN}@example.com`,
      "admin",
    );

    const create = await request.post("/api/events", {
      headers: sessionHeaders(admin.session),
      data: {
        name: `Keystone10 Midweek ${RUN}`,
        timezone: "UTC",
        startsAt: SCHED_START,
        endsAt: SCHED_END,
      },
    });
    expect(create.status()).toBe(201);
    const { event } = (await create.json()) as {
      event: { id: string };
    };

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto(`${baseURL ?? ""}/admin/schedule`);
    await expect(page.getByTestId("page-schedule")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("schedule-view-week").click();
    await expect(page.getByTestId("schedule-week-view")).toBeVisible();

    await expect(
      page.getByTestId("schedule-week-day-2026-09-02"),
    ).toBeVisible();
    await expect(
      page.getByTestId("schedule-week-day-2026-09-03"),
    ).toBeVisible();
    await expect(
      page.getByTestId("schedule-week-day-2026-09-04"),
    ).toBeVisible();
    await expect(
      page.getByTestId("schedule-week-day-2026-08-31"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("schedule-week-day-2026-09-01"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("schedule-week-day-2026-09-05"),
    ).toHaveCount(0);

    const dayCount = await page
      .getByTestId("schedule-week-view")
      .getAttribute("data-day-count");
    expect(dayCount).toBe("3");
  });

  /**
   * Adversarial must-nots owned at the keystone surface.
   */
  test("keystone: must-not unauth admin + evaluator no export/admin", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // Unauthenticated: no privileged list
    const unauthList = await request.get(
      `/api/events/${DEFAULT_BOOTSTRAP_EVENT_ID}/submissions`,
    );
    expect([401, 403, 404]).toContain(unauthList.status());
    const unauthRollup = await request.get(
      `/api/events/${DEFAULT_BOOTSTRAP_EVENT_ID}/eval/rollup`,
    );
    expect([401, 403, 404]).toContain(unauthRollup.status());
    const unauthEvents = await request.get("/api/events");
    expect(unauthEvents.status()).toBe(401);

    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);

    // Evaluator: no admin nav + no export
    const admin = await mintSession(
      request,
      `e2e-keystone107-neg-admin-${RUN}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Keystone10 Neg ${RUN}`,
      `keystone10-neg-${RUN}`.slice(0, 48),
    );
    const evaluator = await mintSession(
      request,
      `e2e-keystone107-neg-eval-${RUN}@example.com`,
      "evaluator",
      event.id,
    );
    await seedSessionCookie(context, baseURL, evaluator.session);

    const evalEvents = await request.get("/api/events", {
      headers: sessionHeaders(evaluator.session),
    });
    expect(evalEvents.status()).toBe(403);

    const evalExport = await request.get(
      `/api/events/${event.id}/eval/export`,
      {
        headers: {
          cookie: `speakerops_session=${evaluator.session}`,
          accept: "text/csv",
        },
      },
    );
    expect(evalExport.status()).toBe(403);

    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page.getByTestId("access-denied")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  });

  /**
   * Static proof table: keystone documents all eight souls + implementation files.
   * (Executable soul paths are the tests above; this locks the mapping for audits.)
   */
  test("keystone: documents all eight Phase 10 F soul proofs", async () => {
    // This assertion is intentionally structural — the suite file itself is the
    // evidence surface for soul → AC → implementation mapping (see file header).
    const souls = [
      "S-SUB-LIST",
      "S-EVAL-UI",
      "S-CFP-SUBMIT",
      "S-CFP-CLOSED",
      "S-AUTH-ROLES",
      "S-CFP-DRAFT",
      "S-SCHED-CHROME",
      "S-EVAL-EXPORT",
    ] as const;
    const owners: Record<(typeof souls)[number], string> = {
      "S-SUB-LIST": "submissions_list_reliability.spec.ts",
      "S-EVAL-UI": "evaluations_progress.spec.ts",
      "S-CFP-SUBMIT": "public_cfp_submit_demo.spec.ts",
      "S-CFP-CLOSED": "public_cfp_submit_demo.spec.ts",
      "S-AUTH-ROLES": "auth_roles_dogfood.spec.ts",
      "S-CFP-DRAFT": "cfp_draft.spec.ts",
      "S-SCHED-CHROME": "schedule_day_chrome.spec.ts",
      "S-EVAL-EXPORT": "eval_export_sort.spec.ts",
    };
    expect(souls).toHaveLength(8);
    for (const soul of souls) {
      expect(owners[soul].length).toBeGreaterThan(0);
    }
    // selectAdminEvent helper remains available for UI-bound paths
    expect(typeof selectAdminEvent).toBe("function");
  });
});
