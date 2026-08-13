/** Safe env read — browsers and Workers without nodejs_compat have no `process`. */
export function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const value = proc?.env?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
