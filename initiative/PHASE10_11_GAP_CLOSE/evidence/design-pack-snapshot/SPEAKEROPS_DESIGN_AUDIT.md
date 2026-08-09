# SpeakerOps design audit

**Date:** 9 August 2026  
**Scope:** Original Grok, Claude, and Codex design kits; Lumen synthesis and governance; implemented React/CSS product; current deployed admin, communications, login, and public CFP states; committed visual evidence; visual-test strategy.  
**Mode:** Audit only. No application, design-system, data, deployment, or production changes were made.

## Executive verdict

SpeakerOps did fall materially short of the agreed design bar.

The application is not visually disastrous. It is clean, light, consistent, and avoids the dark “vibe-coded” failure the brief explicitly rejected. The information architecture is understandable, the indigo/graphite palette is serviceable, and the schedule, form-builder, portal, and trust-before-send concepts show real product judgment.

However, the implemented product is a **functional Lumen-themed scaffold**, not the high-calibre synthesis promised by the three design concepts. The build retained the easiest parts of the concepts—palette, border radii, neutral canvas, sidebar, cards, and status colors—but lost most of their visual composition, hierarchy, density control, progressive disclosure, component craft, and operational ergonomics.

**Overall implemented-design score: 4.4/10.**  
**Target implied by the brief: at least 8.0/10, with no primary surface below 7.0.**

The main failure was not bad taste in the color choice. It was a process failure: the design synthesis was reduced to tokens and a checklist, then functional E2E tests were allowed to stand in for visual acceptance. The result can pass tests because an element exists and is clickable while still looking like a minimally styled internal admin tool.

## What was reviewed

### Original design directions

- **Grok — Program OS:** broadest token scale, strong completeness, schedule tiles, role matrix, component gallery, branded dashboard thinking.
- **Claude — Greenroom:** strongest system logic, progressive disclosure, semantic tokens, live theme variants, status discipline, explicit quality gates.
- **Codex — Northstar:** strongest visual art direction, premium warmth, dimensional hierarchy, deliberate shell anatomy, bespoke dashboard composition.
- **Lumen synthesis:** “Northstar quiet craft + Greenroom living tokens + Program OS completeness.”

### Implemented evidence

- Current deployed admin overview and communications screens in the authenticated Chrome session.
- Current deployed login and public CFP failure states.
- Committed public CFP design-publish screenshot.
- `apps/web/src/styles/lumen.css` and the 2,387-line `shell.css`.
- All major page compositions: admin shell, readiness, CFP builder, public CFP, submissions, evaluation, speakers, schedule, communications, settings, Design Kit, API keys, and speaker portal.
- Lumen governance and E2E tests, including what the tests do and do not prove.

## Ranking: concepts, synthesis, and implementation

| Rank | Direction | Visual craft | System depth | Workflow fit | Implementability | Overall | Assessment |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | **Claude / Greenroom** | 8.5 | 9.3 | 8.8 | 9.0 | **8.9** | Best production design system. Progressive disclosure, semantic tokens, explicit states, theming guardrails, and visual QA thinking were especially strong. |
| 2 | **Codex / Northstar** | 9.3 | 8.1 | 8.4 | 7.8 | **8.7** | Most premium and distinctive. Strongest hierarchy, shell composition, warmth, depth, and “designed rather than generated” feeling. |
| 3 | **Grok / Program OS** | 8.1 | 8.7 | 8.6 | 8.7 | **8.5** | Most complete reference kit. Slightly more familiar/generic SaaS visual language, but far more resolved than the shipped UI. |
| 4 | **Lumen synthesis document** | 7.2 | 7.8 | 8.2 | 8.0 | **7.7** | Good principles and safety rules, but compressed three rich visual systems into a small token set and component list. It preserved intent better than execution detail. |
| 5 | **Implemented SpeakerOps** | 3.8 | 4.8 | 5.0 | 6.2 | **4.4** | Coherent functional baseline, but visually sparse, structurally repetitive, weak at scale, and not close to the reference calibre. |

Claude slightly outranks Codex overall because its system was more implementation-ready, while Codex remains the strongest pure visual direction. The right synthesis is still valid: **Codex composition + Claude system rigor + Grok coverage**. The build did not deliver that synthesis.

## Weighted implementation scorecard

