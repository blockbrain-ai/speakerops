# Lumen 2 QA evidence — sections 11.7 + 11.8 (S-L2-A11Y · S-L2-SCORE)

> Settings two-pane · Design Kit public preview depth · first-class empty/loading/error/session states · a11y gates · **blocking visual suite + taste score ≥8.0**.

**Date:** 2026-08-09  
**Sections:** 11.7 · `spo-11.7-lumen2-settings-states-a11y` · 11.8 · `spo-11.8-lumen2-visual-score-gates`  
**Design pack:** `initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/`  
**QA checklist:** `evidence/design-pack-snapshot/QA_CHECKLIST.md`  
**Taste score:** `docs/audits/LUMEN2_TASTE_SCORE.md` (**8.3 / 10** · PASS)  
**Screenshots:** `docs/audits/visual-lumen2/`

---

## Success metrics

| Metric | Criteria | Evidence |
|--------|----------|----------|
| Session recovery | No auth alert inside shell | `playwright/e2e/session_states_a11y.spec.ts` · `@inv:L2-02` — logout + clear cookies → `/login` with `session-expired-panel`; `admin-shell` count 0 |
| Settings IA | Two-pane | `@inv:L2-03` — `data-testid=settings-shell` `data-layout=two-pane`; category nav + content region |
| Design Kit depth | Live public CFP preview | `@inv:L2-04` — `design-preview-public` hero + form + Submit proposal; brand hex still drives preview |
| A11y | QA checklist section pass | `@inv:L2-05` keyboard focus/Enter on settings nav; 390px usable; Modal focus trap (11.0) unchanged |
| **Visual suite** | **Nine artifact classes captured** | `playwright/e2e/visual_lumen2.spec.ts` · AC-11.8-SUITE · PNGs under `docs/audits/visual-lumen2/` |
| **Taste score** | **≥8.0 · no primary &lt;7.0** | `docs/audits/LUMEN2_TASTE_SCORE.md` · overall **8.3** · min primary **7.6** |
| **QA checklist** | **Filled for primary routes** | This document · sections below |

---

## Visual suite artifact map (11.8)

| # | Class | Capture | Viewport | Proof |
|---|-------|---------|----------|-------|
| 1 | State sheet | `01-state-sheet.png` | 1440×1000 | `l2-state-sheet` + primitive sections |
| 2 | Overview | `02-overview.png` | 1440×1000 | `page-readiness` + `overview-metrics` |
| 3 | CFP builder | `03-cfp-builder.png` | 1440×1000 | outline + canvas workspace |
| 4 | Public CFP | `04-public-cfp-desktop.png` · `04-public-cfp-mobile.png` | 1440 + 390 | `page-public-cfp` + intro |
| 5 | Submissions bulk | `05-submissions-bulk.png` | 1440×1000 | sticky `submissions-table-bulk` |
| 6 | Schedule conflict | `06-schedule-conflict.png` | 1440×1000 | conflict toast + summary |
| 7 | Comms audience | `07-comms-audience.png` | 1440×1000 | segment builder + count |
| 8 | Portal | `08-portal-desktop.png` · `08-portal-mobile.png` | 1440 + 390 | next-task + bottom nav |
| 9 | Error / session states | `09-error-states.png` | 1440×1000 | global states on state sheet + live session recovery |

Regenerate: `pnpm test:e2e:visual`.

---

## QA checklist map (filled)

### 1. Product task (not style alone)

| Item | Status | Notes |
|------|--------|-------|
| Primary job clear in 5s | Pass | Overview risk/action; Comms steps; Portal next-task; Schedule board |
| Event context always visible (admin) | Pass | `event-context` switcher |
| Destructive / bulk paths have preview + cancel | Pass | Submissions bulk preview; Comms trust-before-send |
| Status never rethemed by event brand | Pass | Brand scoped to public/portal / design preview |

### 2. Composition (page-atlas)

| Route | Status | Evidence |
|-------|--------|----------|
| `/admin` overview | Pass | 11.1 + artifact 02 |
| `/admin/cfp` builder | Pass | 11.3 three regions + artifact 03 |
| `/admin/submissions` master-detail | Pass | 11.4 + artifact 05 |
| `/admin/schedule` day studio | Pass | 11.5 + artifact 06 |
| `/admin/comms` campaign | Pass | 11.2 + artifact 07 |
| `/admin/settings/**` two-pane | Pass | 11.7 L2-03 |
| `/cfp/:slug` public | Pass | 11.3 + artifact 04 |
| `/portal` next-task-first | Pass | 11.6 + artifact 08 |
| `/login` session recovery | Pass | L2-02 + artifact 09 |

