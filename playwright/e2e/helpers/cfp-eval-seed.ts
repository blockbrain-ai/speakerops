/**
 * Seed helpers for section 3.6 CFP eval keystone (and reusable phase-3 e2e).
 *
 * No secrets: magic-link tokens are read only from the dev outbox at runtime.
 * Env names only (E10).
 */
import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";

export type SessionAuth = {
  session: string;
  userId: string;
};

export function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
}

export async function requestMagicLink(
  request: APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
}

export async function fetchDevLink(
  request: APIRequestContext,
  email: string,
): Promise<{ token: string; userId: string }> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok(), `dev outbox status ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    link: { token: string; userId?: string } | null;
  };
  expect(body.link?.token, "dev outbox must capture token").toBeTruthy();
  expect(body.link?.userId, "dev outbox must include userId").toBeTruthy();
  return { token: body.link!.token, userId: body.link!.userId! };
}

export async function exchangeForCookie(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  expect(setCookie.toLowerCase()).toContain("httponly");
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  return match![1]!;
}

export async function seedSessionCookie(
  context: BrowserContext,
  baseURL: string | undefined,
  sessionValue: string,
) {
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
}

export async function loginAs(
  request: APIRequestContext,
  context: BrowserContext,
  baseURL: string | undefined,
  email: string,
  purpose: "admin" | "evaluator",
  eventId?: string,
): Promise<SessionAuth> {
  await requestMagicLink(request, email, purpose, eventId);
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await seedSessionCookie(context, baseURL, session);
  return { session, userId: link.userId };
}

export async function ensureEvent(
  request: APIRequestContext,
  session: string,
  name: string,
  slug?: string,
): Promise<{ id: string; slug: string }> {
  const res = await request.post("/api/events", {
    headers: sessionHeaders(session),
    data: {
      name,
      timezone: "UTC",
      ...(slug ? { slug } : {}),
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-02T17:00:00.000Z",
    },
  });
  expect(res.status(), `Event.Create ${res.status()}`).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

/** Upsert a simple two-criterion rubric for evaluator scoring. */
export async function upsertRubric(
  request: APIRequestContext,
  session: string,
  eventId: string,
): Promise<{ criteria: Array<{ id: string; maxScore: number; name: string }> }> {
  const res = await request.put(`/api/events/${eventId}/eval/rubric`, {
    headers: sessionHeaders(session),
    data: {
      name: "Keystone rubric",
      criteria: [
        { name: "Relevance", maxScore: 5, weight: 1 },
        { name: "Delivery", maxScore: 5, weight: 1 },
      ],
    },
  });
  expect(res.status(), `rubric upsert ${res.status()}`).toBe(200);
  const body = (await res.json()) as {
    criteria: Array<{ id: string; maxScore: number; name: string }>;
  };
  return { criteria: body.criteria };
}

/** Select active event in admin shell (localStorage + switcher). */
export async function selectAdminEvent(
  page: import("@playwright/test").Page,
  baseURL: string | undefined,
  eventId: string,
  path = "/admin/cfp",
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
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  const tag = await switcher
    .evaluate((el) => el.tagName.toLowerCase())
    .catch(() => "");
  if (tag === "select") {
    await switcher.selectOption(eventId);
  }
}
