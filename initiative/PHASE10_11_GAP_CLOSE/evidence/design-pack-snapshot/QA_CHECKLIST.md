# SpeakerOps Lumen 2 — design and experience QA checklist

Use this checklist for each migrated route and for changes to shared design
system components. A pass requires evidence, not an unchecked assertion.

## 1. Reference fidelity

- [ ] The implemented route is compared side by side with its canonical screen.
- [ ] Information order and dominant action match the reference.
- [ ] Any intentional difference is documented with a product or technical
      reason, not personal preference.
- [ ] Existing product behavior and permissions remain intact.
- [ ] The route feels part of the same system as already-migrated routes.

## 2. Token integrity

- [ ] No raw hex, RGB, HSL, named color, arbitrary shadow, or one-off radius was
      introduced outside the token layer.
- [ ] Admin and evaluator surfaces use the neutral Lumen mapping.
- [ ] Event branding exists only inside `.l2-brand-scope`.
- [ ] Success, warning, danger, and information semantics do not retheme.
- [ ] Spacing aligns to the four-pixel scale.
- [ ] Control heights use small, default, or large tokens.
- [ ] Shadows correspond to actual elevation.

Suggested source checks:

```sh
rg '#[0-9a-fA-F]{3,8}|rgb\(|hsl\(' apps/web/src \
  --glob '!**/styles/lumen.css'
rg 'style=|borderRadius|boxShadow' apps/web/src/pages apps/web/src/components
```

Review results; generated charts or genuinely dynamic values may need a narrow
exception, but convenience is not an exception.

## 3. Typography and content

- [ ] The existing `--lumen-font` stack is used with no new package or runtime
      font request.
- [ ] There is one page title and heading order is logical.
- [ ] Sentence case is used consistently.
- [ ] Body and metadata sizes use semantic tokens.
- [ ] Long-form copy stays within a readable measure.
- [ ] Buttons describe their immediate result.
- [ ] Dates include timezone where the audience may span zones.
- [ ] Counts include the noun they count.
- [ ] Empty, warning, and error copy explains the next action.
- [ ] No debug labels, raw IDs without context, lorem ipsum, or test content is
      visible.

## 4. Components and interaction

For each control present:

- [ ] Default state is clear.
- [ ] Hover state is visible without changing layout.
- [ ] Focus-visible state is high contrast and not clipped.
- [ ] Pressed/selected state is distinct from hover.
- [ ] Disabled state explains why when the reason is not obvious.
- [ ] Pending state prevents duplicate action and retains control width.
- [ ] Success is confirmed in context.
- [ ] Failure preserves user work and offers recovery.

Additional checks:

- [ ] Only one primary action appears in each decision region.
- [ ] Icon-only controls have an accessible record-specific name.
- [ ] Consequential actions name the object and preview consequences.
- [ ] Destructive actions require confirmation proportional to risk.
- [ ] Modals trap focus, close appropriately, and restore focus.
- [ ] Popovers and menus dismiss without losing unsaved work.
- [ ] Toasts are not the sole place where a failure is recorded.

## 5. Forms

- [ ] Every field has a visible label.
- [ ] Required and optional status is unambiguous.
- [ ] Help text precedes the error location and is programmatically associated.
- [ ] Error copy identifies the problem and recovery.
- [ ] Invalid focus moves only when submission requires it.
- [ ] Server-side validation appears at field and summary level as appropriate.
- [ ] Entered data survives failed submission, refresh where supported, and
      CAPTCHA/service failure.
- [ ] Character limits state the limit and remaining/used count.
- [ ] Uploads state type, size, progress, completion, and failure.
- [ ] Save-and-return behavior is truthful.
- [ ] Unsaved-change protection works across route navigation.

## 6. Data and operational scale

Exercise deterministic fixtures for:

- [ ] Zero records.
- [ ] One record.
- [ ] Typical program volume.
- [ ] Maximum supported volume.
- [ ] Very long record titles and names.
- [ ] Missing optional data.
- [ ] Mixed status values.
- [ ] Partial backend failure.

Verify:

- [ ] Tables remain scannable and sort/filter state is visible.
- [ ] Search announces result count or empty result.
- [ ] Selection and bulk-action scope are explicit.
- [ ] “Select all” distinguishes current page from all results.
- [ ] Pagination states visible range and total.
- [ ] Large lists are paginated or virtualised.
- [ ] The communications audience is rule-based with a live, inspectable count.
- [ ] Partial send results distinguish delivered, suppressed, bounced, and
      retryable contacts.

## 7. Workflow-specific gates

### Overview

- [ ] Attention items are ranked and actionable.
- [ ] Readiness dimensions match the real program model.
- [ ] Metrics include interpretation or a decision.
- [ ] New programs receive setup guidance rather than empty metrics.

### CFP builder

- [ ] Reordering works with keyboard and pointer.
- [ ] Canvas selection and inspector remain synchronised.
- [ ] Autosave proves saving, saved, failure, and retry.
- [ ] Preview uses the actual public component path.
- [ ] Publish confirmation describes live impact.

