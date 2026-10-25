# CardStacks (PokéTracker) — Developer Handoff

Working context for continuing development. For the public-facing overview see
`README.md`; for the live defect list see `BUGS.md`.

_Last updated: 2026-10-25._

**Every session: read this file and `BUGS.md` before starting, and update
"Current state" (and `BUGS.md`) before finishing.**

---

## What it is

A full-stack trading card collection tracker (Pokémon English + Japanese live;
other TCGs seeded): log owned cards by condition, print and quantity, organize
them into Spaces (shelves, boxes, binders, display cases), value the collection
from market prices, and trade through share links. Card/set data comes from
pokemontcg.io and TCGTracking (cached locally); prices from TCGTracking per
condition and print, with a Cardmarket price-guide fallback.

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
│       ├── pages/        # SpacesLivePage (home), CollectionPage (Explore), BulkAddPage, BinderViewPage,
│       │                 # TradePage, SharePage, AnalyzerPage, ConventionModePage
│       ├── components/    # CardTile, OwnedCardTile, CardThumb, CardBrowser, HeaderNav, Toast, ...
│       ├── api/           # client, cards, collection, binders, storage, trading, users, ...
│       └── lib/           # conditions, game, cardSort, trading, csv, cardSearch
├── poketracker-v2/   # Scala 3 + ZIO backend
│   └── src/main/scala/com/poketracker/
│       ├── api/           # CardRoutes, CollectionRoutes, BinderRoutes, RoomRoutes, StorageRoutes, TradingRoutes, ...
│       ├── service/       # CardService, TcgTrackingCatalog, PriceService, CardmarketGuide, TradingService, ...
│       ├── repository/    # CardRepository, CollectionRepository, ...
│       ├── models/        # Card, CardSet, Binder, ...
│       └── Main.scala
│   └── sql/schema.sql
├── README.md
├── BUGS.md
└── HANDOFF.md
```

## Dev environment & workflow

- **Foreman is retired.** The owner confirmed on 2026-10-25 that it has not
  been used for months. Follow direct user instructions and use a worktree
  from current GitHub `main`; do not require or start Foreman.

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
- Full list in `README.md` → API. Most routes take `?game=` (default `pokemon`).
- **Admin/maintenance:** none. The old `/api/admin/refresh*` routes were
  removed in 1f95bbf (no admin-role mechanism exists yet). Prices refresh on
  their own: opening a set re-fetches its prices if they're older than 6h,
  and a background job re-prices every owned set every 6h. One-off data
  fixes are run as SQL in Railway's editor (it appends LIMIT, so wrap a
  DELETE/UPDATE in a CTE that ends in a SELECT, with no trailing semicolon).

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
- **English Pokémon has two catalog sources.** Most sets come from
  pokemontcg.io; sets it lacks but TCGplayer sells (Trainer Kits, Battle
  Academy, Trick or Trade, McDonald's, newest Mega Evolution sets…) come from
  TCGTracking and live in the same `pokemon` game with ids starting `tt`
  (`TcgTrackingCatalog.PokemonExtraSets`, `CardService.isTcgSet`). Their
  printed total is worked out from the "20/30" numbers so number search finds
  them. Add a set by adding its TCGTracking id to `PokemonExtraSets`. Code
  Cards (online redemption codes) are never imported.
- **Conditions** are stored as a condition→quantity map; keys include a
  `" 1st Ed"` suffix variant. `lib/conditions.ts` holds the price math and
  list↔map conversions; `baseCond` strips the suffix for the backend
  `selectedCond`.

## Frontend gotchas

- **Back button = URL.** Any view the user would expect "back" to undo must
  live in the URL (`useSearchParams`), not component state. Spaces uses
  `?area=&space=&unit=&case=&box=`, Explore `?set=`, Trade `?tab=`. Spaces'
  `closeBox` only calls `navigate(-1)` when the box was opened on this page
  (`location.state.boxOpenedHere`), so a shared/reloaded box link doesn't
  leave the site. Don't add popstate handlers or in-memory history stacks.
- **`backdrop-filter`/`filter` on an ancestor traps `position:fixed`
  children** (they position against the ancestor, not the screen). That's why
  the phone bottom bar sat at the top on Analyzer/Convention; `index.css`
  turns off the blur on any ancestor of `.bottom-nav` under 720px. Write only
  the unprefixed `backdrop-filter` — the minifier adds `-webkit-` and, if
  both are written, collapses them wrongly.
- **Phone width:** grid columns need `minmax(0,1fr)` (plain `1fr` won't
  shrink below content); page headers wrap or scroll rather than clip. Check
  with a 390px-wide view for any element past the right edge.

## Current state (2026-10-25)

Shop profile / organization update is implemented in
`.worktrees/shop-inviting-20261025` (`feat/shop-inviting-20261025`), validated locally. Adds owner-editable shop name/bio, set-grouped public inventory,
a desktop set directory and phone set picker, URL-backed set navigation,
friendlier request flow and previews. Also fixes Explore Owned only + Price
descending: sort the complete owned inventory before pagination, rather than
filtering the first 60 catalog cards. Backend: 56 passed, 5 skipped; frontend
build/lint, 4 Open Graph tests and 6 browser scenarios passed. Rendered evidence:
`docs/agent-reports/shop-inviting-20261025/` (sample bio, intercepted API writes).
Migration `020_shop_profile` was manually applied to production on 2026-10-25
and both columns were verified BEFORE publishing dependent code. Verify production rollout against the resulting main commit in Railway.
Actual seller bio is blank until the owner writes it.

Quantity-zero removal repair is deployed as `07af84a` on both Railway services.
A live API smoke test on an isolated anonymous demo account verified 1 -> 0
removal from owned inventory; the seller's existing inventory was untouched.
Clears storage placements/binder mirrors and ownership atomically, preserves
other conditions/prints, fixes bulk zero saves, queues Explore writes and rolls
back failed saves. Local Postgres regressions and full backend suite passed
(51 passed, 5 skipped). Earlier failed removals must be retried because they
never saved their intended quantity. No migration was needed.

Photo feature status: GitHub `feature/shop-photos` (`3ee2f98`), not merged or
live. Production `shop_photos` table exists (checked 2026-10-25), but its full
schema has not been audited. This profile update does not merge that branch.

Pricing repair deployed and verified (2026-10-25, commit `7a57aec`): Railway frontend and backend were both
confirmed on GitHub main commit `2fdbdbc`. TCGTracking moved its API to
`https://openapi.tcgtracking.com/v1`; the previous host returns an empty HTTP
308 redirect that the Java clients do not follow. Updated both PriceService
and TcgTrackingCatalog. Both Railway services deployed successfully. Backend compile and tests passed
(46 passed, 5 skipped). Reset only the 182 owned-set refresh timers; the job
completed, with fresh snapshots for 180 sets and over 32,000 cards across
the catalog. Public API prices/history were verified. Pokémon Futsal Collection
(`fut20`) and Wizards Black Star Promos (`basep`) remain on older prices because
no provider set passed matching; do not claim those were refreshed. No migration
was required. The job's "re-priced" summary counts attempts, including skips.

