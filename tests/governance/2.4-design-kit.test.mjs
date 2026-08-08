/**
 * Section 2.4 — governance / file assertions for Design Kit.
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
  "0005_design_tokens.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const designRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "design",
  "routes.ts",
);
const designTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "design",
  "design.test.ts",
);
const designPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "DesignKit.tsx",
);
const publicCfp = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "PublicCfp.tsx",
);
const e2ePath = join(root, "playwright", "e2e", "design_kit.spec.ts");
const sectionDoc = join(root, "docs", "sections", "2.4-design-kit.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const sharedDesign = join(root, "packages", "shared", "src", "design.ts");

describe("2.4 design kit governance", () => {
  it("0005_design_tokens.sql creates design draft/published and file_assets", () => {
    assert.equal(existsSync(migrationPath), true, "0005_design_tokens.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS design_token_drafts\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS design_token_published\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS file_assets\b/i);
  });

  it("schema exports design tables", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /export const designTokenDrafts/);
    assert.match(src, /export const designTokenPublished/);
    assert.match(src, /export const fileAssets/);
  });

  it("shared design DTOs and API routes exist", () => {
    assert.equal(existsSync(sharedDesign), true);
    const shared = readFileSync(sharedDesign, "utf8");
    assert.match(shared, /DesignSetDraftBodySchema/);
    assert.match(shared, /DesignPublishBodySchema/);
    assert.match(shared, /validateContrastGate/);
    assert.match(shared, /LOGO_MIME_ALLOWLIST/);

    assert.equal(existsSync(designRoutes), true);
    const routes = readFileSync(designRoutes, "utf8");
    assert.match(routes, /Design\.Get|design/);
    assert.match(routes, /Design\.Publish|publish/);
    assert.match(routes, /presign/i);
  });

  it("named assertions present in design.test.ts", () => {
    assert.equal(existsSync(designTest), true);
    const src = readFileSync(designTest, "utf8");
    for (const name of [
      "assert publish with brand #fffffe fails contrast or derives safe fg",
      "assert image/svg+xml logo presign 400",
      "assert public design endpoint returns published not draft",
    ]) {
      assert.match(src, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("DesignKit UI and Playwright @inv C03–C06 C08–C10 exist", () => {
    assert.equal(existsSync(designPage), true);
    assert.equal(existsSync(publicCfp), true);
    assert.equal(existsSync(e2ePath), true);
    const e2e = readFileSync(e2ePath, "utf8");
    for (const id of ["C03", "C04", "C05", "C06", "C08", "C09", "C10"]) {
      assert.match(e2e, new RegExp(`@inv:${id}`));
    }
    assert.match(e2e, /e2e\/admin\/design-color/);
    assert.match(e2e, /e2e\/admin\/design-logo/);
    assert.match(e2e, /e2e\/admin\/design-publish/);
    assert.match(e2e, /e2e\/admin\/design-no-css/);
    assert.match(e2e, /e2e\/admin\/design-contrast/);
    assert.match(e2e, /e2e\/admin\/design-logo-xss/);
    assert.match(e2e, /e2e\/admin\/design-draft-isolation/);
  });

  it("inventory C03–C06 C08–C10 status IMPLEMENTED", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of ["C03", "C04", "C05", "C06", "C08", "C09", "C10"]) {
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
    assert.match(doc, /2\.4/);
    assert.match(doc, /Design\.Publish/);
    assert.match(doc, /contrast/i);
  });

  it("no freeform CSS field in DesignKit page", () => {
    const src = readFileSync(designPage, "utf8");
    assert.equal(/data-testid=["']design-custom-css["']/.test(src), false);
    assert.equal(/name=["']customCss["']/.test(src), false);
    assert.equal(/freeform\s*css/i.test(src) && /textarea/.test(src), false);
  });

  it("no secrets in design module sources", () => {
    const dir = join(root, "apps", "api", "src", "modules", "design");
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const body = readFileSync(join(dir, f), "utf8");
      assert.equal(/sk-[A-Za-z0-9]{20,}/.test(body), false, f);
      assert.equal(/CLOUDFLARE_API_TOKEN\s*=/.test(body), false, f);
    }
  });
});
