/**
 * CLI composition root — `speakerops` bin (section 1.1 scaffold).
 * Domain commands from COMMANDS.md land in later CLI sections (Phase 7).
 * Same domain commands as HTTP; scopes enforced on Worker, not CLI alone (E8).
 */
import { errorEnvelope, VALIDATION_ERROR } from "@speakerops/shared";

export function cliVersion(): string {
  return "0.1.0";
}

export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "speakerops — scoped CLI over domain commands (scaffold; see CLI_INVENTORY.md)\n",
    );
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${cliVersion()}\n`);
    return 0;
  }
  if (argv.includes("--json") && argv[0] === "unknown-command") {
    const body = errorEnvelope("Unknown command", VALIDATION_ERROR, {
      argv,
    });
    process.stdout.write(`${JSON.stringify(body)}\n`);
    return 1;
  }
  process.stdout.write(
    "speakerops: no domain commands registered yet (scaffold 1.1). Use --help.\n",
  );
  return 0;
}

// Run when executed as bin entry (not when imported by tests).
const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("main.js") || process.argv[1].endsWith("main.ts"));

if (isDirect) {
  process.exitCode = main();
}
