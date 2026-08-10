/**
 * Section 8.3 — Security hardening (Vitest).
 *
 * Named assertions from spec:
 * - assert Content-Security-Policy header present on HTML
 * - assert rate limit returns 429 after threshold in test
 * - audit policy documented + script wired
 * - A10/C09 inventory tags still Playwright-bound
 *
 * Runtime CSP/429 behaviour: apps/api/src/middleware/security.test.ts
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("8.3 security hardening", () => {
  it("assert Content-Security-Policy policy is non-empty and strict baseline", () => {
    const shared = readFileSync(
      join(root, "packages/shared/src/security.ts"),
      "utf8",
    );
    expect(shared).toMatch(/CONTENT_SECURITY_POLICY/);
    expect(shared).toMatch(/default-src\s+'self'/);
    expect(shared).toMatch(/frame-ancestors\s+'none'/);
    expect(shared).toMatch(/object-src\s+'none'/);
    expect(shared).toMatch(/X-Content-Type-Options/);
    expect(shared).toMatch(/nosniff/);
  });

  it("middleware + docs + audit script deliverables exist", () => {
    const files = [
      "apps/api/src/middleware/security.ts",
      "apps/api/src/middleware/security.test.ts",
      "packages/shared/src/security.ts",
      "scripts/dependency-audit.mjs",
      "docs/SECURITY.md",
      "docs/sections/8.3-security-hardening.md",
      "apps/web/index.html",
      "apps/web/vite.config.ts",
    ];
    for (const rel of files) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
  });

  it("index.html meta CSP aligns with shared policy (turnstile + CF insights)", () => {
    const html = readFileSync(join(root, "apps/web/index.html"), "utf8");
    expect(html).toMatch(/http-equiv=["']Content-Security-Policy["']/i);
    expect(html).toMatch(/default-src\s+'self'/);
    expect(html).toMatch(/challenges\.cloudflare\.com/);
    // Zone-injected Web Analytics beacon must not CSP-block console on dogfood
    expect(html).toMatch(/static\.cloudflareinsights\.com/);
    expect(html).toMatch(/cloudflareinsights\.com/);
    expect(html).toMatch(/object-src\s+'none'/);
  });

  it("vite config applies SECURITY_HEADERS (CSP on HTML responses)", () => {
    const vite = readFileSync(join(root, "apps/web/vite.config.ts"), "utf8");
    // Production/preview keep strict SECURITY_HEADERS; dev uses DEV variant
    // so @vitejs/plugin-react preamble is not blocked under E2E.
    expect(vite).toMatch(/SECURITY_HEADERS/);
    expect(vite).toMatch(/SECURITY_HEADERS_DEV|CONTENT_SECURITY_POLICY_DEV/);
    expect(vite).toMatch(/headers:\s*(devHeaders|productionHeaders|securityHeaders)/);
  });

  it("production CSP does not allow script unsafe-inline; dev CSP is separate", () => {
    const shared = readFileSync(
      join(root, "packages/shared/src/security.ts"),
      "utf8",
    );
    // Production policy string must not embed script-src unsafe-inline.
    expect(shared).toMatch(
      /CONTENT_SECURITY_POLICY\s*=\s*\[[\s\S]*?script-src 'self' https:\/\/challenges\.cloudflare\.com https:\/\/static\.cloudflareinsights\.com/,
    );
    expect(shared).toMatch(/static\.cloudflareinsights\.com/);
    expect(shared).toMatch(/CONTENT_SECURITY_POLICY_DEV/);
    expect(shared).toMatch(
      /CONTENT_SECURITY_POLICY_DEV[\s\S]*?script-src 'self' 'unsafe-inline'/,
    );
  });

  it("API composition root registers securityHeadersMiddleware", () => {
    const index = readFileSync(
      join(root, "apps/api/src/index.ts"),
      "utf8",
    );
    expect(index).toMatch(/securityHeadersMiddleware/);
    expect(index).toMatch(/cookieSecure:\s*true/);
  });

  it("package.json wires audit:deps script", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["audit:deps"]).toMatch(/dependency-audit/);
  });

  it("docs/SECURITY.md documents pnpm/npm audit fail-on high/critical", () => {
    const md = readFileSync(join(root, "docs/SECURITY.md"), "utf8");
    expect(md).toMatch(/audit/i);
    expect(md).toMatch(/high/i);
    expect(md).toMatch(/critical/i);
    expect(md).toMatch(/pnpm/);
    expect(md).toMatch(/Content-Security-Policy|CSP/);
    expect(md).toMatch(/HttpOnly/);
  });

  it("dependency-audit.mjs encodes fail-on high/critical policy", () => {
    const src = readFileSync(
      join(root, "scripts/dependency-audit.mjs"),
      "utf8",
    );
    expect(src).toMatch(/AUDIT_LEVEL\s*=\s*["']high["']/);
    expect(src).toMatch(/critical/);
    expect(src).toMatch(/DEPENDENCY_AUDIT_POLICY/);
  });

  it("A10 and C09 Playwright @inv tags remain bound", () => {
    const a10 = readFileSync(
      join(root, "playwright/e2e/public_cfp.spec.ts"),
      "utf8",
    );
    const c09 = readFileSync(
      join(root, "playwright/e2e/design_kit.spec.ts"),
      "utf8",
    );
    expect(a10).toMatch(/@inv:A10/);
    expect(c09).toMatch(/@inv:C09/);
  });

  it("security.test.ts includes named CSP HTML and 429 assertions", () => {
    const src = readFileSync(
      join(root, "apps/api/src/middleware/security.test.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /assert Content-Security-Policy header present on HTML/,
    );
    expect(src).toMatch(
      /assert rate limit returns 429 after threshold in test/,
    );
  });
});
