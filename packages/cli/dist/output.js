export function defaultIo() {
    return {
        writeOut: (s) => {
            process.stdout.write(s);
        },
        writeErr: (s) => {
            process.stderr.write(s);
        },
    };
}
/** Print success or E4 error body. Always JSON when json=true. */
export function emitResult(io, result, json, humanOk) {
    if (json) {
        io.writeOut(`${JSON.stringify(result.body, null, 0)}\n`);
        return result.exitCode;
    }
    if (!result.ok) {
        const msg = result.body &&
            typeof result.body === "object" &&
            "error" in result.body &&
            typeof result.body.error === "string"
            ? result.body.error
            : `Request failed (${result.status})`;
        const code = result.body &&
            typeof result.body === "object" &&
            "code" in result.body &&
            typeof result.body.code === "string"
            ? result.body.code
            : undefined;
        io.writeErr(code ? `speakerops: ${msg} [${code}]\n` : `speakerops: ${msg}\n`);
        return result.exitCode;
    }
    if (humanOk) {
        io.writeOut(humanOk(result.body));
    }
    else {
        io.writeOut(`${JSON.stringify(result.body, null, 2)}\n`);
    }
    return result.exitCode;
}
export function emitJson(io, value, exit) {
    io.writeOut(`${JSON.stringify(value)}\n`);
    return exit;
}
export function emitError(io, message, code, exit, json) {
    if (json) {
        io.writeOut(JSON.stringify({ error: message, code }) + "\n");
    }
    else {
        io.writeErr(`speakerops: ${message} [${code}]\n`);
    }
    return exit;
}
//# sourceMappingURL=output.js.map