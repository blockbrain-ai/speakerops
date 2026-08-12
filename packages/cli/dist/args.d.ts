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
export declare function parseArgs(argv: string[]): ParsedArgs;
export declare function hasJson(args: ParsedArgs, argv: string[]): boolean;
export declare function requireOption(args: ParsedArgs, name: string, aliases?: string[]): string | undefined;
/** Split comma-separated scopes list. */
export declare function parseScopesList(raw: string): string[];
//# sourceMappingURL=args.d.ts.map