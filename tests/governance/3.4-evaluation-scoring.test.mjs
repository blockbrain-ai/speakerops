/**
 * Section 3.4 — governance / file assertions for evaluation scoring.
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
  "0009_eval.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const evalRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "eval",
  "routes.ts",
);
const evalTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "eval",
  "eval.test.ts",
);
const evalCommands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "eval",
  "commands.ts",
);
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const sectionDoc = join(root, "docs", "sections", "3.4-evaluation.md");
const sharedEval = join(root, "packages", "shared", "src", "eval.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const queuePage = join(root, "apps", "web", "src", "pages", "EvaluatorQueue.tsx");
const rubricPage = join(root, "apps", "web", "src", "pages", "RubricSettings.tsx");
const e2ePath = join(root, "playwright", "e2e", "eval_scoring.spec.ts");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);

describe("3.4 evaluation scoring governance", () => {
  it("0009_eval.sql creates eval_rounds, eval_criteria, eval_assignments, scores", () => {
    assert.equal(existsSync(migrationPath), true, "0009_eval.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS eval_rounds\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS eval_criteria\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS eval_assignments\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS scores\b/i);
    assert.match(sql, /max_score/i);
    assert.match(sql, /evaluator_user_id/i);
  });

  it("schema exports eval tables", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /export const evalRounds/);
    assert.match(src, /export const evalCriteria/);
    assert.match(src, /export const evalAssignments/);
    assert.match(src, /export const scores/);
  });

  it("shared eval DTOs, routes, OpenAPI, and composition wiring exist", () => {
    assert.equal(existsSync(sharedEval), true);
    const shared = readFileSync(sharedEval, "utf8");
    assert.match(shared, /EvalUpsertRubricBodySchema/);
    assert.match(shared, /EvalScoreBodySchema/);
    assert.match(shared, /computeWeightedAggregate/);

    assert.equal(existsSync(evalRoutes), true);
    const routes = readFileSync(evalRoutes, "utf8");
    assert.match(routes, /eval\/rubric/);
    assert.match(routes, /eval-queue/);
    assert.match(routes, /scores/);

    assert.equal(existsSync(evalCommands), true);
    const cmds = readFileSync(evalCommands, "utf8");
    assert.match(cmds, /Eval\.UpsertRubric|upsertRubric/);
    assert.match(cmds, /Eval\.Score|scoreAssignment/);
    assert.match(cmds, /insertAudit/);

    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /Eval\.UpsertRubric/);
    assert.match(openapi, /Eval\.Score/);
    assert.match(openapi, /Eval\.GetQueue/);

    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /createEventEvalRoutes|createMeEvalRoutes/);
    assert.match(index, /MemoryEvalStore|D1EvalStore/);
  });

  it("named unit assertions and UI pages exist", () => {
    assert.equal(existsSync(evalTest), true);
    const tests = readFileSync(evalTest, "utf8");
    assert.match(
      tests,
      /assert unassigned submission absent from evaluator queue/,
    );
    assert.match(tests, /assert score > max returns 400/);
    assert.match(tests, /status\)\.toBe\(400\)|toBe\(400\)/);

    assert.equal(existsSync(queuePage), true);
    const queue = readFileSync(queuePage, "utf8");
    assert.match(queue, /eval-score-save/);
    assert.match(queue, /no accept|No Decision|admin-only/i);

    assert.equal(existsSync(rubricPage), true);
    assert.match(readFileSync(rubricPage, "utf8"), /rubric-save/);
  });

  it("Playwright @inv tags F01–F04 O04 and inventory PASS", () => {
    assert.equal(existsSync(e2ePath), true);
    const e2e = readFileSync(e2ePath, "utf8");
    for (const id of ["F01", "F02", "F03", "F04", "O04"]) {
      assert.match(e2e, new RegExp(`@inv:${id}`), `missing @inv:${id}`);
    }
    assert.match(e2e, /assert unassigned submission absent from evaluator queue/);
    assert.match(e2e, /assert score > max returns 400/);
    assert.match(e2e, /assert evaluator UI has no accept button/);

    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of ["F01", "F02", "F03", "F04", "O04"]) {
      assert.match(
        inv,
        new RegExp(`\\|\\s*${id}\\s*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|\\s*REQUIRED\\s*\\|\\s*PASS\\s*\\|`),
        `${id} must be REQUIRED PASS in inventory`,
      );
    }
  });

  it("section doc exists", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /S-EVAL|3\.4/);
    assert.match(doc, /Eval\.UpsertRubric/);
  });
});
