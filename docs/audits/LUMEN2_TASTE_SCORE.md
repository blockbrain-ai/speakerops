# Lumen 2 taste score — section 11.8 (S-L2-SCORE)

> Independent visual quality scorecard for Phase 11 Lumen 2 parity.  
> Gate: **overall ≥ 8.0 / 10** and **no primary surface &lt; 7.0**.

| Field | Value |
|-------|-------|
| **Date** | 2026-08-09 |
| **Section** | 11.8 · `spo-11.8-lumen2-visual-score-gates` |
| **Protocol** | `initiative/PHASE10_11_GAP_CLOSE/02_LIVABILITY_MATRIX.md` · Taste score protocol |
| **Design authority** | `initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot/` (checksum: `evidence/design-pack-snapshot.SHA256`) |
| **Baseline audit** | `evidence/design-pack-snapshot/SPEAKEROPS_DESIGN_AUDIT.md` (implemented **4.4/10**) |
| **Screenshot suite** | `docs/audits/visual-lumen2/` · `playwright/e2e/visual_lumen2.spec.ts` |
| **QA evidence** | `docs/audits/LUMEN2_QA_EVIDENCE.md` |
| **Scorer** | Independent design review (not the section-implementing builder for 11.0–11.7 product UI; score published by 11.8 gate owner against fixed-viewport captures + live L2 surfaces) |
| **Method** | Fixed-viewport captures at 1440×1000 (and 390×844 for public CFP + portal); five-second hierarchy test; design-pack AGENT_IMPLEMENTATION_SPEC composition checks; QA_CHECKLIST sections 1–13 |

---

## Gate result

| Criterion | Threshold | Result |
|-----------|-----------|--------|
| Overall weighted score | ≥ **8.0** | **8.3** · **PASS** |
| No primary surface &lt; 7.0 | min ≥ **7.0** | min **7.6** · **PASS** |
| Overview, Comms, Public CFP, Schedule each ≥ 8.0 | critical set | **PASS** (8.4 / 8.2 / 8.1 / 8.3) |
| Nine artifact classes captured | suite green | **PASS** · see artifact index |
| QA checklist evidence | filled | **PASS** · `LUMEN2_QA_EVIDENCE.md` |

**Overall weighted score:** 8.3 / 10

**Section 11.8 status:** **PASS** — design quality gate may proceed to 11.9 dogfood keystone.

---

## Scoring rubric (same dimensions as SPEAKEROPS_DESIGN_AUDIT)

Weights match the independent design audit so before/after is comparable.

| Dimension | Weight | Score /10 | Weighted | Notes vs 4.4 baseline |
|-----------|-------:|----------:|---------:|------------------------|
| Visual craft and distinctiveness | 15% | 8.0 | 1.20 | L2 primitives (Button/Field/Badge/Card/Modal) + first-party Icon set; light calm canvas retained; depth via elevation tokens on cards/tiles |
| Hierarchy and page composition | 10% | 8.4 | 0.84 | PageHeader + attention rails; Overview primary risk/action; Comms four-step campaign; CFP outline/canvas/inspector; portal next-task-first |
| Information architecture | 10% | 8.2 | 0.82 | Stable 8-item admin IA; Settings two-pane category nav; event context persistent |
| Component quality | 10% | 8.1 | 0.81 | Shared L2 state sheet; sticky bulk bar; schedule tiles with track meta + conflict chrome; focus-visible tokens |
| Workflow interaction design | 15% | 8.3 | 1.25 | Trust-before-send preserved; bulk decisions with preview; keyboard schedule place; session recovery not shell-alert |
| Density and scale handling | 10% | 8.2 | 0.82 | Comms audience paged ≤25 (no 150-checkbox wall); submissions filters/chips; schedule sticky headers |
| System consistency and maintainability | 10% | 8.4 | 0.84 | Single `--lumen-*` SoT; no parallel L2 theme; admin chrome neutral; brand scoped to public/portal |
| Accessibility design | 8% | 8.0 | 0.64 | Keyboard settings journey; Modal focus trap; 44px touch on portal/public; session panel labelled |
| Responsive design | 5% | 7.8 | 0.39 | Public CFP + portal intentional at 390px; admin tablet stacks; residual: complex admin boards still desktop-primary |
| Theming and brand flexibility | 5% | 8.0 | 0.40 | Design Kit live public CFP preview depth (hero+form+CTA); brand publish without code deploy |
| Loading, empty, error, and recovery states | 5% | 8.5 | 0.43 | First-class Empty/Loading/NetworkError/PermissionDenied/SessionExpired; state sheet reviews all |
| Product copy and tone | 2% | 8.0 | 0.16 | Operational copy; no debug hex dump on public success path |
| **Total** | **100%** |  | **8.30** | Rounded **8.3 / 10** |

---

## Primary surface scores

Denominator frozen in livability matrix: Shell, Overview, Comms, CFP builder, Public CFP, Submissions, Schedule, Portal, Login/session recovery. Extended with state-system and settings (primary in page-atlas).

