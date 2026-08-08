/**
 * Section 1.4 — Web shell and Lumen tokens governance assertions.
 *
 * Named tests from spec:
 * - assert lumen.css defines --lumen-brand and --lumen-focus-ring
 * - assert AdminShell renders nav label including 'CFP' (see vitest AdminShell.test.tsx)
 * - assert production build exits 0
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const lumenPath = join(root, "apps", "web", "src", "styles", "lumen.css");
const shellPath = join(root, "apps", "web", "src", "layout", "AdminShell.tsx");
const mainPath = join(root, "apps", "web", "src", "main.tsx");
const appPath = join(root, "apps", "web", "src", "App.tsx");
const indexHtmlPath = join(root, "apps", "web", "index.html");
const viteConfigPath = join(root, "apps", "web", "vite.config.ts");
const sectionDocPath = join(root, "docs", "sections", "1.4-lumen-shell.md");
const webPkgPath = join(root, "apps", "web", "package.json");

const REQUIRED_TOKENS = [
  "--lumen-brand",
  "--lumen-focus-ring",
  "--lumen-focus",
  "--lumen-brand-soft",
  "--lumen-success-soft",
  "--lumen-warn-soft",
  "--lumen-danger-soft",
  "--lumen-info-soft",
  "--lumen-bg",
  "--lumen-surface",
  "--lumen-text",
];

describe("1.4 web shell and Lumen tokens", () => {
  it("assert lumen.css defines --lumen-brand and --lumen-focus-ring", () => {
    assert.equal(existsSync(lumenPath), true, "apps/web/src/styles/lumen.css must exist");
    const css = readFileSync(lumenPath, "utf8");
    for (const token of REQUIRED_TOKENS) {
      assert.match(
        css,
        new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`),
        `lumen.css must define ${token}`,
      );
    }
  });

  it("assert AdminShell source includes CFP / Forms and Settings nav", () => {
    assert.equal(existsSync(shellPath), true, "AdminShell.tsx must exist");
    const body = readFileSync(shellPath, "utf8");
    assert.match(body, /CFP\s*\/\s*Forms|CFP/, "AdminShell must include CFP nav label");
    assert.match(body, /Forms/, "AdminShell must include Forms");
    assert.match(body, /Settings/, "AdminShell must include Settings");
    assert.match(body, /Overview|Submissions|Schedule|Comms/, "full Lumen IA present");
  });

  it("assert production build exits 0", () => {
    assert.equal(existsSync(webPkgPath), true);
    const pkg = JSON.parse(readFileSync(webPkgPath, "utf8"));
    assert.equal(typeof pkg.scripts?.build, "string", "web package must define build script");
    assert.match(pkg.scripts.build, /vite/, "web build must use Vite");

    // Directory filter is stable; package name is @speakerops/web
    const result = spawnSync(
      "pnpm",
      ["--filter", "@speakerops/web", "build"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CI: "1" },
        timeout: 120_000,
      },
    );
    assert.equal(
      result.status,
      0,
      `pnpm --filter @speakerops/web build must exit 0\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  });

  it("composition root, Vite entry, and section doc exist", () => {
    for (const p of [mainPath, appPath, indexHtmlPath, viteConfigPath, sectionDocPath]) {
      assert.equal(existsSync(p), true, `${p} must exist`);
    }
    const main = readFileSync(mainPath, "utf8");
    assert.match(main, /lumen\.css/, "main.tsx must import lumen.css");
    assert.match(main, /AdminShell|App/, "main.tsx must mount shell/app");

    const section = readFileSync(sectionDocPath, "utf8");
    assert.match(section, /1\.4/);
    assert.match(section, /Lumen|lumen/i);
  });

  it("no dark-default theme (light lock)", () => {
    const css = readFileSync(lumenPath, "utf8");
    assert.match(css, /color-scheme:\s*light/);
    assert.match(css, /--lumen-bg:\s*#f5f5f7/);
    // Must not default body to near-black cockpit
    assert.equal(
      /prefers-color-scheme:\s*dark[\s\S]*--lumen-bg:\s*#0/.test(css),
      false,
      "must not retheme --lumen-bg to dark under prefers-color-scheme",
    );
  });

  it("no HTTP product handlers invented in 1.4 (N/A with proof)", () => {
    const section = readFileSync(sectionDocPath, "utf8");
    assert.match(
      section,
      /N\/A|no (new )?HTTP|no product HTTP|None added/i,
      "section doc must declare no new HTTP handlers for 1.4",
    );
    assert.match(section, /audit_events|correlationId/i);
  });

  it("web package has vite + react-router-dom dependencies", () => {
    const pkg = JSON.parse(readFileSync(webPkgPath, "utf8"));
    assert.ok(pkg.dependencies?.["react-router-dom"], "react-router-dom required");
    assert.ok(pkg.devDependencies?.vite || pkg.dependencies?.vite, "vite required");
    assert.ok(
      pkg.devDependencies?.["@vitejs/plugin-react"] ||
        pkg.dependencies?.["@vitejs/plugin-react"],
      "@vitejs/plugin-react required",
    );
  });
});
