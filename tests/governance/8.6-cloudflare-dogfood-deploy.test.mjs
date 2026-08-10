/**
 * Section 8.6 — Cloudflare dogfood deploy governance (node:test).
 *
 * Named assertions from spec:
 * - assert deploy script exits nonzero without creds with message
 * - assert OPERATIONS.md lists wrangler steps
 * - assert evidence template path exists
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  vitest: join(root, "tests/8.6-cloudflare-dogfood-deploy.test.ts"),
  packageJson: join(root, "package.json"),
  checklist: join(root, "KMS-competition/initiative/BUILD_CHECKLIST.md"),
  secrets: join(root, "docs/SECRETS.md"),
  smokeSpec: join(root, "playwright/e2e/cf_dogfood_smoke.spec.ts"),
  contracts: join(root, "docs/CONTRACTS.md"),
};

describe("8.6 Cloudflare dogfood deploy", () => {
  it("deliverables exist", () => {
    for (const [name, p] of Object.entries(paths)) {
      assert.equal(existsSync(p), true, `missing ${name}: ${p}`);
    }
  });

  it("assert deploy script exits nonzero without creds with message", () => {
    const r = spawnSync("bash", [paths.deploy], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: "",
        CLOUDFLARE_ACCOUNT_ID: "",
        DEPLOY_DRY_RUN: "",
        DOGFOOD_SKIP_DEPLOY: "",
        SMOKE_BASE_URL: "",
      },
    });
    assert.notEqual(r.status, 0, r.stderr || r.stdout || "expected nonzero");
    const combined = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    assert.match(combined, /missing required Cloudflare credentials/i);
    assert.match(combined, /CLOUDFLARE_API_TOKEN/);
    assert.match(combined, /CLOUDFLARE_ACCOUNT_ID/);
  });

  it("assert OPERATIONS.md lists wrangler steps", () => {
    const md = readFileSync(paths.operations, "utf8");
    assert.match(md, /wrangler/i);
    assert.match(md, /wrangler deploy/i);
    assert.match(md, /wrangler d1/i);
    assert.match(md, /wrangler secret put/i);
    assert.match(md, /D1 Time Travel/i);
    assert.match(md, /CLOUDFLARE_API_TOKEN/);
    assert.match(md, /deploy-dogfood\.sh/);
    assert.match(md, /\/health/);
    for (const re of SECRET_PATTERNS) {
      assert.equal(
        re.test(md),
        false,
        `secret-like pattern in OPERATIONS.md: ${re}`,
      );
    }
  });

  it("assert evidence template path exists", () => {
    assert.equal(existsSync(paths.template), true);
    assert.equal(existsSync(paths.evidence), true);
    const template = readFileSync(paths.template, "utf8");
    assert.match(template, /URL redaction rules/i);
    assert.match(template, /BC10|S-CF/);
    const evidence = readFileSync(paths.evidence, "utf8");
    assert.match(evidence, /BC10|S-CF/);
    assert.match(evidence, /redact/i);
    assert.match(evidence, /cf-dogfood\.template\.txt|template/i);
  });

  it("pnpm deploy:dogfood script wired", () => {
    const pkg = JSON.parse(readFileSync(paths.packageJson, "utf8"));
    assert.equal(typeof pkg.scripts?.["deploy:dogfood"], "string");
    assert.match(pkg.scripts["deploy:dogfood"], /deploy-dogfood\.sh/);
  });

  it("BUILD_CHECKLIST BC10 points at cf-dogfood evidence", () => {
    const md = readFileSync(paths.checklist, "utf8");
    const row = md.split("\n").find((l) => l.includes("| BC10 |"));
    assert.ok(row, "BC10 row");
    assert.match(row, /S-CF/);
    assert.match(row, /cf-dogfood\.txt|evidence\/cf-dogfood/);
  });

  it("named vitest assertions present", () => {
    const t = readFileSync(paths.vitest, "utf8");
    assert.match(
      t,
      /assert deploy script exits nonzero without creds with message/,
    );
    assert.match(t, /assert OPERATIONS\.md lists wrangler steps/);
    assert.match(t, /assert evidence template path exists/);
  });

  it("wrangler dogfood env + no secrets committed", () => {
    const body = readFileSync(paths.wrangler, "utf8");
    assert.match(body, /binding\s*=\s*["']DB["']/);
    assert.match(body, /\[env\.dogfood\]/);
    for (const re of SECRET_PATTERNS) {
      assert.equal(
        re.test(body),
        false,
        `secret-like in wrangler.toml: ${re}`,
      );
    }
    const files = [
      paths.deploy,
      paths.operations,
      paths.evidence,
      paths.template,
      paths.sectionDoc,
      paths.vitest,
      paths.smokeSpec,
    ];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of SECRET_PATTERNS) {
        assert.equal(
          re.test(text),
          false,
          `secret-like pattern in ${f}: ${re}`,
        );
      }
    }
  });

  it("SECRETS.md documents dogfood deploy names", () => {
    const md = readFileSync(paths.secrets, "utf8");
    assert.match(md, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_/);
    assert.match(md, /8\.6|dogfood|deploy/i);
  });

  it("optional SMOKE_BASE_URL playwright has no @inv", () => {
    const spec = readFileSync(paths.smokeSpec, "utf8");
    assert.match(spec, /SMOKE_BASE_URL/);
    assert.equal(/@inv:/.test(spec), false);
  });

  it("section doc declares N/A for new handlers/writes", () => {
    const md = readFileSync(paths.sectionDoc, "utf8");
    assert.match(md, /N\/A/i);
    assert.match(md, /S-CF/);
    assert.match(md, /OPERATIONS\.md/);
  });
});
