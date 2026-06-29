# PokéTracker — Developer Handoff

Working context for continuing development. For the public-facing overview see
`README.md`; for the live defect list see `BUGS.md`.

_Last updated: 2026-06-29._

---

## What it is

A full-stack Pokémon TCG collection tracker: log owned cards by condition and
quantity, organize them into virtual binders, value the collection from market
prices, and analyze trades. Card/set data comes from pokemontcg.io (cached
locally); prices are scraped per condition.

## Architecture & stack

```
React SPA  ──HTTP──▶  ZIO HTTP API  ──Doobie──▶  PostgreSQL
 (web/)                (poketracker-v2/)            └─ cached catalog: sets, cards, prices
                              └──▶ pokemontcg.io (catalog source, on cache miss)
                              └──▶ TCGTracking   (price source)
```

- **Frontend** (`web/`): React 19 + TypeScript + Vite, TanStack Query, React
  Router, Axios.
- **Backend** (`poketracker-v2/`): Scala 3, ZIO 2.1, ZIO HTTP 3, ZIO JSON,
  Doobie 1.0, PostgreSQL. Dockerized.
- **Infra:** Railway — separate frontend and backend services + managed
  PostgreSQL. Deploys on push to `main`.

## Repository layout

```
tcg/
├── web/              # React + TypeScript + Vite frontend
│   └── src/
│       ├── pages/        # CollectionPage, BulkAddPage, OwnedPage, Binder*, AnalyzerPage, ConventionModePage
│       ├── components/    # CardTile, SetSelector, ImportModal, ExportModal, CardPreview, HeaderNav, Toast, ...
│       ├── api/           # client, cards, collection, binders, users
│       └── lib/           # conditions, csv, cardSearch
├── poketracker-v2/   # Scala 3 + ZIO backend
│   └── src/main/scala/com/poketracker/
│       ├── api/           # CardRoutes, CollectionRoutes, BinderRoutes, UserRoutes
│       ├── service/       # CardService, CollectionService, PriceService, ...
│       ├── repository/    # CardRepository, CollectionRepository, ...
│       ├── models/        # Card, CardSet, Binder, ...
│       └── Main.scala
│   └── sql/schema.sql
├── files/            # legacy Node prototype — NOT part of the live app
├── README.md
├── BUGS.md
└── HANDOFF.md
```

## Dev environment & workflow

- **OS/tools:** Windows + Git Bash; Java 21 (Eclipse Temurin); Scala/sbt via
  Coursier; VS Code + Metals.
- **Deploy = push to `main`.** Railway auto-builds both services. There is no
  separate staging — `main` is the deploy trigger. Don't use feature branches
  unless you specifically want something *not* live; merging back is the only way
  it deploys.
- **Verification is done against the live Railway deploy**, not a local server.
  The backend build log is the compile check for Scala changes.
- **Frontend checks** can be run locally: `cd web && npx tsc -b` (typecheck) and
  `npx eslint .` (lint). The production build (`npm run build`) runs `tsc -b`,
  so type errors fail the deploy; eslint does **not** gate the build.
- **`.metals/` IDE files** sometimes show as modified — they should be
  git-ignored and not committed. Stage explicit paths, not `git add -A`.

## Useful endpoints

- `GET /health`
- `GET /api/sets`, `GET /api/cards/:setId`, `GET /api/cards/id/:cardId`,
  `GET /api/search?q=…`
- `GET /api/collection/:userId` (+ `/owned`, `/stats`),
  `POST /api/collection/:userId/:cardId`, `POST /api/collection/:userId/bulk`
- Binders: `GET/POST /api/binders/:userId`, `GET/PUT/DELETE /api/binders/:userId/:binderId`,
  `PUT …/:binderId/slot/:slotIndex`
- Users: `GET /api/users`, `GET /api/users/:username`, `POST /api/users`,
  `PUT /api/users/:userId/location`
- **Admin/maintenance:** `GET /api/admin/refresh/:setId` (re-fetch one set's
  cards + prices), `GET /api/admin/refresh-orphans` (backfill any owned card
  missing from the catalog).

## Code standards (please keep)

- Every file gets a header block: PURPOSE, IMPORTS EXPLAINED, USED BY, DEPENDS ON.
- Every method gets PURPOSE / `@param` / `@return`. Explain non-obvious variables
  inline. Comments should explain **why**, not restate **what** the code does.
- Scala 3 indentation syntax. No unused functions / dead code.
- Frontend: TypeScript strict; prefer real React state over refs-as-state;
  keep all hooks above any early return; no `localStorage`/browser-storage in
  Claude artifacts (the real app may use it — BulkAddPage does, for the session).
- **Show changes as diffs/patches before they go live.** Deploys are real;
  review first.

## Domain gotchas (read before touching search/catalog/pricing)

- **Collector numbers are not globally unique.** "080/198" identifies a card only
  *within a set* — many sets have 198 cards and an #80. The set symbol is the
  real disambiguator. The bulk page resolves this by (a) letting you pick a set
  for an exact match, or (b) showing all candidates by set name when a
  number/total is shared. Don't "fix" search by assuming uniqueness.
- **Card numbers have leading-zero variance** ("080" vs "80"). Match exactly
  (case-insensitive) or numerically when both sides are pure digits — never match
  "7" to "7a". See `numberMatches` in `BulkAddPage.tsx`.
- **Catalog vs collection.** A collection entry references a `cardId`; the card's
  name/number/price live in the `cards`/`card_prices` catalog tables. If a card
  is added whose set was never loaded, it can become an "orphan" (entry with no
  catalog row) → blank/$0. `CardService.ensureCached` prevents this on save;
  `/api/admin/refresh-orphans` repairs existing ones. `getCardsBySet` and
  `searchCards` fall back to the pokemontcg.io API and cache results; only
  `getCardsBySet`/`refreshSet` also fetch **prices**.
- **Prices** come from TCGTracking via `PriceService`, fetched at the set level.
  A card can have a catalog row but no price (fetch failed or source lacks it) →
  shows "no price". See BUG-019.
- **Conditions** are stored as a condition→quantity map; keys include a
  `" 1st Ed"` suffix variant. `lib/conditions.ts` holds the price math and
  list↔map conversions; `baseCond` strips the suffix for the backend
  `selectedCond`.

## Current state

Working: the Scala backend + cached catalog (170+ sets), collection model,
binders, auth, CSV import, and the export scope picker. The bulk-add page was
rewritten this session and is the most-changed area.

Recently changed (2026-06-29): see `BUGS.md` → "Fixed this session". In short —
BulkAddPage rewritten (reducer state, localStorage persistence, set selector, two
number boxes, reliable number search with an ambiguity picker; sidebar removed),
export scope picker wired in, and backend orphan prevention/repair deployed.

## Known issues & next steps

Tracked in `BUGS.md`. Highest-value next items:
1. **BUG-019** — cards showing "no price" (the last thing making cards look
   blank). Investigate the price-fetch path.
2. **BUG-012** — Analyzer "Quick Add from Collection" stub.
3. **BUG-010 / BUG-013** — binder image cropping and a shared design system
   (both improve the portfolio impression).
4. **BUG-017 / BUG-018** — card detail view with purchase price + price history,
   and TCGplayer last-sold pricing (the larger feature work).
