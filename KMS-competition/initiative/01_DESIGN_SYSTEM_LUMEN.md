# Design system synthesis — **Lumen**

**Date:** 2026-08-08  
**Decision authority:** Grok (owner delegated “make the decision”)  
**Inputs:** `design/design-kit-REPORT-grok.html` (Program OS), `design-kit-REPORT-claude.html` (Greenroom), `design-kit-REPORT-codex.html` (Northstar)  
**Auditor process:** draft below → Claude + Codex adversarial critique → fold into this file (see §6)

---

## 1. Verdict

**Adopt name: Lumen** (light, clarity, program ops — not “enterprise sludge”).

| Source kit | Take | Leave |
|-----------|------|--------|
| **Grok / Program OS** | Full token scale, competitor-grounded rubric, schedule tiles, role matrix, interactive brand preview | Working name “Program OS” (product = SpeakerOps) |
| **Claude / Greenroom** | Live re-theme demo, role×capability matrix for E2E, merge gates, “beauty as token change”, status colors locked under brand | Over-heavy dark strip as default; any vibe of product-as-agent-platform |
| **Codex / Northstar** | Quiet density discipline, schedule studio affordances, trust-before-automation (preview send), performance budgets, accessibility as behavior | Name “Northstar” (keep as internal principle: *quietly excellent*) |

**Synthesis principle:** *Northstar quiet craft + Greenroom living tokens + Program OS completeness.*

---

## 2. Visual lock (implement these tokens)

### Mood
Apple Calendar calm × Linear restraint × conference ops density only where needed.  
**Light default.** Soft graphite text on cool gray canvas. No dark-dingy cockpit.

### Color (CSS variables)

```css
:root {
  --lumen-bg: #f5f5f7;
  --lumen-surface: #ffffff;
  --lumen-text: #1d1d1f;
  --lumen-text-secondary: #6e6e73;
  --lumen-border: rgba(0,0,0,0.08);
  --lumen-brand: #4f46e5;      /* indigo — primary action */
  --lumen-brand-soft: #eef2ff;
  --lumen-accent: #0d9488;     /* teal — healthy completion */
  --lumen-success: #059669;
  --lumen-warn: #d97706;
  --lumen-danger: #dc2626;
  --lumen-info: #0284c7;
  --lumen-radius-sm: 8px;
  --lumen-radius-md: 12px;
  --lumen-radius-lg: 16px;
  --lumen-radius-xl: 22px;
  --lumen-radius-pill: 9999px;
  --lumen-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --lumen-shadow-sm: 0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03);
  --lumen-focus: #4f46e5;
  --lumen-focus-ring: 0 0 0 3px rgba(79, 70, 229, 0.35);
  --lumen-disabled-opacity: 0.45;
  --lumen-space-1: 4px;
  --lumen-space-2: 8px;
  --lumen-space-3: 12px;
  --lumen-space-4: 16px;
  --lumen-space-6: 24px;
  --lumen-z-dropdown: 40;
  --lumen-z-modal: 50;
  --lumen-z-toast: 60;
  --lumen-motion: 150ms;
  --lumen-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --lumen-success-soft: #d1fae5;
  --lumen-warn-soft: #fef3c7;
  --lumen-danger-soft: #fee2e2;
  --lumen-info-soft: #e0f2fe;
}
```

**Invariant:** status colors (success/warn/danger/info) **do not** retheme with brand color — Accepted stays green under any event brand.  
**Invariant:** status is **never color-only** — every badge has a text label (and optional icon). Soft-bg + strong-fg pairs required.  
**Invariant — retheme blast radius:** **Public CFP + speaker portal** adopt event brand tokens. **Admin + evaluator chrome stay Lumen default** always (prevents ugly brand destroying daily ops).  
**Invariant — brand contrast:** Design Kit publish validates brand vs on-brand text; auto-derive light/dark label color from luminance; **block** publish if contrast fails AA for primary buttons on public CFP.  
**Dark mode:** out of scope for dogfood claim; ignore `prefers-color-scheme` dark (still honor `prefers-reduced-motion`).

### Type
Inter / system UI. Display tight tracking (−0.03em). Body 16/1.5. Overlines 12 caps for section labels.

### Components (required kit)
Buttons (primary pill, secondary, ghost, danger), inputs/selects/textarea + error, checkboxes/radios, tags, status badges (draft/submitted/in_review/accepted/rejected), cards, tables, empty states, modal, toast, sidebar nav, tabs, speaker card, form-builder block, schedule tile + conflict tile, dashboard stat, Design Kit panel.

### UX laws
1. **One job per surface** (public form vs portal vs eval vs admin schedule).  
2. **Trust before automation** — comms **must** show exact audience count + rendered body + missing merge fields before send; any edit invalidates preview.  
3. **Schedule is hero** — snap, ghost, plain-language conflicts, undo, keyboard alternative; valid place persists across all five views + reload.  
4. **Speed as brand** — optimistic task ticks; on reject (version/authz/network) **revert + toast** (never silent fail).  
5. **Theme via tokens only** — no freeform CSS/HTML (XSS).  
6. **Role-appropriate starts** — admin → readiness; evaluator → queue; speaker → next task.  
7. **Status never color-only** — label required.  
8. **Focus visible** — `--lumen-focus-ring` on all interactive controls; modals trap focus + Esc + restore.

---

## 3. Product chrome structure

```
Admin: Overview | CFP / Forms | Submissions | Evaluations | Speakers | Schedule | Comms | Settings
         Settings → Event · Rooms/Tracks · Tasks · Design (Brand) · API Keys · Airtable status
Evaluator: My queue only
Speaker: Tasks | Profile | My sessions
Public: CFP form only
```

**Active event** always visible on admin mutating surfaces. No enterprise module zoo (CRM/Marketing/CMS).

---

## 4. Design Kit product surface

| Control | Safe | Unsafe |
|---------|------|--------|
| Brand color, soft tint | ✓ CSS vars + **contrast gate** | Unchecked low-contrast hex |
| Logo image | ✓ PNG/WebP/JPEG as inert `<img>` from R2 | **SVG rejected in dogfood** unless later amendment with proven sanitizer; never inline script |
| Radius scale (soft/curvy/round) | ✓ | |
| Wordmark text | ✓ | |
| Freeform CSS/JS/HTML | | ✗ forever |
| Draft vs publish | ✓ draft local to admin until publish | Draft tokens must not leak to public CFP |

CLI: `speakerops design get|set|publish` same tokens as UI.

---

## 5. Mapping to competition win

Judges “use/buy”: calm speed + exact program loop + CF/Airtable fit + agentic CLI.  
Lumen is the **visible proof** of judgment vs Sessionboard sludge and vibe-coded dark UIs.

---

## 6. Auditor feedback (to fold)

### Round 1 prompt (Codex + Claude)

> Critique `01_DESIGN_SYSTEM_LUMEN.md` only. AGREE / AGREE_WITH_NOTES / REVISE.  
> Must not remove Lumen token lock or light-default. Challenge gaps for browser E2E, a11y, schedule, Design Kit security. Return MUST_FIX / SHOULD / NIT.

*(Filled after advisory runs — see `initiative/audits/DESIGN_ADVISORY.md`.)*

---

## 7. Implementation ownership (SR)

| Artifact | Section family |
|----------|----------------|
| Token CSS + primitives | Phase 1 scaffold / design foundation |
| Design Kit admin + CLI | Phase 2 settings + Phase 7 CLI |
| Visual regression optional | Phase 8 E2E (screenshots of kit) |
| Design docs HTML | Phase 9 documentation |

---

*— Design freeze candidate for SpeakerOps*
