# SpeakerOps Lumen 2 — frontend stack compatibility

Checked against the current repository on 9 August 2026.

## Current application baseline

| Area | Existing choice | Lumen 2 decision |
|---|---|---|
| UI | React 18 + React DOM 18 | Keep; build local typed components |
| Routing | React Router 6 | Keep; no route-system change |
| Build | Vite 5 + TypeScript | Keep; reference CSS imports normally |
| Shared contracts | `@speakerops/shared` workspace | Keep as DTO/security source of truth |
| Styling | `styles/lumen.css` + `styles/shell.css` | Extend in place; no CSS runtime |
| State | React hooks/local route state | Keep; no state manager |
| Forms | Native controls + local validation/API contracts | Keep; no form package |
| Drag and drop | Native HTML5 events in builder/schedule | Keep; add local keyboard alternatives |
| Icons | No third-party icon runtime | Use reviewed first-party 24px SVG paths |
| Charts | No chart runtime | Use accessible values and simple CSS bars |
| Tests | Vitest + Playwright inventory | Keep and update existing journeys |
| Security | Shared CSP + dependency audit + SVG upload reject | Preserve without exceptions |

Application runtime dependencies currently declared by `apps/web/package.json`:

- `@speakerops/shared` (first-party workspace)
- `react`
- `react-dom`
- `react-router-dom`

Lumen 2 requires no addition to that list.

## Explicit non-proposals

This pack does not propose Tailwind, MUI, Radix, shadcn, Chakra, Ant Design,
styled-components, Emotion, Framer Motion, Lucide, Heroicons, D3, Recharts,
Chart.js, React Hook Form, Formik, Zustand, Redux, a date library, a
drag-and-drop library, or a font npm package.

Those names are listed only to remove ambiguity for implementation agents. It
is not a judgement that every package is unsafe in every context; it records
that none is necessary here and each would expand the current supply-chain and
maintenance surface.

## Governance alignment

- E6 and `docs/governance/0.2-lumen-lock.md` remain authoritative.
- Existing canonical `--lumen-*` token names and frozen values remain the app
  contract until amended through governance.
- The standalone pack's extended semantic aliases derive from the canonical
  layer. They are an implementation aid, not a competing theme.
- Admin/evaluator chrome never consumes event brand values.
- Public CFP and portal use only published brand tokens.
- Uploaded SVG logos remain rejected. The icon sprite is first-party product
  source, not uploaded or interpreted user content.
- No freeform event CSS, JavaScript, or HTML is introduced.
- Existing CSP is not weakened. Assets remain same-origin.

## Native implementation choices

| Need | Implementation without a new package |
|---|---|
| Modal | React portal/local component, focus sentinels or focusable-element helper, Escape/restore tests |
| Tabs/segments | Native buttons with roving focus where applicable |
| Builder reorder | Existing HTML5 drag plus move-up/down keyboard controls |
| Schedule placement | Existing HTML5 drag plus explicit place/move dialog or keyboard action |
| Trend chart | CSS grid bars plus accessible text summary |
| Icons | Typed `IconName` union and local SVG path data |
| Toast | Local React region with durable inline error fallback |
| Data table | Semantic HTML table, existing data requests, pagination/controlled overflow |
| Audience builder | Existing React state and domain filter fields; server remains authority |
| Theme | Published design-token JSON mapped to CSS custom properties in public scope |

## Dependency exception gate

If an implementation agent believes a new package is unavoidable, stop the
visual migration and open a separate decision with all of the following:

1. Capability gap that cannot reasonably be met with current code.
2. Package owner, release cadence, licence, and maintenance history.
3. Direct and transitive dependency count.
4. Lockfile and bundle-size change.
5. CSP, data, browser, and server trust-boundary impact.
6. Latest `pnpm run audit:deps` result and unresolved advisories.
7. Failure mode if the package is abandoned or compromised.
8. Removal/exit strategy.
9. Owner and security approval.

An agent may not approve its own exception merely because the package makes the
implementation faster.

## Files inspected

- `apps/web/package.json`
- root `package.json`
- `apps/web/src/main.tsx`
- `apps/web/vite.config.ts`
- `apps/web/src/styles/lumen.css`
- `docs/governance/0.2-lumen-lock.md`
- `KMS-competition/initiative/01_DESIGN_SYSTEM_LUMEN.md`
- `docs/SECURITY.md`
- `docs/sections/8.3-security-hardening.md`
- `packages/shared/src/security.ts`
- `scripts/dependency-audit.mjs`
- existing form-builder and schedule drag implementations
