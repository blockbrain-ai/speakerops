# Design advisory — independent critique (Claude)

**Scope reviewed:** `initiative/01_DESIGN_SYSTEM_LUMEN.md`, `initiative/00_CONSTITUTION.md`, `initiative/BROWSER_E2E_INVENTORY.md`, `research-pack/SYNTHESIS-BEST-FOOT-FORWARD.md`
**Date:** 2026-08-08
**Ground rules honored:** Lumen token lock and light-default retained. No soul test removed or weakened. No execute/deploy steps invented — this is advisory only.

---

## 1. Verdict

**AGREE_WITH_NOTES**

Lumen is the right synthesis: light-default calm, tokens-only theming, status colors locked under brand, one job per surface, schedule as hero. The constitution's browser-E2E law and final-phase docs law are the strongest anti-slop mechanisms in the whole programme — keep them exactly as written. The notes below are gaps that will surface *during* build if not closed *before* it: the token lock is incomplete for the interaction states the soul tests demand, and the Design Kit's one genuinely dangerous input (brand color + SVG logo) has no guardrails specified. None of these require reopening the visual decision.

---

## 2. MUST_FIX

### MF-1 — Brand color has no contrast guardrail
The Design Kit lets an admin set any brand color, and S-THEME requires the public CFP to reflect it. If an operator picks `#f0e68c` (or any light hue), primary pill buttons with light text on the public form fail WCAG contrast — on the *one surface external submitters use*. C03's only negative is "invalid hex."
**Fix:** specify a contrast rule at token-set time: either (a) validate brand color against a minimum contrast ratio for on-brand text and reject/warn, or (b) auto-derive the button text color (light/dark) from the brand luminance. Add the chosen behavior to §4 of the Lumen doc as a Safe/Unsafe row, and add an inventory row (see §5, gap G-2).

### MF-2 — "SVG sanitized" is asserted, not specified
§4 says logo upload is "PNG/SVG sanitized" and marks inline-script SVG unsafe, but names no mechanism. SVG sanitization is a classic footgun (script, `foreignObject`, event handlers, external refs, nested `<use>`). C04's negative only covers "bad type rejected."
**Fix:** pick and document one of: rasterize SVG server-side, run a named allowlist sanitizer, or serve logos from R2 behind `Content-Security-Policy: sandbox`/`img-src`-only with `Content-Disposition` and no inline rendering. Then add the negative journey: upload an SVG containing `<script>` and assert it never executes on admin preview *or* public CFP (see gap G-3). UX law 5 ("theme via tokens only — XSS") is only as true as this fix.

### MF-3 — Focus and interaction-state tokens are missing from the lock
The constitution demands keyboard-only completion (F04, I09) and the Lumen doc mandates a "keyboard alternative" for the hero schedule interaction — but the token lock defines no `--lumen-focus` ring, no hover/pressed/disabled treatments, and only one shadow. Without these locked now, every component ships with browser-default or ad-hoc focus styles, and the keyboard soul tests pass functionally while looking broken.
**Fix:** extend §2 with a focus-ring token (color, width, offset — visible on both `--lumen-bg` and `--lumen-surface`), disabled opacity/treatment, and hover/pressed rules for the button set. This is an *addition* to the lock, not a change.

### MF-4 — Status colors fail the colorblind case they were locked to protect
The invariant "Accepted stays green under any event brand" is correct, but success `#059669` and accent teal `#0d9488` are near-indistinguishable under deuteranopia, and status badges specified by hue alone violate "accessibility as behavior" (Codex principle you explicitly kept). Also, single hexes are not enough to build the badge kit — badges need bg/fg/border triples.
**Fix:** (a) require every status badge to carry a text label or icon, never color alone — state this as UX law 7; (b) expand each status color into a soft-bg/strong-fg pair (you already have the pattern with `--lumen-brand-soft`); (c) reconsider whether teal-as-"healthy-completion" earns its place next to success green, or demote it to a data-viz-only accent.

