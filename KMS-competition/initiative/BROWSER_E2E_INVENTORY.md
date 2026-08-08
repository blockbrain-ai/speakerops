# Browser E2E inventory — exhaustive predeclared journeys

**Law:** Every interactive UI control shipped in SpeakerOps must appear here.  
**Gate:** Playwright suite maps `test_id` 1:1; CI fails if a row is `REQUIRED` and not `PASS`.  
**Runner:** Playwright headless Chromium (project standard).  
**Owner order:** full click-through of every function — not smoke samples only.

**Statuses:** `OPEN` | `IMPLEMENTED` | `PASS` | `FAIL` | `DEFER` (owner only)

**Required:** `REQUIRED` = must PASS for dogfood_ready · `OPTIONAL` = hardening only · empty Required on matrix M is not a journey

---

## Legend

| Col | Meaning |
|-----|---------|
| ID | Stable inventory id (never reuse for different behavior) |
| Role | public \| speaker \| evaluator \| admin |
| Surface | Route/area |
| Journey | What the headless browser does |
| test_id | Playwright test name / file anchor |
| Negative | Required deny/error path |

---

## A — Public CFP

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| A01 | public | `/cfp/:slug` | Load form; see welcome; brand tokens visible | e2e/public/cfp-load | 404 invalid slug | REQUIRED | OPEN |
| A02 | public | CFP | Fill required fields; conditional field appears when rule met | e2e/public/cfp-conditional | Hidden field not submitted | REQUIRED | OPEN |
| A03 | public | CFP | Select category; observe routing metadata on submit payload | e2e/public/cfp-category | Invalid category rejected | REQUIRED | OPEN |
| A04 | public | CFP | Add second speaker block; min/max speaker rules | e2e/public/cfp-multi-speaker | Min speakers enforced | REQUIRED | OPEN |
| A05 | public | CFP | Upload supporting file within type/size | e2e/public/cfp-file | Oversize/type rejected | REQUIRED | OPEN |
| A06 | public | CFP | Pass Turnstile (test key); submit success + confirmation | e2e/public/cfp-submit | Missing captcha blocked | REQUIRED | OPEN |
| A07 | public | CFP | Closed window shows closed state; no submit | e2e/public/cfp-closed | — | REQUIRED | OPEN |
| A08 | public | CFP | Validation errors inline; focus management | e2e/public/cfp-validation | — | REQUIRED | OPEN |
| A09 | public | CFP | Mobile viewport complete submit | e2e/public/cfp-mobile | — | REQUIRED | OPEN |
| A10 | public | CFP | XSS string in abstract renders as text not script | e2e/public/cfp-xss | Script not executed | REQUIRED | OPEN |
| A11 | public | CFP | Keyboard-only complete valid submit | e2e/public/cfp-keyboard | — | REQUIRED | OPEN |

---

## B — Auth & session

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| B01 | admin | `/login` | Magic/invite login → session cookie set HttpOnly path | e2e/auth/admin-login | Bad token 401 | REQUIRED | IMPLEMENTED |
| B02 | speaker | magic link | Single-use link → portal; second use fails | e2e/auth/speaker-magic | Replay rejected | REQUIRED | IMPLEMENTED |
| B03 | any | any authed | Logout clears session | e2e/auth/logout | — | REQUIRED | IMPLEMENTED |
| B04 | public | `/admin` | Unauthed redirect/401 | e2e/auth/admin-guard | — | REQUIRED | IMPLEMENTED |
| B05 | speaker | `/admin` | Speaker cannot open admin | e2e/auth/role-guard-admin | 403/redirect | REQUIRED | IMPLEMENTED |
| B06 | evaluator | `/speakers` admin write | Evaluator cannot mutate schedule | e2e/auth/role-guard-eval | 403 API | REQUIRED | IMPLEMENTED |

---

