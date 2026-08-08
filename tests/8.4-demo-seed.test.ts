/**
 * Section 8.4 — Demo seed + role switcher (Vitest).
 *
 * Named assertions from spec:
 * - assert seed twice yields same speaker count
 * - assert seed includes ≥1 schedule conflict and missing headshots
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

describe("8.4 demo seed and role switcher", () => {
  beforeAll(async () => {
    // Ensure db package is built for migrate/seed
    const distJs = join(root, "packages/db/dist/src/migrate.js");
    if (!existsSync(distJs)) {
      const { execSync } = await import("node:child_process");
      execSync("pnpm --filter @speakerops/db build", {
        cwd: root,
        stdio: "pipe",
      });
    }
  });

  it("assert seed twice yields same speaker count", async () => {
    const seedMod = await import(
      pathToFileURL(join(root, "scripts/seed.ts")).href
    );
    const dir = mkdtempSync(join(tmpdir(), "spo-seed-"));
    const dbPath = join(dir, "seed.sqlite");
    try {
      const first = await seedMod.runSeed({ dbPath });
      const second = await seedMod.runSeed({ dbPath });
      expect(first.speakerCount).toBe(seedMod.SEED_SPEAKER_COUNT);
      expect(second.speakerCount).toBe(seedMod.SEED_SPEAKER_COUNT);
      expect(second.speakerCount).toBe(first.speakerCount);
      expect(first.eventId).toBe(seedMod.SEED_EVENT_ID);
      expect(second.correlationId).toBe(seedMod.SEED_CORRELATION_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("assert seed includes ≥1 schedule conflict and missing headshots", async () => {
    const seedMod = await import(
      pathToFileURL(join(root, "scripts/seed.ts")).href
    );
    const dir = mkdtempSync(join(tmpdir(), "spo-seed-cf-"));
    const dbPath = join(dir, "seed.sqlite");
    try {
      const result = await seedMod.runSeed({ dbPath });
      expect(result.scheduleConflictCount).toBeGreaterThanOrEqual(1);
      expect(result.missingHeadshotCount).toBeGreaterThanOrEqual(1);
      expect(result.outstandingTaskCount).toBeGreaterThanOrEqual(1);
      expect(result.speakerCount).toBe(150);

      // Re-open and re-count conflicts via exported helper
      const initSqlJs = require("sql.js") as (
        config?: { locateFile?: (file: string) => string },
      ) => Promise<import("sql.js").SqlJsStatic>;
      let wasmDir: string;
      try {
        wasmDir = dirname(require.resolve("sql.js/dist/sql-wasm.js"));
      } catch {
        wasmDir = dirname(require.resolve("sql.js"));
      }
      const SQL = await initSqlJs({
        locateFile: (file: string) => join(wasmDir, file),
      });
      const { readFileSync } = await import("node:fs");
      const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
      try {
        const conflicts = seedMod.countRoomScheduleConflicts(
          db,
          seedMod.SEED_EVENT_ID,
        );
        expect(conflicts).toBeGreaterThanOrEqual(1);

        // audit_events with correlationId present
        const stmt = db.prepare(
          `SELECT correlation_id, action FROM audit_events WHERE id = ?`,
        );
        stmt.bind([seedMod.SEED_AUDIT_ID]);
        expect(stmt.step()).toBe(true);
        const row = stmt.getAsObject() as {
          correlation_id: string;
          action: string;
        };
        expect(row.correlation_id).toBe(seedMod.SEED_CORRELATION_ID);
        expect(row.action).toBe("Seed.DemoGraph");
        stmt.free();
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("package.json wires pnpm seed and deliverables exist", () => {
    const pkg = JSON.parse(
      require("node:fs").readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.seed).toMatch(/seed\.ts/);
    expect(existsSync(join(root, "scripts/seed.ts"))).toBe(true);
    expect(
      existsSync(join(root, "apps/web/src/components/RoleSwitcher.tsx")),
    ).toBe(true);
    expect(existsSync(join(root, "docs/sections/8.4-demo-seed.md"))).toBe(true);
  });

  it("README documents seed instructions", () => {
    const readme = require("node:fs").readFileSync(
      join(root, "README.md"),
      "utf8",
    ) as string;
    expect(readme).toMatch(/pnpm seed/);
    expect(readme).toMatch(/8\.4|demo seed|role switcher/i);
  });
});
