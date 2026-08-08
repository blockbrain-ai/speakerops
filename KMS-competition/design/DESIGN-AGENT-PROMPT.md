# Independent design brief + design kit task

You are an independent product design advisor. Do NOT implement application code.

## Product
Open-source Sessionboard-class **program/CFP/speaker management** tool for a real conference team (Kill My SaaS competition). Core surfaces: public CFP form, speaker portal, evaluation, drag-drop schedule, onboarding task dashboard, admin settings. Target UX bar: **Apple-level** — light, airy, curvy, tasteful, modern, easy. Explicitly **not** dark dingy vibe-coded slop.

## Owner constraints (honor these)
- Design brief BEFORE deep build planning.
- Frontend must stay **theme-flexible** (CSS variables / design tokens / design-kit dashboard for colors & branding) so beauty can improve during a long Section Runner build.
- Plan for exhaustive E2E mapping of every UI function, settings, and role permissions later — your design should make roles and settings legible.
- Competitors to benchmark: Sessionboard (incumbent), Sessionize, Sched, Cadmium/Eventscribe, Cvent (enterprise), Whova. Screenshots may be in `design/screenshots/`.

## Deliverable (ONE file only)
Write a **self-contained HTML report** to:

`design/design-kit-REPORT-<yourname>.html`

where yourname is `claude` or `codex`.

The HTML must be a **design kit / brief document** you can scroll and fully understand:
1. Design brief (positioning, principles, anti-patterns)
2. Competitor benchmark + evaluation rubric with scores (UX, visual craft, information architecture, accessibility, industry fit, customization, agent/ops clarity)
3. Recommended visual direction (mood: Apple-like conference ops)
4. **Living design tokens**: colors, type scale, spacing, radii, shadows, elevation
5. **Rendered component gallery**: buttons, inputs, selects, textareas, checkboxes, radios, chips/tags, badges/status pills, cards, tables, empty states, modals/sheets, toasts, navigation, sidebar, tabs, drag-drop schedule tile mock, speaker card, form builder block, dashboard stat
6. Role surfaces sketch: public submitter, speaker, evaluator, admin
7. Theming / design-kit dashboard concept (how organizers customize brand without code)
8. Evaluation method for future design iterations (how we know if a design is good)

### HTML technical requirements
- Single self-contained file (inline CSS; optional Google Fonts CDN)
- Light theme default; optional tasteful dark section only if high quality
- Beautiful, presentation-ready — this file IS the design sample
- No build step; openable via `file://`
- Sign the report as Claude or Codex at the bottom

Be opinionated. Prefer one coherent system over many options.