| Dimension | Weight | Score /10 | Weighted contribution | Finding |
|---|---:|---:|---:|---|
| Visual craft and distinctiveness | 15% | 3.5 | 0.53 | Clean but generic. Little bespoke visual language, iconography, imagery, depth, or brand character. |
| Hierarchy and page composition | 10% | 3.5 | 0.35 | Repeated overline/title/body/card pattern; weak focal points; large unused desktop canvas. |
| Information architecture | 10% | 6.0 | 0.60 | Eight-item admin IA is understandable and active-event context is visible. Settings nesting remains basic. |
| Component quality | 10% | 3.5 | 0.35 | Browser-like radios/checkboxes, basic tables and inputs, weak overlays, no mature toolbar/filter/data-grid system. |
| Workflow interaction design | 15% | 4.0 | 0.60 | Important workflows exist, but controls are exposed as long forms instead of carefully staged tasks. |
| Density and scale handling | 10% | 2.5 | 0.25 | The 150-speaker communications audience is the clearest failure: one long raw checkbox list with stray bullets. |
| System consistency and maintainability | 10% | 5.0 | 0.50 | Palette/radius consistency is good, but styling is centralized in one large stylesheet and generic page namespaces are reused widely. |
| Accessibility design | 8% | 5.5 | 0.44 | Focus token, semantic labels, minimum public CTA size, and reduced motion are positive. Faint borders, tiny metadata, default controls, and uneven focus treatment remain. |
| Responsive design | 5% | 4.5 | 0.23 | Public CFP and portal have mobile rules; admin shell does not have a complete narrow-screen navigation strategy. |
| Theming and brand flexibility | 5% | 5.5 | 0.28 | Brand publish, wordmark, logo, radius, and contrast logic exist, but the preview and output are visually shallow. |
| Loading, empty, error, and recovery states | 5% | 3.0 | 0.15 | States exist in code, but current production failures collapse to generic messages with little recovery help. |
| Product copy and tone | 2% | 4.5 | 0.09 | Generally clear, but implementation/debug language leaks into user-facing surfaces. |
| **Total** | **100%** |  | **4.37 / 10** | Rounded overall score: **4.4/10**. |

## Surface-by-surface evaluation

| Surface | Score /10 | What works | Where it falls short | Priority |
|---|---:|---|---|---|
| Admin shell and navigation | 5.5 | Clear labels, persistent event selector, calm light canvas, stable active state. | No icon language, weak brand mark, no account/help chrome, basic desktop-only rail, title/header feels like a wireframe. | High |
| Login | 5.5 | Clean, centered, readable, restrained. | Generic authentication card; admin/speaker purpose radios feel internal; visible logout for a logged-out/error state is confusing; no product or event personality. | Medium |
| Overview / readiness | 3.5 | Correct role start and useful overdue concept. | Vast empty canvas, no strong summary, charts, activity, progress, or “needs attention” composition. Current screen showed a raw “Authentication required” alert inside the shell. | Critical |
| CFP / form builder | 4.5 | Two-column editor/preview concept, field palette, conditions, sections, publish controls. | Too many cards and controls at once; little progressive disclosure; weak drag/reorder affordance; form status/IDs read like implementation detail; preview lacks realistic branded context. | High |
| Public CFP | 3.5 | Responsive single-column foundation, branded tokens, clear fields, 44px primary action. | Current live route failed to load and offered no retry or support path. Committed “success” evidence exposed debug colors and showed “No published CFP form,” making the proof itself look unfinished. | Critical |
| Submissions and decisions | 4.5 | Master/detail structure, filters, batch decisions, status badges, assignment and decision workflow. | Action toolbar is undifferentiated; table styling is minimal; bulk actions lack a mature sticky selection bar; detail hierarchy reads as raw fields/lists. | High |
| Evaluator queue | 5.0 | Sensible queue/detail layout and task focus. | Generic list-and-form composition; limited evidence of reading comfort, keyboard scoring speed, progress, or decision confidence. | Medium |
| Speakers | 4.5 | Search, paging/windowing, detail, tasks, and files are present. | Speaker identity is text-only; no avatar/headshot-led card, readiness summary, filter chips, saved views, or high-signal detail composition. | High |
| Schedule Studio | 5.5 | Best-conceived surface: tray, five views, tiles, conflict states, undo, keyboard path. | Visually still a basic grid of bordered boxes. It lacks the depth, track encoding, sticky time/room structure, spatial clarity, and polish shown in the design kits. | High |
| Communications | 2.5 | Trust-before-send stages and preview/send separation are correct. | Worst visual/scale surface. Template form, audience, send, delivery, and ICS are stacked serially; all 150 speakers render as a raw checkbox list; stray bullets appear; no search, grouping, virtualization, summary rail, or staged campaign flow. | Critical |
| Speaker portal | 5.0 | Mobile-aware, next-task concept, tasks/profile/files/sessions, branded tokens. | Mostly stacked generic cards and forms; little event identity, progress visualization, encouragement, or premium onboarding feel. | High |
| Event settings | 4.0 | Essential destinations and event creation/editing exist. | Long undifferentiated page, ISO date inputs and implementation-oriented language, weak settings IA and no strong section navigation. | High |
| Design Kit | 5.0 | Real token editing, logo, radius, wordmark, preview, draft/publish and contrast work. | Preview is essentially a wordmark/logo/button sample, not a convincing CFP/portal/email preview. Theme versioning, comparison, reset/revert, and cross-surface confidence are weak. | High |
| API keys / Airtable settings | 4.5 | Security concepts and status information are present. | Functional admin forms with limited risk hierarchy, onboarding, and explanation. Destructive/restricted scopes need more composed treatment. | Medium |
| Empty/loading/error/offline states | 2.5 | Basic skeleton/card/status classes exist. | Generic copy, little recovery, no diagnostic hierarchy, and authentication failures can remain inside an apparently authenticated shell. | Critical |
| Mobile admin | 3.0 | Individual grids collapse. | The 240px sidebar itself has no complete drawer/bottom-nav treatment; complex admin workflows are not deliberately adapted. | High |

