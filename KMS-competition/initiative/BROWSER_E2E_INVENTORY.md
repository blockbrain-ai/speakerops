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
| A01 | public | `/cfp/:slug` | Load form; see welcome; brand tokens visible | e2e/public/cfp-load | 404 invalid slug | REQUIRED | PASS |
| A02 | public | CFP | Fill required fields; conditional field appears when rule met | e2e/public/cfp-conditional | Hidden field not submitted | REQUIRED | PASS |
| A03 | public | CFP | Select category; observe routing metadata on submit payload | e2e/public/cfp-category | Invalid category rejected | REQUIRED | PASS |
| A04 | public | CFP | Add second speaker block; min/max speaker rules | e2e/public/cfp-multi-speaker | Min speakers enforced | REQUIRED | PASS |
| A05 | public | CFP | Upload supporting file within type/size | e2e/public/cfp-file | Oversize/type rejected | REQUIRED | PASS |
| A06 | public | CFP | Pass Turnstile (test key); submit success + confirmation | e2e/public/cfp-submit | Missing captcha blocked | REQUIRED | PASS |
| A07 | public | CFP | Closed window shows closed state; no submit | e2e/public/cfp-closed | — | REQUIRED | PASS |
| A08 | public | CFP | Validation errors inline; focus management | e2e/public/cfp-validation | — | REQUIRED | PASS |
| A09 | public | CFP | Mobile viewport complete submit | e2e/public/cfp-mobile | — | REQUIRED | PASS |
| A10 | public | CFP | XSS string in abstract renders as text not script | e2e/public/cfp-xss | Script not executed | REQUIRED | PASS |
| A11 | public | CFP | Keyboard-only complete valid submit | e2e/public/cfp-keyboard | — | REQUIRED | PASS |
| A17 | public | CFP | Save as draft (title-only); resume restores fields; disabled when closed | e2e/public/cfp-draft | Closed rejects draft save | REQUIRED | PASS |
| A18 | public | CFP | Multiselect multi-value + URL field is text (not file) | e2e/public/cfp-multiselect-url | Non-array multiselect rejected API | REQUIRED | PASS |
| A19 | public | CFP | No operator/debug brand copy (Lumen defaults / raw file ids) | e2e/public/cfp-copy-clean | — | REQUIRED | PASS |
| A20 | public | CFP | Expand "About this speaker"; bio/company/title seed accepted speaker profile; never overwrites non-empty | e2e/public-cfp/speaker-about | Accept replay keeps hand-edited bio | REQUIRED | PASS |

---

## B — Auth & session

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| B01 | admin | `/login` | Magic/invite login → session cookie set HttpOnly path | e2e/auth/admin-login | Bad token 401 | REQUIRED | PASS |
| B02 | speaker | magic link | Single-use link → portal; second use fails | e2e/auth/speaker-magic | Replay rejected | REQUIRED | PASS |
| B03 | any | any authed | Logout clears session | e2e/auth/logout | — | REQUIRED | PASS |
| B04 | public | `/admin` | Unauthed redirect/401 | e2e/auth/admin-guard | — | REQUIRED | PASS |
| B05 | speaker | `/admin` | Speaker cannot open admin | e2e/auth/role-guard-admin | 403/redirect | REQUIRED | PASS |
| B06 | evaluator | `/speakers` admin write | Evaluator cannot mutate schedule | e2e/auth/role-guard-eval | 403 API | REQUIRED | PASS |
| B07 | public | `/judge` | Judge access code exchanges for demo role session (4h; body-posted code) | e2e/public/judge-access | Wrong code generic 401; route 404 when disabled | REQUIRED | PASS |
| B08 | any multi | `/login` exchange | Multi-membership chooser after exchange → pick named programme | e2e/auth/membership-chooser | Single membership skips chooser | REQUIRED | PASS |

---

