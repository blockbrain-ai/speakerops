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
  FileUploadResponseSchema,
  FILE_UPLOAD_MAX_BYTES,
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
import {
  MemoryDesignStore,
  type DesignStore,
  type FileBlob,
} from "./store.js";

/** Minimal valid PNG signature + IHDR stub (16 bytes). */
const MINI_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);

const env = { APP_VERSION: "0.1.0" };

/** Design store that can force putFileBytes to fail once (claim-release recovery). */
function designStoreWithFlakyPut(): {
  design: DesignStore;
  failNextPut: () => void;
} {
  const inner = new MemoryDesignStore();
  let failPuts = 0;
  const design: DesignStore = {
    findDraft: (e) => inner.findDraft(e),
    upsertDraft: (r, v) => inner.upsertDraft(r, v),
    findPublished: (e) => inner.findPublished(e),
    upsertPublished: (r) => inner.upsertPublished(r),
    insertFile: (r) => inner.insertFile(r),
    findFile: (e, id) => inner.findFile(e, id),
    findFileById: (id) => inner.findFileById(id),
    listFilesForParticipation: (e, p) =>
      inner.listFilesForParticipation(e, p),
    claimFileUpload: (e, id, p) => inner.claimFileUpload(e, id, p),
    completeFileUpload: (e, id) => inner.completeFileUpload(e, id),
    completeFileChecksum: (e, id, p) => inner.completeFileChecksum(e, id, p),
    releaseFileUploadClaim: (e, id, p) =>
      inner.releaseFileUploadClaim(e, id, p),
    async putFileBytes(eventId: string, fileId: string, blob: FileBlob) {
      if (failPuts > 0) {
        failPuts -= 1;
        throw new Error("simulated R2 put failure");
      }
      return inner.putFileBytes(eventId, fileId, blob);
    },
    getFileBytes: (e, id) => inner.getFileBytes(e, id),
  };
  return {
    design,
    failNextPut: () => {
      failPuts += 1;
    },
  };
}

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

    // PNG presign succeeds; body not ready until upload
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
    expect(png.url).toContain(`/api/files/${png.fileId}/upload`);

    const uploadRes = await app.request(
      `http://localhost${png.url}`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          cookie,
          "x-correlation-id": "corr-logo-upload",
        },
        body: MINI_PNG,
      },
      env,
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = FileUploadResponseSchema.parse(await uploadRes.json());
    expect(uploadBody.uploaded).toBe(true);
    expect(uploadBody.fileId).toBe(png.fileId);
    expect(uploadBody.size).toBe(MINI_PNG.byteLength);

    // Draft-only upload must not be publicly retrievable before Design.Publish
    const publicBeforePublish = await app.request(
      `http://localhost/api/public/files/${png.fileId}`,
      { method: "GET" },
      env,
    );
    expect(publicBeforePublish.status).toBe(404);

    // Attach logo to draft and publish so public CFP can serve it
    const setRes = await app.request(
      `http://localhost/api/events/${eventId}/design`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-logo-draft",
        },
        body: JSON.stringify({
          tokens: {
            brand: "#0b57d0",
            radius: "soft",
            logoFileId: png.fileId,
          },
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
          "x-correlation-id": "corr-logo-publish",
        },
        body: JSON.stringify({ expectedVersion: draft.draft.version }),
      },
      env,
    );
    expect(pubRes.status).toBe(200);

    const publicImg = await app.request(
      `http://localhost/api/public/files/${png.fileId}`,
      { method: "GET" },
      env,
    );
    expect(publicImg.status).toBe(200);
    expect(publicImg.headers.get("content-type")).toMatch(/image\/png/);
    const served = new Uint8Array(await publicImg.arrayBuffer());
    expect(served[0]).toBe(0x89);
    expect(served[1]).toBe(0x50);
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

  it("File.Upload rejects body larger than presign declared size", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-upload-size@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Upload Size");

    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-upload-size-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "logo",
          mime: "image/png",
          size: 8, // smaller than MINI_PNG
          filename: "tiny-budget.png",
        }),
      },
      env,
    );
    expect(presign.status).toBe(200);
    const png = FilePresignResponseSchema.parse(await presign.json());

    const over = await app.request(`http://localhost${png.url}`, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        cookie,
        "x-correlation-id": "corr-upload-size-body",
      },
      body: MINI_PNG,
    }, env);
    expect(over.status).toBe(400);
    const envBody = ErrorEnvelopeSchema.parse(await over.json());
    expect(envBody.code).toBe(VALIDATION_ERROR);
    expect(envBody.error.toLowerCase()).toMatch(/size|presign|exceed/);
  });

  it("File.Upload is single-use (no overwrite)", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-upload-once@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Upload Once");

    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-upload-once-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "logo",
          mime: "image/png",
          size: MINI_PNG.byteLength,
          filename: "once.png",
        }),
      },
      env,
    );
    const png = FilePresignResponseSchema.parse(await presign.json());

    const first = await app.request(`http://localhost${png.url}`, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        cookie,
        "x-correlation-id": "corr-upload-once-1",
      },
      body: MINI_PNG,
    }, env);
    expect(first.status).toBe(200);

    const second = await app.request(`http://localhost${png.url}`, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        cookie,
        "x-correlation-id": "corr-upload-once-2",
      },
      body: MINI_PNG,
    }, env);
    expect(second.status).toBe(409);
    expect(ErrorEnvelopeSchema.parse(await second.json()).code).toBe(CONFLICT);
  });

  it("File.Upload concurrent PUTs: only one claim wins (atomic single-use)", async () => {
    const { app, cookie, design, store } = await magicLinkSession(
      "admin",
      "admin-upload-race@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Upload Race");

    const bodyA = new Uint8Array(MINI_PNG);
    const bodyB = new Uint8Array(MINI_PNG);
    bodyB[bodyB.length - 1] = 0xff; // distinct payload; same length budget

    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-upload-race-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "logo",
          mime: "image/png",
          size: bodyA.byteLength,
          filename: "race.png",
        }),
      },
      env,
    );
    const png = FilePresignResponseSchema.parse(await presign.json());

    const [resA, resB] = await Promise.all([
      app.request(`http://localhost${png.url}`, {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          cookie,
          "x-correlation-id": "corr-upload-race-a",
        },
        body: bodyA,
      }, env),
      app.request(`http://localhost${png.url}`, {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          cookie,
          "x-correlation-id": "corr-upload-race-b",
        },
        body: bodyB,
      }, env),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = resA.status === 200 ? resA : resB;
    const loser = resA.status === 409 ? resA : resB;
    expect(FileUploadResponseSchema.parse(await winner.json()).uploaded).toBe(
      true,
    );
    expect(ErrorEnvelopeSchema.parse(await loser.json()).code).toBe(CONFLICT);

    // Exactly one stored blob — winner's bytes, not a last-writer-wins mix.
    const blob = await design.getFileBytes(eventId, png.fileId);
    expect(blob).not.toBeNull();
    const stored = new Uint8Array(blob!.bytes);
    const matchesA =
      stored.length === bodyA.length &&
      stored.every((b, i) => b === bodyA[i]);
    const matchesB =
      stored.length === bodyB.length &&
      stored.every((b, i) => b === bodyB[i]);
    expect(matchesA || matchesB).toBe(true);
    expect(matchesA && matchesB).toBe(false);

    const meta = await design.findFile(eventId, png.fileId);
    expect(meta?.uploaded).toBe(true);
    expect(meta?.size).toBe(bodyA.byteLength);

    // Only the winning claim may emit File.Upload audit.
    const uploadAudits = (await store.listAudits()).filter(
      (a) => a.action === "File.Upload" && a.entityId === png.fileId,
    );
    expect(uploadAudits).toHaveLength(1);
  });

  it("claimFileUpload is exclusive; put failure releases claim for retry", async () => {
    const { design } = await magicLinkSession(
      "admin",
      "admin-upload-claim@example.com",
    );
    const eventId = "01900000-0000-7000-8000-0000000000c1";
    const fileId = "01900000-0000-7000-8000-0000000000c2";
    const declaredSize = MINI_PNG.byteLength;

    await design.insertFile({
      id: fileId,
      eventId,
      ownerParticipationId: null,
      r2Key: `events/${eventId}/logo/${fileId}.png`,
      filename: "claim.png",
      mime: "image/png",
      size: declaredSize,
      checksum: null,
      purpose: "logo",
      createdAt: new Date().toISOString(),
      uploaded: false,
      uploadState: 0,
    });

    const [c1, c2] = await Promise.all([
      design.claimFileUpload(eventId, fileId, { size: declaredSize }),
      design.claimFileUpload(eventId, fileId, { size: declaredSize }),
    ]);
    const winners = [c1, c2].filter(Boolean);
    expect(winners).toHaveLength(1);
    // Claim is in-progress only — not stored/ready (uploaded stays false).
    expect(winners[0]!.uploaded).toBe(false);
    expect(winners[0]!.uploadState).toBe(2);

    // Simulate putFileBytes failure recovery path.
    await design.releaseFileUploadClaim(eventId, fileId, {
      size: declaredSize,
    });
    const afterRelease = await design.findFile(eventId, fileId);
    expect(afterRelease?.uploaded).toBe(false);
    expect(afterRelease?.uploadState).toBe(0);
    expect(afterRelease?.size).toBe(declaredSize);

    const retried = await design.claimFileUpload(eventId, fileId, {
      size: declaredSize - 1,
    });
    expect(retried?.uploaded).toBe(false);
    expect(retried?.uploadState).toBe(2);
    expect(retried?.size).toBe(declaredSize - 1);

    // Only complete after successful storage marks ready.
    const completed = await design.completeFileUpload(eventId, fileId);
    expect(completed?.uploaded).toBe(true);
    expect(completed?.uploadState).toBe(1);
  });

  it("File.Upload releases claim when storage put fails so client may retry", async () => {
    const { design, failNextPut } = designStoreWithFlakyPut();
    const { app, design: designStore, outbox } = createAppWithAuth({
      cookieSecure: true,
      designStore: design,
    });
    const email = "admin-upload-putfail@example.com";
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
    const sessionValue = setCookie
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=");
    const cookie = `${SESSION_COOKIE_NAME}=${sessionValue}`;

    const { id: eventId } = await createEvent(app, cookie, "Upload PutFail");
    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-upload-putfail-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "logo",
          mime: "image/png",
          size: MINI_PNG.byteLength,
          filename: "putfail.png",
        }),
      },
      env,
    );
    const png = FilePresignResponseSchema.parse(await presign.json());

    failNextPut();
    const failed = await app.request(`http://localhost${png.url}`, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        cookie,
        "x-correlation-id": "corr-upload-putfail-1",
      },
      body: MINI_PNG,
    }, env);
    expect(failed.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await failed.json()).code).toBe(
      VALIDATION_ERROR,
    );

    const pending = await designStore.findFile(eventId, png.fileId);
    expect(pending?.uploaded).toBe(false);
    expect(pending?.size).toBe(MINI_PNG.byteLength);
    expect(await designStore.getFileBytes(eventId, png.fileId)).toBeNull();

    // Retry after recovery succeeds and marks uploaded once.
    const retry = await app.request(`http://localhost${png.url}`, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        cookie,
        "x-correlation-id": "corr-upload-putfail-2",
      },
      body: MINI_PNG,
    }, env);
    expect(retry.status).toBe(200);
    expect(FileUploadResponseSchema.parse(await retry.json()).uploaded).toBe(
      true,
    );
    const done = await designStore.findFile(eventId, png.fileId);
    expect(done?.uploaded).toBe(true);
    expect(await designStore.getFileBytes(eventId, png.fileId)).not.toBeNull();
  });

  it("File.Upload rejects expired presign and oversized Content-Length", async () => {
    const { app, cookie, design } = await magicLinkSession(
      "admin",
      "admin-upload-ttl@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Upload TTL");

    // Insert an already-expired pending file (created_at far in the past).
    const expiredId = "01900000-0000-7000-8000-0000000000e1";
    await design.insertFile({
      id: expiredId,
      eventId,
      ownerParticipationId: null,
      r2Key: `events/${eventId}/logo/${expiredId}.png`,
      filename: "expired.png",
      mime: "image/png",
      size: MINI_PNG.byteLength,
      checksum: null,
      purpose: "logo",
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      uploaded: false,
    });

    const expiredRes = await app.request(
      `http://localhost/api/files/${expiredId}/upload?eventId=${encodeURIComponent(eventId)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          cookie,
          "x-correlation-id": "corr-upload-expired",
        },
        body: MINI_PNG,
      },
      env,
    );
    expect(expiredRes.status).toBe(400);
    const expiredBody = ErrorEnvelopeSchema.parse(await expiredRes.json());
    expect(expiredBody.code).toBe(VALIDATION_ERROR);
    expect(expiredBody.error.toLowerCase()).toMatch(/expir/);

    // Content-Length above 10 MiB must be refused before buffering a huge body.
    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-upload-cl-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "logo",
          mime: "image/png",
          size: FILE_UPLOAD_MAX_BYTES,
          filename: "max.png",
        }),
      },
      env,
    );
    const png = FilePresignResponseSchema.parse(await presign.json());
    const clRes = await app.request(`http://localhost${png.url}`, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        cookie,
        "content-length": String(FILE_UPLOAD_MAX_BYTES + 1),
        "x-correlation-id": "corr-upload-cl",
      },
      // Body intentionally tiny; route must reject on Content-Length alone.
      body: MINI_PNG,
    }, env);
    expect(clRes.status).toBe(400);
    const clBody = ErrorEnvelopeSchema.parse(await clRes.json());
    expect(clBody.code).toBe(VALIDATION_ERROR);
    expect(clBody.error.toLowerCase()).toMatch(/size|maximum|exceed/);
  });
});
