/**
 * Section 9.5 — Beautiful HTML reports (Vitest).
 *
 * Named assertions from spec:
 * - assert reports/index.html links onboarding and e2e-coverage
 * - assert generator exit 0
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildDocsReports,
  escapeHtml,
  markdownToHtml,
  rewriteMdHref,
  REPORT_PAGES,
  renderIndexHtml,
} from "../scripts/build-docs-reports.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(root, "reports", "index.html");
const scriptPath = join(root, "scripts", "build-docs-reports.ts");
const sectionDoc = join(root, "docs", "sections", "9.5-html-reports.md");
const packageJsonPath = join(root, "package.json");

const EXPECTED_FILES = [
  "index.html",
  "onboarding.html",
  "agent-setup.html",
  "architecture.html",
  "cli-reference.html",
  "design-lumen.html",
  "e2e-coverage.html",
] as const;

describe("9.5 Beautiful HTML reports", () => {
  beforeAll(() => {
    // Ensure offline artifacts exist for AC assertions (idempotent).
    buildDocsReports({
      root,
      gitSha: "testsha95",
      generatedAt: "2026-08-09T12:00:00.000Z",
    });
  });

  it("assert reports/index.html links onboarding and e2e-coverage", () => {
    expect(existsSync(indexPath), "reports/index.html").toBe(true);
    const html = readFileSync(indexPath, "utf8");
    expect(html).toMatch(/onboarding\.html/);
    expect(html).toMatch(/e2e-coverage\.html/);
    // Portal cards / nav cover the full report set
    expect(html).toMatch(/agent-setup\.html/);
    expect(html).toMatch(/architecture\.html/);
    expect(html).toMatch(/cli-reference\.html/);
    expect(html).toMatch(/design-lumen\.html/);
  });

  it("assert generator exit 0", () => {
    const r = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/build-docs-reports.ts", "--no-e2e"],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        env: { ...process.env },
      },
    );
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/\[docs:reports\]/);
  });

  it("all report leaves exist offline with nav + SHA footer", () => {
    for (const file of EXPECTED_FILES) {
      const p = join(root, "reports", file);
      expect(existsSync(p), file).toBe(true);
      const html = readFileSync(p, "utf8");
      if (file !== "e2e-coverage.html") {
        expect(html).toMatch(/site-header|SpeakerOps/);
        expect(html).toMatch(/report-footer/);
        expect(html).toMatch(/data-generated-at="[^"]+"/);
        expect(html).toMatch(/data-git-sha="[^"]+"/);
        expect(html).toMatch(/color-scheme:\s*light/);
        expect(html).toMatch(/--lumen-brand:\s*#4f46e5/);
        expect(html).not.toMatch(/prefers-color-scheme:\s*dark/);
      } else {
        // 8.5 keystone keeps its own shell; still Lumen + footer
        expect(html).toMatch(/--lumen-brand:\s*#4f46e5/);
        expect(html).toMatch(/report-footer|data-git-sha/);
      }
    }
  });

  it("nav between reports is present on generated pages", () => {
    const onboarding = readFileSync(
      join(root, "reports", "onboarding.html"),
      "utf8",
    );
    expect(onboarding).toMatch(/href="index\.html"/);
    expect(onboarding).toMatch(/href="agent-setup\.html"/);
    expect(onboarding).toMatch(/href="e2e-coverage\.html"/);
    expect(onboarding).toMatch(/aria-current="page"/);
  });

  it("pnpm docs:reports wires build-docs-reports.ts", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["docs:reports"]).toMatch(/build-docs-reports/);
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(sectionDoc)).toBe(true);
  });

  it("markdown renderer handles headings tables and links offline", () => {
    const md = [
      "# Title",
      "",
      "See [onboarding](./ONBOARDING.md) and [e2e](../reports/e2e-coverage.html).",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | **bold** |",
      "",
      "```",
      "code <tag>",
      "```",
    ].join("\n");
    const html = markdownToHtml(md, "docs/ARCHITECTURE.md");
    expect(html).toMatch(/<h1>Title<\/h1>/);
    expect(html).toMatch(/href="onboarding\.html"/);
    expect(html).toMatch(/href="e2e-coverage\.html"/);
    expect(html).toMatch(/<table>/);
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/&lt;tag&gt;/);
  });

  it("rewriteMdHref maps known report sources", () => {
    expect(rewriteMdHref("./ONBOARDING.md", "docs/AGENT_SETUP.md")).toBe(
      "onboarding.html",
    );
    expect(rewriteMdHref("#anchor", "docs/CLI.md")).toBe("#anchor");
    expect(rewriteMdHref("https://example.com", "docs/CLI.md")).toBe(
      "https://example.com",
    );
  });

  it("escapeHtml and renderIndexHtml are pure / offline-safe", () => {
    expect(escapeHtml(`<script>"&'`)).toBe(
      "&lt;script&gt;&quot;&amp;&#39;",
    );
    const html = renderIndexHtml({
      gitSha: "deadbeef",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(html).toMatch(/onboarding\.html/);
    expect(html).toMatch(/e2e-coverage\.html/);
    expect(html).toMatch(/2026-01-01T00:00:00\.000Z/);
    expect(html).toMatch(/deadbeef/);
    expect(REPORT_PAGES.some((p) => p.file === "index.html")).toBe(true);
  });

  it("writes to custom out dir (fixture) with exit-path parity", () => {
    const tmpDir = join(tmpdir(), `speakerops-9.5-${process.pid}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const result = buildDocsReports({
        root,
        outDir: tmpDir,
        skipE2eRefresh: true,
        gitSha: "fixture95",
        generatedAt: "2026-08-09T18:00:00.000Z",
      });
      // Seed a minimal e2e file so portal link target can exist offline
      writeFileSync(
        join(tmpDir, "e2e-coverage.html"),
        "<!DOCTYPE html><title>e2e</title>",
        "utf8",
      );
      expect(result.outDir).toBe(tmpDir);
      expect(existsSync(join(tmpDir, "index.html"))).toBe(true);
      const index = readFileSync(join(tmpDir, "index.html"), "utf8");
      expect(index).toMatch(/onboarding\.html/);
      expect(index).toMatch(/e2e-coverage\.html/);
      expect(index).toMatch(/fixture95/);
      expect(existsSync(join(tmpDir, "onboarding.html"))).toBe(true);
      expect(existsSync(join(tmpDir, "design-lumen.html"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("no secrets or magic-link tokens in generated portal HTML", () => {
    const html = readFileSync(indexPath, "utf8");
    expect(html).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(html).not.toMatch(/spk_[A-Za-z0-9]{16,}/);
    expect(html).not.toMatch(/Bearer\s+[A-Za-z0-9\-._~+/]{20,}/);
    expect(html).not.toMatch(/magic[_-]?link[^"'\s]{16,}/i);
    const src = readFileSync(scriptPath, "utf8");
    expect(src).toMatch(/Never logs secrets/);
  });
});
