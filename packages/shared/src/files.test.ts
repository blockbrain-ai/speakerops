import { describe, expect, it } from "vitest";
import {
  invalidFileSignature,
  sanitizeContentDispositionFilename,
} from "./files.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);

describe("invalidFileSignature", () => {
  it("accepts full PNG / JPEG / PDF signatures", () => {
    expect(invalidFileSignature(PNG, "image/png")).toBeNull();
    expect(invalidFileSignature(JPEG, "image/jpeg")).toBeNull();
    expect(invalidFileSignature(PDF, "application/pdf")).toBeNull();
  });

  it("rejects HTML labeled as PNG and truncated PNG (4-byte prefix)", () => {
    const html = new TextEncoder().encode("<html></html>");
    expect(invalidFileSignature(html, "image/png")).toBe(
      "PNG body signature invalid",
    );
    const short = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    expect(invalidFileSignature(short, "image/png")).toBe(
      "PNG body signature invalid",
    );
  });

  it("rejects JPEG/PDF mismatches", () => {
    expect(invalidFileSignature(PNG, "image/jpeg")).toBe(
      "JPEG body signature invalid",
    );
    expect(invalidFileSignature(PNG, "application/pdf")).toBe(
      "PDF body signature invalid",
    );
  });

  it("ignores unsigned mime types", () => {
    expect(invalidFileSignature(new Uint8Array([1, 2, 3]), "application/zip")).toBeNull();
  });
});

describe("SafeUploadFilenameSchema", () => {
  it("rejects CR/LF and path characters at the API boundary", async () => {
    const { SafeUploadFilenameSchema } = await import("./design.js");
    expect(SafeUploadFilenameSchema.safeParse('evil\r\n"x.pdf').success).toBe(
      false,
    );
    expect(SafeUploadFilenameSchema.safeParse("../etc/passwd").success).toBe(
      false,
    );
    expect(SafeUploadFilenameSchema.safeParse("talk-v2.pdf").success).toBe(true);
  });
});

describe("sanitizeContentDispositionFilename", () => {
  it("keeps safe tokens", () => {
    expect(sanitizeContentDispositionFilename("talk-v2.pdf")).toBe("talk-v2.pdf");
  });

  it("strips CR/LF quotes slashes and empty", () => {
    expect(sanitizeContentDispositionFilename('evil\r\n"x.pdf')).toBe("evil_x.pdf");
    expect(sanitizeContentDispositionFilename("../etc/passwd")).toBe("etc_passwd");
    expect(sanitizeContentDispositionFilename('""')).toBe("file");
  });
});