## C — Admin: event & Design Kit

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| C01 | admin | Events | Create event; timezone; dates | e2e/admin/event-create | Validation fail | REQUIRED | PASS |
| C02 | admin | Events | Switch active event context | e2e/admin/event-switch | — | REQUIRED | PASS |
| C03 | admin | Design Kit | Set brand color; live preview updates | e2e/admin/design-color | Invalid hex | REQUIRED | PASS |
| C04 | admin | Design Kit | Upload logo; preview | e2e/admin/design-logo | Bad type rejected | REQUIRED | PASS |
| C05 | admin | Design Kit | Publish tokens; public CFP shows brand | e2e/admin/design-publish | Draft not public until publish | REQUIRED | PASS |
| C06 | admin | Design Kit | Cannot inject freeform CSS field (control absent) | e2e/admin/design-no-css | — | REQUIRED | PASS |
| C07 | admin | Settings | Edit event name/close dates for CFP window | e2e/admin/settings-cfp-window | — | REQUIRED | PASS |
| C08 | admin | Design Kit | Near-white brand → contrast warn/block or derived text on public CFP | e2e/admin/design-contrast | Publish blocked or safe fg | REQUIRED | PASS |
| C09 | admin | Design Kit | SVG/scripty logo rejected; never executes | e2e/admin/design-logo-xss | Rejected or inert | REQUIRED | PASS |
| C10 | admin | Design Kit | Draft tokens not visible on public CFP until publish | e2e/admin/design-draft-isolation | — | REQUIRED | PASS |
| C11 | admin | Events | Switch event A→B; no A data in B lists | e2e/admin/event-isolation | Cross-event leak | REQUIRED | PASS |

---

## D — Admin: form builder

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| D01 | admin | Forms | Create form; add text/select/file/speaker fields | e2e/admin/form-create | — | REQUIRED | PASS |
| D02 | admin | Forms | Reorder fields drag | e2e/admin/form-reorder | — | REQUIRED | PASS |
| D03 | admin | Forms | Conditional rule: show field if select=X | e2e/admin/form-conditional | Circular rule blocked | REQUIRED | PASS |
| D04 | admin | Forms | Category field + routing target | e2e/admin/form-routing | — | REQUIRED | PASS |
| D05 | admin | Forms | Required flags + validation | e2e/admin/form-required | — | REQUIRED | PASS |
| D06 | admin | Forms | Welcome/thank-you copy | e2e/admin/form-copy | — | REQUIRED | PASS |
| D07 | admin | Forms | Preview side-by-side | e2e/admin/form-preview | — | REQUIRED | PASS |
| D08 | admin | Forms | Publish version; pin version on new submission | e2e/admin/form-publish-version | Edit published creates new version | REQUIRED | PASS |
| D09 | admin | Forms | Open/close + submission limit | e2e/admin/form-limits | Over limit rejected | REQUIRED | PASS |
| D10 | admin | Forms | Copy public link | e2e/admin/form-link | — | REQUIRED | PASS |
| D11 | admin | Forms | Reload builder restores draft after refresh | e2e/admin/form-reload | — | REQUIRED | PASS |
| D12 | admin | Forms | Field help text, placeholder & character cap render on public CFP with live counter | e2e/admin/form-field-help | Over-cap submit rejected client + server (400) | REQUIRED | PASS |
| D13 | admin | Forms | File field from palette; publish; public PDF upload; admin detail shows working file link | e2e/admin/form-file-field | File field with options rejected | REQUIRED | PASS |
| D14 | admin | Forms | Form settings speaker min/max (1–15) enforced on public CFP | e2e/admin/form-speaker-bounds | Over-max and under-min submits rejected (400) | REQUIRED | PASS |
| D15 | admin | Forms | Form settings per-person cap enforced on public CFP by normalized submitter email; total cap independent | e2e/admin/form-per-submitter-limit | Same email second submit rejected (400, human copy) | REQUIRED | PASS |
| D16 | admin | Forms | Section + divider layout nodes: builder compose/reorder, reload round-trip, public headings/dividers, no layout answers | e2e/admin/form-layout-nodes | Submitted DTO contains no layout answers | REQUIRED | PASS |
| D17 | admin | Forms | Rich welcome (H2/bold/list) + rich_text field authored in builder; publish; public CFP renders authored nodes; rich answer to admin detail + plain-text CSV | e2e/admin/form-rich-text | Builder link dialog rejects javascript: URL inline | REQUIRED | PASS |

---

