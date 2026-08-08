/**
 * Section 8.5 — E2E keystone HTML report governance (node:test).
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - scripts/build-e2e-report.ts + pnpm docs:e2e-report
 * - offline reports/e2e-coverage.html with A01 + PASS|FAIL + timestamp footer
 * - Lumen tokens; no new product handlers; no secrets
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
  /spk_[A-Za-z0-9]{16,}/,
];

const paths = {
  builder: join(root, "scripts/build-e2e-report.ts"),
  coverage: join(root, "reports/e2e-coverage.html"),
  sectionDoc: join(root, "docs/sections/8.5-e2e-keystone-report.md"),
  vitest: join(root, "tests/8.5-e2e-keystone-report.test.ts"),
  packageJson: join(root, "package.json"),
  e2eRun: join(root, "scripts/e2e-run.mjs"),
  e2eDoc: join(root, "docs/E2E.md"),
  evidence: join(
    root,
    "KMS-competition/initiative/evidence/e2e-coverage.txt",
  ),
  inventory: join(
    root,
    "KMS-competition/initiative/BROWSER_E2E_INVENTORY.md",
  ),
};

describe("8.5 E2E keystone HTML report", () => {
  it("deliverables exist", () => {
    for (const [name, p] of Object.entries(paths)) {
      assert.equal(existsSync(p), true, `missing ${name}: ${p}`);
    }
  });

  it("pnpm docs:e2e-report wires build-e2e-report.ts", () => {
    const pkg = JSON.parse(readFileSync(paths.packageJson, "utf8"));
    assert.equal(typeof pkg.scripts?.["docs:e2e-report"], "string");
    assert.match(pkg.scripts["docs:e2e-report"], /build-e2e-report/);
  });

  it("assert reports/e2e-coverage.html contains A01 and PASS|FAIL", () => {
    // Regenerate if missing / ensure fresh offline artifact for gate
    if (!existsSync(paths.coverage)) {
      const r = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/build-e2e-report.ts"],
        { cwd: root, encoding: "utf8", shell: false },
      );
      assert.equal(r.status, 0, r.stderr || r.stdout || "builder failed");
    }
    const html = readFileSync(paths.coverage, "utf8");
    assert.match(html, /\bA01\b/);
    assert.match(html, /\bPASS\b|\bFAIL\b/);
    assert.match(html, /id="A01"/);
  });

  it("assert footer includes generated timestamp", () => {
    const html = readFileSync(paths.coverage, "utf8");
    assert.match(html, /report-footer/);
    assert.match(html, /data-generated-at="/);
    assert.match(html, /<time datetime="/);
    assert.match(html, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.match(html, /Git SHA/);
    assert.match(html, /data-git-sha="/);
  });

  it("HTML is Lumen-styled offline (E6 tokens inlined)", () => {
    const html = readFileSync(paths.coverage, "utf8");
    assert.match(html, /--lumen-brand/);
    assert.match(html, /--lumen-success/);
    assert.match(html, /color-scheme:\s*light/);
    // Self-contained: no external stylesheet required for offline open
    assert.equal(
      /<link[^>]+rel=["']stylesheet["']/i.test(html),
      false,
      "coverage HTML must be offline (inline CSS)",
    );
  });

  it("e2e-run invokes build-e2e-report (not raw Playwright copy alone)", () => {
    const src = readFileSync(paths.e2eRun, "utf8");
    assert.match(src, /build-e2e-report/);
    assert.match(src, /e2e-coverage\.html/);
  });

  it("named vitest assertions present", () => {
    const t = readFileSync(paths.vitest, "utf8");
    assert.match(
      t,
      /assert reports\/e2e-coverage\.html contains A01 and PASS\|FAIL/,
    );
    assert.match(t, /assert footer includes generated timestamp/);
  });

  it("section doc maps ACs and N/A handlers/writes", () => {
    const md = readFileSync(paths.sectionDoc, "utf8");
    assert.match(md, /8\.5/);
    assert.match(md, /S-E2E-RUN|e2e-coverage/);
    assert.match(md, /docs:e2e-report/);
    assert.match(md, /N\/A/i);
    assert.match(md, /A01/);
  });

  it("docs/E2E.md references keystone report path and docs:e2e-report", () => {
    const e2e = readFileSync(paths.e2eDoc, "utf8");
    assert.match(e2e, /e2e-coverage\.html/);
    assert.match(e2e, /docs:e2e-report|build-e2e-report|8\.5/);
  });

  it("no new product HTTP handlers in builder scope", () => {
    const src = readFileSync(paths.builder, "utf8");
    assert.equal(/createApp|app\.(get|post|put|patch|delete)\(/i.test(src), false);
    assert.match(src, /S-E2E-RUN|keystone|coverage/i);
  });

  it("no secrets in 8.5 deliverables", () => {
    const files = [
      paths.builder,
      paths.coverage,
      paths.sectionDoc,
      paths.vitest,
      paths.evidence,
    ];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      for (const re of SECRET_PATTERNS) {
        assert.equal(
          re.test(body),
          false,
          `secret-like pattern ${re} in ${f}`,
        );
      }
    }
  });
});
