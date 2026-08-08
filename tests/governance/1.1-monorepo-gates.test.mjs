/**
 * Section 1.1 — Monorepo and CI gates named assertions.
 * Spec tests:
 * - assert pnpm-workspace packages include web,api,shared,db,cli
 * - assert package.json scripts typecheck and test:ci lack --watch
 * - assert vitest config watch false
 * - assert AGENTS.md references speakerops standards path
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const workspacePath = join(root, "pnpm-workspace.yaml");
const packageJsonPath = join(root, "package.json");
const vitestConfigPath = join(root, "vitest.config.ts");
const agentsPath = join(root, "AGENTS.md");
const sectionDocPath = join(root, "docs", "sections", "1.1-monorepo-gates.md");

const REQUIRED_PACKAGES = [
  "apps/web",
  "apps/api",
  "packages/shared",
  "packages/db",
  "packages/cli",
];

const REQUIRED_PACKAGE_JSONS = [
  "apps/web/package.json",
  "apps/api/package.json",
  "packages/shared/package.json",
  "packages/db/package.json",
  "packages/cli/package.json",
];

const COMPOSITION_ROOTS = [
  "apps/api/src/index.ts",
  "apps/web/src/main.tsx",
  "packages/cli/src/main.ts",
  "packages/db/src/index.ts",
  "packages/shared/src/index.ts",
];

describe("1.1 monorepo and CI gates", () => {
  it("assert pnpm-workspace packages include web,api,shared,db,cli", () => {
    assert.equal(existsSync(workspacePath), true, "pnpm-workspace.yaml must exist");
    const workspace = readFileSync(workspacePath, "utf8");
    assert.match(workspace, /apps\/\*/, "workspace must include apps/*");
    assert.match(workspace, /packages\/\*/, "workspace must include packages/*");

    for (const rel of REQUIRED_PACKAGE_JSONS) {
      const p = join(root, rel);
      assert.equal(existsSync(p), true, `${rel} must exist`);
    }

    // Package names cover web, api, shared, db, cli
    const names = REQUIRED_PACKAGE_JSONS.map((rel) => {
      const pkg = JSON.parse(readFileSync(join(root, rel), "utf8"));
      return String(pkg.name ?? "");
    });
    for (const token of ["web", "api", "shared", "db", "cli"]) {
      assert.ok(
        names.some((n) => n.includes(token)),
        `workspace package names must include ${token}; got ${names.join(", ")}`,
      );
    }

    for (const rel of REQUIRED_PACKAGES) {
      assert.equal(
        existsSync(join(root, rel)),
        true,
        `directory ${rel} must exist`,
      );
    }
  });

  it("assert package.json scripts typecheck and test:ci lack --watch", () => {
    assert.equal(existsSync(packageJsonPath), true);
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts?.typecheck, "string", "typecheck script required");
    assert.equal(typeof pkg.scripts?.["test:ci"], "string", "test:ci script required");

    const typecheck = pkg.scripts.typecheck;
    const testCi = pkg.scripts["test:ci"];
    assert.equal(
      /--watch\b/.test(typecheck),
      false,
      `typecheck must not use --watch: ${typecheck}`,
    );
    assert.equal(
      /--watch\b/.test(testCi),
      false,
      `test:ci must not use --watch: ${testCi}`,
    );
    // Concurrent watch modes also forbidden
    assert.equal(
      /\bwatch\b/.test(typecheck),
      false,
      `typecheck must not enable watch mode: ${typecheck}`,
    );

    // Required gate + stub scripts from in-scope list
    for (const name of [
      "typecheck",
      "test:ci",
      "test:e2e",
      "test:e2e:inventory",
      "db:generate",
      "db:migrate",
      "docs:reports",
    ]) {
      assert.equal(
        typeof pkg.scripts[name],
        "string",
        `root package.json must define scripts.${name}`,
      );
      assert.equal(
        /--watch\b/.test(pkg.scripts[name]),
        false,
        `scripts.${name} must lack --watch`,
      );
    }
  });

  it("assert vitest config watch false", () => {
    assert.equal(existsSync(vitestConfigPath), true, "vitest.config.ts must exist");
    const body = readFileSync(vitestConfigPath, "utf8");
    assert.match(
      body,
      /watch\s*:\s*false/,
      "vitest.config.ts must set watch: false for non-interactive gates",
    );
    assert.equal(
      /watch\s*:\s*true/.test(body),
      false,
      "vitest.config.ts must not set watch: true",
    );
  });

  it("assert AGENTS.md references speakerops standards path", () => {
    assert.equal(existsSync(agentsPath), true, "AGENTS.md must exist");
    const body = readFileSync(agentsPath, "utf8");
    assert.match(
      body,
      /speakerops-engineering-standards\.md/,
      "AGENTS.md must reference speakerops-engineering-standards.md (E1–E12)",
    );
    assert.match(body, /E1|E5|E12/, "AGENTS.md should surface engineering standard ids");
  });

  it("composition roots and section doc exist", () => {
    for (const rel of COMPOSITION_ROOTS) {
      assert.equal(existsSync(join(root, rel)), true, `${rel} must exist`);
    }
    assert.equal(
      existsSync(sectionDocPath),
      true,
      "docs/sections/1.1-monorepo-gates.md must exist",
    );
    const section = readFileSync(sectionDocPath, "utf8");
    assert.match(section, /1\.1/);
    assert.match(section, /pnpm-workspace|monorepo/i);
  });

  it("shared package exports E4 error envelope (Zod)", () => {
    const errorsPath = join(root, "packages", "shared", "src", "errors.ts");
    assert.equal(existsSync(errorsPath), true);
    const body = readFileSync(errorsPath, "utf8");
    assert.match(body, /ErrorEnvelopeSchema|errorEnvelope/);
    assert.match(body, /from ["']zod["']/);
    assert.match(body, /code/);
  });

  it("gitignore includes .pipeline/ and .dev.vars", () => {
    const gi = readFileSync(join(root, ".gitignore"), "utf8");
    assert.match(gi, /^\.pipeline\/?$/m);
    assert.match(gi, /^\.dev\.vars$/m);
  });

  it("typescript project references list workspace packages", () => {
    const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
    const refs = (tsconfig.references ?? []).map((r) => r.path);
    for (const needed of [
      "packages/shared",
      "packages/db",
      "packages/cli",
      "apps/api",
      "apps/web",
    ]) {
      assert.ok(
        refs.some((p) => String(p).includes(needed)),
        `tsconfig references must include ${needed}; got ${refs.join(", ")}`,
      );
    }
  });
});
