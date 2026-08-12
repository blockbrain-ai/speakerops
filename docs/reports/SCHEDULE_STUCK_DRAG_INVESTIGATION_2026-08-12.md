# Schedule Studio — stuck drag investigation (no code changes yet)

**Date:** 2026-08-12  
**Live tip at investigation:** `7200733fd` (landing shots); schedule DnD code last behaviourally touched `16923ba97` / `05f0080d9` (morning) + tray search G2 in `52779034f`.  
**Owner symptom (refined):**  
> “I try and drag something and it physically moves the text but then the text almost stays attached to the mouse and it won't let me put it down anywhere.”  
**Intermittent:** sometimes works again without deploy.

**Rule for this pass:** diagnose + dual-auditor review **before** any fix. After fix: hard comments in code so this class of bug does not recur silently.

---

## 1. What the user is seeing (mapped to code)

| Observed | Code meaning |
|----------|----------------|
| Text/session title moves with the pointer | Floating `.schedule-studio__ghost` is shown when `dragPayload` is set; position from `ghostPos` updated on `pointermove` |
| Stays attached to the mouse | `dragPayload` and/or `ghostPos` remain set; gesture never reaches a **terminal** path |
| Cannot put it down anywhere | `onDragPointerUp` did not run cleanly (or ran without clearing state); drop never calls `performDrop` / cancel path |

This is **not** “page load hang” and **not** (primarily) the Schedule API being down. It is a **stuck pointer-drag state machine**: drag armed → active → ghost live → **no reliable end**.

Escape is documented as cancel (`keydown` Escape → `cancelPointerDrag`), so a fully stuck session may still recover if the user presses Escape — if they do not know that, it feels “broken forever.”

---

## 2. How drag is implemented today

File: `apps/web/src/pages/schedule/ScheduleStudio.tsx`

1. **pointerdown** on tray item / placement tile → `onDragPointerDown`  
   - Stores `pointerDragRef` (payload, start coords, `active: false`, element)  
   - Calls `el.setPointerCapture(pointerId)` in try/catch (**failures are swallowed**)  
2. **pointermove** (React handler **only on that same element**) → after 6px threshold sets `active`, `setDrag(payload)`, updates `ghostPos`, hit-tests slot via `document.elementFromPoint`  
3. **pointerup** (same element only) → release capture; if active, hit-test slot → `performDrop` or `setDrag(null)`  
4. **pointercancel** (same element only) → `cancelPointerDrag`  
5. **Escape** (window, only while `dragPayload` set) → `cancelPointerDrag`

CSS: `user-select: none`, `touch-action: none` on tray + tiles (good). Ghost has `pointer-events: none` (good for hit-test).

There is **no**:
- `window` / `document` `pointerup` / `pointermove` / `pointercancel` safety net  
- `lostpointercapture` handler  
- Comment-enforced invariant that “terminal events must always clear ghost + payload + ref”

E2E (`pointerDragTo`) uses ideal Playwright mouse down → move → up on a living source; it does **not** stress capture loss, source unmount mid-drag, or pointerup outside capture.

---

## 3. Ranked root causes (confidence)

### RC-1 — Capture-only lifecycle (HIGH) — primary match for stuck ghost

**Mechanism:** Move/up/cancel are attached only to the **source** node. Correctness depends on `setPointerCapture` remaining on that node until release.

If capture is **never acquired** (silent catch) or **lost mid-gesture**:
- While the pointer is still over the source, move can still fire and cross the 6px threshold → ghost appears and may track briefly.  
- Once the pointer leaves the source **without capture**, further moves may stop updating **or** behave inconsistently by browser;  
- **`pointerup` lands on whatever is under the cursor, not the source** → `onDragPointerUp` never runs → `dragPayload` / last `ghostPos` remain → **ghost stays attached to the last known cursor position / state; release does nothing.**

Even with capture working most of the time, browsers revoke capture on several paths (see RC-2). Intermittency matches “usually works, sometimes stuck.”

**Why recent deploys feel correlated:** any extra re-renders, tray list identity changes (G2 search/sort in `52779034f`), or background `loadAll` make capture-loss races slightly more likely — but the **architecture has been fragile since** `9142e9e18` (pointer DnD rewrite). CSS view-tab proportion commits (`4926170b9`, `04a3c824f`) are **visual only** and are **not** a causal fix/break for this symptom.

### RC-2 — No `lostpointercapture` cleanup (HIGH)

