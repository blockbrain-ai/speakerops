#!/usr/bin/env node
/**
 * Learn site builder — single source of truth for guides.
 *
 * Source: apps/learn/src/content/*.json + apps/learn/src/nav.json
 * Output: apps/learn/dist/** + search-index.json
 *
 * Usage: node scripts/build-learn.mjs
 * Gate:  node scripts/check-learn-cli-parity.mjs (after build)
 */
import { readdir, readFile, writeFile, mkdir, cp, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps/learn/src");
const DIST = join(ROOT, "apps/learn/dist");
const CONTENT = join(SRC, "content");

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNav(nav, currentPath) {
  const parts = [
    `<div class="nav-head"><p class="nav-title">Guides</p><button type="button" class="nav-close" id="nav-close" data-testid="learn-nav-close" aria-label="Close menu">Close</button></div>`,
  ];
  for (const group of nav) {
    parts.push(`<div class="nav-group"><p class="nav-group-label">${escapeHtml(group.label)}</p><ul>`);
    for (const item of group.items) {
      const cur =
        item.href === currentPath ||
        (currentPath === "/" && item.href === "/")
          ? ' aria-current="page"'
          : "";
      parts.push(
        `<li><a href="${escapeHtml(item.href)}"${cur}>${escapeHtml(item.title)}</a></li>`,
      );
    }
    parts.push(`</ul></div>`);
  }
  return parts.join("\n");
}

function pageHtml({ title, description, crumb, path, bodyHtml, nav }) {
  const desc = description || title;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CSP)}">
<meta name="description" content="${escapeHtml(desc)}">
<title>${escapeHtml(title)} · SpeakerOps Learn</title>
<link rel="stylesheet" href="/assets/learn.css">

</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="learn-shell">
  <aside class="learn-sidebar" data-testid="learn-sidebar">
    <div class="sidebar-brand">
      <a class="brand" href="/" data-testid="learn-brand">SpeakerOps Learn</a>
      <p class="sidebar-tagline">Program OS operator guides</p>
    </div>
    <form class="search-form" role="search" data-testid="learn-search-form" action="#" method="get" onsubmit="return false;">
      <label class="visually-hidden" for="learn-search">Search</label>
      <input type="search" id="learn-search" name="q" class="search-input lumen-focusable" data-testid="learn-search" placeholder="Search all guides…" autocomplete="off">
    </form>
    <nav class="learn-nav" id="learn-nav" aria-label="Documentation" data-testid="learn-sidebar-nav">
${renderNav(nav, path)}
</nav>

  </aside>
  <div class="learn-primary">
    <header class="learn-topbar" role="banner">
      <button type="button" class="nav-toggle" id="nav-toggle" data-testid="learn-nav-toggle" aria-controls="learn-nav" aria-expanded="false">Menu</button>
      <p class="topbar-crumb" data-testid="learn-crumb">${escapeHtml(crumb || title)}</p>
    </header>
    <div class="learn-body-row">
      <main id="main" class="learn-main" data-testid="learn-main">
${bodyHtml}
      </main>
    </div>
  </div>
</div>
<script src="/assets/learn.js" defer></script>
</body>
</html>
`;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const nav = JSON.parse(await readFile(join(SRC, "nav.json"), "utf8"));
  const files = (await readdir(CONTENT)).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error("No content in apps/learn/src/content");
    process.exit(1);
  }

  // Preserve static assets (css/js/fonts/images)
  await mkdir(join(DIST, "assets"), { recursive: true });

  const searchDocs = [];

  for (const f of files) {
    const rec = JSON.parse(await readFile(join(CONTENT, f), "utf8"));
    const path = rec.path === "/" || rec.path === "" ? "/" : rec.path.replace(/\/$/, "");
    const outDir =
      path === "/"
        ? DIST
        : join(DIST, path.replace(/^\//, ""));
    await mkdir(outDir, { recursive: true });
    const outFile = join(outDir, "index.html");

    // Ensure body is wrapped in article if not already
    let body = rec.bodyHtml.trim();
    if (!body.includes("<article")) {
      body = `<article data-article-id="${escapeHtml(rec.id)}">\n${body}\n</article>`;
    }

    const html = pageHtml({
      title: rec.title,
      description: rec.description || stripTags(body).slice(0, 160),
      crumb: rec.title,
      path: path === "" ? "/" : path,
      bodyHtml: body,
      nav,
    });
    await writeFile(outFile, html, "utf8");

    searchDocs.push({
      id: rec.id,
      path: path === "" ? "/" : path,
      title: rec.title,
      text: stripTags(body).slice(0, 4000),
    });
  }

  // search-index.json
  await writeFile(
    join(DIST, "assets", "search-index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), docs: searchDocs }, null, 2) +
      "\n",
    "utf8",
  );

  // 404 page
  const notFound = pageHtml({
    title: "Not found",
    description: "That guide does not exist.",
    crumb: "Not found",
    path: "/404",
    bodyHtml: `<article data-article-id="404"><h1>Not found</h1><p class="learn-lead">No guide at this path. Return to <a href="/">home</a>.</p></article>`,
    nav,
  });
  await writeFile(join(DIST, "404.html"), notFound, "utf8");

  const hash = createHash("sha256")
    .update(JSON.stringify(searchDocs.map((d) => d.id).sort()))
    .digest("hex")
    .slice(0, 12);
  console.log(
    `build-learn: wrote ${files.length} pages + search-index (${searchDocs.length} docs) hash=${hash}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
