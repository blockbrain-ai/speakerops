/**
 * sql.js-backed D1DatabaseLike shim for unit-testing D1 stores against the
 * real migration schema (no Cloudflare runtime required).
 *
 * Implements the surface drizzle-orm/d1 uses: prepare(sql).bind(...params)
 * with .run() / .all() / .raw(), plus batch/exec. Enforces the production D1
 * bound-parameter limit so unchunked IN (...) lists fail here exactly like
 * they fail on live D1 (see 10.1 `?q=` 500 regression).
 */
import type { Database } from "sql.js";

/** Cloudflare D1 bound-parameter limit per statement. */
export const D1_MAX_BOUND_PARAMS = 100;

type BindValue = string | number | null | Uint8Array;

export class SqlJsD1 {
  constructor(
    private readonly db: Database,
    private readonly maxParams: number = D1_MAX_BOUND_PARAMS,
  ) {}

  prepare(query: string) {
    const db = this.db;
    const maxParams = this.maxParams;
    const makeBound = (params: BindValue[]) => ({
      run: async () => {
        const stmt = db.prepare(query);
        try {
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            /* drain */
          }
        } finally {
          stmt.free();
        }
        return {
          success: true,
          meta: { changes: db.getRowsModified() },
        };
      },
      all: async () => {
        const stmt = db.prepare(query);
        const results: Array<Record<string, unknown>> = [];
        try {
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject() as Record<string, unknown>);
          }
        } finally {
          stmt.free();
        }
        return { results, success: true, meta: {} };
      },
      raw: async () => {
        const stmt = db.prepare(query);
        const rows: unknown[][] = [];
        try {
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            rows.push(stmt.get() as unknown[]);
          }
        } finally {
          stmt.free();
        }
        return rows;
      },
    });
    return {
      bind: (...params: BindValue[]) => {
        if (params.length > maxParams) {
          throw new Error(
            `D1_ERROR: too many SQL variables (${params.length} > ${maxParams})`,
          );
        }
        return makeBound(params);
      },
    };
  }

  async batch(statements: unknown[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const s of statements) {
      out.push(
        await (s as { all: () => Promise<unknown> }).all(),
      );
    }
    return out;
  }

  async exec(query: string): Promise<unknown> {
    this.db.run(query);
    return { success: true };
  }
}