## E — Admin: submissions & decisions

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| E01 | admin | Submissions | List filters by status/category | e2e/admin/sub-list | — | REQUIRED | PASS |
| E02 | admin | Submissions | Open detail; answers; speakers | e2e/admin/sub-detail | — | REQUIRED | PASS |
| E03 | admin | Submissions | Assign to evaluator | e2e/admin/sub-assign | — | REQUIRED | PASS |
| E04 | admin | Submissions | Accept creates session + tasks | e2e/admin/sub-accept | Accept without authz denied | REQUIRED | PASS |
| E05 | admin | Submissions | Reject with reason | e2e/admin/sub-reject | — | REQUIRED | PASS |
| E06 | admin | Submissions | Waitlist status | e2e/admin/sub-waitlist | — | REQUIRED | PASS |
| E07 | admin | Submissions | Direct/sponsor session entry (no CFP) | e2e/admin/session-direct | — | REQUIRED | PASS |
| E08 | admin | Submissions | Bulk select + preview bulk status change | e2e/admin/sub-bulk | Empty selection blocked | REQUIRED | PASS |
| E09 | admin | Submissions | Bulk preview → Confirm apply (commit) | e2e/admin/sub-bulk-commit | Partial failures listed | REQUIRED | PASS |
| E10 | admin | Submissions | Search list by title/speaker (`submissions-filter-q`) | e2e/admin/sub-search | Empty results honest | REQUIRED | PASS |
| E11 | admin | Submissions | Assign via evaluator picker (not raw user id) | e2e/admin/sub-assign-picker | No evaluators empty state | REQUIRED | PASS |
| E12 | admin | Submissions | Detail Reviews panel (individual comments) | e2e/admin/sub-detail-reviews | Empty when none | REQUIRED | PASS |
| E13 | admin | Submissions | Decision → notify hand-off: bulk accept exact result set becomes the comms audience; typed template preselected; preview → idempotent send → delivery log | e2e/submissions/decision-notify | Previously accepted outsider never enters the audience | REQUIRED | PASS |
| E14 | admin | Submissions | Filtered submissions CSV export: stable headers, flattened speakers, answer columns (layout nodes excluded); bytes inspected | e2e/submissions/export-csv | Non-matching rows and layout keys absent from the bytes | REQUIRED | PASS |
| E15 | admin | Submissions | Direct/sponsor session dialog parity: repeatable speaker rows + track select; both speakers linked and track chip shown | e2e/submissions/direct-session-parity | — | REQUIRED | PASS |

---

## F — Evaluator

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| F01 | evaluator | Queue | See only assigned | e2e/eval/queue | Unassigned hidden | REQUIRED | PASS |
| F02 | evaluator | Score | Score criteria + comment; save | e2e/eval/score | Out-of-range rejected | REQUIRED | PASS |
| F03 | evaluator | Score | Cannot accept/reject | e2e/eval/no-decide | Control absent/403 | REQUIRED | PASS |
| F04 | evaluator | Score | Keyboard-only complete score | e2e/eval/a11y-keyboard | — | REQUIRED | PASS |
| F05 | admin | Evaluations | Sort by aggregate score; export CSV of scores/status | e2e/eval/export | Unauth 401; evaluator 403 | REQUIRED | PASS |
| F06 | evaluator | Queue | Proposal panel shows speakers + answers beside rubric | e2e/eval/proposal-panel | Unassigned 404 | REQUIRED | PASS |
| F07 | evaluator | Queue | Next unreviewed + search/filter | e2e/eval/queue-nav | — | REQUIRED | PASS |
| F08 | evaluator | Queue | Peer reviews reveal-after-submit | e2e/eval/peer-reviews | Pending peer hidden | REQUIRED | PASS |
| F09 | admin | Evaluations | Expand individual reviewer comments | e2e/eval/admin-reviews | — | REQUIRED | PASS |
| F10 | evaluator | Queue | Abstain with reason; leaves pending flow; admin rollup counts distinctly + shows reason; aggregate unchanged | e2e/eval/abstain | Second abstain rejected (409) | REQUIRED | PASS |
| F11 | evaluator | Queue | Round deadline in banner; closed round locks scoring server-side + shows closed state | e2e/eval/round-close | Score after close rejected (409) | REQUIRED | PASS |
| F12 | admin | Evaluations | Insights: completion bar, top 10 by aggregate (linked), divergence spread list | e2e/eval/insights | Empty insights state before any scores | REQUIRED | PASS |
| F13 | evaluator | Queue | Hide speaker identities: proposal API + evaluator DOM carry no roster tokens; toggle off restores; admin detail complete | e2e/eval/hide-speakers | Toggle off shows the roster again | REQUIRED | PASS |
| F14 | admin | Evaluations | Bulk-assign wizard: preview deterministic plan (filters, modes, caps, preserve/replace) then apply; durable assignments match plan; stale re-commit blocked; preserve re-run adds nothing | e2e/eval/bulk-assign | Drifted estate between preview and apply rejected (409 stale) | REQUIRED | PASS |

