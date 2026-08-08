/**
 * Section 7.2 — governance / file assertions for OpenAPI + CLI (S-CLI).
 *
 * Named plan assertions:
 * - assert CLI01–CLI12 from CLI_INVENTORY.md covered by tests
 * - assert reports-only key schedule place exit code 2
 * - assert readiness --json parses
 * - assert openapi.json includes /api/events
 * - docs/CLI.md lists commands
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const cliMain = join(root, "packages", "cli", "src", "main.ts");
const cliCommands = join(root, "packages", "cli", "src", "commands.ts");
const cliExit = join(root, "packages", "cli", "src", "exit-codes.ts");
const cliHttp = join(root, "packages", "cli", "src", "http.ts");
const cliTest = join(root, "packages", "cli", "src", "cli.test.ts");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const authzPath = join(root, "apps", "api", "src", "middleware", "authz.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const docsCli = join(root, "docs", "CLI.md");
const sectionDoc = join(root, "docs", "sections", "7.2-cli.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "contracts",
  "CLI_INVENTORY.md",
);
const packageJson = join(root, "packages", "cli", "package.json");

const CLI_IDS = [
  "CLI01",
  "CLI02",
  "CLI03",
  "CLI04",
  "CLI05",
  "CLI06",
  "CLI07",
  "CLI08",
  "CLI09",
  "CLI10",
  "CLI11",
  "CLI12",
];

describe("7.2 OpenAPI and CLI governance", () => {
  it("primary files exist", () => {
    for (const p of [
      cliMain,
      cliCommands,
      cliExit,
      cliHttp,
      cliTest,
      openapiPath,
      docsCli,
      sectionDoc,
      inventoryPath,
    ]) {
      assert.ok(existsSync(p), `missing ${p}`);
    }
  });

  it("packages/cli bin is speakerops", () => {
    const pkg = JSON.parse(readFileSync(packageJson, "utf8"));
    assert.equal(pkg.bin?.speakerops, "./dist/main.js");
    assert.equal(pkg.name, "@speakerops/cli");
  });

  it("assert CLI01-CLI12 from CLI_INVENTORY.md covered by tests", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    const testSrc = readFileSync(cliTest, "utf8");
    const docs = readFileSync(docsCli, "utf8");
    for (const id of CLI_IDS) {
      assert.match(inv, new RegExp(id), `inventory missing ${id}`);
      assert.match(testSrc, new RegExp(id), `cli.test.ts missing ${id}`);
      assert.match(docs, new RegExp(id), `docs/CLI.md missing ${id}`);
    }
  });

  it("assert reports-only key schedule place exit code 2", () => {
    const testSrc = readFileSync(cliTest, "utf8");
    assert.match(testSrc, /CLI07/);
    assert.match(testSrc, /EXIT_AUTHZ|exit code 2|toBe\(EXIT_AUTHZ\)|toBe\(2\)/);
    assert.match(testSrc, /reports-only|reports:read/);
    assert.match(testSrc, /schedule.*place|schedule place/i);

    const exitSrc = readFileSync(cliExit, "utf8");
    assert.match(exitSrc, /EXIT_AUTHZ\s*=\s*2/);
    assert.match(exitSrc, /EXIT_CONFLICT\s*=\s*3/);
    assert.match(exitSrc, /EXIT_NETWORK\s*=\s*4/);
  });

  it("assert readiness --json parses", () => {
    const testSrc = readFileSync(cliTest, "utf8");
    assert.match(testSrc, /ReportsReadinessResponseSchema/);
    assert.match(testSrc, /outstanding/);
    assert.match(testSrc, /reports.*readiness|CLI02/i);

    const cmdSrc = readFileSync(cliCommands, "utf8");
    assert.match(cmdSrc, /\/readiness/);
    assert.match(cmdSrc, /cmdReportsReadiness/);
  });

  it("assert openapi.json includes /api/events", () => {
    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /["']\/api\/events["']/);
    assert.match(openapi, /Event\.List/);
    assert.match(openapi, /registerOpenApiRoute|buildOpenApiDocument/);
    assert.match(openapi, /Design\.Publish|DESIGN_OPENAPI/);

    const testSrc = readFileSync(cliTest, "utf8");
    assert.match(testSrc, /\/api\/events/);
    assert.match(testSrc, /openapi\.json|CLI12/);

    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /registerOpenApiRoute/);
  });

  it("docs/CLI.md lists commands and exit codes", () => {
    const docs = readFileSync(docsCli, "utf8");
    assert.match(docs, /events list/);
    assert.match(docs, /reports readiness/);
    assert.match(docs, /design publish/);
    assert.match(docs, /schedule place/);
    assert.match(docs, /files upload/);
    assert.match(docs, /comms draft/);
    assert.match(docs, /comms send/);
    assert.match(docs, /keys create/);
    assert.match(docs, /openapi/i);
    assert.match(docs, /SPEAKEROPS_API_KEY/);
    assert.match(docs, /exit/i);
    assert.match(docs, /0.*ok|Success/i);
  });

  it("bearer scope wiring present for CLI surfaces", () => {
    const authz = readFileSync(authzPath, "utf8");
    assert.match(authz, /requireSessionOrBearerScopes|bearerScopes/);
    assert.match(authz, /resolveBearer/);

    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /keys:\s*keysStore/);
    assert.match(index, /7\.2/);
  });

  it("CLI maps to domain commands not god-mode bypass", () => {
    const main = readFileSync(cliMain, "utf8");
    assert.match(main, /COMMANDS|S-CLI|scopes/i);
    assert.equal(
      /god.?mode|bypass.?scope|skip.?authz/i.test(main),
      false,
      "CLI must not document god-mode bypass",
    );
  });

  it("section doc exists and references S-CLI", () => {
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /S-CLI|7\.2/);
    assert.match(doc, /CLI01|CLI12/);
    assert.match(doc, /docs\/CLI\.md|CLI\.md/);
  });
});
