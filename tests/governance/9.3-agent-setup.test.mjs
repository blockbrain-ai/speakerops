/**
 * Section 9.3 — Agent setup and CLI runbook (node:test / test:ci).
 *
 * Named assertions from spec:
 * - assert AGENT_SETUP contains speakerops reports readiness
 * - assert scope deny example
 * - assert CLI_INVENTORY referenced
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentSetupPath = join(root, "docs/AGENT_SETUP.md");
const cliPath = join(root, "docs/CLI.md");
const sectionPath = join(root, "docs/sections/9.3-agent-setup.md");
const inventoryPath = join(
  root,
  "KMS-competition/initiative/contracts/CLI_INVENTORY.md",
);

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
  /spk_[A-Za-z0-9]{16,}/,
  /magic[_-]?link[^\n]{0,40}[:=]\s*['"][A-Za-z0-9]{16,}/i,
];

describe("9.3 Agent setup and CLI runbook", () => {
  it("assert AGENT_SETUP contains speakerops reports readiness", () => {
    assert.ok(existsSync(agentSetupPath), "docs/AGENT_SETUP.md must exist");
    const body = readFileSync(agentSetupPath, "utf8");
    assert.match(
      body,
      /speakerops\s+reports\s+readiness/,
      "AGENT_SETUP must document speakerops reports readiness",
    );
    assert.match(body, /S-ONB-AGENT/, "soul S-ONB-AGENT required");
    assert.match(
      body,
      /Copy-paste agent prompt block|agent prompt block/i,
      "copy-paste agent prompt block required",
    );
    assert.match(body, /design publish/i);
    assert.match(body, /openapi\.json|\/openapi\.json/);
    assert.match(body, /keys create|Key mint/i);
    assert.match(body, /exit\s*2|Exit codes/i);
    // In-scope topics present
    assert.match(body, /scope|scopes/i);
    assert.match(body, /SPEAKEROPS_API_KEY/);
  });

  it("assert scope deny example", () => {
    const agent = readFileSync(agentSetupPath, "utf8");
    const cli = readFileSync(cliPath, "utf8");
    assert.match(agent, /scope deny|Deny-scope|deny example/i);
    assert.match(agent, /FORBIDDEN/);
    assert.match(agent, /schedule:write|schedule place/i);
    assert.match(agent, /exit\s*2|exit \*\*2\*\*/i);
    assert.match(cli, /CLI07|scope deny/i);
    assert.match(cli, /FORBIDDEN/);
    assert.match(cli, /exit 2|exit \*\*2\*\*/i);
  });

  it("assert CLI_INVENTORY referenced", () => {
    assert.ok(existsSync(cliPath), "docs/CLI.md must exist");
    const agent = readFileSync(agentSetupPath, "utf8");
    const cli = readFileSync(cliPath, "utf8");
    assert.match(agent, /CLI_INVENTORY/);
    assert.match(cli, /CLI_INVENTORY/);
    assert.ok(existsSync(inventoryPath), "CLI_INVENTORY.md must exist");
  });

  it("no secret values in agent docs", () => {
    for (const [label, path] of [
      ["AGENT_SETUP", agentSetupPath],
      ["CLI", cliPath],
      ["section", sectionPath],
    ]) {
      assert.ok(existsSync(path), `${label} must exist`);
      const body = readFileSync(path, "utf8");
      assert.doesNotMatch(body, /\bsk-[A-Za-z0-9]{10,}/);
      assert.doesNotMatch(
        body,
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
      );
      for (const re of SECRET_PATTERNS) {
        assert.doesNotMatch(
          body,
          re,
          `${label} must not contain secret pattern ${re}`,
        );
      }
    }
    const agent = readFileSync(agentSetupPath, "utf8");
    assert.match(
      agent,
      /names only|variable names only|Env \*\*names\*\*|env \*\*names\*\*/i,
    );
  });

  it("section 9.3 note wires AC → proof and N/A product surface", () => {
    assert.ok(existsSync(sectionPath), "section note must exist");
    const section = readFileSync(sectionPath, "utf8");
    assert.match(section, /N\/A/i);
    assert.match(
      section,
      /no new product HTTP handlers|No new product HTTP handlers/i,
    );
    assert.match(
      section,
      /assert AGENT_SETUP contains speakerops reports readiness/,
    );
    assert.match(section, /assert scope deny example/);
    assert.match(section, /assert CLI_INVENTORY referenced/);
    assert.match(section, /S-ONB-AGENT/);
    assert.match(section, /9\.3/);
  });

  it("CLI.md covers key mint, scopes, readiness, design, deny, OpenAPI, exit codes", () => {
    const cli = readFileSync(cliPath, "utf8");
    assert.match(cli, /SPEAKEROPS_API_KEY/);
    assert.match(cli, /Exit codes|exit codes/i);
    assert.match(cli, /reports readiness/);
    assert.match(cli, /design publish/);
    assert.match(cli, /keys create/);
    assert.match(cli, /openapi/i);
    assert.match(cli, /comms:send/);
    assert.match(cli, /keys:admin/);
    assert.match(cli, /CLI01|CLI12|CLI07/);
  });
});
