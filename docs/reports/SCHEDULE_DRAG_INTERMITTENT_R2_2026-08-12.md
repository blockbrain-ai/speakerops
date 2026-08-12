# Schedule Studio — intermittent drag R2 (post window-net fix)

**Date:** 2026-08-12  
**Live tip:** `0.1.0-demo+ff9370f2c` (product SHA includes stuck-drag window net from `cfd89fae3` + quiet loadAll `ff9370f2c`)  
**Owner report (refined):** Drag **intermittently works**. No console errors. Prior “ghost stuck to mouse” was improved by R1; residual is **reliability / drop success**, not a permanent hang.

**Rule this pass:** dual-auditor review **before** further product code changes.

---

## 1. What already shipped (R1) — still on tip

| Fix | Intent |
|-----|--------|
| Window capture-phase `pointermove` / `pointerup` / `pointercancel` while armed | Sole terminal authority (not source-only) |
| `lostpointercapture` → cancel if still armed | Capture revoke cleanup |
| Idempotent `endPointerGesture` | No double-drop |
| Ghost/payload cleared at gesture end | No chrome leased to network RTT |
| `loadAll` not dependent on `view`; silent post-mutation refetch | Less remount / less loading flash mid-session |

E2E green at ship: outside release, Escape, happy path, lostcapture simulation, reliability 10/10, state-machine.

**Owner still sees intermittent failure on live** → residual causes are **not** the original “handlers only on source” class (or not only that).

---

## 2. Symptom taxonomy (map before fixing)

Without a console error, “doesn’t work” can mean several **silent** product paths. Auditors should treat these as distinct:

| Mode | User experience | Code path |
|------|-----------------|-----------|
| **M1** Gesture ends, no place/move | Ghost goes away (or never stuck); session stays put | `onUp` → no slot from `elementFromPoint` → **no toast** |
| **M2** Drop rejected locally | May flash blocked/conflict chrome; no POST | `blockLocalRoomOverlap` / `wouldRoomOverlap` in `performDrop` |
| **M3** Drop blocked by in-flight mutation | Toast “Busy saving another change…” | `mutationInFlightRef` early return |
| **M4** Gesture cancelled mid-drag | Ghost vanishes without drop | `pointercancel` or **`lostpointercapture` → reason `lost`** |
| **M5** Threshold not crossed | Behaves like click/select | `active === false` on up |
| **M6** Ghost stuck (R1 residual) | Rare if R1 fully live | Missed terminal (should be rare after window net) |

Owner said **intermittent works** + **no console error**. Highest prior for R2: **M1, M2, M4** (silent or easy-to-miss).

---

## 3. Ranked residual roots (code-confirmed candidates)

### RC-A — Silent miss on drop hit-test (HIGH for “released but nothing happened”)

```ts
// onUp after endPointerGesture:
const slot = slotTargetFromElement(document.elementFromPoint(snap.clientX, snap.clientY));
if (slot) performDrop(...);
// else: ghost already cleared — ZERO feedback
```

**Why intermittent:**
- Release over **gap / tray / inspector / toolbar / sticky chrome** → null slot.
- Release over **continuation row** may still resolve a slot, but visual “empty space” between cells may not.
- `elementFromPoint` after chrome clear is correct (ghost is `pointer-events: none` and already unmounted by end of gesture) — **unless** layout shifts in the same frame as clear (low).
- Last move may have shown `--over` on a slot, but up coordinates differ slightly (trackpad finger lift) → hit-test miss.

**Gap:** No toast / “release on a time slot” recovery. User reports “doesn’t work,” console clean.

### RC-B — `lostpointercapture` cancels active drag too aggressively (HIGH for intermittent cancel)

```ts
onLost → endPointerGesture({ reason: "lost" })  // cancel, never drop
```

**Why intermittent:**
- UA or OS may revoke capture during drag (scroll intent, focus change, DevTools, trackpad gesture).
- Re-render of source during arm/active still possible (selection / `aria-grabbed` / pending).
- R1 **correctly** no-ops lost after self-`releasePointerCapture`; unexpected lost still **aborts** drop with no “try again” toast.

