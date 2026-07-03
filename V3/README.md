# TCG V3

Production-minded restart of the Pokémon card collection app.

## What this is

TCG V3 is a clean TypeScript/PostgreSQL app for Pokémon card collectors, master set builders, high-volume inventory owners, kids, and vendors.

The backend is the source of truth so web, mobile, and desktop clients can all use the same API.

## Current V3 scope

- Supabase Auth support for email/password and Google login.
- Fastify backend API with centralized error handling.
- PostgreSQL database managed by Prisma migrations.
- React/Vite web app shell.
- Worker app for catalog and price sync jobs.
- Rate limiting for DDoS/basic abuse protection.
- PokémonTCG.io catalog sync support.
- Open TCG / TCGTracking-style SKU price provider scaffold.
- Collection, variants, quantity, condition, paid price/date schema.
- Master set progress schema and routes.
- Binder/share schema and routes.
- CSV/XLSX import/export scaffolding.
- Billing/subscription/admin override schema from day one.

## Required tools

```bash
node --version   # Use Node 20+
pnpm --version
```

## Setup

```bash
cd tcg/V3
cp .env.example .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

## Important environment rule

Never commit a real `.env` file. Commit only `.env.example`.

## Commands

```bash
pnpm dev               # run API, web, and worker dev scripts
pnpm lint              # lint all packages
pnpm typecheck         # TypeScript check all packages
pnpm test              # run tests
pnpm db:generate       # generate Prisma client
pnpm db:migrate        # apply local database migrations
pnpm worker:catalog    # run catalog sync once
pnpm worker:prices     # run price sync once
pnpm prepush           # required checklist before pushing
```

## Railway services

Recommended Railway services:

1. `tcg-v3-api`
2. `tcg-v3-web`
3. `tcg-v3-worker-catalog`
4. `tcg-v3-worker-prices`
5. `PostgreSQL`

## Push rule

Every push must update these docs:

- `README.md`
- `HANDOFF.md`
- `BUGS.md`

Run:

```bash
pnpm prepush
```

## API docs checked

- PokémonTCG.io API v2 for set/card data.
- Open TCG API / TCGTracking for SKU-level condition/variant pricing.

See `docs/API_FIELD_MAP.md`.
