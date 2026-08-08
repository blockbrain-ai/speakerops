/**
 * pnpm db:migrate — apply packages/db/migrations/*.sql to local SQLite (sql.js).
 *
 * Env:
 *   SPEAKEROPS_DB_PATH — target DB file (default: .data/speakerops.local.sqlite)
 *
 * Non-interactive (E5). No secrets required for local apply.
 * Cloudflare remote apply uses the same SQL via wrangler migrations_dir.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function loadMigrate() {
  const distJs = join(root, "packages/db/dist/src/migrate.js");
  if (!existsSync(distJs)) {
    const { execSync } = await import("node:child_process");
    console.log("[db:migrate] building @speakerops/db …");
    execSync("pnpm --filter @speakerops/db build", {
      cwd: root,
      stdio: "inherit",
    });
  }
  return import(pathToFileURL(distJs).href);
}

async function main() {
  try {
    require.resolve("sql.js");
  } catch {
    console.error("[db:migrate] sql.js is required. Run: pnpm install");
    process.exit(1);
  }

  const { migrate, BASELINE_TABLES } = await loadMigrate();

  const migrationsDir = join(root, "packages/db/migrations");
  const dbPath = process.env.SPEAKEROPS_DB_PATH
    ? process.env.SPEAKEROPS_DB_PATH
    : join(root, ".data", "speakerops.local.sqlite");

  const result = await migrate({ dbPath, migrationsDir });

  console.log(`[db:migrate] db=${result.dbPath}`);
  console.log(`[db:migrate] migrationsDir=${result.migrationsDir}`);
  console.log(
    `[db:migrate] applied=${result.applied.length ? result.applied.join(", ") : "(none)"}`,
  );
  console.log(
    `[db:migrate] skipped=${result.skipped.length ? result.skipped.join(", ") : "(none)"}`,
  );
  console.log(`[db:migrate] tables=${result.tables.join(", ")}`);

  const missing = BASELINE_TABLES.filter((t) => !result.tables.includes(t));
  if (missing.length > 0) {
    console.error(`[db:migrate] missing baseline tables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("[db:migrate] ok");
}

main().catch((err) => {
  console.error("[db:migrate] failed:", err instanceof Error ? err.message : err);
  if (err && typeof err === "object" && "stack" in err) {
    // Local debug only — never print secrets (none expected here)
  }
  process.exit(1);
});
