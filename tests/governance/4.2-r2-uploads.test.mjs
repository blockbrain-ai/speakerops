/**
 * Section 4.2 — governance / file assertions for R2 uploads.
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
  "0013_file_assets_virus_scan.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const filesRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "files",
  "routes.ts",
);
const filesCommands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "files",
  "commands.ts",
);
const filesTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "files",
  "files.test.ts",
);
const sharedFiles = join(root, "packages", "shared", "src", "files.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const sectionDoc = join(root, "docs", "sections", "4.2-r2-uploads.md");
const schemaContract = join(
  root,
  "KMS-competition",
  "initiative",
  "contracts",
  "SCHEMA.md",
);
const commandsPath = join(
  root,
  "KMS-competition",
  "initiative",
  "contracts",
  "COMMANDS.md",
);
const wranglerPath = join(root, "wrangler.toml");

describe("4.2 R2 file uploads governance", () => {
  it("0013 migration adds virus_scan_status stub", () => {
    assert.equal(
      existsSync(migrationPath),
      true,
      "0013_file_assets_virus_scan.sql must exist",
    );
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /virus_scan_status/i);
    assert.match(sql, /unscanned/i);
  });

  it("schema exports virusScanStatus on file_assets", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /virusScanStatus|virus_scan_status/);
    assert.match(src, /export const fileAssets/);
  });

  it("shared files DTOs and mime allowlists exist", () => {
    assert.equal(existsSync(sharedFiles), true);
    const shared = readFileSync(sharedFiles, "utf8");
    assert.match(shared, /HEADSHOT_MIME_ALLOWLIST/);
    assert.match(shared, /SLIDES_MIME_ALLOWLIST/);
    assert.match(shared, /application\/x-msdownload|BLOCKED_UPLOAD_MIMES/);
    assert.match(shared, /FileCompleteBodySchema/);
    assert.match(shared, /VIRUS_SCAN_UNSCANNED|unscanned/);
  });

  it("files module routes and commands exist", () => {
    assert.equal(existsSync(filesRoutes), true);
    assert.equal(existsSync(filesCommands), true);
    const routes = readFileSync(filesRoutes, "utf8");
    assert.match(routes, /presign/i);
    assert.match(routes, /complete/i);
    assert.match(routes, /File\.CompleteUpload|completeFileUpload/);
    const commands = readFileSync(filesCommands, "utf8");
    assert.match(commands, /completeFileUpload/);
  });

  it("composition root mounts /api/files", () => {
    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /\/api\/files/);
    assert.match(index, /createFileRoutes|4\.2/);
  });

  it("OpenAPI registers File.PresignUpload and File.CompleteUpload", () => {
    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /File\.PresignUpload/);
    assert.match(openapi, /File\.CompleteUpload/);
    assert.match(openapi, /FILE_OPENAPI_PATHS/);
  });

  it("named assertions present in files.test.ts", () => {
    assert.equal(existsSync(filesTest), true);
    const src = readFileSync(filesTest, "utf8");
    for (const name of [
      "assert application/x-msdownload presign 400",
      "assert complete without presign 400",
      "assert file_assets row has r2_key not bytes",
    ]) {
      assert.match(
        src,
        new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });

  it("section doc and contracts mention file_assets / R2", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /r2_key|R2/i);
    assert.match(doc, /headshot|slides/i);

    const schema = readFileSync(schemaContract, "utf8");
    assert.match(schema, /virus_scan_status/);
    assert.match(schema, /file_assets/);

    const commands = readFileSync(commandsPath, "utf8");
    assert.match(commands, /File\.PresignUpload/);
    assert.match(commands, /File\.CompleteUpload/);
  });

  it("wrangler.toml binds R2 as FILES", () => {
    const wrangler = readFileSync(wranglerPath, "utf8");
    assert.match(wrangler, /binding\s*=\s*"FILES"/);
  });
});
