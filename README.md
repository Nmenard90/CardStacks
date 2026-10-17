# CardStacks

A full-stack trading card collection tracker — Pokémon (English and
Japanese) first, other TCGs ready to switch on. Log the physical cards you
own — by condition, print, and quantity — organize them into virtual binders
and physical storage boxes that mirror your real shelves, value the
collection from live market prices, and trade with other collectors through
a share link.

> **Stack:** React 19 + TypeScript (Vite) frontend · Scala 3 + ZIO 2 + Doobie +
> PostgreSQL backend · Supabase Auth · deployed on Railway.

<!-- TODO: add a live demo link and a couple of screenshots here -->
**Live demo:** no account needed — hit "Try the demo" on the login screen for a temporary account (cleared after 24h) · **API health check:** `GET /health`

---<img width="1448" height="1086" alt="image" src="https://github.com/user-attachments/assets/bc73c8b9-9a47-4e2c-9d36-0408f9119692" />


## Overview

CardStacks is built for collectors who own real cards and want a single place
to track them. English Pokémon card and set data comes from the
[pokemontcg.io](https://pokemontcg.io) catalog, plus the English products it
lacks (Trainer Kits, Battle Academy, newest sets…) and every other game from
[TCGTracking](https://tcgtracking.com) (TCGplayer's catalog). Prices are
per condition and per print from TCGTracking, falling back to Cardmarket's
public price guide when TCGplayer has no sales — never estimates.

- **Spaces** — a personal collection room with three areas: physical Storage
  (boxes and shelf units modeled on real-world formats, auto-filed set boxes
  that can be arranged by release date), a Binder Library, and a Display
  Gallery for showcase pieces.
- **Explore** the full card catalog by set, or search every set at once by
  name or collector number ("20/30").
- **Add Cards** quickly when sorting through a physical pile.
- **Track ownership** by condition (NM / LP / MP / HP / DMG), print (Normal,
  Reverse Holo, Poké Ball…) and quantity, with automatic valuation.
- **Trade & Sell** — mark cards for trade (one at a time or thousands in
  bulk), share one link, and receive offers of cash and/or cards with a
  message thread per offer.
- **Trade Analyzer** — compare the value of cards given vs. received.
- **Convention Mode** — quick on-the-floor price reporting.
- **CSV import / export** of your collection.
- **Multiple games** — each game is its own world (collection, Spaces,
  binders, trades). Switch games from the header.

Accounts are handled by **Supabase Auth** (email + password) — the backend
never sees or stores a password, and there is no way to browse or discover
other users' accounts from the app. A "Try the demo" button on the login
screen starts a Supabase anonymous session instead, so anyone can look
around without creating an account; demo accounts (and their data) are
purged 24 hours after creation. Demo accounts can't trade.

---

## Features

| Area | What it does |
|------|--------------|
| Spaces | Physical Storage, Binder Library, and Display Gallery for one collector's room, backed by real box/shelf presets; set boxes auto-filed and arranged by release date |
| Explore | Browse by set, global name/number search, per-condition and per-print prices |
| Add Cards | High-volume entry with live search-as-you-type and quick-add by number |
| Trade & Sell | Trade list (bulk select, % of market pricing), share link (optionally the whole collection), offers + message threads |
| Trade Analyzer | Side-by-side give/get value comparison with a fairness verdict |
| Convention Mode | Fast price lookups for use at events |
| Import / Export | CSV round-trip of your collection |

Every page's view state (area, box, set, tab) lives in the URL, so the
browser's back button returns to the previous view, and every page is laid
out for phone screens too.

---

## Architecture

```
React SPA  ──HTTP + Supabase JWT──▶  ZIO HTTP API  ──Doobie──▶  PostgreSQL
 (web/)                               (poketracker-v2/)             │
        │                                    │                     └─ cached catalog: sets, cards, prices
        └──▶ Supabase Auth (sign-up/login)   ├──▶ pokemontcg.io (English Pokémon catalog, on cache miss)
                                              ├──▶ TCGTracking (prices; catalog for other games + TCGplayer-only sets)
                                              └──▶ Cardmarket price guide (fallback prices)
```

- The frontend never talks to the database directly, and never calls
  pokemontcg.io/TCGTracking directly — it only talks to the backend API.
- Every request carries `?game=` (the game the header switcher is on); the
  backend scopes catalog, collection, Spaces and trading data to it.
- Background jobs in the backend re-price owned sets every 6h, import the
  catalogs of enabled TCGTracking games daily, and purge demo accounts.
- The frontend authenticates against **Supabase Auth**, then sends the
  resulting access token as a bearer token on every backend request.
- The backend verifies that token itself, against Supabase's own public
  signing keys (fetched once and cached in memory, not per request), and
  uses it to provision/resolve a local profile row, which is what
  collections, binders, and storage actually reference. See
  **Authentication** below.

### Route → service → repository → database

Every backend feature follows the same layering: a **route** file
(`api/`) parses the HTTP request and hands off; a **service** file
(`service/`) holds the actual business rule; a **repository** file
(`repository/`) is the only place that touches SQL for that table. Once you
understand this chain for one feature, you understand it for all of them.
Every source file in `web/` and `poketracker-v2/` is commented line-by-line —
`web/src/components/Mascot.tsx` and
`poketracker-v2/.../repository/UserRepository.scala` are good starting points
if you want to see the pattern explained in full.

---

## Tech Stack

**Frontend** (`web/`)
- React 19 + TypeScript, built with Vite
- TanStack Query for server-state caching
- React Router for client-side routing
- Axios API client
- `@supabase/supabase-js` for authentication

**Backend** (`poketracker-v2/`)
- Scala 3
- ZIO 2.1 (effects/concurrency) + ZIO HTTP 3 (server) + ZIO JSON
- Doobie 1.0 (functional SQL) over the PostgreSQL JDBC driver
- Nimbus JOSE+JWT for verifying Supabase access tokens against Supabase's public JWKS (asymmetric signing keys — no shared secret)
- PostgreSQL
- Packaged with Docker

**Infrastructure**
- Railway (frontend and backend services + managed PostgreSQL)
- Supabase (Auth only — collection data stays in the app's own PostgreSQL)
- Upstream card data from pokemontcg.io and TCGTracking; pricing from
  TCGTracking with a Cardmarket price-guide fallback

---

## Authentication

Sign-up and sign-in go straight to Supabase Auth (`supabase.auth.signUp` /
`signInWithPassword`) — the backend never handles a password. Once Supabase
issues a session, the frontend sends its access token as a bearer token on
every API call; the backend (`security/AuthGuard.scala`, via
`security/SupabaseJwtVerifier.scala`) verifies that token's signature against
Supabase's own public signing keys (fetched once at startup from
`<project-url>/auth/v1/.well-known/jwks.json` and cached in memory — not
re-fetched per request) and resolves (or provisions, on first sign-in) a
matching profile row in its own `users` table via `GET /api/auth/me`.

The same guard also closes an authorization gap: almost every endpoint is
scoped by a `userId` path segment (`/api/spaces/:userId/...`,
`/api/binders/:userId/...`, etc.), and `AuthGuard` rejects any request whose
path `userId` doesn't match the authenticated caller — a collector can only
ever read or write their own data. Endpoints keyed only by an internal
object id (`/api/storage/boxes/:id`, `/api/storage/drawers/:id`) can't be
checked from the path, so their repositories check ownership in SQL
instead.

**Setting it up on your own Supabase project:**

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Project Settings → API: copy the **Project URL** and **anon public key**
   into `web/.env.local` (local dev, copy from `web/.env.example`) or
   `web/.env.production` (deployed build) as `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY`.
3. Set the backend's `SUPABASE_URL` environment variable (Railway, or your
   local shell) to that same Project URL from step 2 — it's not a secret,
   the backend just uses it to fetch Supabase's public signing keys.
4. Run `poketracker-v2/sql/migration_011_supabase_auth.sql` against your
   database (see **Deployment** below for the production caveat).
5. Authentication → Providers → Email: confirm email/password sign-up is
   enabled. Toggle "Confirm email" off if you want new accounts to be usable
   immediately instead of requiring an email confirmation link.

---

## Repository Structure

```
tcg/
├── web/              # React + TypeScript + Vite frontend
│   └── src/
│       ├── pages/        # SpacesLivePage (home), CollectionPage (Explore), BulkAddPage,
│       │                 # BinderViewPage, TradePage, SharePage, AnalyzerPage, ConventionModePage
│       ├── components/   # CardTile, OwnedCardTile, CardThumb, CardBrowser, HeaderNav, ...
│       ├── api/          # One file per backend area (cards, collection, trading, ...)
│       ├── lib/          # conditions (price math), game, cardSort, trading, csv, ...
│       └── styles/       # Per-page CSS
├── poketracker-v2/   # Scala 3 + ZIO backend (Dockerized)
│   ├── src/main/scala/com/poketracker/
│   │   ├── models/       # Plain data shapes (what a "Card" or "User" IS)
│   │   ├── repository/   # All database SQL lives here, and ONLY here
│   │   ├── service/      # Business rules — catalog, pricing, trading, storage, ...
│   │   ├── api/          # HTTP routes — translates web requests into service calls
│   │   ├── security/     # Supabase JWT verification + per-request authorization
│   │   ├── config/       # Database connection + auth setup
│   │   └── Main.scala    # Entry point — wires everything together and starts the server
│   ├── src/test/scala/   # munit suites (pure logic; DB suites are opt-in)
│   └── sql/              # schema.sql + numbered migrations, applied by hand
├── HANDOFF.md        # Developer handoff: current state, gotchas, migrations run
├── BUGS.md           # Tracked known issues
└── README.md         # This file
```

---

## API

Base path: `/api`. User scoping is by `userId` in the path. Every endpoint
below except the catalog, share-page and rip-verdict routes requires an
`Authorization: Bearer <supabase access token>` header — see
**Authentication**. Most routes also take `?game=<id>` (default `pokemon`).

**Auth**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me` | Provision/return the profile linked to the caller's Supabase session |

**Catalog** (public, no auth required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/games` | Enabled games |
| GET | `/api/sets` | All sets of the game |
| GET | `/api/cards/:setId` | Cards in a set, with prices |
| GET | `/api/cards/browse` | Cards across sets, paged and sorted |
| GET | `/api/cards/id/:cardId` | Single card by id |
| GET | `/api/cards/id/:cardId/price-history` | Every price snapshot recorded for a card |
| GET | `/api/search?q=…` | Search across all sets by name or number |

**Collection**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collection/:userId` | All collection entries |
| GET | `/api/collection/:userId/owned` | Owned cards with full card data |
| GET | `/api/collection/:userId/stats` | Totals: cards, value, sets entered |
| POST | `/api/collection/:userId/:cardId` | Save/update one card's conditions |
| POST | `/api/collection/:userId/bulk` | Save many cards at once |

**Spaces** (Storage / Binder Library / Display Gallery)
| Method | Path | Description |
|--------|------|-------------|
| GET / POST | `/api/spaces/:userId` | List / create spaces |
| POST | `/api/spaces/:userId/storage-units` | Add a shelf/rack/cabinet unit |
| POST | `/api/spaces/:userId/storage-units/:unitId/arrange-by-date` | Order set boxes by release date across the room's units |
| PUT | `/api/spaces/:userId/boxes/:boxId/placement` | Place a box on a unit |
| PUT | `/api/spaces/:userId/binders/:binderId/placement` | Place a binder on a unit |
| POST | `/api/spaces/:userId/display-cases` | Add a display case |
| PUT | `/api/spaces/:userId/display-cases/:caseId/lights` | Toggle case lighting |
| GET | `/api/spaces/:userId/inventory` | Full inventory across the space |
| GET | `/api/spaces/:userId/{drawers,binders,display-cases}/:id/allocations` | Copies placed in a drawer, binder or case |
| POST | `/api/spaces/:userId/binders/:binderId/slots/:slotIndex/place` | Put a copy in a binder slot |
| POST / DELETE | `/api/spaces/:userId/allocations[/:id]` | Assign / remove copies |

**Shelf**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/shelf/:userId` | Merged, ordered list of boxes + binders |
| PUT | `/api/shelf/:userId/reorder` | Write a whole new order |

**Binders**
| Method | Path | Description |
|--------|------|-------------|
| GET / POST | `/api/binders/:userId` | List / create binders |
| GET / PUT / DELETE | `/api/binders/:userId/:binderId` | Get / update / delete a binder |
| PUT | `/api/binders/:userId/:binderId/slot/:slotIndex` | Set/clear a slot |

**Physical Storage**
| Method | Path | Description |
|--------|------|-------------|
| GET / POST | `/api/storage/:userId/boxes` | List boxes with their drawers / create a box |
| PUT / DELETE | `/api/storage/boxes/:boxId` | Rename/reorder or delete a box |
| POST | `/api/storage/boxes/:boxId/merge` | Merge another box into this one |
| POST | `/api/storage/boxes/:boxId/drawers` | Create a drawer |
| PUT / DELETE | `/api/storage/drawers/:drawerId` | Rename/reorder or delete a drawer |
| GET | `/api/storage/drawers/:drawerId/cards` | Cards in a drawer |
| GET | `/api/storage/:userId/unassigned` | Owned cards with no drawer |
| POST | `/api/storage/:userId/assign` | Bulk-assign cards to a drawer |
| DELETE | `/api/storage/:userId/assign/:cardId` | Unassign a card |

**Trading**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/share/:slug` | Public share page data (no auth) |
| GET / PUT | `/api/trading/:userId/share` | Own share settings (creates the link) / update them |
| POST | `/api/trading/:userId/share/regenerate` | New link; the old one stops working |
| GET / PUT | `/api/trading/:userId/list` | Own trade list / add or update one card |
| PUT | `/api/trading/:userId/list/bulk` | List many cards at once (capped to what's owned) |
| POST | `/api/trading/:userId/list/remove` | Remove many at once |
| DELETE | `/api/trading/:userId/list/:itemId` | Remove one |
| GET / POST | `/api/trading/:userId/offers` | Offers made and received / make an offer |
| GET | `/api/trading/:userId/offers/:offerId` | One offer + thread (marks it read) |
| PUT | `/api/trading/:userId/offers/:offerId/status` | Accept / decline / withdraw / complete / cancel |
| POST | `/api/trading/:userId/offers/:offerId/messages` | Post to the thread |
| GET | `/api/trading/:userId/unread` | Unread offer count |

**Rip Tracker** (backend only — no page in the app yet)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/rip-sessions` | Start a pack-opening session for a product |
| POST | `/api/rip-sessions/:id/pulls` | Record a pulled card |
| GET | `/api/rip-sessions/:id` | Session recap |
| GET | `/api/rip-tracker/verdict/:productId` | Rip-or-hold verdict (public) |

**Profile**
| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/users/:userId/location` | Update location |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [JDK 17+](https://adoptium.net)
- [sbt](https://www.scala-sbt.org/download.html)
- [PostgreSQL](https://www.postgresql.org/download/) 14+
- A free [Supabase](https://supabase.com) project (for auth — see **Authentication**)

### 1. Database

```bash
createdb poketracker
psql poketracker -f poketracker-v2/sql/schema.sql
```

`schema.sql` is idempotent — safe to run more than once.

### 2. Backend environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_NAME` / `DATABASE_USER` / `DATABASE_PASSWORD` | PostgreSQL connection |
| `SUPABASE_URL` | Your Supabase project's URL (Project Settings → API) — used to fetch its public signing keys, not a secret |
| `POKEMONTCG_API_KEY` | Optional — a free API key from pokemontcg.io for higher rate limits |
| `PORT` | Optional — defaults to `8080` |

```bash
cd poketracker-v2
sbt run
```

### 3. Frontend

```bash
cd web
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

The dev server proxies `/api/*` to the deployed backend by default; set
`VITE_PROXY_TARGET=http://localhost:8080` in `.env.local` to use a local one
(see `web/vite.config.ts`) — no CORS setup needed. Open the printed URL,
create an account, and you're in.

### Building for production

```bash
# Frontend — produces static files in web/dist/
cd web
npm run build

# Backend — produces a runnable "fat JAR"
cd poketracker-v2
sbt assembly
```

### Tests

```bash
cd poketracker-v2
sbt test            # pure-logic suites
cd ../web
npx tsc -b          # typecheck (the production build runs this too)
npx eslint .
```

`TradingDbSuite` runs against a real database only when
`TRADING_IT_DB_URL` is set.

---

## Deployment

Both services deploy on Railway and auto-build on push to `main`. The
frontend builds with Vite and is served as static files; the backend builds
with sbt and runs as a Dockerized JVM process against a managed PostgreSQL
instance.

**Important:** `poketracker-v2/sql/schema.sql` and
`poketracker-v2/sql/migration_*.sql` are applied **manually**, through
Railway's SQL editor — they do **not** run automatically on deploy. Backend
code that depends on a new column/table (like `supabase_user_id` — see
`migration_011_supabase_auth.sql`) must never be pushed to `main` before that
migration has actually been run against the production database, since
Railway auto-deploys backend code on push and code/schema can otherwise go
live out of order and break every query touching the changed table.

---

## Known Issues & Roadmap

Tracked in [`BUGS.md`](./BUGS.md); summary:

**Roadmap**
- Bulk Add print picker (record Reverse Holo etc. while adding — BUG-023).
- Card detail view with purchase price and price-history chart (BUG-017).
- TCGplayer "last sold" pricing, broken out by condition (BUG-018).
- Export scope picker (BUG-014) and a shared design system (BUG-013).
- A Rip Tracker page (the backend endpoints exist).
- TCGplayer's catch-all promo groups (Blister Exclusives…) and Japanese
  One Piece aren't imported yet.

See [`BUGS.md`](./BUGS.md) for full detail and [`HANDOFF.md`](./HANDOFF.md)
for the developer's view of the current state.

---

## License

<!-- TODO: choose a license (e.g. MIT) and add a LICENSE file -->
_Not yet licensed._
