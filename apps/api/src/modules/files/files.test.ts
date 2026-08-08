/**
 * Section 4.2 — R2 file uploads (Vitest).
 *
 * Named assertions from spec:
 * - assert application/x-msdownload presign 400
 * - assert complete without presign 400
 * - assert file_assets row has r2_key not bytes
 *
 * Plus: headshot jpeg ok, download requires auth, Zod 400, authz 401/403,
 * audit_events + correlationId, virus_scan_status=unscanned stub.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  FilePresignResponseSchema,
  FileUploadResponseSchema,
  FileCompleteResponseSchema,
  FileAssetDtoSchema,
  EventResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  SESSION_COOKIE_NAME,
  HEADSHOT_MIME_ALLOWLIST,
  SLIDES_MIME_ALLOWLIST,
  VIRUS_SCAN_UNSCANNED,
  FILE_UPLOAD_MAX_BYTES,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

/** Minimal JPEG (SOI + APP0 stub). */
const MINI_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

/** Minimal PDF header. */
const MINI_PDF = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xc7, 0xec,
]);

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
  name = "Files Event",
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-create-for-files",
      },
      body: JSON.stringify({ name, timezone: "UTC" }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const parsed = EventResponseSchema.parse(await res.json());
  return { id: parsed.event.id, slug: parsed.event.slug };
}

