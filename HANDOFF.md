# CardStacks (PokéTracker) — Developer Handoff

Working context for continuing development. For the public-facing overview see
`README.md`; for the live defect list see `BUGS.md`.

_Last updated: 2026-10-14._

**Every session: read this file and `BUGS.md` before starting, and update
"Current state" (and `BUGS.md`) before finishing.**

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
- **Admin/maintenance:** none. The old `/api/admin/refresh*` routes were
  removed in 1f95bbf (no admin-role mechanism exists yet). Prices refresh on
  their own: opening a set re-fetches its prices if they're older than 6h.

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
  catalog row) → blank/$0. `CardService.ensureCached` prevents this on save. `getCardsBySet` and
  `searchCards` fall back to the pokemontcg.io API and cache results; only
  `getCardsBySet`/`refreshSet` also fetch **prices**.
- **Prices** come from TCGTracking via `PriceService`, fetched at the set level.
  A card can have a catalog row but no price (fetch failed or source lacks it) →
  shows "no price". See BUG-019.
- **One collector number ≠ one TCGTracking product.** Normal / Holofoil /
  Reverse Holofoil are SKU `printing`s of ONE product; Poké Ball / Master Ball
  Pattern and "(Stamped)" promos are SEPARATE products on the same number,
  told apart only by a "(…)" suffix in the name. Plain-named products win for
  the card's main price (BUG-022). Per-print prices live in
  `card_variant_prices`; `card_prices` stays one row per card (default print).
- **Which print a physical copy is can't be derived** — all prints share the
  number, so it has to be the user's choice (BUG-023).
- **Conditions** are stored as a condition→quantity map; keys include a
  `" 1st Ed"` suffix variant. `lib/conditions.ts` holds the price math and
  list↔map conversions; `baseCond` strips the suffix for the backend
  `selectedCond`.

## Current state (2026-10-14)

Live: Supabase auth + demo mode, collection/bulk add, binders, Spaces (shelves,
boxes with compartments, display cases, auto-filing into per-set boxes), Trade
Analyzer, Rip Tracker, price history, "Missing only" per-set view, per-print
prices with a picker on card tiles.

**Git history was rewritten** (old copy in `C:\Users\nicho\tcg-before-history-rewrite-backup`).
`C:\Users\nicho\tcg` is still on the OLD history — don't work or commit there;
use a worktree off current `origin/main`.

### Migrations run in production
Migrations are applied by hand in Railway's SQL editor, before the code that
needs them is pushed.
- `migration_013_drawer_auto_set.sql` (box compartments) — run 2026-10-14.
- `migration_014_card_variant_prices.sql` (per-print prices) — run 2026-10-14.
- `migration_015_trading.sql` (share-link trading) — run 2026-10-14.
- Migration 003 (per-variant `card_prices`) is DISABLED — never run it.

### Pricing audit (2026-10-14)
Full audit of live prices vs. TCGTracking found BUG-022, 025, 026, 027, 028
(see `BUGS.md`). Audit scripts compare every card our API serves against
TCGTracking: re-run one after any pricing change. After deploying a pricing
fix, run `UPDATE card_sets SET prices_fetched_at = NULL;` so every set
re-prices instead of keeping stored wrong values until its next refresh.

### In flight / not yet on main
- **Share-link trading** — LIVE. (`/trade`, public `/s/:slug`): trade list, share
  link (optionally exposing the whole collection), offers with cash and/or
  cards, per-offer message thread, unread badge on the Trade nav link. No
  payments in-app; completing a deal doesn't change collections. Backend:
  `TradingRoutes/Service/Repository`, `models/Trading.scala`. Live on main
  (migration 015 run). `TradingDbSuite` is an opt-in DB test (set `TRADING_IT_DB_URL`).
  The older `trade_listings`/`trade_offers` tables are unrelated and unused.
- **BUG-023 per-print pricing:** card tiles show only alternate prints as
  small chips ("Reverse $1.37"). Phase 2 (record which print an owned copy is,
  via a print suffix on condition keys → `inventory_lots.variant_key`) and
  Phase 3 (print selector in Bulk Add) not started.
- **Excel export by set:** uncommitted in the `tcg-excel` worktree
  (`web/src/lib/xlsxExport.ts`, `CollectionPage.tsx`, `package.json`).
- **TCGTracking PriceService rewrite:** uncommitted in
  `.claude/worktrees/m1-tcgtracking-openapi` (+ tests, `docs/agent-reports/`).
  Overlaps the per-print pricing code — merge with care.

## Known issues & next steps

Tracked in `BUGS.md`. Highest-value next items:
1. **BUG-023** — finish per-print ownership (Phase 2) and Bulk Add (Phase 3).
2. Land or drop the Excel export and the PriceService rewrite worktrees.
3. **BUG-013** — shared design system.
4. **BUG-018** — TCGplayer last-sold pricing.
