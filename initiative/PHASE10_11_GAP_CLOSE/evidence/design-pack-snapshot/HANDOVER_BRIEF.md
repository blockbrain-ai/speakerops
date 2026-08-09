# SpeakerOps Lumen 2 — agent handover brief

## Objective

Use the approved SpeakerOps Lumen 2 design and UX pack to guide future
front-end implementation. The pack is the canonical synthesized direction for
visual design, navigation, page formats, responsive behavior, interaction
patterns, and implementation quality.

The reference pack is complete and self-reviewed at **9.1/10**. It has not been
copied into the production application. Product implementation remains a
separate, gated task.

## Workspace locations

### Application repository

`/Users/qualitycontrol/Documents/speakerops/`

This is the real SpeakerOps codebase. Inspect its current behavior before
changing a route. Preserve permissions, security boundaries, workflows, and
data behavior.

### Approved design pack

`/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/`

This directory contains the implementation reference and all handoff
contracts. Start here.

### Original design research

`/Users/qualitycontrol/Documents/speakerops-research/`

This contains the earlier Croc, Codex, and Claude design work. Use it only for
provenance or comparison. Where an earlier direction conflicts with Lumen 2,
the approved Lumen 2 pack is authoritative.

### Design audit

`/Users/qualitycontrol/Documents/ChatGPT/speakerops/SPEAKEROPS_DESIGN_AUDIT.md`

This explains why the existing implementation fell short, including the
original scorecard and gap-closing plan.

## Required reading order

Read these files in order before implementation:

1. `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/README.md`
   — pack purpose, contents, synthesis, and adoption rules.
2. `/Users/qualitycontrol/Documents/ChatGPT/speakerops/SPEAKEROPS_DESIGN_AUDIT.md`
   — baseline evaluation and the problems Lumen 2 is intended to solve.
3. `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/UX_INFORMATION_ARCHITECTURE.md`
   — product mental model, role navigation, every menu item's purpose, page
   formats, browse behavior, detail behavior, and mobile rules.
4. `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/page-atlas.json`
   — machine-readable contract for all 21 current route decisions.
5. `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/STACK_COMPATIBILITY.md`
   — existing stack, inspected repository files, supply-chain constraints, and
   zero-new-dependency implementation choices.
6. `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/AGENT_IMPLEMENTATION_SPEC.md`
   — binding rules, architecture, implementation sequence, prohibitions, and
   evidence requirements.
7. `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/QA_CHECKLIST.md`
   — route-level visual, state, responsive, accessibility, data-volume,
   security, and dependency gates.
8. `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/DESIGN_PACK_REVIEW.md`
   — final score, strengths, known limitations, correction log, and approval
   conditions.

## Visual reference

Open this file in Chrome:

`/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/index.html`

It works when opened directly and does not require a local server. It contains:

- foundations and design principles;
- color, typography, spacing, radius, elevation, and motion;
- buttons, forms, selections, navigation, cards, tables, alerts, overlays, and
  states;
- the icon library;
- density and scoped event-brand demonstrations;
- six canonical product screens;
- a visual page atlas;
- the implementation sequence and final scorecard.

The six canonical screens are:

1. Program overview and readiness
2. Structured CFP builder
3. Submissions master-detail
4. Schedule Studio
5. Communications campaign
6. Public CFP and speaker portal

## Code-reference files

These files demonstrate the approved design in executable HTML/CSS/JavaScript.
They are references, not a replacement application:

- `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/tokens.css`
  — primitive and semantic tokens, mapped to the ratified Lumen contract.
- `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/components.css`
  — reusable controls, navigation, forms, data display, feedback, and overlays.
- `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/patterns.css`
  — page and workflow compositions, container queries, and responsive rules.
- `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/icons.svg`
  — canonical first-party 24px outline symbol source. The same symbols are
  embedded in `index.html` so Chrome can display them under `file://`.
- `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/design-pack.js`
  — reference-only screen switching, density, scoped branding, modal focus,
  and toast behavior.
- `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/FONT_SPEC.md`
  — typography contract and the no-font-dependency rule.