## C — Admin: event & Design Kit

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| C01 | admin | Events | Create event; timezone; dates | e2e/admin/event-create | Validation fail | REQUIRED | OPEN |
| C02 | admin | Events | Switch active event context | e2e/admin/event-switch | — | REQUIRED | OPEN |
| C03 | admin | Design Kit | Set brand color; live preview updates | e2e/admin/design-color | Invalid hex | REQUIRED | OPEN |
| C04 | admin | Design Kit | Upload logo; preview | e2e/admin/design-logo | Bad type rejected | REQUIRED | OPEN |
| C05 | admin | Design Kit | Publish tokens; public CFP shows brand | e2e/admin/design-publish | Draft not public until publish | REQUIRED | OPEN |
| C06 | admin | Design Kit | Cannot inject freeform CSS field (control absent) | e2e/admin/design-no-css | — | REQUIRED | OPEN |
| C07 | admin | Settings | Edit event name/close dates for CFP window | e2e/admin/settings-cfp-window | — | REQUIRED | OPEN |
| C08 | admin | Design Kit | Near-white brand → contrast warn/block or derived text on public CFP | e2e/admin/design-contrast | Publish blocked or safe fg | REQUIRED | OPEN |
| C09 | admin | Design Kit | SVG/scripty logo rejected; never executes | e2e/admin/design-logo-xss | Rejected or inert | REQUIRED | OPEN |
| C10 | admin | Design Kit | Draft tokens not visible on public CFP until publish | e2e/admin/design-draft-isolation | — | REQUIRED | OPEN |
| C11 | admin | Events | Switch event A→B; no A data in B lists | e2e/admin/event-isolation | Cross-event leak | REQUIRED | OPEN |

---

## D — Admin: form builder

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| D01 | admin | Forms | Create form; add text/select/file/speaker fields | e2e/admin/form-create | — | REQUIRED | OPEN |
| D02 | admin | Forms | Reorder fields drag | e2e/admin/form-reorder | — | REQUIRED | OPEN |
| D03 | admin | Forms | Conditional rule: show field if select=X | e2e/admin/form-conditional | Circular rule blocked | REQUIRED | OPEN |
| D04 | admin | Forms | Category field + routing target | e2e/admin/form-routing | — | REQUIRED | OPEN |
| D05 | admin | Forms | Required flags + validation | e2e/admin/form-required | — | REQUIRED | OPEN |
| D06 | admin | Forms | Welcome/thank-you copy | e2e/admin/form-copy | — | REQUIRED | OPEN |
| D07 | admin | Forms | Preview side-by-side | e2e/admin/form-preview | — | REQUIRED | OPEN |
| D08 | admin | Forms | Publish version; pin version on new submission | e2e/admin/form-publish-version | Edit published creates new version | REQUIRED | OPEN |
| D09 | admin | Forms | Open/close + submission limit | e2e/admin/form-limits | Over limit rejected | REQUIRED | OPEN |
| D10 | admin | Forms | Copy public link | e2e/admin/form-link | — | REQUIRED | OPEN |

---

## E — Admin: submissions & decisions

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| E01 | admin | Submissions | List filters by status/category | e2e/admin/sub-list | — | REQUIRED | OPEN |
| E02 | admin | Submissions | Open detail; answers; speakers | e2e/admin/sub-detail | — | REQUIRED | OPEN |
| E03 | admin | Submissions | Assign to evaluator | e2e/admin/sub-assign | — | REQUIRED | OPEN |
| E04 | admin | Submissions | Accept creates session + tasks | e2e/admin/sub-accept | Accept without authz denied | REQUIRED | OPEN |
| E05 | admin | Submissions | Reject with reason | e2e/admin/sub-reject | — | REQUIRED | OPEN |
| E06 | admin | Submissions | Waitlist status | e2e/admin/sub-waitlist | — | REQUIRED | OPEN |
| E07 | admin | Submissions | Direct/sponsor session entry (no CFP) | e2e/admin/session-direct | — | REQUIRED | OPEN |
| E08 | admin | Submissions | Bulk select + preview bulk status change | e2e/admin/sub-bulk | Empty selection blocked | REQUIRED | OPEN |

---

## F — Evaluator

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| F01 | evaluator | Queue | See only assigned | e2e/eval/queue | Unassigned hidden | REQUIRED | OPEN |
| F02 | evaluator | Score | Score criteria + comment; save | e2e/eval/score | Out-of-range rejected | REQUIRED | OPEN |
| F03 | evaluator | Score | Cannot accept/reject | e2e/eval/no-decide | Control absent/403 | REQUIRED | OPEN |
| F04 | evaluator | Score | Keyboard-only complete score | e2e/eval/a11y-keyboard | — | REQUIRED | OPEN |

---