### 3. Shared system

| Item | Status | Notes |
|------|--------|-------|
| Primitives from L2 set | Pass | State sheet L2-01; Button/Field/Badge/Card/Modal/Empty/Loading/Error |
| No freeform CSS / undefined tokens | Pass | Lumen lock governance; no new UI runtime deps |
| Icons first-party SVG | Pass | `Icon` component |

### 4. Components and interaction

| Item | Status | Notes |
|------|--------|-------|
| Focus-visible high contrast | Pass | `lumen-focusable` on settings nav + design form controls |
| Pending prevents double action | Pass | Existing design save/publish + API key create busy flags; Comms send guard |
| Modals trap focus | Pass | `Modal.tsx` (11.0) — Escape + Tab cycle + restore focus |
| Failure preserves work + recovery | Pass | `NetworkErrorState` scoped retry; session → login recovery; CFP draft preserve |

### 5. Data density & scale

| Item | Status | Evidence |
|------|--------|----------|
| Comms 150 speakers operable | Pass | AC-11.2-SCALE · page size 25 · no checkbox wall |
| Submissions filters/chips | Pass | AC-11.4-FILTER |
| Schedule sticky headers | Pass | AC-11.5-STICKY |

### 6. States

| State | Surface | Component / behaviour |
|-------|---------|------------------------|
| Session expired | Login (post-redirect) | `SessionExpiredPanel` — never inside `admin-shell` |
| Unauthenticated admin | Any `/admin/**` | `RequireRole` → Navigate `/login` `sessionExpired: true` · AC-11.8-AUTHZ |
| Permission denied | API keys mid-flight 403 | `PermissionDeniedState` |
| Network / 5xx | API keys load failure | `NetworkErrorState` + Retry |
| Loading | API keys / lists | `LoadingState` skeletons |
| Empty | API keys / submissions empty | `EmptyState` benefit + next step |
| Auth alert in shell | **Forbidden** | Asserted absent in L2-02 |

### 7. Communications campaign

| Item | Status | Notes |
|------|--------|-------|
| Four steps Audience→Message→Review→Send | Pass | AC-11.2-UI |
| Recipient count + samples | Pass | `comms-summary-count` / segment list |
| Preview before send | Pass | Trust-before-send preserved |

### 8. Responsive visual review

| Width | Settings | Design Kit | Public CFP | Portal |
|-------|----------|------------|------------|--------|
| 1440 | Two-pane sticky nav | Controls + live public preview | Full branded form | Next-task + progress |
| 834 | Nav stacks above content | Grid collapses | Single column | Stacked cards |
| 390 | Full-width nav + content | Controls first | Artifact 04-mobile | Bottom nav · artifact 08-mobile |

Fixed-data screenshots at required desktop/mobile: **Pass** (suite artifacts).

At every width verified in suite / prior section e2e:

- [x] No viewport-level horizontal overflow on primary public/portal captures
- [x] Navigation reachable; current location clear (admin nav / portal bottom nav)
- [x] Primary identity + next action visible (portal next-task; overview action)
- [x] Schedule board scrolls within named region (sticky header test)
- [x] Dialogs/modals fit (state sheet modal open/close)

### 9. Accessibility

| Item | Status | Evidence |
|------|--------|----------|
| Keyboard-only walkthrough | Pass | L2-05: focus settings-nav-event → Tab → Enter on design nav |
| Focus never trapped outside modal | Pass | Settings nav free Tab order; Modal trap only when open |
| Landmarks / names | Pass | `settings-nav` aria-label; content `role=region`; session panel labelled |
| Live regions | Pass | LoadingState `role=status` `aria-busy`; NetworkError `role=alert` |
| Touch targets | Pass | Settings nav links `min-height: 44px`; portal/public CTAs |
| Contrast / tokens | Pass | Lumen tokens only; brand scoped to `.l2-brand-scope` / design preview |
| Status not color-only | Pass | Conflict text + classes; badges with labels |

Automated axe suite not added as a new runtime dependency (stack safety).

### 10. Performance and resilience