When the capture target is disconnected or the UA releases capture, the browser fires **`lostpointercapture`**. We never listen. State machine stays “active drag” with ghost.

**Disconnect triggers that happen in product use:**
- Background `void loadAll(activeEventId)` after place/move/unschedule (success path always refetches) while user already started the **next** drag  
- `loadAll` also depends on **`view`** (`[isCurrent, view]`) — every view-tab change full-reloads schedule+rooms+tracks and rebuilds the board  
- Optimistic `setUnscheduled(filter…)` on place removes tray nodes (after up in happy path; still relevant if timing races with re-render)  
- Tray G2 filter/sort reordering list items (same keys usually preserve DOM; not free of risk under concurrent updates)

### RC-3 — Terminal path asymmetry (MEDIUM)

On pointerup when a slot **is** found:

```text
setGhostPos(null);
performDrop(...);  // keeps dragPayload until place/move .finally()
```

On pointerup when **no** slot:

```text
setDrag(null); setDragOverSlot(null);
```

If pointerup is **missed**, neither path runs. If pointerup runs but `performDrop` throws **synchronously** before scheduling `.finally()`, ghost/payload can stick (less likely; `performDrop` is mostly sync setup + void async).

Also: ghost is rendered whenever `dragPayload` is set; if `ghostPos` is cleared but payload is not, ghost can sit at CSS default `left:0; top:0` (different bug: corner ghost). Owner report is **attached to mouse** → payload + position both live → **up not processed**.

### RC-4 — Historical “dead window” is a different bug (context only)

`05f0080d9` fixed post-drop **inability to start the next drag** (`busy` gated pointerdown). That is **not** “ghost stuck during drag.” Residual risk: `mutationInFlightRef` blocks commits with a toast, but does **not** clear an already-active ghost. If user drops while busy, drop may no-op with toast while up path still clears drag **if up ran**. If they only experience stuck-during-drag, RC-1/2 dominate.

### RC-5 — Network / API “hang” (LOW for this refined symptom)

`listSchedule` is a simple D1 list; unauth probe to live schedule is fast 401. A slow refetch can show “Loading schedule…” and disable Refresh, but does **not** by itself glue a ghost to the cursor. Secondary: slow/repeated `loadAll` **amplifies** RC-2 remount races.

### Ruled out as direct cause of stuck ghost

| Change | Why not |
|--------|---------|
| G1 view-tab 28px CSS | Height/padding only; no pointer handlers |
| Learn / landing / docs link fixes | Unrelated surfaces |
| Comms wizard exclusivity | Unrelated |

---

## 4. Timeline (relevant commits)

| When (approx) | Commit | Effect on this bug |
|---------------|--------|--------------------|
| Aug 10 | `9142e9e18` | Pointer DnD replaces HTML5; **capture-on-source model introduced** |
| Aug 10 | `36f551fa6` | Cancel click-suppression hygiene only |
| Aug 12 morning | `05f0080d9` / `16923ba97` | Dead-window / rollback / e2e state machine — **does not add window-level up** |
| Aug 12 ~17:46 | `52779034f` | Tray search/sort (G2) — more re-renders on tray; **possible race amplifier** |
| Aug 12 later | Schedule tab CSS, Comms, Learn, landing | Unrelated to stuck ghost |

**Conclusion:** Intermittent stuck-drag is a **latent defect in the pointer state machine**, not a one-off bad deploy that permanently broke schedule. “Working again” without code change is expected when capture holds for that gesture.

---

## 5. Dual-auditor results (2026-08-12)

| Auditor | Verdict | Confidence | Diagnosis |
|---------|---------|------------|-----------|
| **A** | **REVISE_PLAN** | 0.88 | RC-1 + RC-2 **confirmed** primary |
| **B** | **REVISE_PLAN** | High | RC-1 + RC-2 **confirmed**; could not disprove |

**Consensus:**
- Refined symptom (ghost glued to mouse / cannot drop) = **stuck pointer state machine**, not API hang or CSS view-tab work.
- Implement **after** plan amendments below (not the draft MUST list verbatim).
- silent-`loadAll` / view-decouple = **SHOULD follow-up**, not gate for this bug.
- **NO-GO** on unrevised plan; **GO** once amendments are the implementation contract.

### Auditor amendments folded in (required)