If owner was mid-drag and capture dies, ghost clears and drop never commits — feels random.

### RC-C — Local overlap pre-flight silently blocks place/move (MEDIUM)

`performDrop` calls `blockLocalRoomOverlap` → conflict toast path exists via `showConflict`. Should not be fully silent. Confirm live toast visibility (z-index / duration). If toast is easy to miss, owner still says “no error.”

### RC-D — `mutationInFlight` serialisation (MEDIUM)

After a successful drop, background silent `loadAll` + mutation finally clear busy. Rapid second drag **start** is allowed (dead-window fix), but **commit** can toast busy. Owner may interpret as flake if toast is subtle.

### RC-E — Threshold / click vs drag (LOW–MEDIUM)

6px activation. Very short flicks may select only. Not usually “intermittent after long drag.”

### RC-F — View / silent loadAll remount (LOW after ff9370f2c)

View no longer reloads board. Silent refetch still replaces placements arrays; stable keys should preserve tiles. Less likely primary after R1+quiet loadAll.

### Ruled less likely

| Item | Why |
|------|-----|
| Console JS exceptions | Owner: none |
| API 401/500 always | Would toast network/error paths more often |
| Deploy missing R1 | Health `+ff9370f2c` includes R1; hard-refresh still required once |

---

## 4. Evidence gaps (what we still don’t know from owner)

To pin M1 vs M4 vs M2, ask (or instrument):

1. When it fails: does the **ghost appear** and follow the cursor?  
2. On release: does ghost **disappear** (terminal ran) or **stick** (R1 residual)?  
3. Any toast (Busy / conflict / network)?  
4. Tray→slot vs tile→slot? Day view only?  
5. Fail more often on **empty** slots or **near filled** tiles?

Until then, treat **M1 + M4** as co-primary residual hypotheses.

---

## 5. Proposed R2 fix plan (for auditor approval — do not implement until PASS)

### MUST

1. **Last-good slot memory**  
   On every active `pointermove` when hit-test finds a slot, store `lastSlotRef = { roomId, startsAt, key }`.  
   On `pointerup` if `elementFromPoint` is null, **fall back to lastSlotRef** if set within last N ms (e.g. 250–400ms) and still plausible.  
   Clears on cancel/lost/escape/successful drop.  
   **Rationale:** trackpad lift often leaves last hover on a valid slot while final coordinates miss.

2. **Honest miss feedback**  
   If active up and no slot (even after fallback): toast  
   `"Drop on a time slot in the board (not the tray or toolbar)."`  
   Kind: error or neutral; auto-clear. No silent no-op.

3. **Honest cancel feedback (optional short toast)**  
   On `lost` / `pointercancel` while `active`: toast  
   `"Drag cancelled — try again."`  
   So M4 is not invisible.

4. **Do not drop on `lost`**  
   Keep cancel-on-lost (stale coordinates). Do **not** auto-performDrop from lastSlot on lost (unsafe). Fallback is **up-only**.

5. **Hard comments** at hit-test + lastSlot:  
   Intermittent miss without toast was owner R2 report; lastSlot + miss toast are mandatory.

6. **E2E**  
   - T1: drag past threshold over a slot (assert `--over` / last slot), release slightly **outside** board → still places if lastSlot fallback within window **OR** if we only toast, assert toast (prefer place via fallback for UX).  
   - T2: release far from board with **no** prior over → toast, no POST.  
   - T3: existing happy path + stuck-ghost suite still green.  
   - T4: lostcapture mid-drag → ghost gone + optional cancel toast; no place.

### SHOULD

7. Prefer **last hovered slot** over pure point at up even when point hits non-slot chrome **if** last hover was recent (same as 1).  
8. Ensure conflict / busy toasts are visible above board (z-index audit).  
9. Consider `pointerdown` `preventDefault()` once active (after threshold) to reduce trackpad cancel (careful with click path).

