/**
 * Phase 0 — Site-wide docs link gate.
 *
 * Product: no same-origin /learn/* content promises; known chrome → learn.speakerops.org.
 * Learn dist: crawl internal hrefs; search-index paths exist.
 *
 * Exit 0 on pass; exit 1 with details on fail.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEARN_URL = "https://learn.speakerops.org";
const errors = [];
const notes = [];

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      walk(p, pred, out);
    } else if (pred(p)) out.push(p);
  }
  return out;
}

// —— Product: ban /learn hrefs ——
const webSrc = join(root, "apps/web/src");
const webFiles = walk(webSrc, (p) => /\.(tsx|ts|jsx|js)$/.test(p));
const badLearn = [];
for (const f of webFiles) {
  const body = readFileSync(f, "utf8");
  if (/href\s*=\s*["']\/learn(\/|["'])/.test(body) || /to\s*=\s*["']\/learn(\/|["'])/.test(body)) {
    badLearn.push(relative(root, f));
  }
}
if (badLearn.length) {
  errors.push(`Product still links same-origin /learn: ${badLearn.join(", ")}`);
} else {
  notes.push("Product: no same-origin /learn hrefs in apps/web/src");
}

// —— Product: known chrome points at external Learn ——
const mustContainLearn = [
  "apps/web/src/pages/PublicLanding.tsx",
  "apps/web/src/layout/AdminShell.tsx",
  "apps/web/src/layout/RoleShell.tsx",
];
for (const rel of mustContainLearn) {
  const body = readFileSync(join(root, rel), "utf8");
  if (!body.includes(LEARN_URL) && !body.includes("learn.speakerops.org")) {
    errors.push(`${rel} missing learn.speakerops.org`);
  }
}
notes.push("Product chrome files reference learn.speakerops.org");

// —— Product: landing API is openapi ——
const landing = readFileSync(join(root, "apps/web/src/pages/PublicLanding.tsx"), "utf8");
if (!landing.includes("/openapi.json") && !landing.includes("OPENAPI_URL")) {
  errors.push("PublicLanding missing OpenAPI footer target");
} else {
  notes.push("PublicLanding API → /openapi.json");
}

// —— Learn dist internal crawl ——
const learnRoot = join(root, "apps/learn/dist");
if (!existsSync(learnRoot)) {
  errors.push("apps/learn/dist missing");
} else {
  const htmlFiles = walk(learnRoot, (p) => p.endsWith(".html"));
  const hrefRe = /(?:href|src)=["']([^"']+)["']/gi;
  let checked = 0;
  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    let m;
    while ((m = hrefRe.exec(html))) {
      let href = m[1];
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("data:"))
        continue;
      if (href.startsWith("http://") || href.startsWith("https://")) {
        // External is fine; do not fetch in CI-offline mode
        continue;
      }
      // strip hash/query
      const bare = href.split("#")[0].split("?")[0];
      if (!bare || bare === "") continue;
      let target;
      if (bare.startsWith("/")) {
        target = join(learnRoot, bare.replace(/^\//, ""));
        // directory index
        if (existsSync(target) && statSync(target).isDirectory()) {
          target = join(target, "index.html");
        } else if (!bare.endsWith(".html") && !bare.includes(".") && !existsSync(target)) {
          target = join(learnRoot, bare.replace(/^\//, ""), "index.html");
        }
      } else {
        target = resolve(dirname(file), bare);
        if (existsSync(target) && statSync(target).isDirectory()) {
          target = join(target, "index.html");
        }
      }
      checked += 1;
      if (!existsSync(target)) {
        errors.push(`Learn broken link ${relative(root, file)} → ${href}`);
      }
    }
  }
  notes.push(`Learn: crawled ${htmlFiles.length} HTML files, ${checked} internal hrefs`);

  // search index paths
  const idxPath = join(learnRoot, "assets/search-index.json");
  if (existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, "utf8"));
    const items = Array.isArray(idx) ? idx : idx.documents ?? idx.pages ?? [];
    let n = 0;
    for (const item of items) {
      const path = item.path || item.url || item.href;
      if (!path || typeof path !== "string") continue;
      n += 1;
      const bare = path.replace(/^\//, "").replace(/\/$/, "");
      const candidates = [
        join(learnRoot, bare, "index.html"),
        join(learnRoot, bare + ".html"),
        join(learnRoot, bare),
      ];
      if (bare === "" || bare === "index") {
        if (!existsSync(join(learnRoot, "index.html"))) {
          errors.push(`search-index path missing: ${path}`);
        }
        continue;
      }
      if (!candidates.some((c) => existsSync(c))) {
        errors.push(`search-index path missing: ${path}`);
      }
    }
    notes.push(`Learn: checked ${n} search-index paths`);
  }
}

// —— Report ——
console.log("[check-docs-links] notes:");
for (const n of notes) console.log("  ·", n);
if (errors.length) {
  console.error("[check-docs-links] FAIL:");
  for (const e of errors) console.error("  ✗", e);
  process.exit(1);
}
console.log("[check-docs-links] OK");
process.exit(0);
