# CardStacks (PokéTracker) — Developer Handoff

Working context for continuing development. For the public-facing overview see
`README.md`; for the live defect list see `BUGS.md`.

_Last updated: 2026-10-29._

**Every session: read this file and `BUGS.md` before starting, and update
"Current state" (and `BUGS.md`) before finishing.**

---

## What it is

A full-stack trading card collection tracker (Pokémon English + Japanese live;
other TCGs seeded): log owned cards by condition, print and quantity, organize
them into Spaces (shelves, boxes, binders, display cases) shown as a 3D room on
the home page, value the collection from market prices, and sell or trade
through a public shop page. Card/set data comes from
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
│       ├── pages/        # RoomPage (home), SpacesLivePage (/spaces), CollectionPage (Explore), BulkAddPage,
│       │                 # BinderViewPage, ShopPage, ShopRequestsPage (My Shop), AnalyzerPage, ConventionModePage
│       ├── room3d/        # the 3D room (React Three Fiber, JS + .d.ts shims)
│       ├── components/    # CardTile, OwnedCardTile, ShopCardTile, CardThumb, OfferInbox, HeaderNav, Toast, ...
│       ├── api/           # client, cards, collection, binders, storage, rooms, shop, trading, users, ...
│       └── lib/           # conditions, game, cardSort, csv, cardSearch
│   └── tests/             # room-browser, shop-browser (mocked API), room-live-smoke (real backend)
├── poketracker-v2/   # Scala 3 + ZIO backend
│   └── src/main/scala/com/poketracker/
│       ├── api/           # CardRoutes, CollectionRoutes, BinderRoutes, RoomRoutes, StorageRoutes, ShopRoutes, TradingRoutes, ...
│       ├── service/       # CardService, TcgTrackingCatalog, PriceService, CardmarketGuide, TradingService (offers), ...
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
- **Backend checks run locally:** `sbt` lives in Coursier
  (`%LOCALAPPDATA%\Coursier\data\bin\sbt.bat`; set `JAVA_HOME` to the JDK 21).
  `sbt test` runs the pure suites; the DB suites need a throwaway local
  Postgres (PostgreSQL 18 is installed — `initdb` a scratch folder, start it
  on 55432, apply `schema.sql` + every migration, then set
  `TRADING_IT_DB_URL` / `SHOP_PROFILE_IT_DB_URL` / `COLLECTION_IT_DB_URL` to
  `jdbc:postgresql://127.0.0.1:55432/postgres`).
- **Frontend checks** can be run locally: `cd web && npx tsc -b` (typecheck),
  `npx eslint .` (lint), `npm run test:room`, `npm run test:og`, and the
  browser tests in `web/tests/` (Playwright; `playwright-core` is in the
  room prototype's `node_modules`, Chromium in `%LOCALAPPDATA%\ms-playwright`).
  The production build (`npm run build`) runs `tsc -b`, so type errors fail
  the deploy; eslint does **not** gate the build (2 known errors in
  `SpacesLivePage`).
- **IDE caches** (`.metals/`, `.bloop/`, `.bsp/`, `metals.sbt`, `.vscode/`) and
  local worktrees (`.worktrees/`, `.claude/`) are git-ignored.

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
  `?area=&space=&unit=&case=&box=`, Explore `?set=`, the shop `?set=`, My Shop
  `?tab=`/`?offer=`, the 3D room its URL hash (`#/binders/<id>/card/<id>`). Spaces'
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

## Current state (2026-10-29)

Branch `feat/3d-room` (worktree `.worktrees/room3d`) holds three commits on
top of `main`, **NOT merged/live yet**:

1. **Cleanup** (`chore/cleanup-20261029`) — removed dead pages/components
   (OwnedPage, ShelfPage, duplicate CollectionPage, CollectionShelf,
   ExportModal…), the Shelf API (`/api/shelf`; its `shelf_items` table is left
   in the database, no longer written), the never-wired old trade system
   (`models/Trade`, `Reputation`, `TradeRepository`), unused CSS selectors,
   template tests, IDE files and a collection CSV in the root.
2. **Trade merged into Shop** — one public page (`/shop/<slug>`) and one owner
   page (My Shop, `/shop/requests`: Requests / Offers / Settings). Brings in the
   unmerged `feature/shop-branding` + `feature/shop-photos` work (collection-style
   page, trade offers with catalog search + cash top-up, seller photos with the
   camera guide), keeping main's shop name/bio and `?set=`. The share-link
   trade page, trade list and make-offer endpoints are gone; existing offers
   stay answerable in My Shop → Offers. `/trade` and `/s/<slug>` redirect
   (`GET /api/shop/from-share/:slug`). Tables `share_profiles`,
   `trade_list_items`, `card_offers`, `offer_messages` are untouched.
3. **3D room landing page** — `/` is the 3D collector's room (`web/src/room3d/`,
   React Three Fiber 9 / drei 10 / three 0.169, lazy-loaded) showing the
   user's real binders, boxes and display cases; Spaces moved to `/spaces`
   (old `/?area=…` links redirect). First-visit animated guide; `/card-art`
   relay for TCGplayer art (`web/cardArt.mjs`). The pinboard opens My Shop.
   Prototype source stays in `D:\Projects\CardStacks\experiments\nook-concept`.