### MUST NOT

- Reintroduce source-only move/up  
- Gate pointerdown on busy  
- Drop on lostpointercapture  
- Dual window+element performDrop  

---

## 6. Dual-auditor results (2026-08-12)

| Auditor | Verdict | Confidence | Primary residual |
|---------|---------|------------|------------------|
| **A** | **REVISE_PLAN** | 0.84 | **RC-A M1 silent miss** primary; RC-B secondary |
| **B** | **REVISE_PLAN** | High | **RC-A confirmed**; RC-B real but **over-ranked** as co-primary |

### Consensus (intersection)

| Topic | Agreement |
|-------|-----------|
| R1 still correct / present | Yes |
| Silent miss on active up (no toast) | **Confirmed MUST** — grid gutters + ghost offset amplifiers |
| lost/cancel silent while active | Real M4 — **toast only**, never auto-drop |
| Unrestricted lastSlot place on any null up | **Unsafe** (destroys cancel-by-release-outside) |
| Drop on lostpointercapture | **Forbidden** (both) |
| Console / dual-end / StrictMode | Not primary |
| Local overlap / busy | Already toast — not “no error” |

### Divergence (resolved for implementer)

| Issue | A | B | **Adopted contract** |
|-------|---|---|----------------------|
| lastSlot auto-place | Spatial + temporal hybrid MUST | Toast-only first; board-gap lastSlot optional later | **Phase 1 MUST = feedback only.** Phase 1b SHOULD = lastSlot **only if** `elementFromPoint` is **inside schedule board** but not a slot, age ≤ ~250ms, lastSlot set |
| Toast visibility / fixed | Promote fixed/sticky MUST | Deprioritize z-index as root cause | Ensure toast is readable; fixed if needed, not the main theory |
| T1 e2e outside board | Prefer place via fallback | Prefer toast + no POST | **Outside board → toast + no POST** (matches existing stuck-ghost outside-release) |

---

## 7. Revised R2 implementation contract (post-auditor)

### MUST (one PR)

1. **Active pointerup + no slot** → toast  
   `"Drop on a time slot on the board (not the tray, toolbar, or gaps between cells)."`  
   Auto-dismiss; no POST.
2. **Active `lost` / `pointercancel`** → short toast  
   `"Drag cancelled — try again."`  
   Never `performDrop` on lost/cancel.
3. **Hard comments** at hit-test / miss path (owner R2 intermittent silent miss; grid gap + ghost offset).
4. **E2E**  
   - Outside/toolbar release → toast visible (or `data-testid` status) + **no place POST**  
   - Far miss, no prior over → toast, no POST  
   - lostcapture mid-drag → ghost gone + cancel toast, no place  
   - Happy path + existing reliability / stuck-ghost still green  
5. Keep R1: window sole authority, latch, no busy-gate pointerdown, no dual performDrop.

### SHOULD (same PR if tiny)

6. **Board-gap lastSlot only:** if up point is inside `[data-testid=schedule-board]` (or day grid) **and** slotTarget is null **and** lastSlot age ≤ 250ms → `performDrop(lastSlot)`. Never when under tray/toolbar/outside board.  
7. Align ghost offset closer to cursor (reduce +14/+12) or document aim-vs-cursor.  
8. Optional same-slot toast: `"Already in that slot"`.

### MUST NOT

- lastSlot place when releasing outside the board / on tray  
- Drop on lostpointercapture  
- Source-only terminals / busy-gate pointerdown  

---

## 8. Status

| Step | State |
|------|--------|
| R1 stuck-ghost | Shipped `cfd89fae3` |
| Quiet loadAll | Shipped `ff9370f2c` |
| R2 residual investigation | Done |
| Dual auditor | **REVISE_PLAN** both; diagnosis accepted; contract above |
| Product code R2 | **Not started** — await owner GO on revised contract |

**No product code changed in this investigation pass.**