---

## G — Speaker portal

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| G01 | speaker | Portal | Land on next incomplete task | e2e/portal/home | — | REQUIRED | PASS |
| G02 | speaker | Profile | Edit bio; save | e2e/portal/bio | XSS text-only | REQUIRED | PASS |
| G03 | speaker | Files | Upload headshot; preview | e2e/portal/headshot | Bad type rejected | REQUIRED | PASS |
| G04 | speaker | Files | Upload slides | e2e/portal/slides | — | REQUIRED | PASS |
| G05 | speaker | Tasks | Complete task; status flips | e2e/portal/task-complete | — | REQUIRED | PASS |
| G06 | speaker | Tasks | Overdue visual state | e2e/portal/task-overdue | — | REQUIRED | PASS |
| G07 | speaker | Sessions | View own session status | e2e/portal/session | No other speakers’ private data | REQUIRED | PASS |
| G08 | speaker | Portal | Mobile complete bio+task | e2e/portal/mobile | — | REQUIRED | PASS |
| G09 | speaker | Portal | Download own session calendar invite (.ics; placed sessions) | e2e/portal/session-ics | Other speaker 404; unscheduled 404 | REQUIRED | PASS |
| G11 | speaker | Portal | Section nav Home/Profile/Tasks/Sessions active + focus | e2e/portal/section-nav | Short page still shows active change | REQUIRED | PASS |
| G12 | speaker | Portal | Required task depth: required-first ordering, Required badge, https resource link on task cards (DTO + DOM) | e2e/portal/task-depth | http:// link rejected inline | REQUIRED | PASS |
| G13 | speaker | Profile | Rich bio (bold) edited in portal profile; admin speaker view renders formatting via safe renderer | e2e/portal/bio-rich | Doc JSON never leaks into rendered admin view | REQUIRED | PASS |

---

## H — Readiness dashboard

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| H01 | admin | Dashboard | Stats + outstanding list | e2e/dash/overview | — | REQUIRED | PASS |
| H02 | admin | Dashboard | Filter overdue | e2e/dash/filter | — | REQUIRED | PASS |
| H03 | admin | Dashboard | Drill to speaker | e2e/dash/drill | — | REQUIRED | PASS |
| H04 | admin | Dashboard | Live update after portal complete (same session or poll ≤5s) | e2e/dash/live | — | REQUIRED | PASS |
| H05 | admin | Dashboard | Empty state when all clear | e2e/dash/empty | — | REQUIRED | PASS |

---

## I — Schedule studio

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| I01 | admin | Schedule | List view shows sessions | e2e/sched/list | — | REQUIRED | PASS |
| I02 | admin | Schedule | Day view | e2e/sched/day | — | REQUIRED | PASS |
| I03 | admin | Schedule | Week view | e2e/sched/week | — | REQUIRED | PASS |
| I04 | admin | Schedule | Track view | e2e/sched/track | — | REQUIRED | PASS |
| I05 | admin | Schedule | Room view | e2e/sched/room | — | REQUIRED | PASS |
| I06 | admin | Schedule | Drag place into empty slot | e2e/sched/drag-place | — | REQUIRED | PASS |
| I07 | admin | Schedule | Drag causes speaker conflict; blocked with reason | e2e/sched/conflict-speaker | — | REQUIRED | PASS |
| I08 | admin | Schedule | Room overlap conflict | e2e/sched/conflict-room | — | REQUIRED | PASS |
| I09 | admin | Schedule | Keyboard move alternative | e2e/sched/keyboard | — | REQUIRED | PASS |
| I10 | admin | Schedule | Undo last move | e2e/sched/undo | — | REQUIRED | PASS |
| I11 | admin | Schedule | Unscheduled tray | e2e/sched/tray | — | REQUIRED | PASS |
| I12 | admin | Schedule | Timezone displayed | e2e/sched/tz | — | REQUIRED | PASS |
| I13 | admin | Schedule | Move already-placed session to new slot | e2e/sched/move | — | REQUIRED | PASS |
| I14 | admin | Schedule | Unschedule back to tray | e2e/sched/unschedule | — | REQUIRED | PASS |
| I15 | admin | Schedule | Stale version conflict shows recovery UI | e2e/sched/stale | No silent overwrite | REQUIRED | PASS |
| I16 | admin | Schedule | After place, all five views + reload consistent | e2e/sched/persist | — | REQUIRED | PASS |
| I17 | admin | Event Settings + Schedule | Agenda settings: set day window 10:00–16:00 + 30-min interval in settings card; Studio day grid shows 12 slots (10:00–15:30); non-drag place snaps to 30-min duration | e2e/schedule/agenda-settings | API place at 09:00 (outside window) → 409 conflicts[] type "hours" | REQUIRED | PASS |