## What the build got right

1. **It respected the light-default mandate.** The product is calm and legible at a basic level and avoids the rejected dark cockpit aesthetic.
2. **The core IA is coherent.** Overview, CFP/Forms, Submissions, Evaluations, Speakers, Schedule, Comms, and Settings match the product loop.
3. **Active event context is persistent.** This is essential for safe event operations.
4. **Status semantics are protected from event branding.** The brand/status separation and contrast logic are sound foundations.
5. **Several interaction contracts are genuinely thoughtful.** Trust-before-send, schedule conflicts/undo, public theming, role-specific starts, and optimistic portal tasks are good product decisions.
6. **The product has more functional depth than the visual surface suggests.** The design problem is therefore fixable without discarding the domain model.

## Where the synthesis was lost

### 1. Rich design directions were compressed into a shallow token lock

The source concepts contained full type scales, spacing scales, multiple elevations, shell compositions, real component anatomy, role surfaces, and realistic dashboard/schedule/form compositions. The implemented Lumen foundation has only five spacing tokens, one shadow, no type-size tokens, and no strong/interactive border scale.

Two undefined token references remain in `shell.css` (`--lumen-space-5` and `--lumen-radius`), which is a small but telling sign that the implemented system is less complete than the source kits.

### 2. Token compliance was mistaken for design quality

The Lumen tests prove that variables such as `--lumen-brand` and `--lumen-focus-ring` exist, that the build succeeds, and that navigation labels render. They do not prove visual hierarchy, density, alignment, meaningful states, or finish.

The design E2E tests mostly assert visibility and text content. A button can be visible, clickable, and technically tokenized while still looking unfinished. This is exactly what happened.

### 3. Visual regression was explicitly made optional

The design synthesis lists visual regression as optional. Both earlier advisories warned that leaving all visual screenshots optional would make the visual lock unverifiable. That warning was not converted into a blocking gate.

There is one committed public CFP screenshot, but it is treated as functional evidence rather than a visual-quality artifact. It contains implementation-facing brand values and an unavailable CFP form; a human design gate should have rejected it immediately.

### 4. A component checklist did not become a component library

The code has component-shaped CSS, but not a mature, shared product UI system. A 2,387-line page stylesheet supplies many page-specific classes, while `event-settings__*` and `eval-queue__*` styles are reused across unrelated screens. There are 393 references to those two generic namespaces across page code.

This produces consistency of color and padding, but not consistency of anatomy or interaction. Buttons, fields, lists, toolbars, statuses, dialogs, and data views are repeatedly assembled at page level.

### 5. The build optimized for test inventory rather than screen composition

The UI frequently reads like a visible map of backend capabilities and `data-testid` requirements. Controls exist because a journey needs to click them, but the surrounding job has not always been reorganized into the simplest human workflow.

Communications is the clearest example: every required capability is present, but the page is a vertical sequence of implementation panels rather than a campaign workflow.

### 6. Scale was tested functionally, not designed visually

The demo includes 150 speakers, but the communications audience exposes all of them as a long checkbox list. Scale proof became “the list contains 150 records” rather than “an operator can confidently target 150 people.”

### 7. The high-craft details disappeared

