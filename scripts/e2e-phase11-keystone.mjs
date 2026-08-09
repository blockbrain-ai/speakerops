/**
 * Section 11.9 — Phase 11 dogfood handover keystone runner (S-DOGFOOD).
 *
 * Sets DOGFOOD_KEYSTONE=1, prefers live origin (no local webServer),
 * writes a dedicated JSON report under initiative evidence for hash provenance.
 *
 * Secrets (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID) should be loaded via:
 *   scripts/with-secrets.sh pnpm test:e2e:phase11-keystone
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = join(
  root,
  "initiative/PHASE10_11_GAP_CLOSE/evidence/phase11-keystone-run.json",
);
const hashPath = join(
  root,
  "initiative/PHASE10_11_GAP_CLOSE/evidence/phase11-keystone-run.SHA256",
);

mkdirSync(dirname(reportPath), { recursive: true });

process.env.DOGFOOD_KEYSTONE = "1";
// Live dogfood origin — no local Vite/API for D proofs
process.env.E2E_WEB_SERVER = process.env.E2E_WEB_SERVER ?? "0";
process.env.E2E_BASE_URL =
  process.env.E2E_BASE_URL || "https://www.speakerops.org";
process.env.E2E_PLAYWRIGHT_RUN_REPORT = reportPath;
process.env.E2E_PLAYWRIGHT_HTML_DIR =
  process.env.E2E_PLAYWRIGHT_HTML_DIR ||
  join(root, "playwright-report/phase11-keystone");

console.log(
  "[test:e2e:phase11-keystone] DOGFOOD_KEYSTONE=1 E2E_BASE_URL=" +
    process.env.E2E_BASE_URL +
    " E2E_WEB_SERVER=" +
    process.env.E2E_WEB_SERVER,
);

// Prefer built api not required when E2E_WEB_SERVER=0; still use e2e-run for consistency
// but e2e-run always builds API — that's fine / harmless.
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "--config",
    join(root, "playwright.config.ts"),
    "playwright/e2e/phase11_handover_keystone.spec.ts",
  ],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  },
);

if (existsSync(reportPath)) {
  const raw = readFileSync(reportPath);
  const hash = createHash("sha256").update(raw).digest("hex");
  writeFileSync(
    hashPath,
    `${hash}  phase11-keystone-run.json\n`,
    "utf8",
  );
  console.log(
    `[test:e2e:phase11-keystone] report hash → ${hashPath} (${hash.slice(0, 16)}…)`,
  );
} else {
  console.warn(
    "[test:e2e:phase11-keystone] no report at",
    reportPath,
    "— hash skipped",
  );
}

process.exit(result.status === null ? 1 : result.status);