### MF-5 — Retheme blast radius is undefined
S-THEME says brand applies "to an event" and the public CFP reflects it. Nothing says whether admin chrome, evaluator queue, and speaker portal also retheme. If everything rethemes, an ugly brand color destroys the admin's daily surface and your "calm speed" pitch; if nothing does, the speaker portal looks unbranded to the customer's speakers. This ambiguity will be resolved silently by whoever builds Phase 2 unless locked now.
**Fix:** state the rule in §2 as an invariant. My recommendation: public CFP + speaker portal retheme (external, brand-facing); admin and evaluator chrome stay Lumen-default always. This also keeps the E2E surface for theming small and testable.

---

## 3. SHOULD

- **S-1 — Complete the token scale.** Spacing, z-index layers (modal/toast/dropdown), and motion tokens (durations + easing + a `prefers-reduced-motion` rule) are absent. The Grok kit's "full token scale" is cited as an input but §2 locks only color/radius/type/one-shadow. Section Runner phases will invent the rest inconsistently otherwise.
- **S-2 — Overlay a11y contract.** Modal (focus trap, `Esc`, return-focus) and toast (`aria-live=polite`, and the schedule-undo toast must be reachable, not hover-only) should be one paragraph in the component kit spec now, so it's in the primitives, not retrofitted at E2E time.
- **S-3 — Define "optimistic tick" failure UX.** UX law 4 mandates optimistic task ticks; the synthesis mandates `expected_version` concurrency. When an optimistic write is rejected (stale version, authz, network), what does the user see? Specify the revert-plus-toast pattern once, centrally.
- **S-4 — Density rule for the tables that will hold 150 speakers.** The seed target is 100–150 speakers. Lock a row-height/pagination-or-virtualization stance for Submissions/Speakers tables so "conference ops density only where needed" is a spec, not a vibe.
- **S-5 — Empty states are listed as a component; give the six primary surfaces their one-line empty-state copy direction** (what the CTA is on an empty Submissions list, empty Schedule, etc.). Cheap now, expensive to invent per-phase.
- **S-6 — Explicitly declare dark mode out of scope** for this claim (light-default is locked; say whether `prefers-color-scheme` is honored or ignored) so no phase burns time on it and no auditor flags its absence.

---

## 4. NIT

- N-1 — `--lumen-border: rgba(0,0,0,0.08)` on `#f5f5f7` yields ~1.1:1 borders; fine for hairlines, but form-input borders should get a stronger token or inputs will fail the "perceivable boundary" check on the public CFP.
- N-2 — Inter via webfont: add a `font-display: swap`/self-host note, or the "speed as brand" law loses its first paint to a font CDN.
- N-3 — §6 of the Lumen doc says the round-1 critique output lands in `initiative/audits/DESIGN_ADVISORY.md`; this file is `DESIGN_ADVISORY-claude.md`. Update the pointer or add a fold-in index so the audit trail stays coherent (S-DOCS cares about orphan references).
- N-4 — Chrome list in §3 shows "API Keys" as top-level nav next to "Settings"; consider nesting under Settings to keep the admin rail at 7 items — density discipline you imported from Northstar.

---

## 5. Browser-E2E gaps

The inventory is genuinely strong — ~95 predeclared journeys with negatives, plus the crawl-discovery hardening rule, is more rigor than most shipping products have. Gaps found, in priority order (all are *additions*; no existing row should shrink):

