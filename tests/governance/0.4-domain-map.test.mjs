/**
 * Section 0.4 — Domain and command map named assertions.
 * Spec tests:
 * - assert COMMANDS and SCHEMA linked
 * - assert Person≠Speaker sentence
 * - assert scopes default-deny listed
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const domainMapPath = join(root, "docs", "governance", "0.4-domain-map.md");
const contractsIndexPath = join(root, "docs", "CONTRACTS.md");
const schemaPath = join(
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
const scopesPath = join(
  root,
  "KMS-competition",
  "initiative",
  "contracts",
  "SCOPES.md",
);

describe("0.4 Domain and command map", () => {
  it("assert domain map doc exists", () => {
    assert.equal(
      existsSync(domainMapPath),
      true,
      "docs/governance/0.4-domain-map.md must exist",
    );
  });

  it("assert COMMANDS and SCHEMA linked", () => {
    const body = readFileSync(domainMapPath, "utf8");
    assert.match(
      body,
      /COMMANDS\.md/,
      "domain map must link COMMANDS.md",
    );
    assert.match(
      body,
      /SCHEMA\.md/,
      "domain map must link SCHEMA.md",
    );
    assert.match(
      body,
      /SCOPES\.md/,
      "domain map must link SCOPES.md (third contract)",
    );
    // Relative link targets under initiative/contracts
    assert.match(
      body,
      /initiative\/contracts\/SCHEMA\.md|contracts\/SCHEMA\.md/,
      "must include SCHEMA path under initiative/contracts",
    );
    assert.match(
      body,
      /initiative\/contracts\/COMMANDS\.md|contracts\/COMMANDS\.md/,
      "must include COMMANDS path under initiative/contracts",
    );
    assert.match(
      body,
      /initiative\/contracts\/SCOPES\.md|contracts\/SCOPES\.md/,
      "must include SCOPES path under initiative/contracts",
    );
    assert.equal(existsSync(schemaPath), true, "SCHEMA.md must exist");
    assert.equal(existsSync(commandsPath), true, "COMMANDS.md must exist");
    assert.equal(existsSync(scopesPath), true, "SCOPES.md must exist");
  });

  it("assert Person≠Speaker sentence", () => {
    const body = readFileSync(domainMapPath, "utf8");
    assert.match(
      body,
      /Person\s*≠\s*Speaker|Person\s*!=\s*Speaker/,
      "domain map must state Person≠Speaker",
    );
    assert.match(
      body,
      /Person\s*≠\s*Speaker|Person is the durable|durable.*identity|canonical identity/i,
      "must explain Person as durable identity",
    );
    assert.match(
      body,
      /event_participations|participation/i,
      "must distinguish participation / speaker-at-event from Person",
    );
    assert.match(body, /people/, "must reference people table / model");
  });

  it("assert scopes default-deny listed", () => {
    const body = readFileSync(domainMapPath, "utf8");
    assert.match(
      body,
      /default.?deny|default-deny/i,
      "domain map must list default-deny scopes policy",
    );
    assert.match(
      body,
      /comms:send/,
      "default-deny must include comms:send",
    );
    assert.match(
      body,
      /decisions:write/,
      "default-deny must include decisions:write",
    );
    assert.match(
      body,
      /keys:admin/,
      "default-deny must include keys:admin",
    );
    // Grouped as the three high-risk defaults
    assert.match(
      body,
      /send.*decision|decision.*send|comms:send[\s\S]{0,400}decisions:write|decisions:write[\s\S]{0,400}comms:send/i,
      "send and decisions must appear in default-deny discussion",
    );
  });

  it("includes command list summary and schema ownership", () => {
    const body = readFileSync(domainMapPath, "utf8");
    assert.match(body, /Command list summary|command list/i);
    assert.match(body, /Decision\.Record/);
    assert.match(body, /Comms\.Send/);
    assert.match(body, /Keys\.Create/);
    assert.match(body, /Schema ownership|first writer/i);
    assert.match(body, /audit_events/);
  });

  it("points at S-CLI and composition roots", () => {
    const body = readFileSync(domainMapPath, "utf8");
    assert.match(body, /S-CLI/);
    assert.match(body, /apps\/api\/src\/index\.ts/);
    assert.match(body, /packages\/cli\/src\/main\.ts/);
    assert.match(body, /packages\/shared\/src/);
  });

  it("linked from docs/CONTRACTS.md and README", () => {
    assert.equal(existsSync(contractsIndexPath), true);
    const contracts = readFileSync(contractsIndexPath, "utf8");
    assert.match(
      contracts,
      /0\.4-domain-map\.md/,
      "docs/CONTRACTS.md must link 0.4-domain-map.md",
    );
    assert.match(contracts, /SCHEMA\.md/);
    assert.match(contracts, /COMMANDS\.md/);
    assert.match(contracts, /SCOPES\.md/);

    const readme = readFileSync(join(root, "README.md"), "utf8");
    assert.match(
      readme,
      /0\.4-domain-map\.md/,
      "README.md must link 0.4-domain-map.md",
    );
  });

  it("includes human review checklist and AC proof map", () => {
    const body = readFileSync(domainMapPath, "utf8");
    assert.match(body, /Human review checklist/i);
    assert.match(body, /- \[ \]/, "must include unchecked review checkbox items");
    assert.match(body, /AC → proof|Acceptance criterion/i);
  });

  it("no secrets or magic-link tokens in domain map", () => {
    const body = readFileSync(domainMapPath, "utf8");
    // Fail if anything looks like a committed secret/token value
    assert.doesNotMatch(
      body,
      /sk_live_|sk_test_|api[_-]?key\s*[:=]\s*['\"][^'\"]{8,}/i,
      "must not contain API key secret values",
    );
    assert.doesNotMatch(
      body,
      /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,
      "must not contain Bearer tokens",
    );
    assert.doesNotMatch(
      body,
      /magic[_-]?link[^\n]{0,40}[:=]\s*['\"][A-Za-z0-9]{16,}/i,
      "must not contain magic-link token values",
    );
  });

  it("canonical contracts still declare default-deny high-risk scopes", () => {
    const scopes = readFileSync(scopesPath, "utf8");
    assert.match(scopes, /decisions:write/);
    assert.match(scopes, /comms:send|send default deny/i);
    assert.match(scopes, /keys:admin/);
    assert.match(scopes, /default deny/i);

    const commands = readFileSync(commandsPath, "utf8");
    assert.match(commands, /Decision\.Record/);
    assert.match(commands, /Comms\.Send/);
    assert.match(commands, /Keys\.Create/);

    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /people/);
    assert.match(schema, /event_participations/);
  });
});
