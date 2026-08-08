/**
 * Ambient types for the section 0.3 inventory lint engine (JS module).
 * Used by scripts/inventory-lint.ts (section 1.5).
 */

export class InventoryLintError extends Error {
  constructor(message: string);
}

export type InventoryLintResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type InvTaggedFinding = {
  id: string;
  skipped: boolean;
  focused: boolean;
  multiTag: boolean;
  title: string;
  file: string;
};

export function extractInvTaggedTests(
  filePath: string,
  source: string,
): InvTaggedFinding[];

export function runInventoryLint(options?: {
  root?: string;
  inventoryPath?: string;
  baselinePath?: string;
  constitutionPath?: string;
  e2eRoots?: string[];
  fullGate?: boolean;
  silent?: boolean;
  allowPlaywrightCli?: boolean;
  playwrightSuite?: unknown;
  suiteReportPath?: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  spawnSyncImpl?: typeof import("node:child_process").spawnSync;
}): InventoryLintResult;

export function normalizeCell(s: string | undefined | null): string;
export function collectFiles(dir: string, acc?: string[]): string[];
export function findPlaywrightConfig(root: string): string | null;
