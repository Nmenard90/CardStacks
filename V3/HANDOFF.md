# HANDOFF

## Project

Pokémon card collection app restart, V3.

## Current user requirements

- Use existing repo only as reference.
- New clean folder: `tcg/V3`.
- Backend is source of truth for web/mobile/desktop.
- Web first, mobile later.
- TypeScript is preferred because mobile clients will consume the same API cleanly.
- Supabase Auth selected for email/password and Google login.
- TCGplayer API is not required because user cannot get a TCGplayer key.
- Use PokémonTCG.io for catalog data.
- Use configurable Open TCG / TCGTracking-style provider for condition/variant pricing.
- Every file and meaningful function needs beginner-readable headings.
- No silent fallbacks.
- Input validation and error handling are required.
- Rate limiting is required.
- README, HANDOFF, and BUGS must be updated on every push.

## Architecture

- `apps/api`: Fastify API.
- `apps/web`: React/Vite web app.
- `apps/worker`: scheduled jobs.
- `packages/db`: Prisma schema and seed.
- `packages/shared`: constants and shared types.

## Most important commands

```bash
cd tcg/V3
cp .env.example .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

## Next implementation steps

1. Install packages and run TypeScript checks.
2. Create first Prisma migration.
3. Configure Supabase project and Google OAuth.
4. Add real PokémonTCG.io API key if available.
5. Run catalog sync.
6. Connect web search UI to API.
7. Deploy API/web/Postgres to Railway.

## Known limitations of this handoff build

- This is a production-minded foundation, not a finished Collectr competitor.
- Price provider is configurable and scaffolded, but must be tested against the user's real `tcg.io`/Open TCG data source.
- Import/export parsers exist as service boundaries; file upload UX still needs final polish.
- Stripe is not wired yet; billing tables and admin override are present.
- Fake-card AI is intentionally not included in MVP code.

## Last docs/API verification

Verified on 2026-07-03:

- PokémonTCG.io v2 card object includes fields such as `id`, `name`, `supertype`, `subtypes`, `set`, `number`, `artist`, `rarity`, `images`, `tcgplayer`, and `cardmarket`.
- PokémonTCG.io v2 set object includes fields such as `id`, `name`, `series`, `printedTotal`, `total`, `ptcgoCode`, `releaseDate`, `updatedAt`, and `images`.
- PokémonTCG.io search endpoint uses `GET /v2/cards` with `q`, `page`, `pageSize`, `orderBy`, and `select` query parameters.
- Open TCG / TCGTracking docs recommend `/skus` for condition/variant pricing and define condition codes NM, LP, MP, HP, DMG.