| ID | Amendment | Why |
|----|-----------|-----|
| **P1** | **Single terminal authority** — window listeners own move/up/cancel while armed; element keeps `pointerdown` only (or element handlers no-op when window session active). Idempotent `endPointerGesture` latch so dual delivery cannot double-`performDrop`. | Window + element both up → double place / busy toast |
| **P2** | **`lostpointercapture` only if** `pointerDragRef` still matches that `pointerId` | Own `releasePointerCapture` also fires lostcapture — must no-op after normal end |
| **P3** | **Clear ghost + `dragPayload` at gesture end** before async place/move; pass **local payload snapshot** into commit; do **not** re-`setDrag` for network RTT (pending ids already show save chrome) | Happy-path corner ghost + “still dragging” feel; contradicts terminal-clear invariant |
| **P4** | Register window listeners on **pointerdown (armed)**, not only after 6px threshold | Capture can die before activation; still need clean end |
| **P5** | Fix misleading catch comment (“capture optional / hit-test still works”) — false without window net | Landmine for future editors |
| **P6** | E2E: outside release, Escape, happy path, single-commit, below-threshold click; capture-loss/unmount if cheap | Happy-path `pointerDragTo` alone insufficient |

---

## 6. Revised fix plan (implementation contract — approved shape)

### MUST (one PR)

1. **`endPointerGesture` / single latch** — one function ends a pointerId once: remove window listeners, release capture if held, clear `pointerDragRef`, `dragPayload` (+ ref), `ghostPos`, `dragOverSlot`; set click-suppression only if drag was active.
2. **Window-level `pointermove` / `pointerup` / `pointercancel`** with `{ capture: true }` while gesture armed — **sole** move/up/cancel authority.
3. **`lostpointercapture`** → cancel cleanup **only if** matching armed pointerId still in ref.
4. **On pointerup with valid slot:** snapshot payload + slot → **clear all drag chrome** → `performDrop`/`place`/`move` from snapshot **without** keeping ghost mounted for RTT.
5. **Hard comments** at the state machine (owner request + auditor text):
   - Symptom: ghost stuck to mouse / cannot drop
   - Window + lostpointercapture mandatory; do not re-bind move/up only to source
   - Terminals must be idempotent; do not keep ghost as mutation busy flag
   - Do not gate pointerdown on `busy` (dead-window lesson)
   - Capture is not optional without the window net
6. **Regressions (non-negotiable):**
   - T1 E2E: past threshold, release over non-slot chrome → `schedule-dnd-ghost` detached; no place
   - T2 E2E: Escape → ghost gone
   - T3 E2E: happy-path tray→slot and tile→slot still work (existing reliability)
   - T4 E2E: one gesture → single commit (no double place / no spurious busy toast)
   - T5 E2E: below-threshold press still selects
   - T6 Unit or harness: after synthetic terminal, ref/payload/ghost/over all null
   - T7 if cheap: mid-drag source unmount / filter or view change → ghost cleared

### SHOULD (same PR only if tiny; else follow-up)

7. `-webkit-user-drag: none` on tray/tile  
8. Silent background `loadAll` (no full `loading` flash during armed drag)  
9. Decouple `loadAll` from `view` identity (API returns full set; view is echo-only)

### MUST NOT

- Reintroduce native HTML5 DnD  
- Gate `pointerdown` on `busy` / pending  
- CSS-only “fix”  
- Leave element `onPointerUp` **and** window `pointerup` both calling `performDrop`

---

## 7. Proof plan after fix

1. Manual dogfood: tray-place + tile-move, release outside board, Escape, rapid second drag, view switch mid-idle  
2. Schedule DnD e2e reliability + state machine + new stuck-ghost cases  
3. Deploy dogfood; hard-refresh  
4. Keep this report + code comments as permanent trail  

---

## 8. Code anchors

| Concern | Location |
|---------|----------|
| Capture + element-only handlers | `onDragPointerDown` / `Move` / `Up` / `Cancel` ~1104–1197 |
| Ghost render | ~2263–2277 |
| `performDrop` keeps payload until async finally | ~1015–1081 |
| `loadAll` depends on `view` + always `setLoading(true)` | ~329–398 |
| Post-mutation background `loadAll` | place/move/unschedule success paths |
| Tray G2 filter (re-render surface) | `filteredUnscheduled` + tray map |
| Prior DnD investigation (HTML5 era) | `initiative/.../SCHEDULE_DND_INVESTIGATION.md` |

---

## 9. Status

| Step | State |
|------|--------|
| Investigation | Done |
| Dual auditor | **REVISE_PLAN** both; diagnosis **ACCEPT**; revised contract above |
| Product code change | **Not started** (await owner GO on revised plan) |

**No product code was changed in this investigation pass.**
