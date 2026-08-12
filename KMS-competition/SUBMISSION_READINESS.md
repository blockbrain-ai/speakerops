# Competition submission readiness — SpeakerOps

**Last updated:** 2026-08-12  
**Live SHA:** check `GET https://www.speakerops.org/health` → `version` suffix  
**Target branch:** `section-runner/speakerops`

## Product claim (what judges can exercise)

1. **Public landing** `/` — value story + entry points  
2. **Admin Overview** — programme control (stages, KPIs, charts, Publish programme)  
3. **Form builder** — guided wizard + rich text  
4. **Submissions grid** — TanStack DataGrid, saved views, bulk decisions  
5. **Schedule Studio** — DnD + list/day/week/track/room/**month**/**conflicts**  
6. **⌘K Find** — permissioned search  
7. **Public CFP** `/cfp/:slug` — submit + draft + wizard Next/Back  
8. **Public programme** `/e/:slug/*` — sessions, speakers, agenda, itinerary, gallery  
9. **Public embeds** `/embed/:slug/*` + admin Embeds configurator  
10. **Portal** `/portal` — speaker onboarding  
11. **Operator** Files / History / Team / Preview  
12. **Analytics** — widget gallery on live roll-ups  
13. **Portal forms** — post-acceptance questionnaires (N1)  
14. **Resources** — event wiki pages (N2)  
15. **File requests** — reusable request library (N3)

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

- Public headshot file route (gallery may show initials)  
- N2 safe HTML embeds / sandboxed iframe CMS depth  
- N5 Accelevents projection needs third-party API credentials (Airtable one-way remains)  
- Social links on speaker profile need a future column  
- Single-step-visible CFP wizard would need e2e rewrites (Next/Back chrome shipped)  
- Golden baton is continuity smoke + keystone suites  
- Learn site dist-only (C2.5 residual)

## Group decision

No first-class Group aggregate — Person / Participation / Submission only.
