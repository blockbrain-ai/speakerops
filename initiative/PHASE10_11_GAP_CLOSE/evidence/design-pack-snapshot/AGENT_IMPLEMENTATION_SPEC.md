# SpeakerOps Lumen 2 — binding implementation specification

Status: reference candidate  
Applies to: `apps/web`  
Visual authority: `design-pack/index.html`  
UX/IA authority: `UX_INFORMATION_ARCHITECTURE.md` + `page-atlas.json`  
Rationale: `../SPEAKEROPS_DESIGN_AUDIT.md`

This document is an execution contract for implementation agents. It is not a
list of optional design ideas. Where existing product code conflicts with this
pack, preserve product behavior and data first, then migrate the presentation
to Lumen 2. Do not reinterpret the visual language route by route.

## 1. Authority order

When two references appear to disagree, use this order:

1. Accessibility, safety, and truthful system state.
2. This implementation specification.
3. The six canonical screens in `index.html`.
4. Component anatomy and states in `components.css`.
5. Semantic values in `tokens.css`.
6. Existing route presentation.

Product behavior, permissions, validation, and data contracts are not replaced
by this pack. Reference content is illustrative; reference structure and state
handling are binding.

## 2. Product character

Lumen 2 must feel calm, deliberate, editorial, operational, and trustworthy.
It must not feel like a dark command centre, an analytics template, a marketing
landing-page kit, or a collection of unrelated cards.

The synthesis is explicit:

- Northstar contributes composition, negative space, warm neutrals, and premium
  public moments.
- Greenroom contributes semantic tokens, progressive disclosure, complete
  states, theming boundaries, and visual verification.
- Program OS contributes role coverage, operational density, scheduling, and
  workflow completeness.

## 3. Surface modes

| Mode | Routes | Visual behaviour |
|---|---|---|
| Admin | `/admin/**` | Neutral Lumen shell; indigo action color; compact-capable density |
| Evaluator | evaluation queue and review | Neutral shell; low distraction; one proposal and decision context at a time |
| Public event | `/cfp/**`, public program routes | Event brand may replace action mapping inside `.l2-brand-scope` only |
| Speaker portal | `/portal/**` | Event branded, mobile-first, action-oriented, no admin chrome |

Never theme success, warning, danger, or information colors. Never allow an
event theme to change admin navigation, evaluator decisions, focus semantics,
or status meaning.

## 4. Existing stack and source architecture

This pack has been checked against the current frontend. The implementation
target is the existing React 18 + React DOM 18 + React Router 6 + Vite 5 +
TypeScript application. Its only application runtime dependencies are React,
React DOM, React Router, and the first-party `@speakerops/shared` workspace
package.

**Dependency rule:** Lumen 2 requires no new runtime package. Do not add a UI
kit, icon package, CSS-in-JS runtime, chart package, form package, animation
package, state manager, date library, drag-and-drop package, or font package as
part of the visual migration. The reference pack itself is dependency-free.

Extend or map the current structure before migrating pages:

```text
apps/web/src/
  styles/
    lumen.css             ← retain the ratified --lumen-* contract; extend here
    shell.css             ← shell composition during incremental migration
    components.css        ← shared Lumen 2 component rules if useful
  components/ui/
    Icon.tsx              ← first-party typed 24px paths; no icon dependency
    Button.tsx
    Field.tsx
    Badge.tsx
    Card.tsx
    Alert.tsx
    Modal.tsx
    DataTable.tsx
    EmptyState.tsx
    PageHeader.tsx
  layout/
    AdminShell.tsx        ← existing route shell, migrated in place
```

The final directory split may follow current project conventions, but it does
not justify duplicating styles inside pages. Shared components own visual
states; routes own data, orchestration, and domain copy.

### 4.1 Supply-chain and security fit

- Use existing React hooks and native HTML controls.
- Keep the existing native HTML5 drag implementation in `FormBuilder.tsx` and
  `schedule/ScheduleStudio.tsx`; add keyboard movement using local code.
- Build small charts with CSS/accessible text. Do not add a charting package.
- Implement the icon set as reviewed first-party SVG paths or a same-origin
  static sprite. This is application-authored UI, not user-uploaded event SVG.
- Continue rejecting uploaded SVG logos as required by the Lumen security lock.
- Use the current text/sanitisation boundaries. Do not render freeform HTML.
- Preserve the shared Content Security Policy. Do not loosen it for styles,
  fonts, scripts, or assets.
- Keep deterministic Playwright/Vitest coverage and the existing inventory
  tags when markup changes.
- Run `pnpm run audit:deps` even when no dependency is added, and require an
  explicit owner/security decision before any future dependency proposal.

