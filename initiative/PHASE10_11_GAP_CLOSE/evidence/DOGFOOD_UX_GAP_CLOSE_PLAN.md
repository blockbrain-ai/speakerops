# Dogfood UX gap-close plan — interactive honesty

**Date:** 2026-08-10  
**Trigger:** Owner walk on www.speakerops.org after magic-link login  
**Branch tip before work:** `742a0283e` (pushed clean)  
**Exit:** No stubs, no DEFER, full multi-role click-through proof  

---

## A. What the owner saw (symptoms)

| Surface | Symptom |
|---------|---------|
| **Schedule list** | Session titles look like links; click does nothing useful; console error reported |
| **Schedule day** | Drag from unscheduled tray works |
| **Overview** | Stuck on “Loading readiness…” / never paints real content |
| **Submissions** | Appears OK |
| **Evaluations** | CSV export works; rows not openable as submission detail |
| **Console** | CSP blocks `static.cloudflareinsights.com/beacon.min.js` |

---

## B. Root causes (verified)

### B1. Overview hang — **real product defect (P0)**

- Live `GET /api/events/evt_dogfood/readiness` returns **200**, schema-valid, but took **~47s** and **~93KB** for **290** outstanding rows (150 speakers).
- Implementation in `getReadiness` does **per-task `findPersonById`** (N+1) after listing participations + tasks.
- SPA shows loading until readiness + metrics resolve → UI looks permanently broken under dogfood seed scale.
- **Why E2E missed it:** Phase 11 keystone asserts overview **attention / DOM within 5s** may pass if seed was smaller at test time, or asserts presence without asserting **non-loading terminal state + data**. Console sweep only waits 800ms and does not assert readiness content. No load-budget gate on readiness API.

### B2. Schedule list “links” — **UX defect + possible console error (P1)**

- List titles are `<button class="eval-queue__link">` that only `setSelectedPlacementId` — **do not switch to day view** or scroll to the slot (unlike conflict focus which sets `view: "day"`).
- Looks like navigation; feels dead in list view.
- Console error may be CSP (below) or a secondary throw when selection state interacts with day grid; must fix selection→day focus path either way.

### B3. Evaluations no click-through — **spec-shaped, UX-poor (P2)**

- Inventory **F05** is admin sort + CSV export only.
- Drill-down into submission is **E02** on **Submissions**, not Evaluations.
- Rows still look interactive; should **link to submissions detail** (or explicit non-link chrome) so operators are not stuck.

### B4. CSP / Cloudflare Insights — **platform noise as hard error (P2)**

- CSP `script-src 'self' https://challenges.cloudflare.com` blocks zone-injected Web Analytics beacon.
- Not a product feature failure, but **pollutes console** and confuses real errors.
- Fix: allow `https://static.cloudflareinsights.com` in production CSP **or** disable CF Web Analytics on the zone. Prefer CSP allowlist if analytics stay on.

### B5. Systemic E2E gap — **process defect**

| What we had | What we lacked |
|-------------|----------------|
| Soul keystone (shallow D proofs) | Full **click every primary control** per role |
| Console sweep (pageerror only) | Assert **terminal data states** (not stuck loading) |
| Unit tests for utils | **API latency budgets** at dogfood scale (≥150) |
| Role landings (auth) | **Admin → eval → speaker** end-to-end program path |

---

## C. Rectification plan (implementation order)

### Wave 1 — Unblock overview (P0)

1. **Batch person enrich** in `getReadiness` (single query / map by personId; no await in loop).
2. **Cap outstanding payload** for UI (e.g. top N=50 overdue-first) while **stats remain full** (`outstandingTasks` still accurate). Optional `?limit=` query.
3. SPA: never show infinite loading — **timeout + error recovery** if readiness > 5s; show partial metrics if ready.
4. Unit/integration test: 150 participations readiness completes under budget in-memory; schema with capped list.

### Wave 2 — Schedule list honesty (P1)

1. List session button: `setSelectedPlacementId` + **`setView("day")`** + set focused day from `placement.startsAt` (mirror conflict focus).
2. Guard room/time formatters against missing room (no throw).
3. Playwright: list view → click session → day view shows selected placement tile.

### Wave 3 — Evaluations UX (P2)

1. Eval rollup title/row → navigate/link to `/admin/submissions` with deep-link query for submission id (or open detail if already supported).
2. E2E: admin eval export still works; click opens submission surface.

### Wave 4 — CSP (P2)

1. Add `https://static.cloudflareinsights.com` to production `script-src` (and connect-src if needed).
2. Governance/security tests updated.

### Wave 5 — Full multi-role click-through suite (process close)

New Playwright suite `playwright/e2e/dogfood_full_workflow.spec.ts` (DOGFOOD_KEYSTONE=1):

| Role | Journey (must not stuck-load; no pageerror) |
|------|-----------------------------------------------|
| **Admin** | Login → Overview (data visible ≤8s) → Submissions list+open detail → Evaluations export+row open → Schedule list click→day + drag place → Speakers → Comms shell → Settings shell |
| **Evaluator** | Login → `/eval` queue → open assignment → score save (or empty-state honest) |
| **Speaker** | Login → portal home → bio/tasks surfaces (or empty-state honest) |

Gates: inventory still 115; typecheck; vitest readiness perf; dogfood deploy; suite green; console sweep still green.

### Wave 6 — Docs + evidence

- Update OPERATIONS / dogfood notes on allowlist + readiness scale.
- Evidence: `DOGFOOD_UX_GAP_CLOSE_EVIDENCE.md` with before/after timings and suite hash.

---

## D. Non-goals (still constitution)

- Full CRM, embeds, gallery CMS, AI placer
- Multi-tenant production cutover
- Replacing sbek harness

---

## E. Codex gate

Ask Codex Sol xhigh: ADEQUATE / REVISE on this plan before code lands. Fold notes then implement.

---

## F. Definition of done

- [ ] Overview shows real readiness/stats on dogfood within **8s** p95
- [ ] Schedule list session click focuses day placement without throw
- [ ] Evaluations row reaches submission detail path
- [ ] CSP no longer blocks CF insights beacon (or analytics disabled)
- [ ] Multi-role dogfood workflow suite **PASS**, no pageerror
- [ ] All committed + pushed to `origin/section-runner/speakerops`
