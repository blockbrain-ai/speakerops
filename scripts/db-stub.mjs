/**
 * Placeholder until section 1.3 (D1 + Drizzle baseline).
 * Keeps root scripts `db:generate` / `db:migrate` non-interactive and green.
 */
const action = process.argv[2] ?? "unknown";
console.log(
  `[db:${action}] stub — real Drizzle generate/migrate lands in section 1.3`,
);
process.exit(0);
