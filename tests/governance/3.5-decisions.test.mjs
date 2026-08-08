/**
 * Section 3.5 — governance / file assertions for accept-reject decisions.
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
  "0010_decisions.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const decisionsRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "decisions",
  "routes.ts",
);
const decisionsTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "decisions",
  "decisions.test.ts",
);
const decisionsCommands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "decisions",
  "commands.ts",
);
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const sectionDoc = join(root, "docs", "sections", "3.5-decisions.md");
const sharedDecisions = join(root, "packages", "shared", "src", "decisions.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const submissionsPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "Submissions.tsx",
);
const e2ePath = join(root, "playwright", "e2e", "submissions_decisions.spec.ts");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);

describe("3.5 decisions governance", () => {
  it("0010_decisions.sql creates decisions, sessions, tasks tables", () => {
    assert.equal(existsSync(migrationPath), true, "0010_decisions.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS decisions\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS sessions\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS session_speakers\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS event_participations\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS task_templates\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS speaker_tasks\b/i);
  });

  it("schema exports decision tables", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /export const decisions/);
    assert.match(src, /export const programSessions/);
    assert.match(src, /export const eventParticipations/);
    assert.match(src, /export const taskTemplates/);
    assert.match(src, /export const speakerTasks/);
  });

  it("shared DTOs, routes, OpenAPI, and composition wiring exist", () => {
    assert.equal(existsSync(sharedDecisions), true);
    const shared = readFileSync(sharedDecisions, "utf8");
    assert.match(shared, /DecisionRecordBodySchema/);
    assert.match(shared, /DirectSessionBodySchema/);
    assert.match(shared, /SubmissionListResponseSchema/);

    assert.equal(existsSync(decisionsRoutes), true);
    const routes = readFileSync(decisionsRoutes, "utf8");
    assert.match(routes, /decision/);
    assert.match(routes, /sessions\/direct/);
    assert.match(routes, /bulk-preview/);

    assert.equal(existsSync(decisionsCommands), true);
    const cmds = readFileSync(decisionsCommands, "utf8");
    assert.match(cmds, /recordDecision|Decision\.Record/);
    assert.match(cmds, /insertAudit/);
    assert.match(cmds, /idempotent/);

    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /Decision\.Record/);
    assert.match(openapi, /Session\.CreateDirect/);

    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /createSubmissionDecisionRoutes|createEventDecisionRoutes/);
    assert.match(index, /MemoryDecisionsStore|D1DecisionsStore/);
  });

  it("named test assertions present in decisions.test.ts", () => {
    assert.equal(existsSync(decisionsTest), true);
    const src = readFileSync(decisionsTest, "utf8");
    assert.match(
      src,
      /assert accept creates speaker_tasks count matching templates/,
    );
    assert.match(src, /assert second accept is idempotent/);
    assert.match(src, /assert evaluator decision 403/);
    assert.match(src, /expectedVersion conflict returns 409/);
  });

  it("Submissions SPA and Playwright inventory tags E01–E08", () => {
    assert.equal(existsSync(submissionsPage), true);
    const page = readFileSync(submissionsPage, "utf8");
    assert.match(page, /submission-accept/);
    assert.match(page, /submission-reject/);
    assert.match(page, /submission-waitlist/);
    assert.match(page, /submissions-direct/);
    assert.match(page, /bulk-preview|submissions-bulk/);

    assert.equal(existsSync(e2ePath), true);
    const e2e = readFileSync(e2ePath, "utf8");
    for (const id of ["E01", "E02", "E03", "E04", "E05", "E06", "E07", "E08"]) {
      assert.match(e2e, new RegExp(`@inv:${id}`));
    }

    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of ["E01", "E02", "E03", "E04", "E05", "E06", "E07", "E08"]) {
      assert.match(
        inv,
        new RegExp(`\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*PASS\\s*\\|`),
      );
    }
  });

  it("section doc 3.5-decisions.md exists", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /Decision\.Record/);
    assert.match(doc, /E01/);
    assert.match(doc, /speaker_tasks/);
  });
});
