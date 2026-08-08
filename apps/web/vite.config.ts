import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SECURITY_HEADERS } from "@speakerops/shared";

const rootDir = dirname(fileURLToPath(import.meta.url));

/** Same security headers as Worker middleware (section 8.3 — CSP on HTML). */
const securityHeaders: Record<string, string> = { ...SECURITY_HEADERS };

/**
 * Vite config for SpeakerOps web SPA (section 1.4 + 8.3 security headers).
 * Local API proxy targets Worker health / domain routes.
 * CSP + companion headers applied to HTML/static so browser documents match production policy.
 */
export default defineConfig({
  plugins: [react()],
  root: rootDir,
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    headers: securityHeaders,
    proxy: {
      // Same-origin style local dev: SPA → API Worker
      "/health": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: securityHeaders,
  },
});