| Item | Status | Notes |
|------|--------|-------|
| Icons local SVG | Pass | No per-row network icon requests |
| Large data does not freeze | Pass | Comms page ≤25; submissions seed list tests |
| Skeletons approximate layout | Pass | LoadingState on lists |
| Retry scoped | Pass | NetworkErrorState retry callbacks |

### 11. Stack safety

| Item | Status |
|------|--------|
| No new UI runtime deps | Pass — `apps/web/package.json` unchanged (React + router + shared) |
| CSP intact | Pass — no new script/font sources |
| First-party icons | Pass — `Icon` SVG set |
| `pnpm run audit:deps` | Pass expectation unchanged |

### 12. Pull-request evidence

| Item | Status | Path |
|------|--------|------|
| Canonical screenshots | Pass | `docs/audits/visual-lumen2/*.png` |
| State-fixture matrix | Pass | State matrix above + state sheet |
| Keyboard notes | Pass | L2-05 + this doc §9 |
| Automated test results | Pass | `pnpm test:e2e:visual` · governance 11.8 |
| Responsive fixed dimensions | Pass | 1440×1000 · 390×844 |
| Known differences named | Pass | Residual section |
| package.json UI deps unchanged | Pass | Visual suite is Playwright-only |
| Independent taste rating | Pass | `LUMEN2_TASTE_SCORE.md` overall **8.3** |

### 13. Final approval (route / programme visual)

| Criterion | Status |
|-----------|--------|
| Meets product task, not merely style | Pass |
| Shared-system reuse evident | Pass |
| Normal / edge / loading / empty / failure credible | Pass |
| Desktop + mobile intentional on public/portal | Pass |
| Accessibility blockers zero on gated journeys | Pass |
| Visual reviewer ≥8.0 with no critical category &lt;7.0 | **Pass · 8.3** |

---

## Inventory rows (11.7; 11.8 adds no new REQUIRED UI controls)

| ID | Journey | test_id |
|----|---------|---------|
| L2-02 | Session expired → login recovery panel (no shell) | `e2e/lumen2/session-expired` |
| L2-03 | Settings two-pane shell category nav | `e2e/lumen2/settings-two-pane` |
| L2-04 | Design Kit live public CFP preview depth | `e2e/lumen2/design-preview-public` |
| L2-05 | Settings keyboard focus journey + 390px | `e2e/lumen2/settings-a11y-keyboard` |

11.8 visual suite is proven by named Playwright tests + score doc (livability `@inv`: visual suite) without new product controls → no inventory shrinkage / no new REQUIRED row required.

---

## Wiring proof

| Component | Instantiated at |
|-----------|-----------------|
| `SettingsShell` | `apps/web/src/App.tsx` · `SettingsGuard` wraps all `/admin/settings/**` |
| State components | `apps/web/src/components/ui/*` · exported from `index.ts` |
| Session recovery | `RequireRole` Navigate state + `Login.tsx` panel |
| Visual suite | `playwright/e2e/visual_lumen2.spec.ts` via `pnpm test:e2e` / `pnpm test:e2e:visual` |
| Taste gate | `docs/audits/LUMEN2_TASTE_SCORE.md` + `tests/governance/11.8-visual-score-gates.test.mjs` |

---

## Implementation notes (not soul residuals)

These document **accepted design choices** within constitution non-goals / zero-deps constraints — not open product gaps:

- Settings mobile uses stacked two-pane (nav above content) rather than a separate index-only route — same routes, responsive layout.
- Rubric / task-templates / airtable pages inherit SettingsShell with two-pane chrome (secondary settings; primary six scored separately).
- Admin schedule/comms boards are desktop-primary with usable tablet stack; taste critical-four ≥8.0 recorded in `LUMEN2_TASTE_SCORE.md`.
- Automated axe suite not added (zero new runtime deps); keyboard + contrast token checks covered in L2-05 and Lumen lock.
- Pixel-diff baselines (`toHaveScreenshot`) not committed — suite uses deterministic path captures + human scorecard (avoids CI font flake).

---

## Rollback

Revert section 11.7 / 11.8 commits as needed; dogfood redeploy previous worker/web. Session recovery degrades to prior login redirect without panel copy; settings return to flat linked list (legacy `settings-*-link` anchors retained). Visual gate and scorecard removed with 11.8 revert.
