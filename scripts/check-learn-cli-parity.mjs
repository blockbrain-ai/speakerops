#!/usr/bin/env node
/**
 * Fail if Learn HTML documents speakerops CLI verbs that do not exist.
 * Source of truth: packages/cli/src/main.ts dispatch (via hardcoded allowlist
 * kept in sync with HELP + dispatch).
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps/learn/dist");

/** resource → verbs (must match packages/cli dispatch) */
const ALLOWED = {
  events: ["list"],
  reports: ["readiness"],
  design: ["get", "set", "publish"],
  schedule: ["place", "list", "unschedule"],
  files: ["upload"],
  speakers: ["update-profile", "update", "profile"],
  comms: ["templates", "template-list", "draft", "preview", "send"],
  members: ["list", "invite", "create-invite", "set-role", "role"],
  keys: ["create"],
  forms: ["list", "get", "create", "draft", "publish"],
  submissions: [
    "list",
    "get",
    "assign",
    "decision",
    "bulk-decision",
    "bulk",
  ],
  eval: ["rollup", "export"],
  openapi: [""],
  help: [""],
  version: [""],
};

async function walk(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (e.name.endsWith(".html")) acc.push(p);
  }
  return acc;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");
}

async function main() {
  const files = await walk(DIST);
  // Only audit fenced CLI examples — not prose ("SpeakerOps Learn", …).
  const blockRe = /<pre class="learn-code"[^>]*>[\s\S]*?<code>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi;
  const cmdRe = /speakerops\s+([a-z0-9-]+)(?:\s+([a-z0-9-]+))?/gi;
  const bad = [];
  for (const f of files) {
    const text = decodeEntities(await readFile(f, "utf8"));
    let bm;
    while ((bm = blockRe.exec(text)) !== null) {
      const block = bm[1];
      let m;
      cmdRe.lastIndex = 0;
      while ((m = cmdRe.exec(block)) !== null) {
        const resource = m[1].toLowerCase();
        const verb = (m[2] || "").toLowerCase();
        if (resource === "help" || resource === "version") continue;
        // Flags like --help are not verbs
        if (resource.startsWith("-")) continue;
        const allowed = ALLOWED[resource];
        if (!allowed) {
          bad.push({ f, cmd: `speakerops ${resource} ${verb}`.trim() });
          continue;
        }
        if (verb.startsWith("-")) continue; // speakerops events --json
        if (verb && !allowed.includes(verb) && !allowed.includes("")) {
          bad.push({ f, cmd: `speakerops ${resource} ${verb}` });
        }
      }
    }
  }
  if (bad.length) {
    console.error("Learn CLI parity FAIL — unknown verbs in learn-code blocks:");
    for (const b of bad.slice(0, 40)) {
      console.error(`  ${b.cmd}\n    in ${b.f.replace(ROOT + "/", "")}`);
    }
    process.exit(1);
  }
  console.log(`check-learn-cli-parity: OK (${files.length} html files)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