Live: Supabase auth + demo mode, collection/bulk add, binders, Spaces (shelves,
boxes with compartments, display cases, auto-filing into per-set boxes), Trade
Analyzer, Rip Tracker API (no page yet), price history, "Missing only" per-set view, per-print
prices with a picker on card tiles, multiple card games, share-link trading.

Recent (2026-10-16): "Arrange by date" orders set boxes by release date
across every shelf unit in a room (`RoomRepository.arrangeSetBoxesByDate`);
TCGplayer-only English sets added; back button works everywhere (see
Frontend gotchas); full phone-width audit fixed overflow on every main page.
Unowned Code Card rows were deleted from production (34 rows).

**Git history was rewritten** (old copy in `C:\Users\nicho\tcg-before-history-rewrite-backup`).
`C:\Users\nicho\tcg` is still on the OLD history — don't work or commit there;
use a worktree off current `origin/main`.

### Migrations run in production
Migrations are applied by hand in Railway's SQL editor, before the code that
needs them is pushed.
- `migration_013_drawer_auto_set.sql` (box compartments) — run 2026-10-14.
- `migration_014_card_variant_prices.sql` (per-print prices) — run 2026-10-14.
- `migration_015_trading.sql` (share-link trading) — run 2026-10-14.
- `migration_016_multi_game.sql` (games table + game_id columns) — run 2026-10-15.
- `migration_017_price_fallbacks.sql` (cardmarket_id, price_source, games.cardmarket_game) — run (the price-fallback code is live on main and serving prices).
- `migration_018_shop.sql` (`shop_settings` + `shop_requests`, the public shop) — run by hand in
  production on 2026-10-23, under the working name "017" before it was renumbered. All statements
  are `IF NOT EXISTS`, so re-running is a no-op. The shop code (`ShopRoutes`) needs these tables.
