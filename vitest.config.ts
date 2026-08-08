import { defineConfig } from "vitest/config";

/**
 * Non-interactive Vitest config for Section Runner gates (E5).
 * Gate scripts must never use watch mode — `watch: false` is explicit.
 */
export default defineConfig({
  test: {
    watch: false,
    globals: false,
    environment: "node",
    include: [
      "packages/**/*.{test,spec}.ts",
      "apps/**/*.{test,spec}.ts",
      "apps/**/*.{test,spec}.tsx",
      "tests/**/*.{test,spec}.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/governance/**",
    ],
    passWithNoTests: false,
  },
});