### Submissions and evaluations

- [ ] Search/filter state survives opening and closing details.
- [ ] Record state, assignment, score, and conflicts are not conflated.
- [ ] Review notes survive network interruption.
- [ ] Conflict-of-interest flow is explicit.

### Schedule Studio

- [ ] Sessions can be placed without drag and drop.
- [ ] Conflicts identify the exact cause and affected objects.
- [ ] Undo and redo cover placement and duration changes.
- [ ] Mobile provides a usable agenda editor or equivalent.
- [ ] Publish confirmation includes unresolved warnings and public impact.

### Communications

- [ ] Audience rules are readable in plain language.
- [ ] Recipient count updates and samples can be inspected.
- [ ] Suppressed and bounced contacts are visible before send.
- [ ] Personalisation is previewed with a real representative recipient.
- [ ] Test send, scheduling timezone, and reply-to are verified.
- [ ] Progress and partial failure are durable and actionable.

### Public CFP and portal

- [ ] Event identity, deadline, effort, and save behavior are visible early.
- [ ] Public forms retain data through service errors.
- [ ] Completion explains what happens next.
- [ ] Portal exposes one clear next action.
- [ ] Internal IDs and admin vocabulary are not leaked.

## 8. Responsive visual review

Capture fixed-data screenshots at:

- [ ] Desktop: 1440×1000.
- [ ] Tablet: 834×1112.
- [ ] Mobile: 390×844.

At every width verify:

- [ ] No viewport-level horizontal overflow.
- [ ] Safe page insets remain at least 16px on mobile.
- [ ] Navigation is reachable and current location is clear.
- [ ] Primary record identity, status, and next action remain visible.
- [ ] Sticky controls do not cover focused fields or system messages.
- [ ] Tables and schedule boards scroll only within their named region.
- [ ] Dialogs fit the viewport and their actions remain reachable.
- [ ] On-screen keyboard does not block the active mobile field/action.
- [ ] 200% browser zoom remains usable.

## 9. Accessibility

- [ ] Automated WCAG 2.2 AA scan has no serious or critical violations.
- [ ] Complete keyboard-only walkthrough succeeds.
- [ ] Focus order follows visible reading and task order.
- [ ] Focus is always visible and never trapped outside a modal.
- [ ] Landmarks and accessible names are specific.
- [ ] Heading levels are logical.
- [ ] Form fields expose label, hint, required, invalid, and error relationships.
- [ ] Tables expose headers and row selection.
- [ ] Status does not depend on color alone.
- [ ] Live regions announce saves, loading completion, and errors without noise.
- [ ] Reduced motion removes non-essential transitions.
- [ ] Touch targets meet 44×44px on public and portal surfaces.
- [ ] Text contrast is at least 4.5:1; large text and UI boundaries meet 3:1.
- [ ] Screen-reader walkthrough is completed for the primary journey.

## 10. Performance and resilience

- [ ] Font files are subset/served efficiently and do not block rendering.
- [ ] Icons are local SVGs, not separate network image requests per row.
- [ ] Large data does not freeze input or scrolling.
- [ ] Skeletons approximate final layout and do not create large shifts.
- [ ] A slow request communicates progress without implying failure.
- [ ] Retry is scoped to the failed operation.
- [ ] Offline/transient failure preserves authored content where practical.

## 11. Stack and supply-chain safety

- [ ] `apps/web/package.json` has no new runtime dependency for UI, icons,
      charts, forms, animation, state, drag-and-drop, or fonts.
- [ ] First-party SVG symbols are referenced from the local sprite; user SVG
      upload remains rejected by the existing validation boundary.
- [ ] Current CSP and security headers remain intact.
- [ ] Native HTML, CSS, React, and browser APIs are preferred for the reference
      interactions in this pack.
- [ ] `pnpm run audit:deps` passes in the implementation repository.
- [ ] Any dependency exception identifies owner, version pinning, integrity and
      provenance checks, transitive surface, update policy, and removal path.

## 12. Pull-request evidence

- [ ] Before/after/canonical screenshots are attached.
- [ ] State-fixture matrix is attached.
- [ ] Keyboard and screen-reader notes are attached.
- [ ] Automated test and accessibility results are attached.
- [ ] Responsive screenshots use the required fixed dimensions.
- [ ] Known differences and remaining debt are named.
- [ ] `apps/web/package.json` is unchanged, or the approved dependency exception
      and supply-chain review are attached.
- [ ] A designer/product owner or designated visual auditor has rated the result
      against the same rubric used in `SPEAKEROPS_DESIGN_AUDIT.md`.

## 13. Final approval

The route is approved only when:

- [ ] It meets the product task, not merely the visual style.
- [ ] Shared-system reuse is evident.
- [ ] The normal, edge, loading, empty, and failure states are credible.
- [ ] Desktop and mobile composition are both intentional.
- [ ] Accessibility blockers are zero.
- [ ] The visual reviewer rates it at least 8.0/10 with no individual critical
      category below 7.0.
