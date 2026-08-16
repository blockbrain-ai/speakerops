import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_DEV,
  SECURITY_HEADERS,
  SECURITY_HEADERS_DEV,
  SECURITY_HEADERS_EMBED,
} from "@speakerops/shared";

const rootDir = dirname(fileURLToPath(import.meta.url));

/** Production / preview — strict CSP (section 8.3). */
const productionHeaders: Record<string, string> = { ...SECURITY_HEADERS };

/**
 * Vite dev server / Playwright webServer only — allows the React Fast Refresh
 * inline preamble and HMR websockets. Never used for preview or Worker.
 */
const devHeaders: Record<string, string> = { ...SECURITY_HEADERS_DEV };

/** /embed/* must be framable in local e2e (mirrors Worker SECURITY_HEADERS_EMBED). */
const embedDevHeaders: Record<string, string> = {
  ...SECURITY_HEADERS_DEV,
  "Content-Security-Policy": CONTENT_SECURITY_POLICY_DEV.replace(
    /frame-ancestors\s+'none'/i,
    "frame-ancestors *",
  ),
};
// Drop DENY so device-preview iframes work locally.
delete embedDevHeaders["X-Frame-Options"];

/**
 * Meta CSP must not include header-only directives. Chromium logs a console.error
 * for `frame-ancestors` inside a `<meta http-equiv="Content-Security-Policy">`
 * element (directive is ignored); that breaks console-clean L04 / keystones.
 * Keep `frame-ancestors` on response headers (SECURITY_HEADERS / DEV).
 */
function cspPolicyForMeta(policy: string): string {
  return policy
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && !/^frame-ancestors\b/i.test(d))
    .join("; ");
}

/**
 * Align index.html meta CSP with the response header for the current mode,
 * minus header-only directives (frame-ancestors).
 * Production meta stays strict; serve mode rewrites to CONTENT_SECURITY_POLICY_DEV
 * so the browser does not block the @vitejs/plugin-react preamble.
 */
function cspMetaAlignPlugin(): Plugin {
  return {
    name: "speakerops-csp-meta-align",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const headerPolicy =
          ctx.server != null
            ? CONTENT_SECURITY_POLICY_DEV
            : CONTENT_SECURITY_POLICY;
        const policy = cspPolicyForMeta(headerPolicy);
        return html.replace(
          /(<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=")([^"]*)(")/i,
          `$1${policy}$3`,
        );
      },
    },
  };
}

/**
 * Vite config for SpeakerOps web SPA (section 1.4 + 8.3 security headers).
 * Local API proxy targets Worker health / domain routes.
 * Production CSP on preview; dev/E2E CSP allows React preamble without
 * weakening Worker / production SECURITY_HEADERS.
 */
function isEmbedUrl(url: string | undefined): boolean {
  const path = (url ?? "").split("?")[0] ?? "";
  return path === "/embed" || path.startsWith("/embed/");
}

/**
 * Intercept setHeader so Vite's static `server.headers` DENY/frame-ancestors
 * none cannot override embed framability (admin preview + N4 third-party).
 */
function interceptEmbedResponseHeaders(
  req: { url?: string },
  res: {
    setHeader: (name: string | number, value: string | number | readonly string[]) => unknown;
    removeHeader: (name: string) => void;
  },
  headers: Record<string, string>,
) {
  if (!isEmbedUrl(req.url)) return;
  const orig = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    const key = String(name).toLowerCase();
    if (key === "content-security-policy") {
      return orig("Content-Security-Policy", headers["Content-Security-Policy"]!);
    }
    if (key === "x-frame-options") {
      // Skip DENY for embed documents.
      return res;
    }
    return orig(name, value);
  };
  // Ensure embed policy is present even if Vite never sets CSP.
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "x-frame-options") continue;
    orig(k, v);
  }
  res.removeHeader("X-Frame-Options");
}

function embedPathPlugin(): Plugin {
  return {
    name: "speakerops-embed-csp",
    configureServer(server) {
      // Pre-middleware: wrap setHeader before Vite applies server.headers.
      server.middlewares.use((req, res, next) => {
        interceptEmbedResponseHeaders(req, res, embedDevHeaders);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        interceptEmbedResponseHeaders(req, res, { ...SECURITY_HEADERS_EMBED });
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cspMetaAlignPlugin(), embedPathPlugin()],
  root: rootDir,
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    headers: devHeaders,
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
    headers: productionHeaders,
  },
});
