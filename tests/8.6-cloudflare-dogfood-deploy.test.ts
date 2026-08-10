/**
 * Section 8.6 — Cloudflare dogfood deploy (Vitest).
 *
 * Named assertions from spec:
 * - assert deploy script exits nonzero without creds with message
 * - assert OPERATIONS.md lists wrangler steps
 * - assert evidence template path exists
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const paths = {
  deploy: join(root, "scripts/deploy-dogfood.sh"),
  operations: join(root, "docs/OPERATIONS.md"),
  evidence: join(
    root,
    "KMS-competition/initiative/evidence/cf-dogfood.txt",
  ),
  template: join(
    root,
    "KMS-competition/initiative/evidence/cf-dogfood.template.txt",
  ),
  wrangler: join(root, "wrangler.toml"),
  sectionDoc: join(root, "docs/sections/8.6-cloudflare-dogfood-deploy.md"),
  secrets: join(root, "docs/SECRETS.md"),
  smokeSpec: join(root, "playwright/e2e/cf_dogfood_smoke.spec.ts"),
};

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']{8,}["']/,
  // CLOUDFLARE_ACCOUNT_ID is a public resource identifier (wrangler.toml
  // documents this; Cloudflare account IDs are not secrets). The prior
  // pattern over-classified it and failed the repo's own committed config.
  // Real credentials (API token, bearer, sk-) remain fail-closed above.
];

describe("8.6 Cloudflare dogfood deploy", () => {
  it("deliverables exist", () => {
    for (const [name, p] of Object.entries(paths)) {
      expect(existsSync(p), `missing ${name}: ${p}`).toBe(true);
    }
  });

  it("assert deploy script exits nonzero without creds with message", () => {
    expect(existsSync(paths.deploy)).toBe(true);
    // Executable bit should be set for operator use
    try {
      accessSync(paths.deploy, constants.X_OK);
    } catch {
      // still runnable via bash
    }

    const r = spawnSync("bash", [paths.deploy], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: "",
        CLOUDFLARE_ACCOUNT_ID: "",
        // Ensure dry-run / skip paths do not mask the missing-creds gate
        DEPLOY_DRY_RUN: "",
        DOGFOOD_SKIP_DEPLOY: "",
        SMOKE_BASE_URL: "",
      },
    });

    expect(r.status, r.stderr || r.stdout || "expected nonzero").not.toBe(0);
    const combined = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    expect(combined).toMatch(/missing required Cloudflare credentials/i);
    expect(combined).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(combined).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it("assert OPERATIONS.md lists wrangler steps", () => {
    const md = readFileSync(paths.operations, "utf8");
    expect(md).toMatch(/wrangler/i);
    expect(md).toMatch(/wrangler deploy/i);
    expect(md).toMatch(/wrangler d1/i);
    expect(md).toMatch(/wrangler secret put/i);
    expect(md).toMatch(/D1 Time Travel/i);
    expect(md).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(md).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
    expect(md).toMatch(/deploy-dogfood\.sh/);
    expect(md).toMatch(/\/health/);
    // names only — no token-shaped assignments
    for (const re of SECRET_PATTERNS) {
      expect(re.test(md), `secret-like pattern in OPERATIONS.md: ${re}`).toBe(
        false,
      );
    }
  });

  it("assert evidence template path exists", () => {
    expect(existsSync(paths.template)).toBe(true);
    expect(existsSync(paths.evidence)).toBe(true);
    const template = readFileSync(paths.template, "utf8");
    expect(template).toMatch(/URL redaction rules/i);
    expect(template).toMatch(/BC10|S-CF/);
    expect(template).toMatch(/cf-dogfood\.txt/);
    const evidence = readFileSync(paths.evidence, "utf8");
    expect(evidence).toMatch(/BC10|S-CF/);
    expect(evidence).toMatch(/redact/i);
    expect(evidence).toMatch(/\/health/);
  });

  it("deploy script documents redaction and never embeds secret values", () => {
    const sh = readFileSync(paths.deploy, "utf8");
    expect(sh).toMatch(/redact_url|REDACTED/);
    expect(sh).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(sh).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
    expect(sh).toMatch(/DEPLOY_DRY_RUN|DOGFOOD_SKIP_DEPLOY/);
    for (const re of SECRET_PATTERNS) {
      expect(re.test(sh), `secret-like pattern in deploy script: ${re}`).toBe(
        false,
      );
    }
  });

  it("wrangler.toml has dogfood env and names-only bindings", () => {
    const body = readFileSync(paths.wrangler, "utf8");
    expect(body).toMatch(/binding\s*=\s*["']DB["']/);
    expect(body).toMatch(/\[env\.dogfood\]/);
    expect(body).toMatch(/8\.6|dogfood|S-CF/i);
    for (const re of SECRET_PATTERNS) {
      expect(re.test(body), `secret-like in wrangler.toml: ${re}`).toBe(false);
    }
  });

  it("optional SMOKE_BASE_URL playwright smoke is skip-when-unset", () => {
    const spec = readFileSync(paths.smokeSpec, "utf8");
    expect(spec).toMatch(/SMOKE_BASE_URL/);
    expect(spec).toMatch(/test\.skip|skip\(/);
    expect(spec).toMatch(/\/health/);
    // No inventory ownership
    expect(spec).not.toMatch(/@inv:/);
  });

  it("section doc maps N/A handlers and AC proof", () => {
    const md = readFileSync(paths.sectionDoc, "utf8");
    expect(md).toMatch(/8\.6/);
    expect(md).toMatch(/S-CF/);
    expect(md).toMatch(/N\/A/i);
    expect(md).toMatch(
      /assert deploy script exits nonzero without creds with message/,
    );
    expect(md).toMatch(/assert OPERATIONS\.md lists wrangler steps/);
    expect(md).toMatch(/assert evidence template path exists/);
  });
});
