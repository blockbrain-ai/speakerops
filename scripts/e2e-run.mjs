/**
 * Browser E2E gate: `pnpm test:e2e`
 *
 * When Playwright config exists, ensures API dist is built, enables local
 * webServer (Vite + Hono health) for foundation smoke (section 1.6), then
 * runs Playwright.
 *
 * Full REQUIRED suite green remains Phase 8 (S-E2E-RUN).
 * Env names only (E10): E2E_WEB_SERVER, E2E_BASE_URL, E2E_WEB_PORT, E2E_API_PORT.
 */
import { existsSync } from "node:fs";
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

// Prefer built Worker app for e2e-api-server (stable ESM, no strip-types).
// Always rebuild shared + api so section work is not served from stale dist
// when reuseExistingServer is off / CI starts a fresh server.
const apiDist = join(root, "apps", "api", "dist", "index.js");
console.log("[test:e2e] building @speakerops/shared + @speakerops/api for e2e…");
const build = spawnSync(
  "pnpm",
  ["--filter", "@speakerops/shared", "--filter", "@speakerops/api", "build"],
  { cwd: root, stdio: "inherit", shell: false },
);
if (build.status !== 0) {
  console.error("[test:e2e] API build failed — cannot start e2e health server");
  process.exit(build.status === null ? 1 : build.status);
}
if (!existsSync(apiDist)) {
  console.error("[test:e2e] API dist missing after build:", apiDist);
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
process.exit(result.status === null ? 1 : result.status);
