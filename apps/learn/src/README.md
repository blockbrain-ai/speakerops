# Learn source of truth

- `nav.json` — sidebar groups (single source for every page)
- `content/*.json` — guide bodies (`id`, `path`, `title`, `bodyHtml`)
- Build: `pnpm build:learn` → `apps/learn/dist`
- CLI parity gate: `pnpm check:learn-cli` (fenced `learn-code` blocks only)

Do not hand-edit `dist/**/*.html` after a build — edit content and rebuild.
