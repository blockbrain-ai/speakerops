/**
 * Minimal argv helpers for speakerops CLI (no external parser dep).
 */

export type ParsedArgs = {
  /** Positional tokens after command path (resource/verb already consumed). */
  positionals: string[];
  /** Boolean flags (e.g. --json → true). */
  flags: Set<string>;
  /** Key=value options (--event E, --brand '#x'). */
  options: Map<string, string>;
};

/**
 * Parse argv after the resource/verb tokens have been sliced off.
 * Supports `--flag`, `--key value`, `--key=value`.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const options = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        const key = tok.slice(2, eq);
        const val = tok.slice(eq + 1);
        options.set(key, val);
        continue;
      }
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        options.set(key, next);
        i++;
      } else {
        flags.add(key);
      }
      continue;
    }
    if (tok.startsWith("-") && tok.length === 2) {
      // short flags: -h -V -j
      const short = tok.slice(1);
      if (short === "h") flags.add("help");
      else if (short === "V") flags.add("version");
      else if (short === "j") flags.add("json");
      else flags.add(short);
      continue;
    }
    positionals.push(tok);
  }

  return { positionals, flags, options };
}

export function hasJson(args: ParsedArgs, argv: string[]): boolean {
  return args.flags.has("json") || argv.includes("--json") || argv.includes("-j");
}

export function requireOption(
  args: ParsedArgs,
  name: string,
  aliases: string[] = [],
): string | undefined {
  if (args.options.has(name)) return args.options.get(name);
  for (const a of aliases) {
    if (args.options.has(a)) return args.options.get(a);
  }
  return undefined;
}

/** Split comma-separated scopes list. */
export function parseScopesList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
