# Schedule DnD deep investigation + Codex audit

**Date:** 2026-08-10  
**Owner reports:** tray grab flake; place should leave tray; placed tiles won’t move; no click-to-reschedule; CSP insights; E2E miss  

## Dual investigation

| Source | Verdict |
|--------|---------|
| Builder (this pass) | Product UX defects confirmed in code; API place/move OK |
| Independent auditor (Codex-style REVISE_PLAN) | Same roots A/B/C/D; residual ship gates listed |

## Root causes (confirmed)

1. **Tray grab flake** — tray used `<button draggable>`. Chromium often fails first HTML5 drag on buttons.  
2. **Move feels broken** — placement tiles fill the slot hitbox but did **not** call `preventDefault` on `dragover` / handle `drop`. Browser rejects drop when pointer is over the tile (the common case for moves).  
3. **Compact list tiles** — historically `draggable={false}` on week/track/room compact chrome.  
4. **No inspector** — selection only fed keyboard place; no date/time/room form.  
5. **E2E false green** — I06/I13 use synthetic `DragEvent` polyfill targeting **slot** testids, never nested tile drop or real mouse HTML5. Playwright `dragTo` also fails to start HTML5 DnD in Chromium (reproduced).  
6. **CSP** — live tip already allows insights; owner console string without insights = **stale tab / pre-deploy HTML**. Source `index.html` was still stale vs shared — now aligned + governance lock.

## Tray remove honesty

API `listSchedule` already excludes placed sessions from `unscheduled`. SPA now optimistically removes on `placeSession` (drag **and** keyboard) and reloads on failure.

## Fixes shipped

- Tray: `div role="button"` + grip + `user-select: none` / `-webkit-user-drag`  
- Tiles: always draggable; slot tiles wire `dragover`/`drop` to slot handler  
- Click tile → **Reschedule inspector** (room / day / time / apply / unschedule+undo previous)  
- Busy mutations toast instead of silent no-op  
- `index.html` CSP + 8.3 test lock for insights hosts  
- E2E: `playwright/e2e/schedule_dnd_honesty.spec.ts` (tray empty after place, move, inspector, grab contracts, nested drop)

## Similar program gaps

| Surface | Note |
|---------|------|
| Form builder field reorder | `<li draggable>` without setData; E2E only uses move-up buttons |
| Schedule week list | Drop targets sparse (first room × few slots) |
| All HTML5 DnD | No true mouse HTML5 in Playwright Chromium — gate via contracts + synthetic |

## Deploy / owner check

Hard-refresh www.speakerops.org (or new private window). CSP console error without `static.cloudflareinsights.com` should be gone. Schedule: drag from tray once; drag a placed tile to another hour; click a tile and use **Apply reschedule**.
