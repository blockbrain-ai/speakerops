/**
 * Section 9.3 — Agent setup and CLI runbook (Vitest).
 *
 * Named assertions from spec:
 * - assert AGENT_SETUP contains speakerops reports readiness
 * - assert scope deny example
 * - assert CLI_INVENTORY referenced
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentSetupPath = join(root, "docs/AGENT_SETUP.md");
const cliPath = join(root, "docs/CLI.md");
const sectionPath = join(root, "docs/sections/9.3-agent-setup.md");

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
  it("deliverables exist", () => {
    expect(existsSync(agentSetupPath), "docs/AGENT_SETUP.md").toBe(true);
    expect(existsSync(cliPath), "docs/CLI.md").toBe(true);
    expect(existsSync(sectionPath), "docs/sections/9.3-agent-setup.md").toBe(
      true,
    );
    expect(
      existsSync(join(root, "tests/governance/9.3-agent-setup.test.mjs")),
    ).toBe(true);
  });

  it("assert AGENT_SETUP contains speakerops reports readiness", () => {
    const body = readFileSync(agentSetupPath, "utf8");
    expect(body).toMatch(/speakerops\s+reports\s+readiness/);
    expect(body).toMatch(/S-ONB-AGENT/);
    // Copy-paste agent prompt block present
    expect(body).toMatch(/Copy-paste agent prompt block|agent prompt block/i);
    expect(body).toMatch(/design publish/i);
    expect(body).toMatch(/openapi\.json|\/openapi\.json/);
    expect(body).toMatch(/keys create|Key mint/i);
    // Exit codes documented
    expect(body).toMatch(/exit\s*2|Exit codes/i);
  });

  it("assert scope deny example", () => {
    const agent = readFileSync(agentSetupPath, "utf8");
    const cli = readFileSync(cliPath, "utf8");
    // Deny narrative in agent setup
    expect(agent).toMatch(/scope deny|Deny-scope|deny example/i);
    expect(agent).toMatch(/FORBIDDEN/);
    expect(agent).toMatch(/schedule:write|schedule place/i);
    expect(agent).toMatch(/exit\s*2|exit \*\*2\*\*/i);
    // CLI inventory deny (CLI07)
    expect(cli).toMatch(/CLI07|scope deny/i);
    expect(cli).toMatch(/FORBIDDEN/);
    expect(cli).toMatch(/exit 2|exit \*\*2\*\*/i);
  });

  it("assert CLI_INVENTORY referenced", () => {
    const agent = readFileSync(agentSetupPath, "utf8");
    const cli = readFileSync(cliPath, "utf8");
    expect(agent).toMatch(/CLI_INVENTORY/);
    expect(cli).toMatch(/CLI_INVENTORY/);
    // Inventory file exists
    expect(
      existsSync(
        join(
          root,
          "KMS-competition/initiative/contracts/CLI_INVENTORY.md",
        ),
      ),
    ).toBe(true);
  });

  it("no secret values in AGENT_SETUP or CLI", () => {
    for (const [label, path] of [
      ["AGENT_SETUP", agentSetupPath],
      ["CLI", cliPath],
      ["section", sectionPath],
    ] as const) {
      const body = readFileSync(path, "utf8");
      expect(body).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/);
      expect(body).not.toMatch(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
      for (const re of SECRET_PATTERNS) {
        expect(body, `${label} secret pattern ${re}`).not.toMatch(re);
      }
    }
    const agent = readFileSync(agentSetupPath, "utf8");
    expect(agent).toMatch(/names only|variable names only|Env \*\*names\*\*|env \*\*names\*\*/i);
  });

  it("section 9.3 note declares N/A product surface and named tests", () => {
    const section = readFileSync(sectionPath, "utf8");
    expect(section).toMatch(/N\/A/i);
    expect(section).toMatch(
      /no new product HTTP handlers|No new product HTTP handlers/i,
    );
    expect(section).toMatch(
      /assert AGENT_SETUP contains speakerops reports readiness/,
    );
    expect(section).toMatch(/assert scope deny example/);
    expect(section).toMatch(/assert CLI_INVENTORY referenced/);
    expect(section).toMatch(/S-ONB-AGENT/);
    expect(section).toMatch(/9\.3/);
  });

  it("CLI.md covers in-scope runbook topics", () => {
    const cli = readFileSync(cliPath, "utf8");
    expect(cli).toMatch(/SPEAKEROPS_API_KEY/);
    expect(cli).toMatch(/Exit codes|exit codes/i);
    expect(cli).toMatch(/reports readiness/);
    expect(cli).toMatch(/design publish/);
    expect(cli).toMatch(/keys create/);
    expect(cli).toMatch(/openapi/i);
    // High-risk default-deny called out
    expect(cli).toMatch(/comms:send/);
    expect(cli).toMatch(/keys:admin/);
  });
});