describe("4.2 R2 file uploads", () => {
  it("assert application/x-msdownload presign 400", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-exe@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Exe Reject Event");

    const res = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-exe-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "application/x-msdownload",
          size: 4096,
          filename: "malware.exe",
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(VALIDATION_ERROR);
    expect(body.error.toLowerCase()).toMatch(/executable|not allowed|mime/);
  });

  it("assert complete without presign 400", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-complete-nopresign@example.com",
    );
    await createEvent(app, cookie, "Complete No Presign");

    const res = await app.request(
      "http://localhost/api/files/missing-file-id/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-complete-nopresign",
        },
        body: JSON.stringify({
          checksum: "abc123deadbeef",
          filename: "orphan.jpg",
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(VALIDATION_ERROR);
    expect(body.error.toLowerCase()).toMatch(/presign|not found|fileid/);
  });

  it("assert file_assets row has r2_key not bytes", async () => {
    const { app, store, design, cookie } = await magicLinkSession(
      "admin",
      "admin-meta@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Metadata Event");

    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-meta-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "image/jpeg",
          size: MINI_JPEG.byteLength,
          filename: "speaker-headshot.jpg",
        }),
      },
      env,
    );
    expect(presign.status).toBe(200);
    const png = FilePresignResponseSchema.parse(await presign.json());

    const row = await design.findFile(eventId, png.fileId);
    expect(row).not.toBeNull();
    expect(row!.r2Key).toMatch(
      new RegExp(`^events/${eventId}/headshot/${png.fileId}\\.`),
    );
    expect(row!.r2Key.length).toBeGreaterThan(0);
    // Metadata only — no binary payload on the row
    expect(row).not.toHaveProperty("bytes");
    expect(row).not.toHaveProperty("content");
    expect(row).not.toHaveProperty("data");
    expect(row!.virusScanStatus).toBe(VIRUS_SCAN_UNSCANNED);

    // Bytes live in object storage (R2 / isolate map), not D1 metadata
    const beforeUpload = await design.getFileBytes(eventId, png.fileId);
    expect(beforeUpload).toBeNull();

    const upload = await app.request(
      `http://localhost${png.url}`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/jpeg",
          cookie,
          "x-correlation-id": "corr-meta-upload",
        },
        body: MINI_JPEG,
      },
      env,
    );
    expect(upload.status).toBe(200);
    FileUploadResponseSchema.parse(await upload.json());

    const afterMeta = await design.findFile(eventId, png.fileId);
    expect(afterMeta!.r2Key).toBe(row!.r2Key);
    expect(afterMeta).not.toHaveProperty("bytes");
    const blob = await design.getFileBytes(eventId, png.fileId);
    expect(blob).not.toBeNull();
    expect(blob!.bytes.byteLength).toBe(MINI_JPEG.byteLength);

    const complete = await app.request(
      `http://localhost/api/files/${png.fileId}/complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-meta-complete",
        },
        body: JSON.stringify({
          eventId,
          checksum: "sha256:deadbeefcafebabe",
          filename: "speaker-headshot-final.jpg",
        }),
      },
      env,
    );
    expect(complete.status).toBe(200);
    const completed = FileCompleteResponseSchema.parse(await complete.json());
    FileAssetDtoSchema.parse(completed.file);
    expect(completed.file.r2Key).toBe(row!.r2Key);
    expect(completed.file.checksum).toBe("sha256:deadbeefcafebabe");
    expect(completed.file.filename).toBe("speaker-headshot-final.jpg");
    expect(completed.file.virusScanStatus).toBe(VIRUS_SCAN_UNSCANNED);
    // Response is metadata DTO — no byte payload
    expect(completed.file).not.toHaveProperty("bytes");

    const audits = await store.listAudits();
    const completeAudit = audits.find(
      (a) =>
        a.action === "File.CompleteUpload" && a.entityId === png.fileId,
    );
    expect(completeAudit).toBeDefined();
    expect(completeAudit!.correlationId).toBe("corr-meta-complete");
    const after = JSON.parse(completeAudit!.afterJson!);
    expect(after.r2Key).toBe(row!.r2Key);
    expect(after.bytesStoredInD1).toBe(false);
  });

  it("headshot jpeg presign + upload ok (AC: Headshot jpeg ok)", async () => {
    expect(HEADSHOT_MIME_ALLOWLIST).toContain("image/jpeg");
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-jpeg@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "JPEG Headshot");

    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-jpeg-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "image/jpeg",
          size: MINI_JPEG.byteLength,
          filename: "me.jpg",
        }),
      },
      env,
    );
    expect(presign.status).toBe(200);
    const body = FilePresignResponseSchema.parse(await presign.json());
    expect(body.purpose).toBe("headshot");
    expect(body.mime).toBe("image/jpeg");

    const upload = await app.request(`http://localhost${body.url}`, {
      method: "PUT",
      headers: {
        "content-type": "image/jpeg",
        cookie,
        "x-correlation-id": "corr-jpeg-upload",
      },
      body: MINI_JPEG,
    }, env);
    expect(upload.status).toBe(200);
  });

  it("slides pdf presign ok", async () => {
    expect(SLIDES_MIME_ALLOWLIST).toContain("application/pdf");
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-slides@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Slides Event");

    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-slides-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "slides",
          mime: "application/pdf",
          size: MINI_PDF.byteLength,
          filename: "talk.pdf",
        }),
      },
      env,
    );
    expect(presign.status).toBe(200);
    const body = FilePresignResponseSchema.parse(await presign.json());
    expect(body.purpose).toBe("slides");

    const upload = await app.request(`http://localhost${body.url}`, {
      method: "PUT",
      headers: {
        "content-type": "application/pdf",
        cookie,
        "x-correlation-id": "corr-slides-upload",
      },
      body: MINI_PDF,
    }, env);
    expect(upload.status).toBe(200);
  });

  it("download requires auth — public GET headshot 404", async () => {
    const { app, design, cookie } = await magicLinkSession(
      "admin",
      "admin-dl@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Download Auth");

    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-dl-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "image/jpeg",
          size: MINI_JPEG.byteLength,
        }),
      },
      env,
    );
    const body = FilePresignResponseSchema.parse(await presign.json());
    await app.request(`http://localhost${body.url}`, {
      method: "PUT",
      headers: {
        "content-type": "image/jpeg",
        cookie,
        "x-correlation-id": "corr-dl-upload",
      },
      body: MINI_JPEG,
    }, env);

    // Even after upload, public endpoint never serves private portal files
    const pub = await app.request(
      `http://localhost/api/public/files/${body.fileId}`,
      { method: "GET" },
      env,
    );
    expect(pub.status).toBe(404);
    const envBody = ErrorEnvelopeSchema.parse(await pub.json());
    expect(envBody.code).toBe("NOT_FOUND");

    // Bytes exist in private storage for authenticated consumers
    const blob = await design.getFileBytes(eventId, body.fileId);
    expect(blob).not.toBeNull();
  });

  it("unauthenticated presign returns 401", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-unauth@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie);

    const res = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-unauth-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "image/jpeg",
          size: 100,
        }),
      },
      env,
    );
    expect(res.status).toBe(401);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(UNAUTHORIZED);
  });

  it("evaluator role cannot presign headshot (403)", async () => {
    const { app, outbox } = createAppWithAuth({ cookieSecure: true });

    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin-for-eval@example.com",
          purpose: "admin",
        }),
      },
      env,
    );
    const adminTok = outbox.lastForEmail("admin-for-eval@example.com")!.token;
    const adminEx = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: adminTok }),
      },
      env,
    );
    const adminCookie = `${SESSION_COOKIE_NAME}=${adminEx.headers
      .get("set-cookie")!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=")}`;
    const { id: eventId } = await createEvent(
      app,
      adminCookie,
      "Role Gate Event",
    );

    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "eval-gate@example.com",
          purpose: "evaluator",
          eventId,
        }),
      },
      env,
    );
    const evalTok = outbox.lastForEmail("eval-gate@example.com")!.token;
    const evalEx = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: evalTok }),
      },
      env,
    );
    const evalCookie = `${SESSION_COOKIE_NAME}=${evalEx.headers
      .get("set-cookie")!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=")}`;

    const res = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: evalCookie,
          "x-correlation-id": "corr-eval-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "image/jpeg",
          size: 100,
        }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(FORBIDDEN);
  });

  it("speaker can presign headshot on own event", async () => {
    const { app, outbox } = createAppWithAuth({ cookieSecure: true });
    // Admin creates event
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin-spk@example.com",
          purpose: "admin",
        }),
      },
      env,
    );
    const adminTok = outbox.lastForEmail("admin-spk@example.com")!.token;
    const adminEx = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: adminTok }),
      },
      env,
    );
    const adminCookie = `${SESSION_COOKIE_NAME}=${adminEx.headers
      .get("set-cookie")!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=")}`;
    const { id: eventId } = await createEvent(app, adminCookie, "Speaker Upload");

    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "speaker-up@example.com",
          purpose: "speaker",
          eventId,
        }),
      },
      env,
    );
    const spTok = outbox.lastForEmail("speaker-up@example.com")!.token;
    const spEx = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: spTok }),
      },
      env,
    );
    const spCookie = `${SESSION_COOKIE_NAME}=${spEx.headers
      .get("set-cookie")!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=")}`;

    const res = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: spCookie,
          "x-correlation-id": "corr-speaker-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "image/jpeg",
          size: MINI_JPEG.byteLength,
          filename: "speaker.jpg",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = FilePresignResponseSchema.parse(await res.json());
    expect(body.purpose).toBe("headshot");
  });

  it("validation 400 on complete missing checksum", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-val@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie);

    const presign = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-val-presign",
        },
        body: JSON.stringify({
          eventId,
          purpose: "slides",
          mime: "application/pdf",
          size: 100,
        }),
      },
      env,
    );
    const p = FilePresignResponseSchema.parse(await presign.json());

    const res = await app.request(
      `http://localhost/api/files/${p.fileId}/complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-val-complete",
        },
        body: JSON.stringify({ eventId }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(VALIDATION_ERROR);
  });

  it("presign audit includes correlationId", async () => {
    const { app, store, cookie } = await magicLinkSession(
      "admin",
      "admin-audit@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie);

    const res = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-audit-presign-42",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "image/png",
          size: 64,
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const audits = await store.listAudits();
    const a = audits.find(
      (x) =>
        x.action === "File.PresignUpload" &&
        x.correlationId === "corr-audit-presign-42",
    );
    expect(a).toBeDefined();
    const after = JSON.parse(a!.afterJson!);
    expect(after.virusScanStatus).toBe(VIRUS_SCAN_UNSCANNED);
    expect(after.r2Key).toBeTruthy();
  });

  it("size over 10 MiB rejected at Zod boundary", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-size@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie);

    const res = await app.request(
      "http://localhost/api/files/presign",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-size",
        },
        body: JSON.stringify({
          eventId,
          purpose: "headshot",
          mime: "image/jpeg",
          size: FILE_UPLOAD_MAX_BYTES + 1,
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(VALIDATION_ERROR);
  });
});
