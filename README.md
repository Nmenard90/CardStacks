# PokéTracker

A full-stack Pokémon TCG collection tracker. Log the physical cards you own — by
condition, variant, and quantity — organize them into virtual binders and
physical storage boxes that mirror your real shelves, value the collection
from live market prices, and weigh trades before you make them.

> **Stack:** React 19 + TypeScript (Vite) frontend · Scala 3 + ZIO 2 + Doobie +
> PostgreSQL backend · Supabase Auth · deployed on Railway.

<!-- TODO: add a live demo link and a couple of screenshots here -->
**Live demo:** _coming soon_ · **API health check:** `GET /health`

---

## Overview

PokéTracker is built for collectors who own real cards and want a single place
to track them. Card and set data is sourced from the
[pokemontcg.io](https://pokemontcg.io) catalog (backfilled locally across 170+
sets) and enriched with per-condition pricing from
[TCGTracking](https://tcgtracking.com). The app is organized around a few
focused workflows:

- **Spaces** — a personal collection room with three areas: physical Storage
  (boxes and shelf units modeled on real-world formats), a Binder Library, and
  a Display Gallery for showcase pieces.
- **Browse & search** the full card catalog by set, or search every set at
  once by name or collector number.
- **Bulk add** cards quickly when sorting through a physical pile.
- **Track ownership** by condition (NM / LP / MP / HP / DMG) and quantity,
  with automatic per-condition valuation.
- **Trade Analyzer** — compare the value of cards given vs. received.
- **Convention Mode** — quick on-the-floor price reporting.
- **CSV import / export** of your collection.

Accounts are handled by **Supabase Auth** (email + password) — the backend
never sees or stores a password, and there is no way to browse or discover
other users' accounts from the app.

---

## Features

| Area | What it does |
|------|--------------|
| Spaces | Physical Storage, Binder Library, and Display Gallery for one collector's room, backed by real box/shelf presets |
| Collection | Browse by set, global name/number search, per-condition quantities and valuation |
| Bulk Add | High-volume entry with live search-as-you-type and quick-add by number |
| Trade Analyzer | Side-by-side give/get value comparison with a fairness verdict |
| Convention Mode | Fast price lookups for use at events |
| Import / Export | CSV round-trip of your collection |

---

## Architecture

```
React SPA  ──HTTP + Supabase JWT──▶  ZIO HTTP API  ──Doobie──▶  PostgreSQL
 (web/)                               (poketracker-v2/)             │
        │                                    │                     └─ cached catalog: sets, cards, prices
        └──▶ Supabase Auth (sign-up/login)   └──▶ pokemontcg.io (catalog source, on cache miss)
                                              └──▶ TCGTracking (per-condition price source)
```

- The frontend never talks to the database directly, and never calls
  pokemontcg.io/TCGTracking directly — it only talks to the backend API.
- The frontend authenticates against **Supabase Auth**, then sends the
  resulting access token as a bearer token on every backend request.
- The backend verifies that token itself (HS256, against the Supabase
  project's JWT secret — no network call to Supabase per request) and uses it
  to provision/resolve a local profile row, which is what collections,
  binders, and storage actually reference. See **Authentication** below.

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
- Hand-rolled HS256 JWT verification for Supabase access tokens (no external JWT library)
- PostgreSQL
- Packaged with Docker

**Infrastructure**
- Railway (frontend and backend services + managed PostgreSQL)
- Supabase (Auth only — collection data stays in the app's own PostgreSQL)
- Upstream card data from pokemontcg.io; upstream pricing from TCGTracking

---

## Authentication

Sign-up and sign-in go straight to Supabase Auth (`supabase.auth.signUp` /
`signInWithPassword`) — the backend never handles a password. Once Supabase
issues a session, the frontend sends its access token as a bearer token on
every API call; the backend (`security/AuthGuard.scala`) verifies that token's
signature locally and resolves (or provisions, on first sign-in) a matching
profile row in its own `users` table via `GET /api/auth/me`.

The same guard also closes an authorization gap: almost every endpoint is
scoped by a `userId` path segment (`/api/spaces/:userId/...`,
`/api/binders/:userId/...`, etc.), and `AuthGuard` rejects any request whose
path `userId` doesn't match the authenticated caller — a collector can only
ever read or write their own data. A few endpoints keyed only by an internal
object id (`/api/storage/boxes/:id`) are authenticated but not yet
ownership-checked at that layer; see `AuthGuard.scala`'s header comment for
the exact scope.

**Setting it up on your own Supabase project:**

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Project Settings → API: copy the **Project URL** and **anon public key**
   into `web/.env.local` (local dev, copy from `web/.env.example`) or
   `web/.env.production` (deployed build) as `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY`.
3. Project Settings → API → JWT Settings: copy the **JWT Secret** and set it
   as the backend's `SUPABASE_JWT_SECRET` environment variable (Railway, or
   your local shell).
4. Run `poketracker-v2/sql/migration_011_supabase_auth.sql` against your
   database (see **Deployment** below for the production caveat).
5. Authentication → Providers → Email: confirm email/password sign-up is
   enabled. Toggle "Confirm email" off if you want new accounts to be usable
   immediately instead of requiring an email confirmation link.

---

## Repository Structure

```
tcg/
├── web/              # React + TypeScript + Vite frontend — the ACTIVE frontend
├── poketracker-v2/   # Scala 3 + ZIO backend (Dockerized) — the ACTIVE backend
│   ├── src/main/scala/com/poketracker/
│   │   ├── models/       # Plain data shapes (what a "Card" or "User" IS)
│   │   ├── repository/   # All database SQL lives here, and ONLY here
│   │   ├── service/      # Business rules — the "why," not the "how to store it"
│   │   ├── api/          # HTTP routes — translates web requests into service calls
│   │   ├── security/     # Supabase JWT verification + per-request authorization
│   │   ├── config/       # Database connection + auth secret setup
│   │   └── Main.scala    # Entry point — wires everything together and starts the server
│   └── sql/schema.sql    # The full database structure, run once to set it up
├── V3/               # An abandoned rewrite attempt — historical only, do not build on this
├── files/            # An even older legacy Node.js prototype — historical only
├── BUGS.md           # Tracked known issues
└── README.md         # This file
```

`V3/` and `files/` are **not** part of the running app — they're kept around
for historical reference only. All new work happens in `web/` and
`poketracker-v2/`.

---

## API

Base path: `/api`. User scoping is by `userId` in the path. Every endpoint
below except the catalog routes requires a `Authorization: Bearer <supabase
access token>` header — see **Authentication**.

**Auth**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me` | Provision/return the profile linked to the caller's Supabase session |

**Catalog** (public, no auth required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sets` | All sets |
| GET | `/api/cards/:setId` | Cards in a set, with prices |
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
| GET | `/api/spaces/:userId` | List spaces |
| POST | `/api/spaces/:userId` | Create a space |
| POST | `/api/spaces/:userId/storage-units` | Add a shelf/rack/cabinet unit |
| PUT | `/api/spaces/:userId/boxes/:boxId/placement` | Place a box on a unit |
| PUT | `/api/spaces/:userId/binders/:binderId/placement` | Place a binder on a unit |
| POST | `/api/spaces/:userId/display-cases` | Add a display case |
| PUT | `/api/spaces/:userId/display-cases/:caseId/lights` | Toggle case lighting |
| GET | `/api/spaces/:userId/inventory` | Full inventory across the space |
| GET/POST/DELETE | `/api/spaces/:userId/allocations...` | Assign/move/remove copies into drawers, cases, binder slots |

**Binders**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/binders/:userId` | List binders |
| POST | `/api/binders/:userId` | Create a binder |
| GET | `/api/binders/:userId/:binderId` | Get one binder |
| PUT | `/api/binders/:userId/:binderId` | Update a binder |
| DELETE | `/api/binders/:userId/:binderId` | Delete a binder |
| PUT | `/api/binders/:userId/:binderId/slot/:slotIndex` | Set/clear a slot |

**Physical Storage**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/storage/:userId/boxes` | List boxes with their drawers |
| POST | `/api/storage/:userId/boxes` | Create a box |
| PUT / DELETE | `/api/storage/boxes/:boxId` | Rename/reorder or delete a box |
| POST | `/api/storage/boxes/:boxId/drawers` | Create a drawer |
| PUT / DELETE | `/api/storage/drawers/:drawerId` | Rename/reorder or delete a drawer |
| GET | `/api/storage/drawers/:drawerId/cards` | Cards in a drawer |
| GET | `/api/storage/:userId/unassigned` | Owned cards with no drawer |
| POST | `/api/storage/:userId/assign` | Bulk-assign cards to a drawer |
| DELETE | `/api/storage/:userId/assign/:cardId` | Unassign a card |

**Profile**
| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/users/:userId/location` | Update location |

**Rip Tracker** (schema exists, backend service/routes exist, **not yet wired
into the live server** — see `poketracker-v2/.../api/RipRoutes.scala` header
for exactly what's blocking it) — box-opening EV/verdict math, not reachable
over HTTP yet.

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
| `SUPABASE_JWT_SECRET` | From Supabase → Project Settings → API → JWT Settings — verifies session tokens |
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

The dev server proxies `/api/*` to your local backend (see
`web/vite.config.ts`) — no CORS setup needed. Open the printed URL, create an
account, and you're in.

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
sbt test
```

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

**Known issues**
- A handful of storage endpoints keyed by an internal box/drawer id (not by
  `userId`) are authenticated but not yet ownership-checked — see
  `security/AuthGuard.scala`.
- Binder image cropping: card images in binder slots are cropped at the edges.
- Trade Analyzer "Quick Add from Collection" panel is stubbed.

**Roadmap**
- Ownership-check the remaining internal-id-keyed storage endpoints.
- Wire the Rip Tracker (box-opening EV/verdict) into the live server.
- Per-card detail view with purchase-price tracking and price-history charts.
- TCGplayer "last sold" pricing, broken out by condition.

See [`BUGS.md`](./BUGS.md) for full detail.

---

## License

<!-- TODO: choose a license (e.g. MIT) and add a LICENSE file -->
_Not yet licensed._
