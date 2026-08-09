# Lumen 2 QA evidence — section 11.7 (S-L2-A11Y)

> Settings two-pane · Design Kit public preview depth · first-class empty/loading/error/session states · a11y gates.

**Date:** 2026-08-09  
**Section:** 11.7 · `spo-11.7-lumen2-settings-states-a11y`  
**Design pack:** `initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/`  
**QA checklist:** `evidence/design-pack-snapshot/QA_CHECKLIST.md`

---

## Success metrics

| Metric | Criteria | Evidence |
|--------|----------|----------|
| Session recovery | No auth alert inside shell | `playwright/e2e/session_states_a11y.spec.ts` · `@inv:L2-02` — logout + clear cookies → `/login` with `session-expired-panel`; `admin-shell` count 0 |
| Settings IA | Two-pane | `@inv:L2-03` — `data-testid=settings-shell` `data-layout=two-pane`; category nav + content region |
| Design Kit depth | Live public CFP preview | `@inv:L2-04` — `design-preview-public` hero + form + Submit proposal; brand hex still drives preview |
| A11y | QA checklist section pass | `@inv:L2-05` keyboard focus/Enter on settings nav; 390px usable; Modal focus trap (11.0) unchanged |

---

## QA checklist map (section-owned)

### 4. Components and interaction

| Item | Status | Notes |
|------|--------|-------|
| Focus-visible high contrast | Pass | `lumen-focusable` on settings nav + design form controls |
| Pending prevents double action | Pass | Existing design save/publish + API key create busy flags |
| Modals trap focus | Pass | `Modal.tsx` (11.0) — Escape + Tab cycle + restore focus |
| Failure preserves work + recovery | Pass | `NetworkErrorState` scoped retry; session → login recovery |

### 8. Responsive

| Width | Settings | Design Kit |
|-------|----------|------------|
| 1440 | Two-pane sticky nav | Controls + live public preview side-by-side |
| 834 | Nav stacks above content; grid categories | Grid collapses to single column (`design-kit__grid`) |
| 390 | Full-width nav list + content | Controls first, preview second |

### 9. Accessibility

| Item | Status | Evidence |
|------|--------|----------|
| Keyboard-only walkthrough | Pass | L2-05: focus settings-nav-event → Tab → Enter on design nav |
| Focus never trapped outside modal | Pass | Settings nav is free Tab order; Modal trap only when open |
| Landmarks / names | Pass | `settings-nav` aria-label; content `role=region`; session panel labelled |
| Live regions | Pass | LoadingState `role=status` `aria-busy`; NetworkError `role=alert` |
| Touch targets | Pass | Settings nav links `min-height: 44px` |
| Contrast / tokens | Pass | Lumen tokens only; brand scoped to `.l2-brand-scope` / design preview |

### 11. Stack safety

| Item | Status |
|------|--------|
| No new UI runtime deps | Pass — `apps/web/package.json` unchanged (React + router + shared) |
| CSP intact | Pass — no new script/font sources |
| First-party icons | Pass — `Icon` SVG set |

---

## State matrix

| State | Surface | Component / behaviour |
|-------|---------|------------------------|
| Session expired | Login (post-redirect) | `SessionExpiredPanel` — never inside `admin-shell` |
| Unauthenticated admin | Any `/admin/**` | `RequireRole` → Navigate `/login` `sessionExpired: true` |
| Permission denied | API keys mid-flight 403 | `PermissionDeniedState` |
| Network / 5xx | API keys load failure | `NetworkErrorState` + Retry → `loadKeys` |
| Loading | API keys list | `LoadingState` skeletons |
| Empty | API keys no rows | `EmptyState` benefit + next step |
| Auth alert in shell | **Forbidden** | Asserted absent in L2-02 |

---

## Inventory rows added (same PR)

| ID | Journey | test_id |
|----|---------|---------|
| L2-02 | Session expired → login recovery panel (no shell) | `e2e/lumen2/session-expired` |
| L2-03 | Settings two-pane shell category nav | `e2e/lumen2/settings-two-pane` |
| L2-04 | Design Kit live public CFP preview depth | `e2e/lumen2/design-preview-public` |
| L2-05 | Settings keyboard focus journey + 390px | `e2e/lumen2/settings-a11y-keyboard` |

Baseline fingerprints updated in `scripts/e2e-inventory-required-baseline.json`.

---

## Wiring proof

| Component | Instantiated at |
|-----------|-----------------|
| `SettingsShell` | `apps/web/src/App.tsx` · `SettingsGuard` wraps all `/admin/settings/**` |
| State components | `apps/web/src/components/ui/*` · exported from `index.ts` |
| Session recovery | `RequireRole` Navigate state + `Login.tsx` panel |
| E2E | `playwright/e2e/session_states_a11y.spec.ts` via `pnpm test:e2e` |

---

## Known differences / residual

- Settings mobile uses stacked two-pane (nav above content) rather than a separate index-only route — same routes, responsive layout (page-atlas “settings index followed by detail” satisfied by sticky/stack nav + dedicated routes).
- Rubric / task-templates / airtable pages inherit SettingsShell without deep visual rework (remaining polish out of critical path; two-pane chrome applied).
- Automated axe suite not added as a new runtime dependency; keyboard + contrast token checks covered in L2-05 and Lumen lock.

---

## Rollback

Revert section 11.7 commit; dogfood redeploy previous worker/web. Session recovery degrades to prior login redirect without panel copy; settings return to flat linked list (legacy `settings-*-link` anchors retained).
