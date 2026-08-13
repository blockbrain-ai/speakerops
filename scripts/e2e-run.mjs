/**
 * Browser E2E gate: `pnpm test:e2e`
 *
 * When Playwright config exists, ensures API dist is built, enables local
 * webServer (Vite + Hono health) for foundation smoke (section 1.6), then
 * runs Playwright.
 *
 * Section 8.2 (S-E2E-RUN): full REQUIRED suite + raw report artifacts.
 * Default report paths (override via env **names** only — E10):
 *   E2E_PLAYWRIGHT_RUN_REPORT  → reports/playwright-run.json
 *   E2E_PLAYWRIGHT_HTML_DIR    → playwright-report/
 *   reports/e2e-coverage.html  ← section 8.5 Lumen keystone (inventory + results)
 *
 * Env names: E2E_WEB_SERVER, E2E_BASE_URL, E2E_WEB_PORT, E2E_API_PORT,
 *            E2E_PLAYWRIGHT_RUN_REPORT, E2E_PLAYWRIGHT_SUITE_REPORT,
 *            E2E_PLAYWRIGHT_HTML_DIR, E2E_PLAYWRIGHT_HTML_MIRROR,
 *            E2E_COVERAGE_HTML, CI
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(root, "playwright.config.ts"),
  join(root, "playwright.config.mjs"),
  join(root, "playwright.config.js"),
  join(root, "apps", "web", "playwright.config.ts"),
];

const config = candidates.find((p) => existsSync(p));

if (!config) {
  console.log(
    "[test:e2e] pre-scaffold: Playwright not configured yet (expected until Phase 1.5+).",
  );
  console.log(
    "[test:e2e] Law: Phase 8 full run must execute every REQUIRED inventory journey (S-E2E-RUN).",
  );
  console.log(
    "[test:e2e] Inventory law: docs/governance/0.3-e2e-inventory-law.md · canonical initiative/BROWSER_E2E_INVENTORY.md",
  );
  console.log(
    "[test:e2e] OK (stub) — does not claim dogfood_ready or REQUIRED PASS set green.",
  );
  process.exit(0);
}

// Foundation smoke (1.6) needs Vite + local API. Allow explicit opt-out:
// E2E_WEB_SERVER=0 pnpm test:e2e  (e.g. external servers already up)
if (process.env.E2E_WEB_SERVER === undefined) {
  process.env.E2E_WEB_SERVER = "1";
}

// Section 8.2 — default run-report path for phase8 inventory gate
if (!process.env.E2E_PLAYWRIGHT_RUN_REPORT && !process.env.E2E_PLAYWRIGHT_SUITE_REPORT) {
  process.env.E2E_PLAYWRIGHT_RUN_REPORT = join(
    root,
    "reports",
    "playwright-run.json",
  );
}
if (!process.env.E2E_PLAYWRIGHT_HTML_DIR) {
  process.env.E2E_PLAYWRIGHT_HTML_DIR = join(root, "playwright-report");
}
// Mirror HTML under reports/playwright when not CI (local full suite)
if (process.env.E2E_PLAYWRIGHT_HTML_MIRROR === undefined) {
  process.env.E2E_PLAYWRIGHT_HTML_MIRROR = "1";
}

// Ensure report parent dirs exist before Playwright writes
for (const dir of [
  join(root, "reports"),
  process.env.E2E_PLAYWRIGHT_HTML_DIR,
  join(root, "playwright-report"),
]) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

// Prefer built Worker app for e2e-api-server (stable ESM, no strip-types).
// Always rebuild shared + api + cli so section work is not served from stale
// dist when reuseExistingServer is off / CI starts a fresh server.
// CLI dist is required by phase7 keystone (7.4) for CLI07 deny spawn against
// the live e2e API (S-CLI proof in browser gate).
const apiDist = join(root, "apps", "api", "dist", "index.js");
const cliDist = join(root, "packages", "cli", "dist", "main.js");
console.log(
  "[test:e2e] building @speakerops/shared + @speakerops/sdk + @speakerops/api + @speakerops/cli for e2e…",
);
const build = spawnSync(
  "pnpm",
  [
    "--filter",
    "@speakerops/shared",
    "--filter",
    "@speakerops/sdk",
    "--filter",
    "@speakerops/api",
    "--filter",
    "@speakerops/cli",
    "build",
  ],
  { cwd: root, stdio: "inherit", shell: false },
);
if (build.status !== 0) {
  console.error("[test:e2e] API/CLI build failed — cannot start e2e health server");
  process.exit(build.status === null ? 1 : build.status);
}
if (!existsSync(apiDist)) {
  console.error("[test:e2e] API dist missing after build:", apiDist);
  process.exit(1);
}
if (!existsSync(cliDist)) {
  console.error("[test:e2e] CLI dist missing after build:", cliDist);
  process.exit(1);
}

// Forward extra CLI args after `--` (e.g. a single spec path).
const extraArgs = process.argv.slice(2).filter((a) => a !== "--");

console.log(
  `[test:e2e] running Playwright with ${config} (E2E_WEB_SERVER=${process.env.E2E_WEB_SERVER})${
    extraArgs.length ? ` args=${extraArgs.join(" ")}` : ""
  }`,
);
const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "--config", config, ...extraArgs],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  },
);

// Post-run: store report path artifact + section 8.5 Lumen keystone HTML
const jsonReport =
  process.env.E2E_PLAYWRIGHT_RUN_REPORT ||
  process.env.E2E_PLAYWRIGHT_SUITE_REPORT ||
  join(root, "reports", "playwright-run.json");
const htmlDir =
  process.env.E2E_PLAYWRIGHT_HTML_DIR || join(root, "playwright-report");
const coverageHtml =
  process.env.E2E_COVERAGE_HTML || join(root, "reports", "e2e-coverage.html");
const pathManifest = join(root, "reports", "e2e-report-path.txt");

try {
  mkdirSync(join(root, "reports"), { recursive: true });
  // Section 8.5 — inventory + Playwright results → offline Lumen HTML (S-E2E-RUN)
  const reportBuild = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/build-e2e-report.ts", `--out=${coverageHtml}`],
    { cwd: root, stdio: "inherit", shell: false, env: process.env },
  );
  if (reportBuild.status !== 0) {
    console.warn(
      "[test:e2e] build-e2e-report exited",
      reportBuild.status === null ? 1 : reportBuild.status,
      "— coverage HTML may be stale",
    );
  }
  const lines = [
    `playwright_run_json=${jsonReport}`,
    `playwright_html_dir=${htmlDir}`,
    `e2e_coverage_html=${coverageHtml}`,
    `exit_status=${result.status === null ? 1 : result.status}`,
    `generated_at=${new Date().toISOString()}`,
  ];
  writeFileSync(pathManifest, lines.join("\n") + "\n", "utf8");
  console.log(`[test:e2e] report path stored: ${pathManifest}`);
  console.log(`[test:e2e] JSON run report: ${jsonReport} (exists=${existsSync(jsonReport)})`);
  console.log(`[test:e2e] HTML dir: ${htmlDir} (exists=${existsSync(htmlDir)})`);
  if (existsSync(coverageHtml)) {
    console.log(`[test:e2e] coverage HTML: ${coverageHtml}`);
  }
} catch (e) {
  console.warn("[test:e2e] report path store failed:", e?.message ?? e);
}

process.exit(result.status === null ? 1 : result.status);
