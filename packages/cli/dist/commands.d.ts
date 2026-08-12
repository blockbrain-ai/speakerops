import { parseArgs, type ParsedArgs } from "./args.js";
import { type CliExitCode } from "./exit-codes.js";
import { ApiClient } from "./http.js";
import { type Io } from "./output.js";
export type CommandContext = {
    argv: string[];
    args: ParsedArgs;
    json: boolean;
    io: Io;
    client: ApiClient | null;
    /** Optional file reader override for tests. */
    readFileImpl?: (path: string) => Promise<Uint8Array>;
};
export declare function buildClientFromArgs(args: ParsedArgs): {
    client: ApiClient | null;
    error?: string;
};
/** Allow tests to inject a prebuilt client. */
export type ClientFactory = (args: ParsedArgs) => ApiClient | null;
export declare function setClientFactoryForTests(factory: ClientFactory | null): void;
export declare function resolveClient(args: ParsedArgs): ApiClient | null;
export declare function cmdEventsList(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdReportsReadiness(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdDesignGet(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdDesignSet(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdDesignPublish(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdSchedulePlace(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdFilesUpload(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdSpeakersUpdateProfile(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdCommsDraft(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdCommsSend(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdKeysCreate(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdOpenApi(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdFormsList(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdFormsGet(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdFormsCreate(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdFormsDraft(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdFormsPublish(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdSubmissionsList(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdSubmissionsGet(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdSubmissionsAssign(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdSubmissionsDecision(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdSubmissionsBulkDecision(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdEvalRollup(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdEvalExport(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdScheduleList(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdScheduleUnschedule(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdCommsTemplates(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdMembersList(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdMembersInvite(ctx: CommandContext): Promise<CliExitCode>;
export declare function cmdMembersSetRole(ctx: CommandContext): Promise<CliExitCode>;
/** Re-export parseArgs for main. */
export { parseArgs };
//# sourceMappingURL=commands.d.ts.map