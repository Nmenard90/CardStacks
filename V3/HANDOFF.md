# V3 Handoff

Last updated: 2026-07-03

## Project

This is the V3 rebuild of the Pokémon card collection app inside:

```txt
tcg/V3
```

The older repo code is reference only. V3 should not preserve old structure unless it is useful.

## Product Goal

Build a production-minded Pokémon card collection app for:

* collectors
* vendors
* kids
* master set builders
* people with large personal inventories

Core features:

* all Pokémon sets/cards
* fast search by name, set, and card number
* collection add/remove/update
* quantity tracking
* condition tracking
* variant tracking
* paid price and purchase date tracking
* master set progress
* missing cards/missing variants
* online binder
* public binder sharing
* CSV and XLSX import/export
* current market prices
* historical price snapshots
* future trade analysis
* future fake-card guidance
* future monetization

## Important User Requirements

The user wants senior-developer-style code:

* no useless functions
* no unused code
* clear file headings
* clear function headings
* task-grouped functions
* thin main files
* no hard-coded values
* strong input validation
* strong exception handling
* visible errors instead of silent fallbacks
* rate limiting/DDOS protection
* efficient Big-O choices
* low memory usage
* readable comments for non-programmers
* README, HANDOFF, and BUGS updated every push

## Current Stack

Backend:

* TypeScript
* Fastify
* Prisma
* PostgreSQL
* Zod
* Supabase Auth
* Rate limiting

Frontend:

* React
* TypeScript
* Vite

Worker:

* TypeScript
* Scheduled catalog/price sync

Deployment:

* Railway

Package manager:

* pnpm

## Current Local State

Known current status:

* `V3` folder exists locally.
* `pnpm install` succeeded.
* Prisma generated successfully after env was fixed.
* Initial Prisma migration was started and Prisma asked for a migration name.
* Recommended migration name: `init_v3_schema`.
* Local API and Web run successfully when using Turbo `--env-mode=loose`.
* Web runs at `http://localhost:5173`.
* API logs show it listens on port `4000`.
* Worker should not run by default during local dev yet.

Working local command:

```bash
pnpm exec dotenv -e .env -- turbo dev --filter=@tcg/api --filter=@tcg/web --env-mode=loose
```

The root `package.json` should use:

```json
"dev": "dotenv -e .env -- turbo dev --filter=@tcg/api --filter=@tcg/web --env-mode=loose"
```

## Environment Issue Found

Problem:

Turbo was not passing required env vars to `@tcg/api`.

Symptoms:

```txt
DATABASE_URL missing
PUBLIC_WEB_URL missing
API_BASE_URL missing
POKEMON_TCG_API_URL missing
OPEN_TCG_API_BASE_URL missing
```

Confirmed `.env` itself worked with:

```bash
pnpm exec dotenv -e .env -- node -e "for (const k of ['DATABASE_URL','PUBLIC_WEB_URL','API_BASE_URL','POKEMON_TCG_API_URL','OPEN_TCG_API_BASE_URL']) console.log(k + '=' + Boolean(process.env[k]));"
```

That returned all `true`.

Fix:

Use Turbo loose env mode:

```bash
--env-mode=loose
```

## Local Development Commands

From:

```bash
cd /c/Users/nicho/tcg/V3
```

Run API + Web:

```bash
pnpm dev
```

Run worker only:

```bash
pnpm dev:worker
```

Run all services:

```bash
pnpm dev:all
```

Database:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Test/check:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Railway State

Railway services have been created:

```txt
Postgres
tcg-v3-api
tcg-v3-web
tcg-v3-worker-prices
```

Railway deployment has not been fully verified yet.

Recommended deploy order:

```txt
1. Postgres
2. API
3. Web
4. Worker
```

Railway API/Worker should use private DB variable:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Local `.env` should use Railway public DB URL.

Do not commit real secrets.

## External API Notes

Do not use TCGplayer as a required provider. The user cannot get a TCGplayer API key.

Use:

* PokémonTCG.io for catalog data.
* Open TCG / TCGTracking-style provider for pricing/variant/SKU data.

Important rule:

Before coding sync/parsing logic, verify official API docs and document fields in:

```txt
docs/API_FIELD_MAP.md
```

## Immediate Next Steps

1. Confirm root `package.json` has:

   * `dev`
   * `dev:all`
   * `dev:worker`
   * `--env-mode=loose`

2. Run:

```bash
pnpm dev
```

3. Confirm:

```txt
http://localhost:5173
http://localhost:4000/health
```

4. Run:

```bash
pnpm db:seed
pnpm typecheck
pnpm test
```

5. Fix any TypeScript/test errors.

6. Commit V3:

```bash
cd /c/Users/nicho/tcg
git restore .metals
git check-ignore -v V3/.env
git check-ignore -v V3/node_modules
git add V3
git commit -m "Add V3 foundation and fix local env loading"
git push origin main
```

7. Deploy Railway API first.

## Known Warnings

* The real `.env` must stay local-only.
* User pasted a database URL in chat earlier. Recommend rotating Railway Postgres credentials once setup is stable.
* Worker is not ready to be part of default local dev.
* Pricing provider mapping still needs real API fixture verification.
* XLSX import/export needs implementation verification.
