/**
 * Section 9.4 — Architecture security ops docs (node:test / test:ci).
 *
 * Named assertions from spec:
 * - assert each deep doc file line count ≥ 40
 * - assert ARCHITECTURE mentions D1 and one-way Airtable
 * - assert COMPETITION lists struck items
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DEEP_DOCS = [
  "docs/ARCHITECTURE.md",
  "docs/SECURITY.md",
  "docs/OPERATIONS.md",
  "docs/AIRTABLE.md",
  "docs/E2E.md",
  "docs/COMPETITION.md",
  "docs/TROUBLESHOOTING.md",
  "docs/FIELD_FLOW.md",
];

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
  /spk_[A-Za-z0-9]{16,}/,
  /magic[_-]?link[^\n]{0,40}[:=]\s*['"][A-Za-z0-9]{16,}/i,
];

/**
 * @param {string} rel
 */
function lineCount(rel) {
  const body = readFileSync(join(root, rel), "utf8");
  return body.split(/\r?\n/).length;
}

describe("9.4 Architecture security ops docs", () => {
  it("assert each deep doc file line count ≥ 40", () => {
    const short = [];
    for (const rel of DEEP_DOCS) {
      assert.ok(existsSync(join(root, rel)), `missing ${rel}`);
      const n = lineCount(rel);
      if (n < 40) short.push(`${rel} (${n})`);
    }
    assert.deepEqual(
      short,
      [],
      `deep docs under 40 lines: ${short.join(", ")}`,
    );
  });

  it("assert ARCHITECTURE mentions D1 and one-way Airtable", () => {
    const body = readFileSync(join(root, "docs/ARCHITECTURE.md"), "utf8");
    assert.match(body, /\bD1\b/, "ARCHITECTURE must mention D1");
    assert.match(body, /one-way|one‑way/i, "ARCHITECTURE must mention one-way");
    assert.match(body, /Airtable/i, "ARCHITECTURE must mention Airtable");
    assert.match(body, /system of record|SoR/i);
  });

  it("assert COMPETITION lists struck items", () => {
    const body = readFileSync(join(root, "docs/COMPETITION.md"), "utf8");
    assert.match(body, /struck/i, "COMPETITION must list struck items");
    assert.match(body, /OR-Tools|OR‑Tools/i);
    assert.match(body, /dual-write|dual write/i);
    assert.match(body, /Next\.?js|RSC/i);
    assert.match(body, /agent fleet|multi-agent/i);
    assert.match(body, /CFP|form builder/i);
    assert.match(body, /readiness/i);
  });

  it("SECURITY matches E10 and failure modes", () => {
    const body = readFileSync(join(root, "docs/SECURITY.md"), "utf8");
    assert.match(body, /E10/);
    assert.match(body, /HttpOnly/i);
    assert.match(body, /CSP|Content-Security-Policy/);
    assert.match(body, /names only|env \*\*names\*\*/i);
    assert.match(body, /401/);
    assert.match(body, /403/);
    assert.match(body, /no stack|without stack/i);
  });

  it("section 9.4 note and N/A product surface", () => {
    const section = readFileSync(
      join(root, "docs/sections/9.4-deep-docs.md"),
      "utf8",
    );
    assert.match(section, /N\/A/i);
    assert.match(section, /no new product HTTP handlers|No new product HTTP handlers/i);
    assert.match(section, /assert each deep doc file line count/);
    assert.match(section, /assert ARCHITECTURE mentions D1/);
    assert.match(section, /assert COMPETITION lists struck items/);
    assert.match(section, /S-DOCS/);
  });

  it("no secrets or magic-link tokens in 9.4 docs surface", () => {
    const scan = [...DEEP_DOCS, "docs/sections/9.4-deep-docs.md"];
    for (const rel of scan) {
      const body = readFileSync(join(root, rel), "utf8");
      for (const re of SECRET_PATTERNS) {
        assert.doesNotMatch(
          body,
          re,
          `${rel} must not contain secret pattern ${re}`,
        );
      }
    }
  });

  it("OPERATIONS documents D1 Time Travel rollback", () => {
    const body = readFileSync(join(root, "docs/OPERATIONS.md"), "utf8");
    assert.match(body, /Time Travel/i);
    assert.match(body, /migrate|migration/i);
    assert.match(body, /wrangler|deploy/i);
  });
});