If a future feature genuinely needs a package, the agent must first document
why native/local code is insufficient, maintenance and transitive-dependency
risk, lockfile change, CSP impact, bundle impact, licence, audit result, and an
exit strategy. That review is outside the visual migration by default.

## 5. Token contract

### 5.1 Required rule

The ratified `--lumen-*` variables in `apps/web/src/styles/lumen.css` remain the
application source of truth. The `--l2-*` vocabulary in this standalone pack is
an expanded semantic authoring layer that aliases the ratified values. During
adoption, merge required semantic aliases into the existing Lumen file or map
components directly to existing variables; do not install a parallel theme and
do not silently change governance-frozen values. Raw colors may appear only in
the governed token layer. A new raw hex in a page or component fails review.

Any intentional change to a frozen value requires the normal governance
amendment before implementation. Layout, hierarchy, and component-state
improvements can land without changing the frozen palette.

### 5.2 Color roles

| Role | Token | Required use |
|---|---|---|
| App background | `--l2-canvas` | Route canvas and working background |
| Primary surface | `--l2-surface` | Cards, forms, rails, menus |
| Primary text | `--l2-text` | Titles and important values |
| Secondary text | `--l2-text-secondary` | Explanatory copy |
| Tertiary text | `--l2-text-tertiary` | Metadata, timestamps, hints |
| Action | `--l2-action` | Primary controls, selected state, links |
| Border | `--l2-border` | Major surface separation |
| Subtle border | `--l2-border-subtle` | Rows and internal grouping |

Do not use action color as decoration on non-interactive surfaces. Do not use
status colors to style general cards.

### 5.3 Typography

- Product/UI family: the existing `--lumen-font` stack (Inter when available,
  then platform UI fonts).
- System values: the declared platform monospace stack.
- Do not add a font package, runtime loader, or new third-party request.
- Use only semantic type tokens. Avoid arbitrary local sizes.
- Page titles are sentence case, 32px at desktop, and never all caps.
- Eyebrows are optional context, not a required decoration on every card.
- Body copy should remain 46rem or narrower when it is meant to be read.

See `FONT_SPEC.md` for loading, weights, and fallbacks.

### 5.4 Space and geometry

- Four-pixel base scale.
- Default control height: 40px. Small: 32px. Large: 46px.
- Default surface radius: 14px. Major public surfaces: 20–28px.
- Round radii are limited to avatars, status dots, switches, and pills.
- A border is the default separator. Shadow indicates actual elevation.
- Do not combine a heavy border and a heavy shadow on the same surface.

## 6. Icon contract

- Viewbox: `0 0 24 24`.
- Stroke: 1.75px, round caps, round joins.
- Default visible size: 20px; small: 16px; large: 24px.
- Use the semantic names in `icons.svg`. Do not introduce a second icon style.
- Familiar icon-only controls require an accessible name and a tooltip in the
  product implementation.
- Unfamiliar or consequential actions retain a text label.
- Do not use emoji, filled pictograms, or text glyphs as product icons.
- Directional icons must respect locale if RTL support is added.

## 7. Component requirements

Every interactive component must implement default, hover, focus-visible,
pressed, disabled, and pending where an action may be asynchronous.

### Button

- Variants: primary, secondary, quiet, danger, success only when the action
  itself confirms a successful decision.
- One primary button per decision region.
- Destructive buttons may be quiet in menus, but become danger-styled in the
  confirmation step.
- Pending buttons retain their width, show progress, and prevent duplicate
  submission.
- Icon-only buttons are always square with a minimum 40px target on touch.

### Field

- Visible label is mandatory. Placeholder text is never the only label.
- Required state is expressed in text or programmatically, not by an asterisk
  without explanation.
- Hint and error occupy the same location to prevent layout ambiguity.
- Error messages state how to recover. “Invalid input” is unacceptable.
- Server errors persist until corrected or explicitly dismissed.
- Textarea resize must not destroy the surrounding layout.

### Badge and chip

- Badge is read-only state. Chip is a filter or removable selection.
- Both carry text; a dot may reinforce but never replace it.
- Status vocabulary is fixed per domain. Do not show “Approved” on one screen
  and “Accepted” for the same state on another.

### Card

- A card must express a meaningful unit, not compensate for weak page grouping.
- Nested cards are prohibited unless the inner element is a domain object such
  as a session tile.
- Card headers align title/context left and one local action right.

### Data table

- Column headers are concise and describe the cell values beneath them.
- The primary column contains the record title and stable secondary identifier.
- Selection reveals a bulk-action bar without shifting the table horizontally.
- Row action menus are the final column and have record-specific accessible
  names.
- Horizontal scroll is allowed at narrow widths; critical identity remains the
  first visible data column.
- Pagination states range and total. Virtualisation is required when the real
  data volume makes full rendering slow.