---

## J — Communications

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| J01 | admin | Comms | Create/edit template merge fields | e2e/comms/template | — | REQUIRED | PASS |
| J02 | admin | Comms | Segment audience; count | e2e/comms/segment | — | REQUIRED | PASS |
| J03 | admin | Comms | Preview all recipients + body | e2e/comms/preview | Send without preview blocked if product requires | REQUIRED | PASS |
| J04 | admin | Comms | Send once; second send idempotent | e2e/comms/send-idempotent | — | REQUIRED | PASS |
| J05 | admin | Comms | Delivery log visible | e2e/comms/log | — | REQUIRED | PASS |
| J06 | admin | Comms | ICS attach for scheduled session | e2e/comms/ics | — | REQUIRED | PASS |
| J11 | admin | Comms | Send with calendar invite attached from picker | e2e/comms/ics-attach-send | Send without invite still works | REQUIRED | PASS |
| J07 | admin | Comms | Role without comms:send cannot send | e2e/comms/authz | 403 | REQUIRED | PASS |
| J08 | admin | Comms | Send without completed preview blocked | e2e/comms/preview-required | Blocked | REQUIRED | PASS |
| J09 | admin | Comms | Edit audience invalidates preview | e2e/comms/preview-invalidate | — | REQUIRED | PASS |
| J10 | admin | Comms | ICS update after reschedule keeps UID bumps SEQUENCE | e2e/comms/ics-update | — | REQUIRED | PASS |
| J12 | admin | Comms | Submission confirmation lifecycle: public submit → queued delivery-log job with rendered merge fields; template editable | e2e/comms/submission-confirmation | Disabled toggle → no new lifecycle job | REQUIRED | PASS |
| J13 | admin | Comms | ICS picker lists actual scheduled sessions (title + time + room); invite carries the placement's real times; reschedule + regenerate bumps SEQUENCE | e2e/comms/ics-picker | Empty picker when nothing scheduled; generate disabled | REQUIRED | PASS |
| J14 | admin | Comms | Rich template body (bold + merge token) edited in rich editor; preview shows rendered body; markup-shaped merge value stays escaped text | e2e/comms/template-rich | No <b> element from recipient data in rendered preview | REQUIRED | PASS |

---

## K — API keys UI

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| K01 | admin | API Keys | Create key with subset of scopes; secret shown once | e2e/keys/create | — | REQUIRED | PASS |
| K02 | admin | API Keys | Revoke key | e2e/keys/revoke | — | REQUIRED | PASS |
| K03 | admin | API Keys | Copy prefix only after dismiss | e2e/keys/secret-once | — | REQUIRED | PASS |
| K04 | admin | API Keys | Non-admin cannot open keys | e2e/keys/authz | — | REQUIRED | PASS |
| K05 | admin | API Keys | Judge demo session mints 4h key, uses and revokes it; seeded key revoke blocked | e2e/keys/demo-clamp | Seeded key revoke → 403 with human copy | REQUIRED | PASS |

---

## L — Empty / error / loading (cross-cutting)

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| L01 | admin | Submissions | Empty list CTA | e2e/states/empty-sub | — | REQUIRED | PASS |
| L02 | admin | Network | Offline/API 500 shows error state not blank | e2e/states/error | — | REQUIRED | PASS |
| L03 | any | Slow | Loading skeletons not infinite hang | e2e/states/loading | — | REQUIRED | PASS |
| L04 | any | Happy paths | No uncaught console errors | e2e/states/console-clean | — | REQUIRED | PASS |
| L05 | admin | Lists | 150-row seed list paginates or virtualizes usable | e2e/states/large-list | — | REQUIRED | PASS |