| Gap | Area | Missing journey | Suggested shape |
|-----|------|-----------------|-----------------|
| G-1 | **Admin: Speakers** | §3 chrome includes a "Speakers" nav item, but no inventory section covers it. H03 drills *to* a speaker from the dashboard; nothing tests the Speakers list/detail surface itself (search, filter, view files/tasks per speaker). Per the constitution's own law, shipped-but-uninventoried UI = defect. | New section (e.g. N01–N04): list, search/filter, detail with tasks+files, admin views uploaded headshot/slides |
| G-2 | Design Kit | Low-contrast brand color guardrail (MF-1) has no row | Negative on C03: set near-white brand → warn/derived-text behavior asserted on public CFP |
| G-3 | Design Kit | SVG-with-script logo (MF-2): C04 only rejects bad *type* | Negative: malicious SVG upload → script never executes on preview or public CFP (sibling of A10) |
| G-4 | Cross-event isolation | C02 switches event context, but no negative asserts event A's submissions/speakers/tokens never leak into event B's views | Negative pair on C02 or E01 |
| G-5 | Schedule | I06 drags into an *empty* slot only. Missing: move an already-placed session, and unschedule back to the tray (I10 undo is not the same as deliberate removal) | I13 move-placed, I14 unschedule-to-tray |
| G-6 | Concurrency | Synthesis mandates `expected_version` on commands, but no browser row shows the stale-write UX (two contexts edit the same session; second gets conflict state, not silent overwrite) | New L row or I15; pairs with S-3 |
| G-7 | Admin: Evaluations | Chrome has an "Evaluations" tab; inventory covers the evaluator's own queue (F) and rubric editing (M04) but no admin-side evaluation-progress view (who has scored what, rollup before decision) | New E row(s) if the tab ships — or cut the tab |
| G-8 | A11y depth | Keyboard rows exist only for evaluator (F04) and schedule (I09). The *public CFP* — the only surface strangers use — has no keyboard-complete or axe-scan row (A08 covers focus on errors only) | A11: keyboard-only public submit; optional axe smoke on the four role home surfaces |
| G-9 | Comms/ICS | J06 attaches an ICS, but S-COMMS requires *stable UID* and the synthesis requires SEQUENCE lifecycle. If reschedule→update-invite is a UI action, it needs a row; if API-only, note in the inventory that UID/SEQUENCE proof lives in the CLI/API suite so the gate isn't silently untested | J08 or an explicit cross-reference note |
| G-10 | Scale states | L covers empty/error/loading but not the 100–150-speaker list: pagination or long-list behavior has no row despite being the seeded demo reality | L05 large-list row |

Also: rule 5's discovery crawl is marked "optional hardening" — given the constitution makes *unlisted controls a defect*, I'd promote the crawl to REQUIRED for the admin surface at Phase 8. It is the only mechanism that catches the G-1 class of gap automatically.

---

## 6. Final-phase onboarding/docs opinion

**Strongly agree with the law, with one structural push: make the docs *executable*, not just readable.**

S-ONB-HUMAN ("in under documented time, without tribal knowledge") and S-ONB-AGENT are the right bar, and putting docs as a *gated final phase* rather than a README afterthought is the single best judgment call in the constitution — for this competition specifically, because "would we use/buy this?" is answered at setup time, not demo time. Notes:

1. **The only honest proof of S-ONB-AGENT is an agent actually following the doc.** The acceptance check for the final phase should be: a fresh agent context given only `docs/AGENT_SETUP.md` + OpenAPI + CLI `--help` completes the readiness-report and design-publish path. If the doc needs any out-of-band hint, the doc fails, not the agent. Write this into the phase's acceptance criteria now so the doc phase is built to be tested, not narrated.
2. **"Under documented time" needs a number written before the run, not after.** Otherwise the doc times itself and always passes. Pick the target (e.g. 30 minutes zero→demo-path) when the phase pack is authored.
3. **HTML reports should be Lumen-themed.** The e2e-coverage, onboarding, and architecture HTML reports are the last thing a judge sees; rendering them with the same tokens is free brand proof and closes the loop on "beauty as token change." The Lumen doc already assigns "Design docs HTML" to Phase 9 — add "uses Lumen tokens" to that row.
4. **Secrets stay names-only in docs** — the onboarding doc should carry a table of secret *names* + where each is injected, never values or value-shaped placeholders that invite pasting. This is already constitutional (Article VI); repeat it inside the docs phase spec because that's where the violation would happen.
5. **S-DOCS "no orphan critical procedures"** should include the audit trail itself: this advisory, the fold-in (§6 of the Lumen doc), and DEFER rows must be reachable from the docs tree, or the programme's best evidence of judgment is invisible to judges.

The final-phase law is the difference between "we built it" and "you can run it." Do not let schedule pressure convert it into a README — Article VI already forbids that, and I co-sign.

---

*— Claude, independent design/product critic*
