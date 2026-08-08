/**
 * Section 3.1 — governance / file assertions for Form builder API.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const migrationPath = join(
  root,
  "packages",
  "db",
  "migrations",
  "0007_forms.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const formsRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "forms",
  "routes.ts",
);
const formsTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "forms",
  "forms.test.ts",
);
const formsCommands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "forms",
  "commands.ts",
);
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const sectionDoc = join(root, "docs", "sections", "3.1-form-builder-api.md");
const sharedForms = join(root, "packages", "shared", "src", "forms.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");

describe("3.1 form builder API governance", () => {
  it("0007_forms.sql creates forms, form_versions, form_fields, form_rules", () => {
    assert.equal(existsSync(migrationPath), true, "0007_forms.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS forms\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS form_versions\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS form_fields\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS form_rules\b/i);
    assert.match(sql, /snapshot_json/i);
    assert.match(sql, /field_key/i);
    assert.match(sql, /route_to_category/i);
  });

  it("schema exports form tables", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /export const forms/);
    assert.match(src, /export const formVersions/);
    assert.match(src, /export const formFields/);
    assert.match(src, /export const formRules/);
  });

  it("shared form DTOs, routes, OpenAPI, and composition wiring exist", () => {
    assert.equal(existsSync(sharedForms), true);
    const shared = readFileSync(sharedForms, "utf8");
    assert.match(shared, /FormCreateBodySchema/);
    assert.match(shared, /FormUpdateDraftBodySchema/);
    assert.match(shared, /FieldKeySchema/);

    assert.equal(existsSync(formsRoutes), true);
    const routes = readFileSync(formsRoutes, "utf8");
    assert.match(routes, /Form\.Create/);
    assert.match(routes, /Form\.UpdateDraftFields/);
    assert.match(routes, /Form\.Publish/);
    assert.match(routes, /Form\.GetPublic/);

    assert.equal(existsSync(formsCommands), true);
    assert.equal(existsSync(openapiPath), true);
    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /Form\.Create/);
    assert.match(openapi, /Form\.Publish/);

    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /createEventFormsRoutes|createFormsRoutes/);
    assert.match(index, /registerOpenApiRoute/);
    assert.match(index, /D1FormsStore|MemoryFormsStore/);
  });

  it("named assertions present in forms.test.ts", () => {
    assert.equal(existsSync(formsTest), true);
    const src = readFileSync(formsTest, "utf8");
    for (const name of [
      "assert publish freezes form_versions row immutable",
      "assert draft update does not change published snapshot_json",
      "assert invalid condition field_key 400",
    ]) {
      assert.match(
        src,
        new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });

  it("section doc exists", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /3\.1/);
    assert.match(doc, /Form\.Publish|form_versions/);
    assert.match(doc, /S-CFP/);
  });
});
