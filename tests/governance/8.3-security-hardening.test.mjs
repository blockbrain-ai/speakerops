/**
 * Section 8.3 — Security hardening governance (node:test).
 *
 * Locks AC surface for `pnpm test:ci`:
 * - CSP middleware present
 * - XSS inventory A10/C09 Playwright-bound
 * - rate limit test present
 * - npm/pnpm audit policy documented
 * - no secrets patterns in new security files
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
  /TURNSTILE_SECRET_KEY\s*=\s*["'][^"']{10,}["']/,
];

const paths = {
  middleware: join(root, "apps/api/src/middleware/security.ts"),
  middlewareTest: join(root, "apps/api/src/middleware/security.test.ts"),
  sharedSecurity: join(root, "packages/shared/src/security.ts"),
  apiIndex: join(root, "apps/api/src/index.ts"),
  auditScript: join(root, "scripts/dependency-audit.mjs"),
  securityDoc: join(root, "docs/SECURITY.md"),
  sectionDoc: join(root, "docs/sections/8.3-security-hardening.md"),
  packageJson: join(root, "package.json"),
  indexHtml: join(root, "apps/web/index.html"),
  viteConfig: join(root, "apps/web/vite.config.ts"),
  vitest: join(root, "tests/8.3-security-hardening.test.ts"),
  a10: join(root, "playwright/e2e/public_cfp.spec.ts"),
  c09: join(root, "playwright/e2e/design_kit.spec.ts"),
  inventory: join(
    root,
    "KMS-competition/initiative/BROWSER_E2E_INVENTORY.md",
  ),
};

describe("8.3 Security hardening", () => {
  it("deliverables exist", () => {
    for (const [name, p] of Object.entries(paths)) {
      assert.equal(existsSync(p), true, `missing ${name}: ${p}`);
    }
  });

  it("CSP middleware registered and policy exports frame-ancestors none", () => {
    const mw = readFileSync(paths.middleware, "utf8");
    const shared = readFileSync(paths.sharedSecurity, "utf8");
    const index = readFileSync(paths.apiIndex, "utf8");
    assert.match(mw, /securityHeadersMiddleware/);
    assert.match(mw, /Content-Security-Policy|SECURITY_HEADERS/);
    assert.match(shared, /frame-ancestors\s+'none'/);
    assert.match(shared, /CONTENT_SECURITY_POLICY/);
    assert.match(index, /securityHeadersMiddleware/);
    assert.match(index, /app\.use\(["']\*["'],\s*securityHeadersMiddleware\)/);
  });

  it("assert Content-Security-Policy header present on HTML (named test)", () => {
    const t = readFileSync(paths.middlewareTest, "utf8");
    assert.match(
      t,
      /assert Content-Security-Policy header present on HTML/,
    );
    assert.match(t, /c\.html\(/);
    assert.match(t, /content-type/i);
    assert.match(t, /Content-Security-Policy/);
  });

  it("assert rate limit returns 429 after threshold in test (named test)", () => {
    const t = readFileSync(paths.middlewareTest, "utf8");
    assert.match(
      t,
      /assert rate limit returns 429 after threshold in test/,
    );
    assert.match(t, /CfpRateLimiter/);
    assert.match(t, /toBe\(429\)/);
    assert.match(t, /RATE_LIMITED/);
  });

  it("npm/pnpm audit policy documented", () => {
    const sec = readFileSync(paths.securityDoc, "utf8");
    const section = readFileSync(paths.sectionDoc, "utf8");
    const script = readFileSync(paths.auditScript, "utf8");
    const pkg = JSON.parse(readFileSync(paths.packageJson, "utf8"));
    assert.match(sec, /Dependency audit policy/i);
    assert.match(sec, /high/i);
    assert.match(sec, /critical/i);
    assert.match(sec, /pnpm/);
    assert.match(section, /audit/i);
    assert.match(script, /AUDIT_LEVEL\s*=\s*["']high["']/);
    assert.equal(
      typeof pkg.scripts?.["audit:deps"],
      "string",
      "audit:deps script",
    );
    assert.match(pkg.scripts["audit:deps"], /dependency-audit/);
  });

  it("XSS inventory A10 and C09 remain REQUIRED PASS with Playwright @inv", () => {
    const inv = readFileSync(paths.inventory, "utf8");
    const a10 = readFileSync(paths.a10, "utf8");
    const c09 = readFileSync(paths.c09, "utf8");
    assert.match(a10, /@inv:A10/);
    assert.match(c09, /@inv:C09/);
    // Inventory rows still present and PASS
    assert.match(inv, /\| A10 \|/);
    assert.match(inv, /\| C09 \|/);
    const a10Row = inv.split("\n").find((l) => l.includes("| A10 |"));
    const c09Row = inv.split("\n").find((l) => l.includes("| C09 |"));
    assert.ok(a10Row, "A10 row");
    assert.ok(c09Row, "C09 row");
    assert.match(a10Row, /REQUIRED/);
    assert.match(a10Row, /PASS/);
    assert.match(c09Row, /REQUIRED/);
    assert.match(c09Row, /PASS/);
  });

  it("production cookieSecure forced in createAppFromBindings", () => {
    const index = readFileSync(paths.apiIndex, "utf8");
    assert.match(index, /createAppFromBindings/);
    assert.match(index, /cookieSecure:\s*true/);
  });

  it("SPA HTML has CSP meta and Vite headers", () => {
    const html = readFileSync(paths.indexHtml, "utf8");
    const vite = readFileSync(paths.viteConfig, "utf8");
    assert.match(html, /Content-Security-Policy/i);
    assert.match(html, /default-src\s+'self'/);
    assert.match(vite, /SECURITY_HEADERS/);
  });

  it("no secret values in 8.3 security deliverables", () => {
    const scan = [
      paths.middleware,
      paths.sharedSecurity,
      paths.auditScript,
      paths.securityDoc,
      paths.sectionDoc,
      paths.middlewareTest,
    ];
    for (const p of scan) {
      const text = readFileSync(p, "utf8");
      for (const re of SECRET_PATTERNS) {
        assert.equal(
          re.test(text),
          false,
          `secret-like pattern ${re} in ${p}`,
        );
      }
    }
  });

  it("section implements only security hardening (no invent dual-write/OR-Tools)", () => {
    const section = readFileSync(paths.sectionDoc, "utf8");
    assert.match(section, /Security hardening/i);
    assert.match(section, /CSP/);
    assert.doesNotMatch(section, /OR-Tools/);
    assert.doesNotMatch(section, /dual-write Airtable as SoR/i);
  });
});
