/**
 * Section 7.1 — governance / file assertions for API keys and scopes.
 *
 * Named plan assertions:
 * - assert secret returned once only on create
 * - assert list endpoints never include full secret
 * - assert revoked key 401 on API call
 * - assert @inv:K01-K04
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sharedKeys = join(root, "packages", "shared", "src", "keys.ts");
const sharedIndex = join(root, "packages", "shared", "src", "index.ts");
const migration = join(
  root,
  "packages",
  "db",
  "migrations",
  "0018_api_keys.sql",
);
const schema = join(root, "packages", "db", "schema.ts");
const store = join(root, "apps", "api", "src", "modules", "keys", "store.ts");
const commands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "keys",
  "commands.ts",
);
const routes = join(root, "apps", "api", "src", "modules", "keys", "routes.ts");
const apiTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "keys",
  "keys.test.ts",
);
const authz = join(root, "apps", "api", "src", "middleware", "authz.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const page = join(root, "apps", "web", "src", "pages", "ApiKeys.tsx");
const appTsx = join(root, "apps", "web", "src", "App.tsx");
const e2ePath = join(root, "playwright", "e2e", "api_keys.spec.ts");
const sectionDoc = join(root, "docs", "sections", "7.1-api-keys.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const shellCss = join(root, "apps", "web", "src", "styles", "shell.css");

const K_IDS = ["K01", "K02", "K03", "K04"];

describe("7.1 API keys governance", () => {
  it("primary files exist", () => {
    for (const p of [
      sharedKeys,
      migration,
      schema,
      store,
      commands,
      routes,
      apiTest,
      authz,
      page,
      e2ePath,
      sectionDoc,
    ]) {
      assert.ok(existsSync(p), `missing ${p}`);
    }
  });

  it("migration creates api_keys with hash columns only", () => {
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS api_keys/i);
    assert.match(sql, /key_hash/);
    assert.match(sql, /key_prefix/);
    assert.match(sql, /scopes_json/);
    // No column for raw secret material (comments may mention "plaintext never")
    assert.equal(
      /secret_plain|raw_secret|plaintext_secret/i.test(sql),
      false,
      "migration must not store plaintext secret columns",
    );
    assert.equal(
      /\bsecret\s+TEXT\b/i.test(sql),
      false,
      "migration must not have a secret TEXT column",
    );
  });

  it("schema exports apiKeys table", () => {
    const src = readFileSync(schema, "utf8");
    assert.match(src, /export const apiKeys/);
    assert.match(src, /keyHash/);
    assert.match(src, /scopesJson/);
  });

  it("shared DTOs export Keys schemas + default-deny", () => {
    const src = readFileSync(sharedKeys, "utf8");
    assert.match(src, /KeysCreateBodySchema/);
    assert.match(src, /KeysCreateResponseSchema/);
    assert.match(src, /KeysListResponseSchema/);
    assert.match(src, /DEFAULT_DENY_SCOPES/);
    assert.match(src, /keys:admin/);
    assert.match(src, /comms:send/);
    assert.match(src, /decisions:write/);
    const idx = readFileSync(sharedIndex, "utf8");
    assert.match(idx, /from "\.\/keys\.js"/);
  });

  it("composition root registers /api/keys", () => {
    const src = readFileSync(indexPath, "utf8");
    assert.match(src, /createKeysRoutes/);
    assert.match(src, /["']\/api\/keys["']/);
    assert.match(src, /MemoryKeysStore|D1KeysStore/);
  });

  it("authz has requireKeysAdmin + Bearer support", () => {
    const src = readFileSync(authz, "utf8");
    assert.match(src, /requireKeysAdmin/);
    assert.match(src, /resolveBearer|extractBearerSecret/);
    assert.match(src, /Authorization|Bearer/i);
  });

  it("commands hash secret and audit without secret", () => {
    const src = readFileSync(commands, "utf8");
    assert.match(src, /hashToken/);
    assert.match(src, /Keys\.Create/);
    assert.match(src, /Keys\.Revoke/);
    assert.match(src, /insertAudit/);
    assert.match(src, /authenticateApiKey/);
    // Must not log secret in audit
    assert.match(src, /Never log secret|never.*secret/i);
  });

  it("API unit tests name required assertions", () => {
    const src = readFileSync(apiTest, "utf8");
    assert.match(src, /assert secret returned once only on create/);
    assert.match(src, /assert list endpoints never include full secret/);
    assert.match(src, /assert revoked key 401 on API call/);
    assert.match(src, /default-deny/);
  });

  it("UI page + route + Lumen CSS", () => {
    const ui = readFileSync(page, "utf8");
    assert.match(ui, /api-keys-page/);
    assert.match(ui, /api-key-secret-once/);
    assert.match(ui, /api-key-create-submit/);
    assert.match(ui, /DEFAULT_DENY_SCOPE_SET|SAFE_DEFAULT_SCOPES/);
    assert.equal(
      /dangerouslySetInnerHTML/.test(ui),
      false,
      "no raw HTML injection",
    );
    const app = readFileSync(appTsx, "utf8");
    assert.match(app, /ApiKeysPage/);
    assert.match(app, /admin\/settings\/api-keys/);
    const css = readFileSync(shellCss, "utf8");
    assert.match(css, /\.api-keys/);
    // Lumen tokens only
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(
        css.slice(css.indexOf("/* Section 7.1")),
      ),
      false,
      "7.1 CSS must use Lumen tokens not freeform hex",
    );
  });

  it("Playwright binds @inv:K01–K04", () => {
    const src = readFileSync(e2ePath, "utf8");
    for (const id of K_IDS) {
      assert.match(src, new RegExp(`@inv:${id}`), `missing @inv:${id}`);
    }
    assert.match(src, /e2e\/keys\/create/);
    assert.match(src, /e2e\/keys\/revoke/);
    assert.match(src, /e2e\/keys\/secret-once/);
    assert.match(src, /e2e\/keys\/authz/);
  });

  it("inventory K01–K04 are not OPEN (IMPLEMENTED or PASS)", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of K_IDS) {
      const line = inv
        .split("\n")
        .find((l) => l.includes(`| ${id} |`));
      assert.ok(line, `inventory row for ${id}`);
      assert.equal(
        /\|\s*OPEN\s*\|?\s*$/.test(line) || line.includes("| OPEN |"),
        false,
        `${id} must not remain OPEN after 7.1`,
      );
      assert.match(
        line,
        /\|\s*(PASS|IMPLEMENTED)\s*\|/,
        `${id} status should be PASS or IMPLEMENTED`,
      );
    }
  });

  it("OpenAPI registers Keys commands", () => {
    const src = readFileSync(openapiPath, "utf8");
    assert.match(src, /Keys\.Create/);
    assert.match(src, /Keys\.Revoke/);
    assert.match(src, /Keys\.List/);
    assert.match(src, /KEYS_OPENAPI_PATHS/);
  });

  it("migrations stay linear additive NNNN_*.sql", () => {
    const dir = join(root, "packages", "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    assert.ok(files.includes("0018_api_keys.sql"));
    for (const f of files) {
      assert.match(f, /^\d{4}_.+\.sql$/i, `bad migration name: ${f}`);
    }
  });

  it("section doc exists", () => {
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /7\.1/);
    assert.match(doc, /K01/);
    assert.match(doc, /api_keys/);
  });
});
