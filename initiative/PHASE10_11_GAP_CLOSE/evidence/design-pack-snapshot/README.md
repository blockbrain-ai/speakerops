# SpeakerOps Lumen 2 design pack

This pack is the implementation companion to `../SPEAKEROPS_DESIGN_AUDIT.md`.
It removes ambiguity between the original design directions and future product
work by providing a complete visual reference, reusable code, screen patterns,
and binding quality gates.

**Status:** approved implementation reference · **self-review:** 9.1/10.

## Open the pack

Open `index.html` directly in Chrome or through a local static server. The page
embeds its SVG symbols so icons also work under Chrome's `file://` restrictions.
The document is dependency-free. Its CSS and SVG are executable references;
adoption is mapped into the existing React/Vite codebase as described below,
not installed as a new package.

## Contents

| File | Purpose |
|---|---|
| `index.html` | Interactive visual reference and six product reference screens |
| `tokens.css` | Complete Lumen 2 primitive and semantic tokens |
| `components.css` | Reusable controls, navigation, data display, feedback, and overlays |
| `patterns.css` | Product compositions for overview, CFP, submissions, schedule, comms, and portal |
| `icons.svg` | Canonical 24px outline SVG symbol source, mirrored inline in `index.html` for direct-file viewing |
| `design-pack.js` | Reference-only theme, density, modal, toast, and screen controls |
| `FONT_SPEC.md` | Font loading, weights, scale, fallbacks, and acceptance checks |
| `STACK_COMPATIBILITY.md` | Verified React/Vite fit and zero-new-dependency guardrails |
| `UX_INFORMATION_ARCHITECTURE.md` | Role navigation, every menu purpose, page formats, and browse behavior |
| `page-atlas.json` | Machine-readable route, view, detail, and mobile decisions |
| `AGENT_IMPLEMENTATION_SPEC.md` | Binding implementation rules for agents |
| `QA_CHECKLIST.md` | Visual, responsive, accessibility, and realistic-data gates |
| `DESIGN_PACK_REVIEW.md` | Final self-critique, rating, limitations, and correction log |
| `HANDOVER_BRIEF.md` | Agent-facing file map, reading order, constraints, and definition of done |
| `manifest.json` | Machine-readable pack metadata and required artifacts |

## Adoption rule

Do not paste the reference page wholesale into the product. Adopt in this
order:

1. `tokens.css`
2. shared primitives from `components.css`
3. product compositions from `patterns.css`
4. route-by-route migration with screenshot review

The current frontend has deliberately minimal runtime dependencies: React,
React DOM, React Router, and the first-party shared workspace package. This pack
adds none. Use first-party React components, native HTML controls/drag events,
local CSS, and reviewed same-origin SVG paths. Do not add a UI kit, icon set,
charting, form, animation, state, drag-and-drop, or font package for this work.

The ratified `--lumen-*` variables in `apps/web/src/styles/lumen.css` remain the
application source of truth. The extended `--l2-*` names in this standalone
reference map to that contract; they do not authorize a second theme or a
silent change to governance-frozen values.

The reference page is intentionally richer than a component inventory. It
shows how primitives combine into calm operational workflows at realistic
density.

## Design synthesis

- **Northstar:** premium composition, warmer canvas, meaningful depth, strong
  hierarchy, quiet confidence.
- **Greenroom:** semantic tokens, progressive disclosure, complete states,
  theming guardrails, visual QA.
- **Program OS:** operational completeness, role surfaces, schedule and data
  density, broad component coverage.

## Non-negotiables

- Light default; no dark cockpit.
- Admin and evaluator chrome stay Lumen neutral.
- Event branding applies only to public CFP and speaker portal scopes.
- Status colors never retheme and never communicate by color alone.
- Every interactive control has hover, focus-visible, pressed, disabled, and
  pending treatment.
- Every high-risk action previews consequences and requires explicit
  confirmation.
- Every critical screen is approved from a fixed-data screenshot at desktop
  and mobile widths.
