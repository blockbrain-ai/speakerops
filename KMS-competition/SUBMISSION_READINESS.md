# Competition submission readiness — SpeakerOps

**Last updated:** 2026-08-12  
**Live SHA:** check `GET https://www.speakerops.org/health` → `version` suffix  
**Target branch:** `section-runner/speakerops`

## Product claim (what judges can exercise)

1. **Public landing** `/` — value story + entry points  
2. **Admin Overview** — programme control (stages, KPIs, charts, Publish programme)  
3. **Form builder** — guided wizard + rich text  
4. **Submissions grid** — TanStack DataGrid, saved views, bulk decisions  
5. **Schedule Studio** — DnD, list/day/week/track/room/**month**/**conflicts**  
6. **⌘K Find** — permissioned search  
7. **Public CFP** `/cfp/:slug` — submit + draft + wizard Next/Back  
8. **Public programme** `/e/:slug/*` — sessions, speakers, agenda, itinerary, gallery (after Publish)  
9. **Public embeds** `/embed/:slug/*` + admin **Embeds** configurator (copy iframe code)  
10. **Portal** `/portal` — speaker onboarding (profile, tasks, sessions)  
11. **Operator** Files / History / Team / Preview hub  
12. **Analytics** — template gallery widgets on live roll-ups  
13. **Portal forms** — post-acceptance questionnaires (create → publish → speaker fill API)

## Gates (local)

```bash
pnpm --filter @speakerops/shared build
pnpm typecheck
pnpm test:ci
CI=1 pnpm test:e2e
E2E_INVENTORY_GATE=phase8 pnpm test:e2e:inventory
```

## Deploy

```bash
scripts/with-secrets.sh npx wrangler d1 migrations apply speakerops-demo --env dogfood --remote
VITE_ROLE_SWITCHER=1 scripts/with-secrets.sh bash scripts/deploy-dogfood.sh
```

## Known residuals (honest)

- Public headshot file route (gallery may show initials until private→public serve is wired)  
- N2 Resources/wiki + sandboxed HTML embeds (not shipped as a first-class CMS)  
- N3 File Requests entity (portal headshot/slides cover the onboarding file path; reusable request library not full)  
- N5 Accelevents projection requires third-party API credentials — Airtable one-way status remains; do not stub dual-write  
- Social links on speaker profile (LinkedIn/X/etc.) need a future additive column  
- True single-step-visible CFP wizard would need coordinated e2e rewrites (Next/Back chrome shipped; fields remain on-page for e2e safety)  
- Golden baton is continuity smoke + existing keystone suites (not a single 20-min monolith browser recording)  
- Learn site is dist-only (Phase 4 C2.5 residual for source+build)

## Group decision

No first-class Group aggregate — Person / Participation / Submission only. Portal forms are participation-scoped.

## Recent ship waves

| Wave | SHA prefix | Surfaces |
|------|------------|----------|
| F3–F7 | …8b96bc6a5 | Grid, charts, Find, Drawer/Toast, public programme |
| P5/P7/P8/N6 | 92642dd4f | CFP wizard chrome, settings hub, month/conflicts, Files/History/Team |
| N4/N6/N7 | adbf35d33 | Embeds, Preview hub, Analytics |
| N1 | (this wave) | Portal forms builder + D1 0040 |
