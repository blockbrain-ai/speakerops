/**
 * Section 1.2 — Worker API health governance / file assertions.
 *
 * Named assertions from spec:
 * - assert wrangler.toml has binding name DB without secret values
 * Plus AC coverage for no secrets, scope, docs, composition root.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const wranglerPath = join(root, "wrangler.toml");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");
const errorsMwPath = join(root, "apps", "api", "src", "middleware", "errors.ts");
const sectionDocPath = join(root, "docs", "sections", "1.2-worker-health.md");
const healthDtoPath = join(root, "packages", "shared", "src", "health.ts");
const healthTestPath = join(root, "apps", "api", "src", "health.test.ts");

/** Patterns that must never appear as committed secret values in wrangler. */
const SECRET_PATTERNS = [
  /api[_-]?key\s*=\s*["'][^"']+["']/i,
  /secret\s*=\s*["'][^"']+["']/i,
  /password\s*=\s*["'][^"']+["']/i,
  /token\s*=\s*["'][A-Za-z0-9_\-]{20,}["']/i,
  /CLOUDFLARE_API_TOKEN\s*=/,
  /AIRTABLE_API_KEY\s*=/,
  /AIRTABLE_PAT\s*=/,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,
  /sk-[A-Za-z0-9]{10,}/,
];

describe("1.2 worker API health", () => {
  it("assert wrangler.toml has binding name DB without secret values", () => {
    assert.equal(existsSync(wranglerPath), true, "wrangler.toml must exist at repo root");
    const body = readFileSync(wranglerPath, "utf8");

    // D1 binding name DB (AC)
    assert.match(
      body,
      /binding\s*=\s*["']DB["']/,
      'wrangler.toml must list D1 binding name DB (binding = "DB")',
    );
    assert.match(body, /\[\[d1_databases\]\]/, "wrangler.toml must declare [[d1_databases]]");

    // R2 / Queues name placeholders (in-scope)
    assert.match(body, /\[\[r2_buckets\]\]/, "R2 binding placeholder required");
    assert.match(
      body,
      /binding\s*=\s*["']FILES["']/,
      'R2 binding name FILES expected',
    );
    assert.match(body, /queues\.producers|\[\[queues/, "Queue binding placeholder required");

    // No secret values
    for (const re of SECRET_PATTERNS) {
      assert.equal(
        re.test(body),
        false,
        `wrangler.toml must not contain secret-like value matching ${re}`,
      );
    }

    // .dev.vars is the secret path — must not be imported as committed content
    assert.equal(
      existsSync(join(root, ".dev.vars")),
      false,
      ".dev.vars must not be committed",
    );
  });

  it("composition root implements GET /health and E4 notFound", () => {
    assert.equal(existsSync(apiIndexPath), true);
    assert.equal(existsSync(errorsMwPath), true);
    const index = readFileSync(apiIndexPath, "utf8");
    const errors = readFileSync(errorsMwPath, "utf8");

    assert.match(index, /\/health/, "API must register /health");
    assert.match(index, /from ["']hono["']/, "API must use Hono");
    assert.match(index, /HealthResponseSchema|ok:\s*true/, "health body shape");
    assert.match(index, /notFound|notFoundHandler/, "404 handler wired");
    assert.match(errors, /errorEnvelope|NOT_FOUND|INTERNAL_ERROR/);
    assert.match(errors, /correlationId|CORRELATION/, "E3 correlation middleware");

    // CORS same-origin policy note present in composition root
    assert.match(
      index,
      /CORS|same-origin/i,
      "composition root must document CORS same-origin policy",
    );
  });

  it("shared HealthResponseSchema requires ok + version (Zod)", () => {
    assert.equal(existsSync(healthDtoPath), true);
    const body = readFileSync(healthDtoPath, "utf8");
    assert.match(body, /HealthResponseSchema/);
    assert.match(body, /from ["']zod["']/);
    assert.match(body, /version/);
    assert.match(body, /ok/);
  });

  it("section doc and vitest health tests exist", () => {
    assert.equal(existsSync(sectionDocPath), true, "docs/sections/1.2-worker-health.md");
    const doc = readFileSync(sectionDocPath, "utf8");
    assert.match(doc, /1\.2/);
    assert.match(doc, /\/health|health/i);
    assert.match(doc, /wrangler/i);

    assert.equal(existsSync(healthTestPath), true, "apps/api/src/health.test.ts");
    const tests = readFileSync(healthTestPath, "utf8");
    assert.match(
      tests,
      /assert GET \/health returns 200 and body\.ok===true/,
    );
    assert.match(
      tests,
      /assert unknown path returns 404 JSON with code field/,
    );
  });

  it("no consequential writes in 1.2 (audit_events N/A until domain writes)", () => {
    const index = readFileSync(apiIndexPath, "utf8");
    // Health is read-only; no INSERT/audit_events emission expected in this section
    assert.equal(
      /audit_events|INSERT\s+INTO/i.test(index),
      false,
      "1.2 must not invent write paths; audit_events land with domain writes",
    );
  });
});