---

## L2 — Lumen 2 foundation (S-L2-SYSTEM)

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| L2-01 | admin | Lumen 2 state sheet | Review primitives + state anatomy (`data-testid=l2-state-sheet`) | e2e/lumen2/state-sheet | Unauth cannot open sheet | REQUIRED | PASS |
| L2-02 | admin | Login recovery | Session expired → focused recovery panel (no auth alert in shell) | e2e/lumen2/session-expired | Unauth never sees settings shell | REQUIRED | PASS |
| L2-03 | admin | Settings shell | Two-pane category nav + content region | e2e/lumen2/settings-two-pane | Evaluator cannot open settings | REQUIRED | PASS |
| L2-04 | admin | Design Kit | Live public CFP preview depth (hero + form + CTA) | e2e/lumen2/design-preview-public | Admin chrome not rethemed | REQUIRED | PASS |
| L2-05 | admin | Settings a11y | Keyboard focus journey + 390px usable settings | e2e/lumen2/settings-a11y-keyboard | — | REQUIRED | PASS |

---

## N — Admin Speakers list/detail

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| N01 | admin | Speakers | List speakers for event | e2e/admin/speakers-list | — | REQUIRED | PASS |
| N02 | admin | Speakers | Search/filter | e2e/admin/speakers-filter | — | REQUIRED | PASS |
| N03 | admin | Speakers | Detail: tasks + files | e2e/admin/speakers-detail | — | REQUIRED | PASS |
| N04 | admin | Speakers | Open headshot/slides metadata | e2e/admin/speakers-files | No cross-speaker leak | REQUIRED | PASS |
| N05 | admin | Speakers | Complete task on behalf of speaker; portal + readiness update instantly | e2e/speakers/complete-on-behalf | Replay is idempotent 200 no-op; cross-event 404 | REQUIRED | PASS |

---

## Q — Closeout surfaces (Find + portal library N1–N3)

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| Q01 | admin | Find | Open palette, rebuild index, search returns typed hits without console errors | e2e/find/palette | Empty event shows honest empty state | REQUIRED | PASS |
| Q02 | admin | Portal forms | Create portal form, publish, list persists title/fields | e2e/portal-lib/form-publish | Unauth 401 | REQUIRED | PASS |
| Q03 | admin | Resources | Create resource, select row, save, publish | e2e/portal-lib/resource-edit | Unauth 401 | REQUIRED | PASS |
| Q04 | admin | File requests | Create + publish file request | e2e/portal-lib/file-request-publish | Unauth 401 | REQUIRED | PASS |
| Q05 | speaker | Portal library | Published forms + resources listed for speaker | e2e/portal-lib/speaker-list | Cross-event isolation | REQUIRED | PASS |
| Q06 | speaker | File requests | Upload fulfils published file request (fileId linked) | e2e/portal-lib/file-request-fulfill | Other speaker cannot fulfil | REQUIRED | PASS |
| Q07 | admin | Embeds | Admin embed preview iframe allowed by frame-src self | e2e/embeds/preview-frame | Non-embed routes remain frame-ancestors none | REQUIRED | PASS |
| Q08 | admin | Team | Add member invite by email + role; roster updates | e2e/team/invite | Last-admin demotion blocked | REQUIRED | PASS |

---

## O — Admin settings journeys (full rows, not cross-refs)

| ID | Role | Surface | Journey | test_id | Negative | Required | Status |
|----|------|---------|---------|---------|----------|--------|
| O01 | admin | Settings | Event name/dates/tz | e2e/settings/event | Validation | REQUIRED | PASS |
| O02 | admin | Settings | Rooms CRUD | e2e/settings/rooms | — | REQUIRED | PASS |
| O03 | admin | Settings | Tracks CRUD | e2e/settings/tracks | — | REQUIRED | PASS |
| O04 | admin | Settings | Eval rubric edit | e2e/settings/rubric | — | REQUIRED | PASS |
| O05 | admin | Settings | Task templates on accept | e2e/settings/task-templates | — | REQUIRED | PASS |
| O06 | admin | Settings | Airtable projection status read | e2e/settings/airtable-status | — | REQUIRED | PASS |

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