**Before merging:** migration 019 (`shop_photos`) must exist in production with
the columns in `sql/migration_019_shop_photos.sql` — the public shop response
reads it. The table was seen in production on 2026-10-25 but its columns were
never checked; run the migration (it is `IF NOT EXISTS`) and confirm
`user_id, card_id, condition, side, image, content_type, updated_at` exist.

**Verification (2026-10-29):** backend 66 passed / 1 skipped (DB suites against
a local Postgres with schema + migrations 010–020); `tsc` clean; build OK;
`test:room` 90/90; og 4/4; `shop-browser.mjs` 11/11 (desktop + phone);
`room-browser.mjs` (4 screen sizes). Reports and screenshots:
`docs/agent-reports/cleanup-20261029/`, `docs/agent-reports/room3d-landing/`.

**Repo cleanup (2026-10-29):** everything was backed up first to
`C:\Users\nicho\tcg-backups\2026-10-29-pre-cleanup\` (git bundle of every
branch/tag, plus each worktree's uncommitted diff and untracked files) and
tag `backup/pre-cleanup-2026-10-29` on GitHub. Then 27 old worktrees and 31
local branches were removed, and 5 merged/obsolete GitHub branches deleted.
`C:\Users\nicho\tcg` is now on current `main` (no longer the pre-rewrite history).
Unfinished uncommitted work that only lives in that backup: Excel export by set
(`tcg-excel`: `web/src/lib/xlsxExport.ts`), the TCGTracking PriceService
rewrite + fixtures (`m1-tcgtracking-openapi`), an integrated trade/inbox
preview (`collection-integrated`), a collection overview
(`collection-overview`) and a mobile plan (`tcg-compartments`). Restore one
with `git apply <name>.diff` and `tar -xzf <name>.untracked.tgz` in a fresh
worktree of its branch from `all-refs.bundle`.

GitHub branches kept for a decision: `fix/auto-allocation-protection-mismatch`
(auto-filed copies saved with NULL protection → duplicate rows; not on main;
its second commit is a one-off cleanup query), `feature/unsorted-holding-box`
(file new cards into one Unsorted box instead of one per set — a behaviour
change), `fix/bulk-add-first-edition-sticky-toggle` (probably superseded by
main's 1st-Edition set list; check before deleting). `feature/shop-branding`
and `feature/shop-photos` can be deleted once the branch above is merged.

## Earlier state (2026-10-25)

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

Photo feature status (2026-10-25): GitHub `feature/shop-photos` (`3ee2f98`),
not merged or live. Production `shop_photos` table exists (checked 2026-10-25),
but its full schema has not been audited. (Now carried in `feat/3d-room` — see
Current state.)

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
prices with a picker on card tiles, multiple card games, share-link trading
(replaced by the shop on `feat/3d-room`), the public shop.

Recent (2026-10-16): "Arrange by date" orders set boxes by release date
across every shelf unit in a room (`RoomRepository.arrangeSetBoxesByDate`);
TCGplayer-only English sets added; back button works everywhere (see
Frontend gotchas); full phone-width audit fixed overflow on every main page.
Unowned Code Card rows were deleted from production (34 rows).

**Git history was rewritten** (old copy in `C:\Users\nicho\tcg-before-history-rewrite-backup`).
Since 2026-10-29 `C:\Users\nicho\tcg` is on current `main`; still do task work
in a worktree off `origin/main`.

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
- `migration_019_shop_photos.sql` (`shop_photos`, seller photos of the actual cards) — table seen in
  production 2026-10-25, columns **not verified**. Run it (idempotent) and check its columns in Railway's
  SQL editor BEFORE `feat/3d-room` reaches `main` (the shop page's public response queries
  `shop_photos`, so a missing/wrong table would break every shop page).
- `migration_020_shop_profile.sql` (`shop_settings.display_name`, `bio`) — run 2026-10-25.
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
- **Shop** (`/shop/<slug>`, My Shop at `/shop/requests`) — the one place to
  sell and trade. The owner's rules: prices follow the market (no fixed or %
  prices), trades welcome, a trade offer must be even or better for the
  seller (a little extra cards/cash, never less). Buyers need no account;
  requests carry a "TRADE OFFER" list in the message. Backend: `ShopRoutes`,
  `ShopRepository`, `models/Shop.scala` (migrations 018–020). Shop links get
  Open Graph previews from `web/ogTags.mjs` (served by `server.mjs`).
- **Card offers** (from the retired share-link trading, migration 015) — read,
  accept/decline, message only, in My Shop → Offers (`TradingRoutes/Service/
  Repository`, `components/OfferInbox`). No new offers are created. The older
  `trade_listings`/`trade_offers` tables are unrelated and unused.
- **Excel export by set** and the **TCGTracking PriceService rewrite** were
  uncommitted worktrees; they now only exist in the 2026-10-29 backup (see
  Current state).

## Known issues & next steps

Tracked in `BUGS.md`. Highest-value next items:
1. Verify migration 019 in production, then merge `feat/3d-room` (cleanup +
   shop + 3D room) and check both Railway services; try the room on a real
   phone and with the owner's full collection.
2. Decide the three kept fix branches (see Current state).
3. **BUG-023** — Bulk Add print picker (Phase 3).
4. Restore or drop the Excel export / PriceService rewrite from the backup.
5. **BUG-013** — shared design system.
6. **BUG-018** — TCGplayer last-sold pricing.