- Migration 003 (per-variant `card_prices`) is DISABLED — never run it.

### Pricing audit (2026-10-14)
Full audit of live prices vs. TCGTracking found BUG-022, 025, 026, 027, 028
(see `BUGS.md`). Audit scripts compare every card our API serves against
TCGTracking: re-run one after any pricing change. After deploying a pricing
fix, run `UPDATE card_sets SET prices_fetched_at = NULL;` so every set
re-prices instead of keeping stored wrong values until its next refresh.

### Feature notes
- **Multiple card games** (migration 016) — LIVE. `games` table; each game is a
  separate world (collection, Spaces, boxes, binders, trades scoped by
  `game_id`; card-derived rows inherit via `cards.game_id`). English Pokémon
  stays on pokemontcg.io; every other game (Pokémon JP enabled; Magic,
  Yu-Gi-Oh, One Piece, Lorcana seeded but disabled) comes from the generic
  `TcgTrackingCatalog` — enable a game by flipping `games.enabled`, no code.
  Ids: set `tt{category}-{tcgSetId}`, card `{setId}-{productId}`. A daily
  background job (`warmCatalog`) imports every set of enabled TCGTracking
  games so search covers them. Web: `?game=` on every request (api/client.ts
  interceptor, `lib/game.ts`), header switcher reloads into the chosen game.
  Old index `uq_collection_spaces_default` is deliberately kept (see 016).
- **Price fallbacks, never estimates** (TCGTracking games): TCGplayer NM
  market price, else a TCGplayer sale in another condition (other conditions
  filled by typical discounts), else Cardmarket's public daily price guide
  (`CardmarketGuide`, converted with a value-banded TCGplayer/Cardmarket
  ratio from similar cards in the set). `card_prices.price_source` records
  Cardmarket; tiles show "via Cardmarket". Cards never sold on either
  marketplace stay unpriced (~13% of JP — old event promos; TCGplayer shows
  no market price for them either, at most a seller's asking price).
- **Per-print ownership** shipped (BUG-023 phase 2): condition keys
  `"NM · reverse"`; Bulk Add's entry form still has no print picker (phase 3).
- **Not covered yet:** TCGplayer's catch-all promo groups (Blister
  Exclusives, Alternate Art Promos — no real release date) and Japanese One
  Piece.
- **Share-link trading** — LIVE. (`/trade`, public `/s/:slug`): trade list, share
  link (optionally exposing the whole collection), offers with cash and/or
  cards, per-offer message thread, unread badge on the Trade nav link. No
  payments in-app; completing a deal doesn't change collections. Backend:
  `TradingRoutes/Service/Repository`, `models/Trading.scala`. Live on main
  (migration 015 run). `TradingDbSuite` is an opt-in DB test (set `TRADING_IT_DB_URL`).
  The older `trade_listings`/`trade_offers` tables are unrelated and unused.
  Bulk listing: `PUT …/list/bulk` / `POST …/list/remove` (≤2000 per request;
  the web sends 500 at a time). Quantities are capped to what's owned.
- **Excel export by set:** uncommitted in the `tcg-excel` worktree
  (`web/src/lib/xlsxExport.ts`, `CollectionPage.tsx`, `package.json`).
- **TCGTracking PriceService rewrite:** uncommitted in
  `.claude/worktrees/m1-tcgtracking-openapi` (+ tests, `docs/agent-reports/`).
  Overlaps the per-print pricing code — merge with care.

## Known issues & next steps

Tracked in `BUGS.md`. Highest-value next items:
1. **BUG-023** — Bulk Add print picker (Phase 3).
2. Land or drop the Excel export and the PriceService rewrite worktrees.
3. **BUG-013** — shared design system.
4. **BUG-018** — TCGplayer last-sold pricing.