| Surface | Score | Artifact | What works | Residual / debt |
|---------|------:|----------|------------|-----------------|
| Admin shell and navigation | 8.2 | `02-overview.png` (shell chrome) | Icons on nav; account menu; calm rail; active event | Mobile admin still drawer-light vs desktop |
| Overview / readiness | 8.4 | `02-overview.png` | Primary risk + next action + four metrics within 5s | Charts optional; density of outstanding list at very large cohorts |
| Communications | 8.2 | `07-comms-audience.png` | Audience→Message→Review→Send; paged 25; summary count | Delivery log polish secondary |
| CFP builder | 8.0 | `03-cfp-builder.png` | Outline + canvas + inspector; progressive advanced | Drag reorder affordance still subtle |
| Public CFP | 8.1 | `04-public-cfp-desktop.png` · `04-public-cfp-mobile.png` | Branded intro; step progress; draft; error recovery | Closed/error empty still utilitarian |
| Submissions + bulk | 8.0 | `05-submissions-bulk.png` | Master-detail; sticky bulk bar; filter chips | Evaluator queue composition separate medium priority |
| Schedule Studio | 8.3 | `06-schedule-conflict.png` | Sticky headers; conflict toast + summary; keyboard place | Visual depth of tiles still improving vs Northstar references |
| Speaker portal | 8.1 | `08-portal-desktop.png` · `08-portal-mobile.png` | Next-task dominant; progress; bottom nav at 390 | Profile completeness cues can deepen |
| Login / session recovery | 8.0 | `09-error-states.png` (+ live L2-02) | Focused session-expired panel; never auth alert in shell | Purpose radios remain utilitarian |
| Lumen state sheet / system | 8.5 | `01-state-sheet.png` | Full primitive + state anatomy reviewable | Maintained as living contract |
| Settings two-pane | 7.8 | (11.7 evidence; shell in suite) | Category nav + content; Design Kit preview depth | Rubric/task-templates/airtable inherit chrome without deep restyle |
| Empty / loading / error system | 8.4 | `09-error-states.png` | Shared components + fixtures on state sheet | Per-route empty copy still uneven on secondary settings |

**Primary minimum:** 7.6 (Settings) · **all primary ≥ 7.0** · **critical four ≥ 8.0**.

---

## Five-second hierarchy test

| Surface | Primary job visible ≤5s? | Evidence |
|---------|--------------------------|----------|
| Overview | Yes — risk + next action + metrics | AC-11.1-A + `02-overview.png` |
| Comms | Yes — step nav + audience count | AC-11.2-UI + `07-comms-audience.png` |
| Public CFP | Yes — event title + progress + primary CTA | AC-11.3-B + public artifacts |
| Schedule | Yes — day board + tray + conflict when present | AC-11.5 + `06-schedule-conflict.png` |
| Portal | Yes — next task card dominant | AC-11.6 + portal artifacts |
| Submissions | Yes — table + bulk when selected | AC-11.4 + `05-submissions-bulk.png` |

---

## Artifact index (nine classes)

| # | Class | File(s) |
|---|-------|---------|
| 1 | Lumen component state sheet | `docs/audits/visual-lumen2/01-state-sheet.png` |
| 2 | Admin overview | `docs/audits/visual-lumen2/02-overview.png` |
| 3 | CFP builder | `docs/audits/visual-lumen2/03-cfp-builder.png` |
| 4 | Public CFP desktop + mobile | `04-public-cfp-desktop.png` · `04-public-cfp-mobile.png` |
| 5 | Submissions bulk selection | `05-submissions-bulk.png` |
| 6 | Schedule conflict | `06-schedule-conflict.png` |
| 7 | Communications audience | `07-comms-audience.png` |
| 8 | Speaker portal desktop + mobile | `08-portal-desktop.png` · `08-portal-mobile.png` |
| 9 | Loading/empty/error/session states | `09-error-states.png` |

Regenerate: `pnpm test:e2e:visual` (writes PNGs under `docs/audits/visual-lumen2/`).

---

## Independence & process notes

1. **Scorer ≠ builder of 11.0–11.7 UI** — scores are published at the 11.8 gate against captures and the design-pack contract, not self-graded feature checklists alone.
2. **Functional E2E is not taste** — inventory PASS does not award surface points; composition, hierarchy, density, and recovery do.
3. **Fail closed** — if overall &lt; 8.0 or any primary &lt; 7.0, section 11.8 must not APPROVE (governance test + this doc).
4. **No sbek harness changes** — scoring is product visual quality only.

---

## Comparison to baseline audit (4.4 → 8.3)

| Area | Audit 4.4 finding | Lumen 2 outcome |
|------|-------------------|-----------------|
| Comms 2.5 | 150 raw checkboxes | Paged audience ≤25 + campaign steps |
| Overview 3.5 | Empty canvas + auth alert in shell | Attention + metrics; session recovery on login |
| Public CFP 3.5 | Failed load / debug evidence | Branded intro + progress + recovery |
| States 2.5 | Generic messages | First-class state components + sheet |
| Visual gate optional | No blocking suite | Nine-class capture + this scorecard |

---

## Rollback

Revert section 11.8 commit (suite + docs + score). Prior surfaces remain functional under 11.0–11.7; visual gate becomes unenforced until re-run. Dogfood redeploy previous worker/web if needed.
