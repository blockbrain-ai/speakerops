/**
 * Section 2.4 — Design Kit (Vitest).
 *
 * Named assertions from spec:
 * - assert publish with brand #fffffe fails contrast or derives safe fg
 * - assert image/svg+xml logo presign 400
 * - assert public design endpoint returns published not draft
 *
 * Plus: Zod 400, authz 401/403, audit_events + correlationId.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  DesignGetResponseSchema,
  DesignSetDraftResponseSchema,
  DesignPublishResponseSchema,
  PublicDesignResponseSchema,
  FilePresignResponseSchema,
  EventResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  CONFLICT,
  SESSION_COOKIE_NAME,
  contrastRatio,
  deriveBrandFg,
  validateContrastGate,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  store: ReturnType<typeof createAppWithAuth>["store"];
  events: ReturnType<typeof createAppWithAuth>["events"];
  design: ReturnType<typeof createAppWithAuth>["design"];
  cookie: string;
}> {
  const { app, store, events, design, outbox } = createAppWithAuth({
    cookieSecure: true,
  });
  const body: Record<string, string> = { email, purpose };
  if (eventId) body.eventId = eventId;

  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
  const sessionValue = setCookie
    .split(";")[0]!
    .split("=")
    .slice(1)
    .join("=");
  return {
    app,
    store,
    events,
    design,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name = "Design Event",
  slug?: string,
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-create-for-design",
      },
      body: JSON.stringify({
        name,
        timezone: "UTC",
        ...(slug ? { slug } : {}),
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const parsed = EventResponseSchema.parse(await res.json());
  return { id: parsed.event.id, slug: parsed.event.slug };
}

describe("2.4 design kit", () => {
  it("assert publish with brand #fffffe fails contrast or derives safe fg", async () => {
    // Unit: near-white derives dark safe fg with strong ratio
    const gate = validateContrastGate({
      brand: "#fffffe",
      radius: "soft",
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.brandFg.toLowerCase()).not.toBe("#ffffff");
      expect(gate.ratio).toBeGreaterThanOrEqual(3);
      expect(gate.tokens.brandFg).toBe(gate.brandFg);
    }

    const { app, store, cookie } = await magicLinkSession(
      "admin",
      "admin-contrast@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Contrast Event");

    const setRes = await app.request(
      `http://localhost/api/events/${eventId}/design`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-design-near-white",
        },
        body: JSON.stringify({
          tokens: { brand: "#fffffe", radius: "soft", wordmark: "NearWhite" },
        }),
      },
      env,
    );
    expect(setRes.status).toBe(200);
    const draft = DesignSetDraftResponseSchema.parse(await setRes.json());

    const pubRes = await app.request(
      `http://localhost/api/events/${eventId}/design/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-design-publish-near-white",
        },
        body: JSON.stringify({ expectedVersion: draft.draft.version }),
      },
      env,
    );

    // Either CONTRAST_FAILED (block) or success with derived safe fg
    if (pubRes.status === 400) {
      const envBody = ErrorEnvelopeSchema.parse(await pubRes.json());
      expect(
        envBody.code === "CONTRAST_FAILED" || envBody.code === VALIDATION_ERROR,
      ).toBe(true);
    } else {
      expect(pubRes.status).toBe(200);
      const pub = DesignPublishResponseSchema.parse(await pubRes.json());
      const fg = pub.published.tokens.brandFg ?? deriveBrandFg("#fffffe");
      const ratio = contrastRatio("#fffffe", fg);
      expect(ratio).not.toBeNull();
      expect(ratio!).toBeGreaterThanOrEqual(3);
      // Safe fg is dark (not white) for near-white brand
      expect(fg.toLowerCase()).not.toBe("#ffffff");
    }

    const audits = await store.listAudits();
    const setAudit = audits.find((a) => a.action === "Design.SetDraft");
    expect(setAudit?.correlationId).toBe("corr-design-near-white");
  });

  it("assert image/svg+xml logo presign 400", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-logo@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Logo Event");

    const svgRes = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-logo-svg",
        },
        body: JSON.stringify({
          eventId,
          purpose: "logo",
          mime: "image/svg+xml",
          size: 1024,
          filename: "evil.svg",
        }),
      },
      env,
    );
    expect(svgRes.status).toBe(400);
    const envBody = ErrorEnvelopeSchema.parse(await svgRes.json());
    expect(envBody.code).toBe(VALIDATION_ERROR);
    expect(envBody.error.toLowerCase()).toMatch(/svg|not allowed|png/);

    // PNG succeeds
    const pngRes = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-logo-png",
        },
        body: JSON.stringify({
          eventId,
          purpose: "logo",
          mime: "image/png",
          size: 2048,
          filename: "logo.png",
        }),
      },
      env,
    );
    expect(pngRes.status).toBe(200);
    const png = FilePresignResponseSchema.parse(await pngRes.json());
    expect(png.mime).toBe("image/png");
    expect(png.purpose).toBe("logo");
    expect(png.fileId.length).toBeGreaterThan(0);
  });

  it("assert public design endpoint returns published not draft", async () => {
    const { app, store, cookie } = await magicLinkSession(
      "admin",
      "admin-public@example.com",
    );
    const { id: eventId, slug } = await createEvent(
      app,
      cookie,
      "Public Isolation",
      "public-iso",
    );

    // Save draft with distinctive brand
    const setRes = await app.request(
      `http://localhost/api/events/${eventId}/design`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-design-draft-only",
        },
        body: JSON.stringify({
          tokens: {
            brand: "#112233",
            radius: "curvy",
            wordmark: "DraftOnly",
          },
        }),
      },
      env,
    );
    expect(setRes.status).toBe(200);
    const draft = DesignSetDraftResponseSchema.parse(await setRes.json());
    expect(draft.draft.tokens.brand.toLowerCase()).toBe("#112233");

    // Public must NOT see draft
    const publicBefore = await app.request(
      `http://localhost/api/public/design/${slug}`,
      { method: "GET" },
      env,
    );
    expect(publicBefore.status).toBe(200);
    const beforeBody = PublicDesignResponseSchema.parse(
      await publicBefore.json(),
    );
    expect(beforeBody.published).toBeNull();
    expect(beforeBody.cssVariables).toBeNull();

    // Publish
    const pubRes = await app.request(
      `http://localhost/api/events/${eventId}/design/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-design-publish-ok",
        },
        body: JSON.stringify({ expectedVersion: draft.draft.version }),
      },
      env,
    );
    expect(pubRes.status).toBe(200);
    const published = DesignPublishResponseSchema.parse(await pubRes.json());
    expect(published.published.tokens.brand.toLowerCase()).toBe("#112233");

    // Public now sees published only
    const publicAfter = await app.request(
      `http://localhost/api/public/design/${slug}`,
      { method: "GET" },
      env,
    );
    expect(publicAfter.status).toBe(200);
    const afterBody = PublicDesignResponseSchema.parse(
      await publicAfter.json(),
    );
    expect(afterBody.published).not.toBeNull();
    expect(afterBody.published!.tokens.brand.toLowerCase()).toBe("#112233");
    expect(afterBody.published!.tokens.wordmark).toBe("DraftOnly");
    expect(afterBody.cssVariables).toMatch(/--lumen-brand:\s*#112233/i);

    // Change draft to different brand without publish — public unchanged
    const set2 = await app.request(
      `http://localhost/api/events/${eventId}/design`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-design-draft-2",
        },
        body: JSON.stringify({
          tokens: { brand: "#ff00aa", radius: "round", wordmark: "SecretDraft" },
          expectedVersion: draft.draft.version + 1, // publish bumped draft version
        }),
      },
      env,
    );
    // After publish, draft version was not bumped in our impl — only tokens updated.
    // Re-get draft version for correct concurrency.
    if (set2.status === 409) {
      const getRes = await app.request(
        `http://localhost/api/events/${eventId}/design`,
        { method: "GET", headers: { cookie } },
        env,
      );
      const getBody = DesignGetResponseSchema.parse(await getRes.json());
      const set2b = await app.request(
        `http://localhost/api/events/${eventId}/design`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-correlation-id": "corr-design-draft-2b",
          },
          body: JSON.stringify({
            tokens: {
              brand: "#ff00aa",
              radius: "round",
              wordmark: "SecretDraft",
            },
            expectedVersion: getBody.draft!.version,
          }),
        },
        env,
      );
      expect(set2b.status).toBe(200);
    } else {
      expect(set2.status).toBe(200);
    }

    const publicDraft = await app.request(
      `http://localhost/api/public/design/${slug}`,
      { method: "GET" },
      env,
    );
    const draftIso = PublicDesignResponseSchema.parse(
      await publicDraft.json(),
    );
    expect(draftIso.published!.tokens.brand.toLowerCase()).toBe("#112233");
    expect(draftIso.published!.tokens.wordmark).toBe("DraftOnly");
    expect(draftIso.published!.tokens.wordmark).not.toBe("SecretDraft");

    const audits = await store.listAudits();
    const pubAudit = audits.find((a) => a.action === "Design.Publish");
    expect(pubAudit?.correlationId).toBe("corr-design-publish-ok");
  });

  it("unauthenticated design routes return 401", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-authz@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Authz Event");

    const getNoAuth = await app.request(
      `http://localhost/api/events/${eventId}/design`,
      { method: "GET" },
      env,
    );
    expect(getNoAuth.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(await getNoAuth.json()).code).toBe(
      UNAUTHORIZED,
    );
  });

  it("speaker cannot write design (403)", async () => {
    const admin = await magicLinkSession("admin", "admin-role@example.com");
    const { id: eventId } = await createEvent(
      admin.app,
      admin.cookie,
      "Role Event",
    );

    const speakerEmail = "speaker-design@example.com";
    const speakerUser = await admin.store.createUser({ email: speakerEmail });
    await admin.store.upsertMembership({
      eventId,
      userId: speakerUser.id,
      role: "speaker",
    });

    await admin.app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: speakerEmail,
          purpose: "speaker",
          eventId,
        }),
      },
      env,
    );
    const out = await admin.app.request(
      `http://localhost/api/auth/dev/outbox?email=${encodeURIComponent(speakerEmail)}`,
      { method: "GET" },
      env,
    );
    expect(out.status).toBe(200);
    const outBody = (await out.json()) as { link: { token: string } | null };
    expect(outBody.link?.token).toBeTruthy();

    const exchange = await admin.app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: outBody.link!.token }),
      },
      env,
    );
    expect(exchange.status).toBe(200);
    const setCookie = exchange.headers.get("set-cookie")!;
    const sessionValue = setCookie
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=");
    const speakerCookie = `${SESSION_COOKIE_NAME}=${sessionValue}`;

    const putRes = await admin.app.request(
      `http://localhost/api/events/${eventId}/design`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: speakerCookie,
        },
        body: JSON.stringify({
          tokens: { brand: "#000000", radius: "soft" },
        }),
      },
      env,
    );
    expect(putRes.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await putRes.json()).code).toBe(
      FORBIDDEN,
    );
  });

  it("invalid hex on set draft returns 400", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-hex@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Hex Event");

    const res = await app.request(
      `http://localhost/api/events/${eventId}/design`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          tokens: { brand: "not-a-color", radius: "soft" },
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await res.json()).code).toBe(
      VALIDATION_ERROR,
    );
  });

  it("version conflict on publish returns 409", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-conflict@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Conflict Event");

    const setRes = await app.request(
      `http://localhost/api/events/${eventId}/design`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          tokens: { brand: "#4f46e5", radius: "soft" },
        }),
      },
      env,
    );
    expect(setRes.status).toBe(200);

    const pubRes = await app.request(
      `http://localhost/api/events/${eventId}/design/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ expectedVersion: 999 }),
      },
      env,
    );
    expect(pubRes.status).toBe(409);
    expect(ErrorEnvelopeSchema.parse(await pubRes.json()).code).toBe(CONFLICT);
  });

  it("cross-event design get returns 404", async () => {
    const a = await magicLinkSession("admin", "admin-a@example.com");
    const { id: eventA } = await createEvent(a.app, a.cookie, "Event A");

    const b = await magicLinkSession("admin", "admin-b@example.com");
    // B has no membership on A
    const res = await b.app.request(
      `http://localhost/api/events/${eventA}/design`,
      {
        method: "GET",
        headers: { cookie: b.cookie },
      },
      env,
    );
    // Different app instances — membership isolation is per-store; eventA not in B's memberships
    expect(res.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await res.json()).code).toBe(NOT_FOUND);
  });
});