The source kits used logo marks, icons, avatar/headshot composition, stronger typographic contrast, richer elevation, intentionally warm/cool canvases, status-led objects, progress, charts, activity, and contextual toolbars. The implementation uses mostly text, thin borders, muted 12–14px copy, and identical white cards.

The UI is visually quiet, but not “quietly exceptional.” It is quiet because very little visual hierarchy was implemented.

## Specific design-system gaps

| Gap | Current condition | Required correction |
|---|---|---|
| Typography | Hard-coded page-level sizes; many 12–14px labels; no semantic type tokens. | Add display, page title, section title, body, compact UI, label, metadata, and numeric-stat tokens with line-height/tracking rules. |
| Spacing | Only 4/8/12/16/24px canonical tokens; source systems used broader intentional scales. | Add 20/32/40/48/64px values and page/container/gutter semantics. |
| Elevation | One subtle shadow for nearly everything. | Define rest, raised, sticky, popover, modal, and drag elevations. |
| Borders | One 8%-black border is too faint for many inputs and structural divisions. | Add subtle, control, strong, selected, and danger border tokens. |
| Controls | Native-looking radios/checkboxes and repeated button recipes. | Build shared accessible controls with consistent 40–44px targets and full state anatomy. |
| Icons | Navigation and actions are largely text-only. | Introduce one restrained icon set and icon-size/stroke tokens. |
| Data views | Basic tables/lists; no robust density, selection, sticky headers, saved filters, or virtualized audiences. | Build a shared DataTable/ListView system with compact/comfortable density. |
| Overlays | Modal/toast behavior is governed but not visibly central to the UI system. | Build and visually test modal, drawer, popover, toast, confirmation, and command feedback states. |
| Motion | One duration/easing pair; little designed feedback. | Define fast/standard/slow motion and drag/saving/success patterns, respecting reduced motion. |
| Responsive shell | Page grids collapse, but admin navigation does not fully transform. | Define desktop rail, tablet drawer, and mobile task-specific patterns. |

## Gap-closure plan

### Phase 0 — Re-baseline the visual direction

**Goal:** turn “Lumen” back into a screen-level product direction.

1. Adopt **Codex/Northstar composition** as the visual north star: warmer premium canvas, stronger scale contrast, dimensional but restrained surfaces, meaningful shell chrome.
2. Adopt **Claude/Greenroom system rules**: semantic tokens, progressive disclosure, state completeness, theme guardrails, and mandatory visual QA.
3. Retain **Grok/Program OS coverage**: component breadth, schedule patterns, role matrix, and operational completeness.
4. Produce six high-fidelity reference screens before implementation:
   - Overview/readiness
   - CFP builder
   - Submissions master/detail
   - Schedule Studio
   - Communications campaign workflow
   - Public CFP + speaker portal mobile pair
5. Require owner sign-off on those screens and freeze only their reusable anatomy—not every pixel.

**Exit gate:** the six screens score at least 8/10 in a documented owner/outsider taste review.

### Phase 1 — Replace the shallow foundation with a real UI system

Create shared primitives and compositions before reworking pages:

- Typography, spacing, elevation, border, container, density, icon, and motion tokens.
- `Button`, `IconButton`, `Field`, `Select`, `Checkbox`, `Radio`, `SearchField`, `Card`, `Status`, `Avatar`, `Tabs`, `Toolbar`, `DataTable`, `ListView`, `EmptyState`, `Skeleton`, `Toast`, `Dialog`, `Drawer`, and `SplitPane`.
- A component state sheet covering rest, hover, focus, pressed, selected, disabled, pending, success, warning, danger, validation, empty, offline, and permission denied.
- Token linting that fails on undefined Lumen variables and uncontrolled raw visual values.

**Exit gate:** fixed-viewport component state screenshots pass human review; no undefined tokens; AA contrast and keyboard behavior pass.

### Phase 2 — Recompose the shell and overview

- Give SpeakerOps a restrained mark and icon vocabulary.
- Add section-aware navigation, account/help area, clearer event context, and a tablet/mobile shell.
- Turn Overview into an operational dashboard:
  - readiness progress
  - overdue/blocked items
  - submission/evaluation/schedule summary
  - recent activity
  - quick actions
  - data freshness/error state
- Keep the page focused: one dominant “what needs attention now?” story.

**Exit gate:** a first-time operator identifies the event, primary risk, and next action in a five-second test.

### Phase 3 — Redesign the five critical workflows

#### Communications

- Convert the long page into a four-step campaign flow: **Template → Audience → Preview → Send/Delivery**.
- Replace 150 raw checkboxes with search, filters, segments, select-all rules, pagination/virtualization, and an always-visible audience summary.
- Move ICS into a contextual calendar action rather than a fixture-like form at the end of the email page.

