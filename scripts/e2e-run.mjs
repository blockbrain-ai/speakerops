/**
 * Browser E2E gate: `pnpm test:e2e`
 *
 * Pre-scaffold: documents that full REQUIRED suite is Phase 8 (S-E2E-RUN).
 * Post-scaffold: when Playwright config exists, delegates to playwright test.
 *
 * Section 0.3 does not claim full-suite green — only wires the command name.
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

console.log(`[test:e2e] running Playwright with ${config}`);
const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "--config", config],
  { cwd: root, stdio: "inherit", shell: false },
);
process.exit(result.status === null ? 1 : result.status);
