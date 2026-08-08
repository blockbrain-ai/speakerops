/**
 * Typecheck gate — delegates to monorepo project references (`tsc -b`).
 * Kept for callers that invoke this script directly; root `pnpm typecheck`
 * uses `tsc -b --pretty false` (non-interactive, no watch).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "pnpm",
  ["exec", "tsc", "-b", "--pretty", "false"],
  { cwd: root, stdio: "inherit", shell: false },
);
process.exit(result.status === null ? 1 : result.status);