## G — Speaker portal

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| G01 | speaker | Portal | Land on next incomplete task | e2e/portal/home | — | REQUIRED | OPEN |
| G02 | speaker | Profile | Edit bio; save | e2e/portal/bio | XSS text-only | REQUIRED | OPEN |
| G03 | speaker | Files | Upload headshot; preview | e2e/portal/headshot | Bad type rejected | REQUIRED | OPEN |
| G04 | speaker | Files | Upload slides | e2e/portal/slides | — | REQUIRED | OPEN |
| G05 | speaker | Tasks | Complete task; status flips | e2e/portal/task-complete | — | REQUIRED | OPEN |
| G06 | speaker | Tasks | Overdue visual state | e2e/portal/task-overdue | — | REQUIRED | OPEN |
| G07 | speaker | Sessions | View own session status | e2e/portal/session | No other speakers’ private data | REQUIRED | OPEN |
| G08 | speaker | Portal | Mobile complete bio+task | e2e/portal/mobile | — | REQUIRED | OPEN |

---

## H — Readiness dashboard

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| H01 | admin | Dashboard | Stats + outstanding list | e2e/dash/overview | — | REQUIRED | OPEN |
| H02 | admin | Dashboard | Filter overdue | e2e/dash/filter | — | REQUIRED | OPEN |
| H03 | admin | Dashboard | Drill to speaker | e2e/dash/drill | — | REQUIRED | OPEN |
| H04 | admin | Dashboard | Live update after portal complete (same session or poll ≤5s) | e2e/dash/live | — | REQUIRED | OPEN |
| H05 | admin | Dashboard | Empty state when all clear | e2e/dash/empty | — | REQUIRED | OPEN |

---

## I — Schedule studio

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| I01 | admin | Schedule | List view shows sessions | e2e/sched/list | — | REQUIRED | OPEN |
| I02 | admin | Schedule | Day view | e2e/sched/day | — | REQUIRED | OPEN |
| I03 | admin | Schedule | Week view | e2e/sched/week | — | REQUIRED | OPEN |
| I04 | admin | Schedule | Track view | e2e/sched/track | — | REQUIRED | OPEN |
| I05 | admin | Schedule | Room view | e2e/sched/room | — | REQUIRED | OPEN |
| I06 | admin | Schedule | Drag place into empty slot | e2e/sched/drag-place | — | REQUIRED | OPEN |
| I07 | admin | Schedule | Drag causes speaker conflict; blocked with reason | e2e/sched/conflict-speaker | — | REQUIRED | OPEN |
| I08 | admin | Schedule | Room overlap conflict | e2e/sched/conflict-room | — | REQUIRED | OPEN |
| I09 | admin | Schedule | Keyboard move alternative | e2e/sched/keyboard | — | REQUIRED | OPEN |
| I10 | admin | Schedule | Undo last move | e2e/sched/undo | — | REQUIRED | OPEN |
| I11 | admin | Schedule | Unscheduled tray | e2e/sched/tray | — | REQUIRED | OPEN |
| I12 | admin | Schedule | Timezone displayed | e2e/sched/tz | — | REQUIRED | OPEN |
| I13 | admin | Schedule | Move already-placed session to new slot | e2e/sched/move | — | REQUIRED | OPEN |
| I14 | admin | Schedule | Unschedule back to tray | e2e/sched/unschedule | — | REQUIRED | OPEN |
| I15 | admin | Schedule | Stale version conflict shows recovery UI | e2e/sched/stale | No silent overwrite | REQUIRED | OPEN |
| I16 | admin | Schedule | After place, all five views + reload consistent | e2e/sched/persist | — | REQUIRED | OPEN |

---

## J — Communications

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| J01 | admin | Comms | Create/edit template merge fields | e2e/comms/template | — | REQUIRED | OPEN |
| J02 | admin | Comms | Segment audience; count | e2e/comms/segment | — | REQUIRED | OPEN |
| J03 | admin | Comms | Preview all recipients + body | e2e/comms/preview | Send without preview blocked if product requires | REQUIRED | OPEN |
| J04 | admin | Comms | Send once; second send idempotent | e2e/comms/send-idempotent | — | REQUIRED | OPEN |
| J05 | admin | Comms | Delivery log visible | e2e/comms/log | — | REQUIRED | OPEN |
| J06 | admin | Comms | ICS attach for scheduled session | e2e/comms/ics | — | REQUIRED | OPEN |
| J07 | admin | Comms | Role without comms:send cannot send | e2e/comms/authz | 403 | REQUIRED | OPEN |
| J08 | admin | Comms | Send without completed preview blocked | e2e/comms/preview-required | Blocked | REQUIRED | OPEN |
| J09 | admin | Comms | Edit audience invalidates preview | e2e/comms/preview-invalidate | — | REQUIRED | OPEN |
| J10 | admin | Comms | ICS update after reschedule keeps UID bumps SEQUENCE | e2e/comms/ics-update | — | REQUIRED | OPEN |

