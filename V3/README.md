# TCG V3 — Pokémon Card Collection App

Production-minded V3 restart of the Pokémon card collection app.

This app is being rebuilt from scratch inside `tcg/V3`. The older repo code is reference material only. V3 is designed to be cleaner, easier to maintain, faster, safer, and easier to extend to web, mobile, and desktop clients later.

## Product Goal

Build a Pokémon card collection app for collectors, vendors, kids, and master set builders.

Core goals:

* Search all Pokémon sets and cards quickly.
* Add and remove cards from a collection.
* Track quantity, condition, variant, paid price, and purchase date.
* Manage online binders.
* Share binders publicly.
* Track master set progress and missing cards.
* Store current prices and historical price snapshots.
* Support CSV and XLSX import/export.
* Prepare for trade analysis, fake-card guidance, and monetization.

## Current Status

Last updated: 2026-07-03

Current working state:

* V3 workspace exists.
* API and Web apps run locally.
* Worker exists but is not part of the default local `pnpm dev` command.
* Prisma schema exists.
* Initial migration was started.
* Environment loading was fixed by using `dotenv-cli` and Turbo `--env-mode=loose`.
* Railway services have been created.
* Railway deployment still needs to be verified service by service.

## Tech Stack

Backend:

* TypeScript
* Fastify
* Prisma
* PostgreSQL
* Zod validation
* Supabase Auth
* Rate limiting

Frontend:

* React
* TypeScript
* Vite

Worker:

* TypeScript
* Scheduled catalog/price jobs

Database:

* PostgreSQL
* Prisma migrations

Deployment:

* Railway

## Folder Structure

```txt
V3/
  apps/
    api/        Backend API
    web/        React web app
    worker/     Scheduled sync jobs
  packages/
    db/         Prisma schema, migrations, seed
    shared/     Shared constants and types
  docs/         Architecture, API notes, security, standards
  README.md
  HANDOFF.md
  BUGS.md
  .env.example
```

## Local Setup

Requires:

* Node.js `22.x` (matches the `node:22-alpine` images used by `apps/api` and `apps/web` Dockerfiles).
* pnpm `9.15.0` (pinned via `packageManager` in `package.json`; use `corepack enable` to get the matching version automatically).

From the repo root:

```bash
cd V3
pnpm install
cp .env.example .env
```

Update `.env` with real local values.

Important:

* Do not commit `.env`.
* Use Railway `DATABASE_PUBLIC_URL` only for local development.
* Use Railway private `DATABASE_URL` inside Railway services.

Required local env values:

```env
DATABASE_URL=
PUBLIC_WEB_URL=http://localhost:5173
API_BASE_URL=http://localhost:4000
POKEMON_TCG_API_URL=https://api.pokemontcg.io/v2
OPEN_TCG_API_BASE_URL=https://www.tcgtracking.com/tcgapi/v1
```

## Database Commands

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Do not run seed until migration succeeds.

## Verifying a Clean Clone

`@tcg/db`, `@tcg/api`, and `@tcg/worker` import generated Prisma client types.
The database package generates those types during installation and before its
build, lint, typecheck, test, and seed commands, so clean-worktree verification
does not require a separate generation step. From a fresh clone/checkout:

```bash
pnpm install --frozen-lockfile
pnpm prepush   # lint && typecheck && test
pnpm build
```

Manual `db:generate` remains available and only needs a syntactically valid
`DATABASE_URL` (Prisma reads the schema, it does not need to reach a live
database), so this sequence works even before a real local Postgres instance
is configured.

To exercise the clean-worktree regression directly, run
`pnpm --filter @tcg/db test:generate`. It temporarily invalidates one generated
declaration and verifies that the normal database lint command regenerates it.

## Local Development

Run API and Web only:

```bash
pnpm dev
```

This starts:

```txt
apps/api
apps/web
```

Run the worker separately:

```bash
pnpm dev:worker
```

Run all services together only when env vars are fully configured:

```bash
pnpm dev:all
```

## Useful URLs

Local web:

```txt
http://localhost:5173
```

Local API health:

```txt
http://localhost:4000/health
```

## Scripts

```bash
pnpm dev          # API + Web only
pnpm dev:all      # API + Web + Worker
pnpm dev:worker   # Worker only
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm prepush
```

## Coding Standards

V3 code must follow senior-developer standards:

* Every file has a plain-English file heading.
* Every function has a clear function heading.
* Main files stay thin.
* Business logic stays in services.
* Database access stays in repositories.
* Routes only handle HTTP-level concerns.
* No hard-coded secrets or URLs.
* All input is validated.
* Errors are explicit and consistent.
* No silent fallbacks.
* Large data is paginated, batched, or streamed.
* Database indexes should support fast search.
* Tests should be added before piling on more features.

## Deployment Notes

Railway services:

```txt
tcg-v3-api
tcg-v3-web
tcg-v3-worker-prices
Postgres
```

Deploy order:

```txt
1. Postgres
2. API
3. Web
4. Worker
```

Do not deploy the worker before API/Web are verified.

## Required Push Rule

Before every push, update:

```txt
README.md
HANDOFF.md
BUGS.md
```

Then run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

If those pass:

```bash
git add V3
git commit -m "Describe the V3 change"
git push origin main
```
