import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for SpeakerOps web SPA (section 1.4).
 * Local API proxy targets Worker health / future domain routes.
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
});