### Alert and toast

- Inline alert: persistent information requiring understanding or action.
- Toast: non-critical confirmation after an action; it must not be the only
  record of failure.
- Partial failure states state successes, failures, and next available action.
- Never replace an error with a raw exception, stack trace, or status code.

### Modal

- Use only when the background task must pause.
- Focus enters the modal, remains trapped, and returns to the trigger.
- Escape and an explicit cancel control close non-destructive modals.
- Confirmation names the object and explains the consequence.
- Irreversible actions require a stronger confirmation proportional to risk.

## 8. Canonical screen specifications

### 8.1 Admin overview `/admin`

Purpose: answer “Is the program on track, and what needs me now?”

Required order:

1. Program context and concise greeting.
2. Four high-value stats: submissions, evaluations, speakers, schedule.
3. Readiness model with named dimensions.
4. Ranked attention queue with direct next actions.
5. Trend or activity only after actionable content.

Do not fill the route with placeholder cards. A metric without interpretation
or action should not appear. Empty programs replace metrics with a guided setup
sequence.

### 8.2 CFP builder `/admin/cfp`

Purpose: create a structured public form without exposing internal schema.

Desktop composition: outline, central form canvas, contextual inspector.
Tablet: outline plus canvas, inspector as a drawer. Mobile: canvas plus drawers.

Required behaviour:

- Drag handles are supplemented by keyboard move actions.
- Selection is visible on the canvas and synchronised with the inspector.
- Autosave states: saving, saved with time, failure with retry.
- Preview uses actual public rendering and current event theme.
- Publishing shows changed fields and affected live form before confirmation.
- Field deletion names the field and explains response-data implications.

### 8.3 Submissions `/admin/submissions`

Purpose: find, compare, evaluate, and change proposal state.

Use a table plus detail pane on desktop. On mobile, selecting a row opens a
full-screen detail route or sheet with a clear back action. Preserve search and
filter state when returning.

Required states: no submissions, no filter results, loading, permission error,
partial metadata failure, selected row, multi-selection, and bulk-action
result.

### 8.4 Evaluations

Purpose: complete decisions with minimal cognitive switching.

- Evaluator queue shows assignment status, due date, conflict state, and
  completion progress.
- Review view keeps proposal evidence, rubric, notes, and progress visible.
- Save is resilient. A temporary network failure must not discard written
  notes or selected scores.
- Conflicts of interest are first-class and never buried in a general menu.

### 8.5 Speakers `/admin/speakers`

Purpose: turn accepted proposals into confirmed, program-ready people.

- Separate acceptance, confirmation, profile, travel, and session readiness.
- Do not collapse them into one vague status.
- Bulk communication acts on an explicit, previewed audience.
- Speaker detail shows contact, sessions, tasks, communication history, and
  internal notes in a stable structure.

### 8.6 Schedule Studio `/admin/schedule`

Purpose: construct a valid program and understand conflicts before publishing.

Required composition: unscheduled tray, date/view toolbar, room/time grid,
conflict summary, save/publish state.

- Dragging is never the only input method.
- Conflicts appear on the affected session and in a navigable summary.
- The conflict explanation names the speaker, room, capacity, or travel rule.
- Undo/redo applies to placement and duration changes.
- Publishing confirms event/date scope, public impact, and unresolved warnings.
- Mobile may use a day agenda editor rather than compressing the full grid.

### 8.7 Communications `/admin/comms`

Purpose: contact the correct audience with visible consequences.

Replace raw recipient checkbox walls with a four-step sequence:

1. Audience — human-readable rules, live count, sample recipients, exclusions.
2. Message — subject, body, variables, sender, reply-to, and personal preview.
3. Review — exact recipient total, suppressed/bounced contacts, schedule/time
   zone, and test-send evidence.
4. Send — explicit confirmation, progress, completion, and partial failures.

For 150 recipients, show 25 at a time or virtualise. Never render an ungrouped
150-checkbox wall as the primary audience tool.

### 8.8 Settings `/admin/settings/**`

- Use a settings index with named categories.
- Each page has one save region, clear dirty state, success confirmation, and
  navigation protection for unsaved changes.
- API keys are shown only at creation, with copy and revocation flows.
- Integration status translates technical failure into impact and recovery.

### 8.9 Public CFP

Purpose: earn trust and help a speaker submit a strong proposal.

- Event identity and deadline are visible before the form.
- State estimated effort, available formats, save-and-return behaviour, and
  selection expectations.
- Divide fields into meaningful steps with progress and draft persistence.
- CAPTCHA or service failure must preserve entered content and offer recovery.
- Submission confirmation states what was received and what happens next.

### 8.10 Speaker portal `/portal/**`

Purpose: give each speaker a clear next action and trustworthy event record.

