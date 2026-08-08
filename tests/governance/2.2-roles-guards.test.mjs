/**
 * Section 2.2 — governance / file assertions for roles and route guards.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const migrationPath = join(
  root,
  "packages",
  "db",
  "migrations",
  "0003_event_memberships.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const authzPath = join(root, "apps", "api", "src", "middleware", "authz.ts");
const authzTestPath = join(
  root,
  "apps",
  "api",
  "src",
  "middleware",
  "authz.test.ts",
);
const requireRoleUi = join(root, "apps", "web", "src", "auth", "RequireRole.tsx");
const e2ePath = join(root, "playwright", "e2e", "auth_role_guards.spec.ts");
const sectionDoc = join(root, "docs", "sections", "2.2-roles-guards.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);

describe("2.2 roles and route guards governance", () => {
  it("0003_event_memberships.sql creates event_memberships with role", () => {
    assert.equal(existsSync(migrationPath), true, "0003_event_memberships.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(
      sql,
      /CREATE TABLE IF NOT EXISTS event_memberships\b/i,
      "must create event_memberships",
    );
    assert.match(sql, /\brole\b/i);
    assert.match(sql, /event_id/i);
    assert.match(sql, /user_id/i);
  });

  it("schema exports eventMemberships", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /export const eventMemberships/);
  });

  it("requireRole middleware exists with 401/403/404 policy", () => {
    assert.equal(existsSync(authzPath), true);
    const src = readFileSync(authzPath, "utf8");
    assert.match(src, /export function requireRole/);
    assert.match(src, /UNAUTHORIZED|401/);
    assert.match(src, /FORBIDDEN|403/);
    assert.match(src, /NOT_FOUND|404/);
    assert.match(src, /cross-event/i);
  });

  it("named assertions present in authz.test.ts", () => {
    const src = readFileSync(authzTestPath, "utf8");
    for (const name of [
      "assert speaker session GET /api/events admin list returns 403",
      "assert evaluator POST schedule place returns 403",
      "assert unauthenticated admin route 401",
    ]) {
      assert.match(src, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("RequireRole UI and Playwright @inv B04–B06 exist", () => {
    assert.equal(existsSync(requireRoleUi), true);
    assert.equal(existsSync(e2ePath), true);
    const e2e = readFileSync(e2ePath, "utf8");
    assert.match(e2e, /@inv:B04/);
    assert.match(e2e, /@inv:B05/);
    assert.match(e2e, /@inv:B06/);
    assert.match(e2e, /e2e\/auth\/admin-guard/);
    assert.match(e2e, /e2e\/auth\/role-guard-admin/);
    assert.match(e2e, /e2e\/auth\/role-guard-eval/);
  });

  it("inventory B04–B06 status IMPLEMENTED", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of ["B04", "B05", "B06"]) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*IMPLEMENTED\\s*\\|`,
        ),
        `${id} must be IMPLEMENTED`,
      );
    }
  });

  it("section doc exists", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /2\.2/);
    assert.match(doc, /requireRole/);
    assert.match(doc, /401/);
    assert.match(doc, /403/);
    assert.match(doc, /404/);
  });

  it("no secrets in authz / events / schedule sources", () => {
    const dirs = [
      join(root, "apps", "api", "src", "middleware"),
      join(root, "apps", "api", "src", "modules", "events"),
      join(root, "apps", "api", "src", "modules", "schedule"),
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
      for (const f of files) {
        const body = readFileSync(join(dir, f), "utf8");
        assert.equal(/sk-[A-Za-z0-9]{20,}/.test(body), false, f);
        assert.equal(/CLOUDFLARE_API_TOKEN\s*=/.test(body), false, f);
      }
    }
  });
});
