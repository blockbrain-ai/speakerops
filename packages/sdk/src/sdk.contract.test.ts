/**
 * Worker-backed SDK contract — minted API keys against createAppWithAuth.
 */
import { describe, it, expect } from "vitest";
import {
  SESSION_COOKIE_NAME,
  type ApiScope,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../../apps/api/src/index.js";
import { SpeakerOps, unwrap } from "./index.js";

const env = { APP_VERSION: "0.1.0" };

function honoFetch(
  app: ReturnType<typeof createAppWithAuth>["app"],
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const abs = url.startsWith("http") ? url : `http://localhost${url}`;
    return app.request(
      abs,
      {
        method: init?.method ?? "GET",
        headers: init?.headers,
        body: init?.body as BodyInit | undefined,
      },
      env,
    );
  };
}

async function adminWithKey(scopes: ApiScope[], email: string) {
  const ctx = createAppWithAuth({ cookieSecure: true });
  const { app, store, outbox } = ctx;
  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose: "admin" }),
    },
    env,
  );
  const token = outbox.lastForEmail(email)!.token;
  const exchange = await app.request(
    "http://localhost/api/auth/exchange",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    },
    env,
  );
  expect(exchange.status).toBe(200);
  const setCookie = exchange.headers.get("set-cookie")!;
  const sessionValue = setCookie.split(";")[0]!.split("=").slice(1).join("=");
  const cookie = `${SESSION_COOKIE_NAME}=${sessionValue}`;
  const user = await store.findUserByEmail(email);
  expect(user).toBeTruthy();

  const createEvt = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "SDK Contract Event", timezone: "UTC" }),
    },
    env,
  );
  expect(createEvt.status).toBe(201);
  const created = (await createEvt.json()) as {
    event: { id: string; slug: string };
  };

  const mint = await app.request(
    "http://localhost/api/keys",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "sdk-contract",
        scopes,
        eventId: created.event.id,
      }),
    },
    env,
  );
  expect(mint.status).toBe(201);
  const key = (await mint.json()) as { secret: string };

  const so = new SpeakerOps({
    baseUrl: "http://localhost",
    apiKey: key.secret,
    fetchImpl: honoFetch(app),
  });
  return { so, eventId: created.event.id, slug: created.event.slug, app };
}

describe("@speakerops/sdk Worker contract", () => {
  it("lists events and publishes a programme with a Bearer key", async () => {
    const { so, eventId, slug } = await adminWithKey(
      ["events:read", "events:write"],
      "sdk-pub@example.com",
    );
    const listed = unwrap(await so.events.list());
    expect(listed.events.some((e) => e.id === eventId)).toBe(true);

    const before = unwrap(await so.programme.status(eventId));
    expect(before.published).toBe(false);

    unwrap(await so.programme.publish(eventId));
    const after = unwrap(await so.programme.status(eventId));
    expect(after.published).toBe(true);

    const snap = await so.programme.projectPublished(slug);
    expect(snap.slug).toBe(slug);
    expect(snap.eventId).toBe(eventId);
  });

  it("denies programme publish with a reports-only key", async () => {
    const { so, eventId } = await adminWithKey(
      ["reports:read"],
      "sdk-deny@example.com",
    );
    const result = await so.programme.publish(eventId);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("OpenAPI includes the public programme path", async () => {
    const { so } = await adminWithKey(["events:read"], "sdk-oa@example.com");
    const doc = unwrap(await so.openapi.get()) as {
      paths?: Record<string, unknown>;
    };
    expect(doc.paths?.["/api/public/programme/{slug}"]).toBeTruthy();
    expect(doc.paths?.["/api/events/{eventId}/programme/publish"]).toBeTruthy();
  });
});
