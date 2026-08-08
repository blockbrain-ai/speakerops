/**
 * Pre-scaffold / governance typecheck gate.
 * Full monorepo `tsc` lands in section 1.1; until then this gate stays green
 * without inventing product packages.
 */
console.log("[typecheck] ok (governance / pre-scaffold — no product TS packages yet)");
process.exit(0);