- `/Users/qualitycontrol/Documents/ChatGPT/speakerops/design-pack/manifest.json`
  — machine-readable pack status, stack compatibility, reference screens, and
  required review viewports.

Do not paste `index.html` into the React application. Extract the system and
patterns into existing shared components and routes.

## Existing application contracts to inspect

Before implementing, compare the reference with these current application
files:

- `/Users/qualitycontrol/Documents/speakerops/apps/web/package.json`
- `/Users/qualitycontrol/Documents/speakerops/apps/web/src/styles/lumen.css`
- `/Users/qualitycontrol/Documents/speakerops/apps/web/src/styles/shell.css`
- `/Users/qualitycontrol/Documents/speakerops/docs/governance/0.2-lumen-lock.md`

Search the application for the current route and its existing components,
tests, permissions, data loading, empty states, and error handling before
making changes.

## Non-negotiable implementation constraints

1. Add **no new runtime dependency** by default.
2. Do not introduce a UI kit, icon package, chart library, form library,
   animation package, state library, drag-and-drop package, or font package.
3. Use the current React 18, React Router 6, Vite 5, TypeScript, local CSS,
   native HTML controls, native browser APIs, and first-party SVG paths.
4. Keep `apps/web/src/styles/lumen.css` as the application token source of
   truth. The design-pack aliases do not authorize a parallel theme.
5. Preserve the existing CSP, dependency audit, SVG-upload rejection, auth,
   roles, permissions, and product behavior.
6. Keep admin and evaluator chrome neutral. Event branding is scoped to public
   CFP and speaker-portal surfaces only.
7. Status meanings and colors never retheme and never rely on color alone.
8. Implement shared tokens and primitives before page-specific compositions.
9. Use deterministic real-shape fixtures for normal, empty, loading, error,
   warning, long-content, and high-volume states.
10. Do not claim production completion from visual similarity alone. Each route
    must pass `QA_CHECKLIST.md`.

Any proposed dependency exception requires explicit owner and security review,
including version pinning, provenance, integrity, transitive surface, update
policy, and a removal path.

## Navigation and copy decisions

The route and page-format decisions are fully specified in
`UX_INFORMATION_ARCHITECTURE.md` and `page-atlas.json`.

Two recommended visible-label improvements require a label-only governance
amendment before use:

- `CFP / Forms` → `Call for proposals`
- `Comms` → `Communications`

Until that amendment is ratified, retain the governance-locked labels in the
application while implementing the approved structure and behavior.

`Design Kit` may use the clearer display copy `Event brand` where current
governance permits it.

## Recommended implementation sequence

1. Confirm the target route, its user role, and its entry/exit workflows.
2. Inspect existing route behavior and tests in the application repository.
3. Adopt or reconcile the canonical Lumen token mapping.
4. Build or migrate the shared primitives used by the route.
5. Implement one representative composition from the relevant pattern family.
6. Bind existing data and behavior without weakening permissions or failure
   recovery.
7. Exercise the state-fixture matrix.
8. Review at 1440×1000, 834×1112, and 390×844.
9. Complete keyboard, focus, accessible-name, contrast, zoom, and screen-reader
   checks.
10. Run existing tests and `pnpm run audit:deps`.
11. Attach the evidence required by `QA_CHECKLIST.md`.
12. Rate the production result independently against the original audit.

Prove a representative route from each pattern family before scaling the
migration across similar routes.

## Definition of done for another agent

The next agent is finished only when:

- the requested route retains all existing functional behavior;
- the correct page format and navigation contract are implemented;
- shared components are reused rather than duplicated;
- no unapproved dependency or token system has been introduced;
- normal and adverse states are credible with realistic data;
- desktop, tablet, and mobile evidence is attached;
- keyboard and accessibility gates pass;
- automated tests and the dependency audit pass;
- intentional deviations from Lumen 2 are documented with product or
  technical reasons;
- the implemented result is independently rated at least 8.0/10, with no
  critical category below 7.0.

## Handover status

The design audit, visual reference, UX/IA decisions, stack compatibility
review, implementation contract, QA gates, and final self-review are complete.
No application route has been migrated as part of this design-pack task.