#### CFP builder

- Use a three-part builder: section outline, canvas, property inspector, with a realistic preview mode.
- Hide conditions and advanced publishing controls until relevant.
- Use drag handles and clear insertion affordances, not only move-up/down buttons.

#### Submissions

- Add a serious data toolbar, sticky selection action bar, visible filter state, better row hierarchy, and a refined detail drawer/panel.
- Separate review/assignment/decision actions by stage and risk.

#### Schedule Studio

- Make it a full-height working surface with sticky time/room headers, clear track encoding, richer session tiles, and a persistent unscheduled tray.
- Make drag target, ghost, conflict, pending, saved, rollback, and undo visually unmistakable.

#### Public CFP and portal

- Give the public CFP an event-branded introduction, date/status context, section progress, stronger field grouping, autosave/draft messaging where applicable, and useful failure recovery.
- Give the portal a branded welcome, completion/progress model, stronger next-task card, and more celebratory completion states.

**Exit gate:** no critical surface scores below 7/10; communications remains usable with 150+ speakers; schedule and CFP are tested at desktop and mobile breakpoints.

### Phase 4 — Complete state, accessibility, and responsive design

- Design authentication expiry, network loss, stale data, permission loss, empty data, partial failure, and retry states as first-class screens.
- Never leave “Authentication required” inside an apparently usable admin shell; redirect or present a focused session-expired recovery panel.
- Give public failures a retry, status/support path, and preserved user input where relevant.
- Audit target sizes, focus order, dialog restoration, error summary, live regions, contrast, and text zoom.
- Define admin tablet/mobile rules instead of relying on individual grid collapse.

**Exit gate:** axe support checks plus manual keyboard journeys; no critical state without a recovery action; 200% text zoom and 390px public/portal layouts pass.

### Phase 5 — Make visual quality a blocking delivery gate

Add a small, stable screenshot suite at fixed data and viewports:

1. Lumen component state sheet
2. Admin overview
3. CFP builder
4. Public CFP desktop + mobile
5. Submissions selected/bulk-action state
6. Schedule drag/conflict/saved states
7. Communications audience + preview
8. Speaker portal desktop + mobile
9. Loading/empty/error/session-expired states

Each milestone should require:

- automated screenshot capture
- human approval of intentional diffs
- owner taste score
- accessibility/contrast results
- proof at realistic data volume

Functional E2E remains necessary, but it cannot substitute for this gate.

## Recommended delivery order

| Order | Work | Why first |
|---:|---|---|
| 1 | Visual re-baseline + six reference screens | Prevents another token-only redesign. |
| 2 | Component system and state sheet | Stops each page inventing its own anatomy. |
| 3 | Shell + Overview | Establishes the product’s first impression and shared composition. |
| 4 | Communications | Largest current usability and scale failure. |
| 5 | CFP builder + public CFP | Core acquisition workflow and external brand proof. |
| 6 | Submissions + evaluator | Core review/decision work. |
| 7 | Schedule Studio | Hero differentiator; worth a dedicated polish pass. |
| 8 | Speaker portal + settings | Completes role quality and admin confidence. |
| 9 | Cross-cutting states/responsive/a11y | Must be integrated throughout, then closed systematically. |
| 10 | Blocking visual regression and final taste review | Prevents the same gap from returning. |

## Acceptance score for closure

The design gap should not be called closed until all of the following are true:

- Weighted product score is **at least 8.0/10**.
- No primary surface is below **7.0/10**.
- Overview, Communications, Public CFP, and Schedule each score **8.0+**.
- A 150-speaker communications audience is searchable, filterable, and operable without a 150-row raw checkbox scroll.
- Public CFP failure and session-expired states provide a clear recovery path.
- Every shared component state is visible in a reviewed state sheet.
- Fixed-view screenshot tests cover the nine critical visual artifacts above.
- Owner and one fresh observer pass the five-second hierarchy test on every primary surface.
- Task benchmarks are measured against a competitor on equivalent data, not inferred from test pass counts.

## Final conclusion

The project has a sound product skeleton and a salvageable visual foundation. It does not need a cosmetic reskin; it needs a **screen-composition and workflow-design pass backed by a real component system and visual acceptance gates**.

The shortfall is best summarized this way:

> The concepts designed a product. The implementation styled a feature inventory.

Closing the gap means returning to the original promise—Northstar craft, Greenroom system rigor, and Program OS completeness—and making human visual review as binding as functional E2E.