- Mobile-first. No admin side rail.
- Home order: participation state, next action, session record, key dates,
  travel/program updates.
- Do not expose internal IDs, raw task types, or admin-only status vocabulary.
- Profile completion explains why each requested item is public or private.

## 9. Responsive contract

Required verification widths are 1440×1000, 834×1112, and 390×844.

| Width | Required adaptation |
|---|---|
| ≥1200px | Full admin rail; side-by-side operational panes; schedule grid |
| 768–1199px | Narrower or collapsible rail; inspector/detail may become drawer |
| <768px | No persistent rail; single-column page flow; actions remain reachable |
| <480px | Full-width primary actions where useful; safe 16px page inset |

Responsive design is not “stack every column.” Preserve task priority:
secondary metadata may move or collapse; the object identity, state, and next
action remain visible.

No horizontal viewport overflow is allowed. Controlled horizontal scrolling
inside a table or schedule board is allowed when labelled and usable.

## 10. Content contract

- Use sentence case everywhere except true proper nouns.
- Prefer “Save changes” over “Submit” when the result is a save.
- Prefer “Couldn’t save changes” over “Error 500.”
- Buttons use verbs and describe the immediate result.
- Empty states describe the benefit of the missing object and offer one next
  step.
- Dates include timezone when the audience may span zones.
- Counts include the noun: “42 recipients,” not a bare “42.”
- Avoid “Are you sure?” without naming the action and consequence.

## 11. Accessibility contract

Target WCAG 2.2 AA.

- All functions work by keyboard, including builder reordering and schedule
  placement.
- Focus-visible treatment uses the Lumen token and is never removed.
- Page, region, navigation, table, form, and dialog landmarks are meaningful.
- Heading order reflects the visible hierarchy.
- Fields have labels, descriptions, errors, and programmatic required state.
- Status changes are announced at appropriate politeness.
- Minimum touch target is 44×44px in public and portal surfaces.
- Text meets 4.5:1; large text and essential UI meet 3:1.
- Reduced-motion preferences remove non-essential movement.
- Zoom to 200% retains content and operation without two-dimensional page
  scrolling.

## 12. State matrix

Every migrated route must prove these states before approval:

| Dimension | Required fixtures |
|---|---|
| Volume | zero, one, typical, maximum supported |
| Network | first load, refresh, mutation pending, success, failure, retry |
| Permission | full access, read-only, forbidden |
| Content | short, long, missing optional field, unusual characters |
| Selection | none, one, many, all-page, all-results where supported |
| Domain | normal, warning, blocked/conflict, completed/archived |

Mock data must be deterministic so visual diffs are meaningful.

## 13. Route migration order

1. Adopt tokens and font loading.
2. Build Icon, Button, Field, Badge, Card, Alert, Modal, and PageHeader.
3. Migrate `AdminShell.tsx`; retain current routes and permissions.
4. Migrate `Readiness.tsx` and use it to settle page composition.
5. Migrate `Submissions.tsx`, `AdminEvaluations.tsx`, and
   `EvaluatorQueue.tsx` to settle data density and decision state.
6. Migrate `FormBuilder.tsx` and `components/forms/FormPreview.tsx`.
7. Migrate `schedule/ScheduleStudio.tsx`.
8. Migrate `Comms.tsx` and replace raw recipient selection.
9. Migrate `Speakers.tsx` and settings routes.
10. Migrate `PublicCfp.tsx`, public program routes, and portal routes inside the
    event-brand scope.
11. Retire obsolete page-level visual rules from `styles/lumen.css` and
    `styles/shell.css` only after their consumers are migrated.

Do not combine a broad visual migration with data-contract changes unless the
feature itself requires them. Keep reviewable seams.

## 14. Pull-request evidence

Every migration pull request must include:

- Before and after screenshots at affected required widths.
- Canonical screen shown alongside the result.
- A state matrix listing fixtures exercised.
- Keyboard test notes.
- Automated accessibility result and any justified exception.
- Test commands and results.
- Confirmation that raw color and page-specific component duplication were not
  introduced.

## 15. Rejection conditions

Reject an implementation if any of these are true:

- It resembles the current route more than the canonical composition without a
  documented product reason.
- It introduces a new bespoke button, field, badge, modal, or table style.
- It applies event branding to admin or semantic states.
- It presents a long unstructured checkbox wall.
- It handles only the happy path.
- It hides failure in a transient toast.
- It uses placeholder or debug content in approval screenshots.
- It requires a pointer for a critical workflow.
- It is not visually reviewed at desktop and mobile widths.

## 16. Definition of done

A route is Lumen 2 only when its composition, shared components, content,
responsive behaviour, state coverage, accessibility, and visual proof all pass.
Changing colors and radii alone is not a migration.
