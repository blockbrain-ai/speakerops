/**
 * Section 8.6 — Optional Cloudflare dogfood remote health smoke (S-CF).
 *
 * When SMOKE_BASE_URL is set (private workers.dev / preview base, no trailing
 * path), asserts GET /health → 200 and body.ok === true.
 *
 * When unset, the suite skips — local pnpm test:e2e stays green without CF.
 * No browser inventory ownership (no @inv tags).
 *
 * @see docs/OPERATIONS.md
 * @see docs/sections/8.6-cloudflare-dogfood-deploy.md
 */
import { test, expect } from "@playwright/test";

const smokeBase = (process.env.SMOKE_BASE_URL || "").replace(/\/$/, "");

test.describe("8.6 optional CF dogfood smoke (S-CF)", () => {
  test("remote GET /health returns 200 when SMOKE_BASE_URL is set", async ({
    request,
  }) => {
    test.skip(
      !smokeBase,
      "SMOKE_BASE_URL unset — optional remote dogfood smoke skipped",
    );

    const res = await request.get(`${smokeBase}/health`, {
      timeout: 30_000,
    });
    expect(res.status(), `GET ${smokeBase}/health`).toBe(200);

    const body: unknown = await res.json();
    expect(body).toMatchObject({ ok: true });
    expect(typeof (body as { version?: unknown }).version).toBe("string");
  });
});
