# <PROJECT NAME> Workspace

This file is loaded automatically by Claude Code at the start of every session. Keep it accurate — outdated commands here cost real time.

## Stack

<language and version>, <framework>, <ORM>, <test runner>, <key libraries>

Example:
- Backend: TypeScript 5.x (strict), Node 20, Express, Prisma 5.x, Zod, Vitest
- Frontend: Next.js 14, React 18, Tailwind, shadcn/ui

## Commands

- **Build / typecheck**: `<exact command>` (e.g. `pnpm typecheck`, `npx tsc --noEmit`, `cargo check`)
- **Test**: `<exact command>` (e.g. `cd apps/backend && npm run test:section-runner`, `pytest -q`)
- **Schema / codegen** (if applicable): `<exact command>`
- **Lint** (if applicable): `<exact command>`
- **Format** (if applicable): `<exact command>`

> The Section Runner build gate uses these same commands via `GATE_TYPECHECK_CMD` and `GATE_TEST_CMD`. They must match.

## Conventions

- **Logger**: `<path/import>` — never use `console.log` in production code paths
- **Routes**: `<path>`
- **Services**: `<path>`
- **Repositories / data access**: `<path>`
- **Tests**: `<co-located | dedicated tests/ dir | other>` — naming convention: `<foo.ts → foo.test.ts>`
- **Migrations** (if applicable): `<path>`
- **Validation**: `<Zod | Pydantic | Joi | other>` — every endpoint that accepts a body must validate before business logic runs
- **Naming**: `<camelCase | snake_case | other>` for variables, `<PascalCase>` for types, `<kebab-case>` for filenames
- **Imports**: `<ESM static import only | CommonJS | other>`. No mixing.

## Engineering Standards

See `<RUNS_DIR>/engineering-standards.md` (E1-E9). Every change must comply unless explicitly deferred in the run plan.

Key cross-cutting rules summarised here for fast access:
- Tenant data: organisation-scoped queries, never `findUnique`. See E2.
- Correlation IDs: propagate, never regenerate. See E3.
- API responses: use the canonical envelope shape. See E4.
- Seeds: idempotent, key on a unique constraint. See E6.
- Commit format: `<type>(<section>): <description>`. See E7.

## Pipeline Boundaries

Section Runner runs implementation phases inside this workspace. Stay within these boundaries:

- Do not commit `.pipeline/` (it is runtime state owned by the pipeline)
- Do not modify the parent `section-runner/` repo from inside this workspace
- Do not modify other workspaces (`<other workspace paths if applicable>`)
- All file changes must happen under `<WORKSPACE_PATH>`
- Commit your work before each section ends — leaving an uncommitted tree blocks the build gate

## Brownfield Notes (delete if greenfield)

This workspace is an existing application. Section Runner is being introduced incrementally. Important context:

- The inherited test suite at `<path>` has known pre-existing failures outside the scope of this work. The Section Runner gate uses a focused script (`scripts/ci/<project>-gate-tests.sh`) that targets only `<scope>`. Do not run the full inherited suite as a gate.
- Follow existing patterns in `<directory>` rather than introducing new ones. If a new pattern is genuinely needed, document it in the relevant section's plan.
- The mainline branch is `<branch>`. Section Runner work happens on `<section-runner-branch>`. Do not push directly to mainline from inside a section.
