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

/** Normalized Playwright suite entry (list or run report). */
export type PlaywrightSuiteEntry = {
  file: string;
  title: string;
  status?: string;
  outcome?: string;
  ok?: boolean;
};

export type PlaywrightSuite = {
  files: string[];
  entries: PlaywrightSuiteEntry[];
  source: string;
  hasExecutionOutcomes: boolean;
};

export function entryHasExecutionOutcome(
  entry: PlaywrightSuiteEntry | null | undefined,
): boolean;

export function suiteHasExecutionOutcomes(
  suite: { entries?: PlaywrightSuiteEntry[] } | null | undefined,
): boolean;

export function isPassedNonSkippedResult(
  entry: PlaywrightSuiteEntry | null | undefined,
): boolean;

export function isSkippedExecutionResult(
  entry: PlaywrightSuiteEntry | null | undefined,
): boolean;

export function normalizePlaywrightSuite(
  input: unknown,
  root?: string,
): PlaywrightSuite | null;

export function loadPlaywrightSuiteReport(
  reportPath: string,
  root?: string,
): PlaywrightSuite | null;

export function parsePlaywrightListText(
  text: string,
  root?: string,
): PlaywrightSuite | null;
