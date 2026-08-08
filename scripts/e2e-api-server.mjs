/**
 * Local Hono API server for Playwright foundation smoke (section 1.6).
 *
 * Serves the real Worker app (`createApp`) over HTTP so Vite's `/health`
 * proxy and Playwright `request.get("/health")` hit the same composition root
 * as production — no wrangler required for local e2e.
 *
 * Env names only (E10): E2E_API_PORT, APP_VERSION.
 * Does not log secrets or magic links.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_API_PORT || 8787);
const HOST = process.env.E2E_API_HOST || "127.0.0.1";

async function loadCreateApp() {
  const distEntry = join(root, "apps", "api", "dist", "index.js");
  if (existsSync(distEntry)) {
    const mod = await import(pathToFileURL(distEntry).href);
    return mod.createApp;
  }
  // Fallback: load TypeScript source via dynamic import when dist is absent
  // (tsx / node --experimental-strip-types environments). Prefer dist in CI.
  const srcEntry = join(root, "apps", "api", "src", "index.ts");
  const mod = await import(pathToFileURL(srcEntry).href);
  return mod.createApp;
}

const createApp = await loadCreateApp();
const app = createApp();

/** Minimal Worker bindings for health (names only — no secrets). */
const env = {
  APP_VERSION:
    typeof process.env.APP_VERSION === "string" && process.env.APP_VERSION.length > 0
      ? process.env.APP_VERSION
      : "0.1.0",
};

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || `${HOST}:${PORT}`;
    const url = new URL(req.url || "/", `http://${host}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else {
        headers.set(key, value);
      }
    }

    const method = req.method || "GET";
    /** @type {RequestInit} */
    const init = { method, headers };

    if (method !== "GET" && method !== "HEAD") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length > 0) {
        init.body = Buffer.concat(chunks);
      }
    }

    const response = await app.request(url.toString(), init, env);
    const outHeaders = {};
    response.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    res.writeHead(response.status, outHeaders);
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch {
    // E4-shaped failure without stack leak to client
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unexpected error", code: "INTERNAL_ERROR" }));
  }
});

server.listen(PORT, HOST, () => {
  // Structured, non-secret log for e2e startup only
  process.stdout.write(
    `[e2e-api] listening on http://${HOST}:${PORT} (health: /health)\n`,
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
