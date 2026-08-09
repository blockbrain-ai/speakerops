/**
 * Section 8.5 — E2E keystone HTML report (Vitest).
 *
 * Named assertions from spec:
 * - assert reports/e2e-coverage.html contains A01 and PASS|FAIL
 * - assert footer includes generated timestamp
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildE2eReport,
  escapeHtml,
  mapInvFromSuite,
  renderE2eCoverageHtml,
  summarizeRows,
  type CoverageRow,
} from "../scripts/build-e2e-report.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const coveragePath = join(root, "reports", "e2e-coverage.html");
const scriptPath = join(root, "scripts", "build-e2e-report.ts");
const sectionDoc = join(root, "docs", "sections", "8.5-e2e-keystone-report.md");
const packageJsonPath = join(root, "package.json");

describe("8.5 E2E keystone HTML report", () => {
  beforeAll(() => {
    // Ensure offline artifact exists for AC assertions (idempotent).
    buildE2eReport({
      root,
      gitSha: "testsha0",
      generatedAt: "2026-08-08T12:00:00.000Z",
    });
  });

  it("assert reports/e2e-coverage.html contains A01 and PASS|FAIL", () => {
    expect(existsSync(coveragePath), "reports/e2e-coverage.html").toBe(true);
    const html = readFileSync(coveragePath, "utf8");
    expect(html).toMatch(/\bA01\b/);
    expect(html).toMatch(/\bPASS\b|\bFAIL\b/);
    // REQUIRED table links inv ID → status (anchor + pill)
    expect(html).toMatch(/id="A01"/);
    expect(html).toMatch(/status-pill/);
    // At least one PASS or FAIL pill for A01 row context
    expect(html).toMatch(/id="A01"[\s\S]*?status-pill\s+(PASS|FAIL)/);
  });

  it("assert footer includes generated timestamp", () => {
    expect(existsSync(coveragePath)).toBe(true);
    const html = readFileSync(coveragePath, "utf8");
    expect(html).toMatch(/report-footer/);
    expect(html).toMatch(/data-generated-at="[^"]+"/);
    expect(html).toMatch(/<time datetime="[^"]+"/);
    // ISO-ish timestamp present
    expect(html).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    // SHA footer
    expect(html).toMatch(/data-git-sha="[^"]+"/);
    expect(html).toMatch(/Git SHA/);
  });

  it("builder maps Playwright @inv outcomes onto REQUIRED rows", () => {
    const fixtureSuite = {
      entries: [
        {
          file: "playwright/e2e/public_cfp.spec.ts",
          title: "@inv:A01 e2e/public/cfp-load synthetic",
          status: "expected",
          outcome: "passed",
          ok: true,
        },
        {
          file: "playwright/e2e/public_cfp.spec.ts",
          title: "@inv:A02 e2e/public/cfp-fail synthetic",
          status: "unexpected",
          outcome: "failed",
          ok: false,
        },
      ],
    };
    const result = buildE2eReport({
      root,
      playwrightSuite: fixtureSuite,
      dryRun: true,
      gitSha: "abc1234",
      generatedAt: "2026-08-08T15:30:00.000Z",
    });
    const a01 = result.rows.find((r) => r.id === "A01");
    const a02 = result.rows.find((r) => r.id === "A02");
    expect(a01?.status).toBe("PASS");
    expect(a01?.statusSource).toBe("playwright");
    expect(a02?.status).toBe("FAIL");
    expect(a02?.statusSource).toBe("playwright");
    expect(result.html).toMatch(/A01/);
    expect(result.html).toMatch(/PASS|FAIL/);
    expect(result.html).toMatch(/2026-08-08T15:30:00\.000Z/);
    expect(result.html).toMatch(/abc1234/);
    expect(result.summary.required).toBeGreaterThanOrEqual(100);
  });

  it("does not green-wash REQUIRED PASS from inventory when suite is missing", () => {
    const result = buildE2eReport({
      root,
      suiteReportPath: null,
      dryRun: true,
      gitSha: "nogrn01",
      generatedAt: "2026-08-08T16:00:00.000Z",
    });
    // Inventory may claim PASS, but without Playwright execution evidence
    // REQUIRED non-DEFER rows must not surface as PASS in the keystone report.
    const requiredPassFromInv = result.requiredRows.filter(
      (r) =>
        r.statusSource === "inventory" &&
        String(r.status).toUpperCase() === "PASS" &&
        r.inventoryStatus === "PASS",
    );
    expect(requiredPassFromInv).toEqual([]);
    expect(result.summary.fromPlaywright).toBe(0);
    // At least one REQUIRED row should be FAIL/UNKNOWN when suite is absent
    const failedOrUnknown = result.requiredRows.filter((r) => {
      const s = String(r.status).toUpperCase();
      return s === "FAIL" || s === "UNKNOWN";
    });
    expect(failedOrUnknown.length).toBeGreaterThan(0);
    expect(result.summary.pass).toBe(0);
  });

  it("Lumen tokens present; no freeform dark default", () => {
    const html = readFileSync(coveragePath, "utf8");
    expect(html).toMatch(/--lumen-brand:\s*#4f46e5/);
    expect(html).toMatch(/--lumen-success:/);
    expect(html).toMatch(/color-scheme:\s*light/);
    expect(html).not.toMatch(/prefers-color-scheme:\s*dark/);
  });

  it("pnpm docs:e2e-report script wired to build-e2e-report.ts", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["docs:e2e-report"]).toMatch(/build-e2e-report/);
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(sectionDoc)).toBe(true);
  });

  it("escapeHtml and render helpers are pure / offline-safe", () => {
    expect(escapeHtml(`<script>"&'`)).toBe(
      "&lt;script&gt;&quot;&amp;&#39;",
    );
    const rows: CoverageRow[] = [
      {
        id: "A01",
        role: "public",
        surface: "cfp",
        journey: "load",
        testId: "e2e/public/cfp-load",
        required: true,
        inventoryStatus: "PASS",
        status: "PASS",
        statusSource: "inventory",
      },
    ];
    const summary = summarizeRows(rows);
    expect(summary.pass).toBe(1);
    const html = renderE2eCoverageHtml({
      rows,
      summary,
      gitSha: "deadbeef",
      generatedAt: "2026-01-01T00:00:00.000Z",
      suiteSource: null,
      inventoryRel: "KMS-competition/initiative/BROWSER_E2E_INVENTORY.md",
    });
    expect(html).toMatch(/A01/);
    expect(html).toMatch(/PASS/);
    expect(html).toMatch(/2026-01-01T00:00:00\.000Z/);
  });

  it("mapInvFromSuite extracts @inv ids from titles", () => {
    const map = mapInvFromSuite([
      {
        file: "x.spec.ts",
        title: "@inv:B01 login magic link",
        status: "passed",
        ok: true,
      },
    ]);
    expect(map.get("B01")?.status).toBe("PASS");
  });

  it("no secrets or magic-link tokens in generated HTML", () => {
    const html = readFileSync(coveragePath, "utf8");
    expect(html).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(html).not.toMatch(/spk_[A-Za-z0-9]{16,}/);
    expect(html).not.toMatch(/Bearer\s+[A-Za-z0-9\-._~+/]{20,}/);
    expect(html).not.toMatch(/magic[_-]?link[^"'\s]{16,}/i);
    // Builder source must not log secrets
    const src = readFileSync(scriptPath, "utf8");
    expect(src).toMatch(/Never logs secrets/);
  });

  it("writes to custom out path (fixture)", () => {
    const tmpDir = join(tmpdir(), `speakerops-8.5-${process.pid}`);
    mkdirSync(tmpDir, { recursive: true });
    const out = join(tmpDir, "coverage-fixture.html");
    try {
      const result = buildE2eReport({
        root,
        outPath: out,
        suiteReportPath: null,
        gitSha: "fixture1",
        generatedAt: "2026-08-08T18:00:00.000Z",
      });
      expect(result.outPath).toBe(out);
      expect(existsSync(out)).toBe(true);
      const html = readFileSync(out, "utf8");
      expect(html).toMatch(/A01/);
      expect(html).toMatch(/PASS|FAIL/);
      expect(html).toMatch(/2026-08-08T18:00:00\.000Z/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