---

## K — API keys UI

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| K01 | admin | API Keys | Create key with subset of scopes; secret shown once | e2e/keys/create | — | REQUIRED | OPEN |
| K02 | admin | API Keys | Revoke key | e2e/keys/revoke | — | REQUIRED | OPEN |
| K03 | admin | API Keys | Copy prefix only after dismiss | e2e/keys/secret-once | — | REQUIRED | OPEN |
| K04 | admin | API Keys | Non-admin cannot open keys | e2e/keys/authz | — | REQUIRED | OPEN |

---

## L — Empty / error / loading (cross-cutting)

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| L01 | admin | Submissions | Empty list CTA | e2e/states/empty-sub | — | REQUIRED | OPEN |
| L02 | admin | Network | Offline/API 500 shows error state not blank | e2e/states/error | — | REQUIRED | OPEN |
| L03 | any | Slow | Loading skeletons not infinite hang | e2e/states/loading | — | REQUIRED | OPEN |
| L04 | any | Happy paths | No uncaught console errors | e2e/states/console-clean | — | REQUIRED | OPEN |
| L05 | admin | Lists | 150-row seed list paginates or virtualizes usable | e2e/states/large-list | — | REQUIRED | OPEN |

---

## N — Admin Speakers list/detail

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| N01 | admin | Speakers | List speakers for event | e2e/admin/speakers-list | — | REQUIRED | OPEN |
| N02 | admin | Speakers | Search/filter | e2e/admin/speakers-filter | — | REQUIRED | OPEN |
| N03 | admin | Speakers | Detail: tasks + files | e2e/admin/speakers-detail | — | REQUIRED | OPEN |
| N04 | admin | Speakers | Open headshot/slides metadata | e2e/admin/speakers-files | No cross-speaker leak | REQUIRED | OPEN |

---

## O — Admin settings journeys (full rows, not cross-refs)

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| O01 | admin | Settings | Event name/dates/tz | e2e/settings/event | Validation | REQUIRED | OPEN |
| O02 | admin | Settings | Rooms CRUD | e2e/settings/rooms | — | REQUIRED | OPEN |
| O03 | admin | Settings | Tracks CRUD | e2e/settings/tracks | — | REQUIRED | OPEN |
| O04 | admin | Settings | Eval rubric edit | e2e/settings/rubric | — | REQUIRED | OPEN |
| O05 | admin | Settings | Task templates on accept | e2e/settings/task-templates | — | REQUIRED | OPEN |
| O06 | admin | Settings | Airtable projection status read | e2e/settings/airtable-status | — | REQUIRED | OPEN |

---

## M — Settings coverage matrix (non-counted; maps to inventory IDs)

| Control | Who | Proven by |
|---------|-----|-----------|
| Event name/dates/tz | admin | O01, C01, C07 |
| CFP open/close/limit | admin | D09 |
| Form fields/rules | admin | D01–D08 |
| Eval rubric | admin | O04 |
| Task templates | admin | O05 |
| Email templates | admin | J01 |
| Rooms/tracks | admin | O02, O03 |
| Design tokens | admin | C03–C10 |
| API keys | admin | K01–K04 |
| Airtable status | admin | O06 |

---

## Coverage rules

1. **New UI control** → add inventory row in same PR as feature section.  
2. **Playwright file** must tag `@inv:A01` etc.  
3. **Phase 8 keystone** runs full suite; report HTML in `reports/e2e-coverage.html`.  
4. **CLI is not browser** — CLI has separate suite; browser inventory is UI-only.  
5. **Discovery crawl REQUIRED at Phase 8** for admin primary actions: fail if unmatched to inventory (allowlist for pure chrome).  
6. **Section M is not a journey count** — use O/N/C/D/J/K rows.

---

## Counts (canonical journeys)

| Area | Rows (approx) |
|------|----------------|
| A–O inventory tables | **~115+** REQUIRED journeys |
| M matrix | coverage map only (not double-counted) |

---

*— Living inventory; amend only with section PR or owner DEFER*
