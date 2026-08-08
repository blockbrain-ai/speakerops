# SpeakerOps / Lumen design advisory

## 1. Verdict

**REVISE**

The product judgment is sound: Lumen should remain the light-default design system; the six-workflow program loop is the right scope; role-specific starts, trust-before-automation, schedule-as-hero, and token-only theming are strong foundations. No soul test should be removed or softened.

The revision is needed before design freeze because the current document is a visual direction plus component list, not yet an implementation-grade interaction system. Its navigation omits a required workflow, accessibility is asserted but not specified, arbitrary event branding can break contrast, and the browser inventory cannot currently satisfy its own 1:1 traceability law. This is a tightening pass, not a redesign, and it introduces no execute or deploy scope.

## 2. MUST_FIX

1. **Make the information architecture match the product loop.** The admin chrome has no Forms/CFP destination even though the form builder is a primary workflow. Define the route hierarchy for Events, CFP/Forms, evaluation configuration, task templates, rooms/tracks, and event settings; show which controls are event-scoped versus account-scoped. The active event must remain unmistakable on every mutating admin surface.

2. **Specify Lumen as behavior, not only tokens.** Add normative states for focus-visible, hover, pressed, selected, disabled, pending, success, warning, destructive confirmation, validation, empty, offline, and permission denial. Define keyboard order, dialog focus return/trapping, error-summary behavior, live-region announcements, reduced-motion behavior, minimum target size, and non-color status cues. These are required to make “accessibility as behavior” testable.

3. **Protect contrast under user branding.** A free-choice brand hex cannot be assumed safe with white text, focus rings, or soft tints. Design Kit publish must validate the effective foreground/background pairs, derive a safe foreground where possible, and block an inaccessible combination where it cannot. Status colors must remain locked and must also carry text/icon meaning.

4. **Write the Schedule Studio interaction contract.** Define the shared placement model across list/day/week/track/room views; time granularity and snapping; the unscheduled tray; selected, ghost, valid-drop, conflict, saving, rollback, and saved states; plain-language conflict placement; keyboard parity; undo semantics; timezone/DST display; and stale-write handling. A valid move must visibly persist across views and reload. This preserves S-SCHED without introducing an auto-scheduler.

5. **Finish the trust contract for communications and calendar.** Preview is mandatory, not conditional: it must expose the exact audience, count, rendered personalization, missing merge fields, and attachment/calendar effect. Any audience or template edit must invalidate the prior preview. The UX and proof must cover stable ICS UID plus update/cancel sequence behavior, not merely attaching one initial `.ics` file.

6. **Harden Design Kit publication and logo handling.** Reconcile the promised controls across UI and CLI—brand color/tint, logo, radius, and wordmark—and define draft, publish, failure, and revert states. Uploaded logos must be delivered as inert image assets with enforced MIME/CSP rules; SVG must be rejected unless the chosen sanitizer and serving path are explicitly proven safe. Raw CSS, HTML, JavaScript, and active same-origin content remain forbidden.

7. **Repair E2E inventory traceability before calling it exhaustive.** Section M is neither a normal inventory table nor a clean cross-reference: it duplicates journeys, omits the standard `test_id` and negative columns, and introduces uncovered anchors such as rubric editing and task templates. Convert unique settings interactions into full inventory rows; make the remainder an explicitly non-counted coverage matrix. Then calculate the total from canonical rows rather than maintaining an approximate hand count.

8. **Make authorization proof systematic.** The synthesis promises UI actions across allowed and denied roles, while the inventory samples only a few denials. Add a role/event isolation matrix mapped to browser journeys for every shipped privileged surface, including cross-event access and hidden-control plus server-denial proof. Control absence alone is not authorization evidence.

## 3. SHOULD

- Add spacing, density, elevation, responsive, table, form-layout, and content-width tokens so different builders do not produce visually related but structurally inconsistent screens.
- Define a compact vocabulary for statuses and actions. In particular, distinguish submission status, evaluation state, session scheduling state, speaker readiness, and delivery state rather than reusing a generic badge language.
- Replace “speed as brand” with measurable interaction expectations for navigation, optimistic updates, polling freshness, drag feedback, and error recovery. The user must always know whether an optimistic mutation is pending, saved, or rolled back.
- Require a small visual-regression set for Lumen’s light default, the component state sheet, public CFP theming, Schedule Studio, and communications preview. Making all screenshots a gate would be brittle; leaving every screenshot optional makes the visual lock unverifiable.
- Define admin desktop density and the supported narrow-screen fallback explicitly. Public CFP and speaker portal should remain excellent on mobile; any intentionally desktop-first Schedule Studio limitation should be stated rather than discovered in QA.
- Keep dangerous or irreversible actions visually quiet until the final confirmation, then explicit. Bulk decisions, sends, key revocation, and theme publication need consequence-focused copy and a reliable cancel path.
- Make event context switching resistant to accidental cross-event work: persistent event identity, unsaved-change handling, and a clear post-switch landing state.

