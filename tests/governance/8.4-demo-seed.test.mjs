/**
 * Section 8.4 — Demo seed and role switcher governance (node:test).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /RESEND_API_KEY\s*=\s*["'][^"']+["']/,
  /TURNSTILE_SECRET_KEY\s*=\s*["'][^"']{10,}["']/,
];

const paths = {
  seed: join(root, "scripts/seed.ts"),
  roleSwitcher: join(root, "apps/web/src/components/RoleSwitcher.tsx"),
  roleSwitchTest: join(root, "apps/api/src/modules/auth/role-switch.test.ts"),
  vitest: join(root, "tests/8.4-demo-seed.test.ts"),
  sectionDoc: join(root, "docs/sections/8.4-demo-seed.md"),
  packageJson: join(root, "package.json"),
  readme: join(root, "README.md"),
  commands: join(
    root,
    "KMS-competition/initiative/contracts/COMMANDS.md",
  ),
  authRoutes: join(root, "apps/api/src/modules/auth/routes.ts"),
  inventory: join(
    root,
    "KMS-competition/initiative/BROWSER_E2E_INVENTORY.md",
  ),
  l05: join(root, "playwright/e2e/readiness_dashboard.spec.ts"),
};

describe("8.4 Demo seed and role switcher", () => {
  it("deliverables exist", () => {
    for (const [name, p] of Object.entries(paths)) {
      assert.equal(existsSync(p), true, `missing ${name}: ${p}`);
    }
  });

  it("pnpm seed script wired", () => {
    const pkg = JSON.parse(readFileSync(paths.packageJson, "utf8"));
    assert.equal(typeof pkg.scripts?.seed, "string");
    assert.match(pkg.scripts.seed, /seed\.ts/);
  });

  it("assert seed twice yields same speaker count (named test present)", () => {
    const t = readFileSync(paths.vitest, "utf8");
    assert.match(t, /assert seed twice yields same speaker count/);
    assert.match(t, /SEED_SPEAKER_COUNT|speakerCount/);
    const seed = readFileSync(paths.seed, "utf8");
    assert.match(seed, /SEED_SPEAKER_COUNT\s*=\s*150/);
    assert.match(seed, /ON CONFLICT/);
  });

  it("assert seed includes ≥1 schedule conflict and missing headshots (named test)", () => {
    const t = readFileSync(paths.vitest, "utf8");
    assert.match(
      t,
      /assert seed includes ≥1 schedule conflict and missing headshots/,
    );
    const seed = readFileSync(paths.seed, "utf8");
    assert.match(seed, /scheduleConflict|conflict/i);
    assert.match(seed, /headshot/i);
    assert.match(seed, /missingHeadshot|headshot_file_id/);
  });

  it("README seed instructions present", () => {
    const readme = readFileSync(paths.readme, "utf8");
    assert.match(readme, /pnpm seed/);
    assert.match(readme, /seed|role switcher|8\.4/i);
  });

  it("role switcher is flag-gated (dev/dogfood only)", () => {
    const ui = readFileSync(paths.roleSwitcher, "utf8");
    assert.match(ui, /VITE_ROLE_SWITCHER|isRoleSwitcherEnabled/);
    assert.match(ui, /role-switcher/);
    const routes = readFileSync(paths.authRoutes, "utf8");
    assert.match(routes, /enableRoleSwitcher/);
    assert.match(routes, /dev\/role-switch/);
    const apiIndex = readFileSync(
      join(root, "apps/api/src/index.ts"),
      "utf8",
    );
    assert.match(apiIndex, /ROLE_SWITCHER_ENABLED/);
    // Production path default must not force-enable
    assert.match(apiIndex, /enableRoleSwitcher:\s*roleSwitcherEnabled/);
  });

  it("COMMANDS.md lists Auth.DevRoleSwitch", () => {
    const cmd = readFileSync(paths.commands, "utf8");
    assert.match(cmd, /Auth\.DevRoleSwitch|dev\/role-switch/);
  });

  it("L05 remains Playwright-bound (seed supports L05)", () => {
    const l05 = readFileSync(paths.l05, "utf8");
    assert.match(l05, /@inv:L05/);
    const inv = readFileSync(paths.inventory, "utf8");
    const row = inv.split("\n").find((l) => l.includes("| L05 |"));
    assert.ok(row, "L05 inventory row");
    assert.match(row, /PASS|IMPLEMENTED/);
  });

  it("no secrets committed in 8.4 files", () => {
    const files = [
      paths.seed,
      paths.roleSwitcher,
      paths.roleSwitchTest,
      paths.sectionDoc,
      paths.vitest,
    ];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      for (const re of SECRET_PATTERNS) {
        assert.equal(
          re.test(body),
          false,
          `secret-like pattern in ${f}: ${re}`,
        );
      }
    }
  });
});
