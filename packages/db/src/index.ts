/**
 * @speakerops/db — D1 + Drizzle composition root (placeholder until 1.3).
 *
 * Real schema lives in SCHEMA.md and lands with section 1.3
 * (`packages/db/schema.ts` + `migrations/`). No invented tables here.
 */

/** Placeholder marker so dependents can import the package before schema exists. */
export const DB_PACKAGE = "@speakerops/db" as const;

export type DbPlaceholder = {
  readonly packageName: typeof DB_PACKAGE;
  readonly schemaReady: false;
};

export function createDbPlaceholder(): DbPlaceholder {
  return {
    packageName: DB_PACKAGE,
    schemaReady: false,
  };
}