## 4. NIT

- Indigo, teal, green, and blue create a crowded semantic palette. Reserve teal for a named product meaning or use it sparingly so it does not compete with success and info.
- Use pill geometry selectively. A pill primary button everywhere can make dense admin surfaces feel promotional; the radius scale already supports quieter rectangular actions.
- Twelve-pixel all-caps overlines should be sparse and letter-spaced enough to remain readable.
- “Apple-level” and “beautiful” are useful ambition statements but poor acceptance criteria. Keep them as tone, then judge against the explicit state, spacing, motion, contrast, and performance contracts.
- “Design Kit” may read as an internal component library. If user testing shows confusion, “Brand” or “Appearance” can be the navigation label while Lumen remains the system name.

## 5. Browser-E2E gaps

The current inventory is an excellent scope-control mechanism, but it is not yet exhaustive enough for S-E2E-INV or S-E2E-RUN.

- **Shared chrome is absent:** sidebar destinations, active-event switch behavior, tabs, dialogs, confirmation flows, toast/retry behavior, and any shipped search/sort/pagination controls need canonical coverage rather than being implicitly exercised.
- **Design Kit is incomplete:** add radius and wordmark controls, contrast rejection/foreground derivation, draft discard/revert, publish failure, unsafe-logo payload handling, and proof that draft tokens do not leak before publish.
- **Authentication is too narrow:** cover expired links, expired sessions, cross-event isolation, and a privileged mutation after loss of authorization. Magic-link replay alone does not cover the session lifecycle.
- **Settings rows are structurally invalid:** rubric editing, task templates, rooms/tracks, and Airtable status need proper IDs, roles, surfaces, journeys, test IDs, negatives, and statuses. Cross-references should not count as independent journeys.
- **Form and decision safety needs concurrency/error proof:** cover publish failure without losing edits, stale/version-conflicted edits, double-click/retry idempotency for decisions, and the visible recovery state. These tests should follow the already-locked command/version model.
- **Schedule proof stops too early:** after a valid placement, assert persistence after reload and parity in every committed view; cover rejected-drop rollback, stale-write conflict, focus restoration after keyboard movement, and undo’s actual boundary.
- **Communications proof contradicts the UX law:** J03’s “if product requires” must become an unconditional block. Add preview invalidation, unresolved merge fields, double-click/network-retry send safety, and ICS update/cancel lifecycle with stable UID and increasing sequence.
- **Accessibility coverage is only sampled:** A08, F04, and I09 are insufficient. Add critical-path keyboard/focus tests for public CFP, evaluator, speaker, Schedule Studio, Design Kit, comms preview, and all modal confirmations; include automated accessibility checks as support, not as a substitute for behavior assertions.
- **Readiness live state lacks failure semantics:** cover stale/offline indication, retry, and recovery after polling or invalidation failure so “live” never silently becomes misleading.
- **The inventory/control relationship needs enforcement:** maintain a machine-readable mapping from each shipped interactive control to at least one canonical inventory ID, with an allowlist for shared chrome. A best-effort crawler is useful hardening but cannot prove semantic coverage by itself.
- **Evidence requirements are underspecified:** each PASS should identify test file/name, run artifact, environment, build revision, and timestamp. Console-clean assertions should attach the offending log and page on failure.

## 6. Final-phase onboarding/docs opinion

**Agree with the final-phase gate and with keeping S-ONB-HUMAN, S-ONB-AGENT, and S-DOCS blocking.** This is unusually good product judgment: an open-source replacement is not dogfood-ready if only its authors can operate it.

The final phase should validate and assemble documentation that was kept current during earlier phases, not discover the operating model at the end. Replace the circular phrase “under documented time” with an owner-chosen fixed target and test it from a genuinely clean environment without author shell state or tribal knowledge.

The canonical docs should cover prerequisites, environment-variable names and ownership, migrations and seed data, first-admin access, local versus private Cloudflare configuration, queues/email/Turnstile/R2/Airtable setup boundaries, backup/recovery and rollback procedures, common failure modes, security assumptions, and the exact six-workflow demo path. They should document only commands and deployment procedures that actually exist and have been verified.

`AGENT_SETUP.md` should be operational rather than prompt-theatrical: scopes, key lifecycle, safe preview/dry-run behavior, stable JSON shapes, exit codes, audit attribution, OpenAPI discovery, and explicit denial examples. Generated HTML reports should derive from canonical sources where possible and include build revision, environment, generation time, and evidence links so they do not become polished but stale parallel documentation.

Final acceptance should include two witnessed rehearsals: one new human completing the documented onboarding path and one clean agent context completing the scoped readiness and design-publish path, with no undocumented intervention beyond permitted secret injection. A docs link check and command/example verification should remain part of the closing gate.

— **Codex**
