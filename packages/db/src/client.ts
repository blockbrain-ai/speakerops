/**
 * Drizzle client factories for D1 (Workers) and better-sqlite3 (local/tests).
 */
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { schema } from "../schema.js";

/** Minimal D1 surface used by drizzle-orm/d1 (avoids @cloudflare/workers-types dep). */
export type D1DatabaseLike = {
  prepare: (query: string) => unknown;
  batch: (statements: unknown[]) => Promise<unknown[]>;
  exec: (query: string) => Promise<unknown>;
};

/**
 * Create a Drizzle client bound to a Worker D1 binding (wrangler binding name: DB).
 */
export function createDb(d1: D1DatabaseLike) {
  return drizzleD1(d1 as Parameters<typeof drizzleD1>[0], { schema });
}

export type SpeakerOpsDb = ReturnType<typeof createDb>;

/** True once schema module is loaded (section 1.3+). */
export const SCHEMA_READY = true as const;
