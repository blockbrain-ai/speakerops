/**
 * Section 9.5 — Beautiful HTML reports (node:test / test:ci).
 *
 * Named assertions from spec:
 * - assert reports/index.html links onboarding and e2e-coverage
 * - assert generator exit 0
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const paths = {
  builder: join(root, "scripts/build-docs-reports.ts"),
  index: join(root, "reports/index.html"),
  section: join(root, "docs/sections/9.5-html-reports.md"),
  packageJson: join(root, "package.json"),
};

const REPORT_FILES = [
  "index.html",
  "onboarding.html",
  "agent-setup.html",
  "architecture.html",
  "cli-reference.html",
  "design-lumen.html",
  "e2e-coverage.html",
];

describe("9.5 Beautiful HTML reports", () => {
  it("pnpm docs:reports wires build-docs-reports.ts", () => {
    const pkg = JSON.parse(readFileSync(paths.packageJson, "utf8"));
    assert.equal(typeof pkg.scripts?.["docs:reports"], "string");
    assert.match(pkg.scripts["docs:reports"], /build-docs-reports/);
    assert.equal(existsSync(paths.builder), true, "builder script missing");
    assert.equal(existsSync(paths.section), true, "section doc missing");
  });

  it("assert generator exit 0", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        paths.builder,
      ],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        env: { ...process.env },
      },
    );
    // Prefer pnpm exec if node --import tsx is unavailable in this gate env
    if (r.status !== 0) {
      const r2 = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/build-docs-reports.ts"],
        {
          cwd: root,
          encoding: "utf8",
          shell: false,
          env: { ...process.env },
        },
      );
      assert.equal(
        r2.status,
        0,
        `generator exit non-zero: ${r2.stderr || r2.stdout || r.stderr || r.stdout}`,
      );
      assert.match(r2.stdout, /\[docs:reports\]/);
    } else {
      assert.match(r.stdout, /\[docs:reports\]/);
    }
  });

  it("assert reports/index.html links onboarding and e2e-coverage", () => {
    // Ensure built (generator may have run in previous test)
    if (!existsSync(paths.index)) {
      const r = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/build-docs-reports.ts"],
        {
          cwd: root,
          encoding: "utf8",
          shell: false,
        },
      );
      assert.equal(r.status, 0, r.stderr || r.stdout);
    }
    assert.equal(existsSync(paths.index), true, "reports/index.html missing");
    const html = readFileSync(paths.index, "utf8");
    assert.match(html, /onboarding\.html/, "index must link onboarding");
    assert.match(html, /e2e-coverage\.html/, "index must link e2e-coverage");
    assert.match(html, /--lumen-brand:\s*#7ba88b/, "light Lumen brand token");
    assert.match(html, /color-scheme:\s*light/);
    assert.match(html, /report-footer/);
    assert.match(html, /data-git-sha="/);
  });

  it("report set files exist for S-DOCS portal", () => {
    for (const file of REPORT_FILES) {
      const p = join(root, "reports", file);
      assert.equal(existsSync(p), true, `missing reports/${file}`);
    }
  });

  it("section doc names AC assertions and S-DOCS", () => {
    const md = readFileSync(paths.section, "utf8");
    assert.match(
      md,
      /assert reports\/index\.html links onboarding and e2e-coverage/,
    );
    assert.match(md, /assert generator exit 0/);
    assert.match(md, /S-DOCS/);
    assert.match(md, /docs:reports/);
  });

  it("no secrets in builder source", () => {
    const src = readFileSync(paths.builder, "utf8");
    assert.match(src, /Never logs secrets/);
    assert.doesNotMatch(src, /sk-[A-Za-z0-9]{20,}/);
    assert.doesNotMatch(src, /spk_[A-Za-z0-9]{16,}/);
  });
});
