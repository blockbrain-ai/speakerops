/**
 * Section 2.1 — governance / file assertions for session auth magic link.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const migrationPath = join(root, "packages", "db", "migrations", "0002_auth.sql");
const schemaPath = join(root, "packages", "db", "schema.ts");
const authTestPath = join(root, "apps", "api", "src", "modules", "auth", "auth.test.ts");
const routesPath = join(root, "apps", "api", "src", "modules", "auth", "routes.ts");
const loginPath = join(root, "apps", "web", "src", "pages", "Login.tsx");
const e2ePath = join(root, "playwright", "e2e", "auth_magic_link.spec.ts");
const sectionDoc = join(root, "docs", "sections", "2.1-session-auth.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);

describe("2.1 session auth magic link governance", () => {
  it("0002_auth.sql creates users, auth_sessions, magic_links with token_hash only", () => {
    assert.equal(existsSync(migrationPath), true, "0002_auth.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    for (const table of ["users", "auth_sessions", "magic_links"]) {
      assert.match(
        sql,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"),
        `must create ${table}`,
      );
    }
    assert.match(sql, /token_hash/i);
    // No plaintext token column
    assert.equal(
      /CREATE TABLE[\s\S]*?\btoken\b(?!_hash)/i.test(
        sql.replace(/token_hash/gi, "TOKENHASH"),
      ),
      false,
      "must not create plaintext token column",
    );
  });

  it("schema exports users, authSessions, magicLinks", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /export const users/);
    assert.match(src, /export const authSessions/);
    assert.match(src, /export const magicLinks/);
  });

  it("auth routes map COMMANDS.md paths", () => {
    const src = readFileSync(routesPath, "utf8");
    assert.match(src, /\/magic-link|magic-link/);
    assert.match(src, /\/exchange|exchange/);
    assert.match(src, /\/logout|logout/);
    assert.match(src, /HttpOnly/i);
  });

  it("named assertions present in auth.test.ts", () => {
    const src = readFileSync(authTestPath, "utf8");
    for (const name of [
      "assert magic link token stored only as hash",
      "assert reused exchange returns 401",
      "assert Set-Cookie contains HttpOnly",
      "assert unknown email still returns sent:true",
    ]) {
      assert.match(src, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("Login page and Playwright @inv B01–B03 exist", () => {
    assert.equal(existsSync(loginPath), true);
    assert.equal(existsSync(e2ePath), true);
    const e2e = readFileSync(e2ePath, "utf8");
    assert.match(e2e, /@inv:B01/);
    assert.match(e2e, /@inv:B02/);
    assert.match(e2e, /@inv:B03/);
    assert.match(e2e, /e2e\/auth\/admin-login/);
    assert.match(e2e, /e2e\/auth\/speaker-magic/);
    assert.match(e2e, /e2e\/auth\/logout/);
  });

  it("inventory B01–B03 status IMPLEMENTED", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of ["B01", "B02", "B03"]) {
      assert.match(
        inv,
        new RegExp(`\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*IMPLEMENTED\\s*\\|`),
        `${id} must be IMPLEMENTED`,
      );
    }
  });

  it("section doc exists", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /2\.1/);
    assert.match(doc, /HttpOnly/i);
  });

  it("no secrets in auth module sources", () => {
    const authDir = join(root, "apps", "api", "src", "modules", "auth");
    const files = readdirSync(authDir).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const body = readFileSync(join(authDir, f), "utf8");
      assert.equal(/sk-[A-Za-z0-9]{20,}/.test(body), false, f);
      assert.equal(/CLOUDFLARE_API_TOKEN\s*=/.test(body), false, f);
    }
  });
});
