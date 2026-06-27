# PokéTracker

A full-stack Pokémon TCG collection tracker. Log the physical cards you own — by
condition and quantity — organize them into virtual binders, value the
collection from live market prices, and weigh trades before you make them.

> **Stack at a glance:** React 19 + TypeScript (Vite) frontend · Scala 3 + ZIO 2
> + Doobie + PostgreSQL backend · deployed on Railway.

<!-- TODO: add a live demo link and a couple of screenshots here -->
**Live demo:** _coming soon_ · **API health check:** `GET /health`

---

## Overview

PokéTracker is built for collectors who own real cards and want a single place to
track them. Card and set data is sourced from the [pokemontcg.io](https://pokemontcg.io)
catalog (backfilled locally across 170+ sets) and enriched with per-condition
pricing. The app is organized around a few focused workflows:

- **Browse & search** the full card catalog by set, or search every set at once
  by name or collector number.
- **Bulk add** cards quickly when sorting through a physical pile.
- **Track ownership** by condition (NM / LP / MP / HP / DMG) and quantity, with
  automatic per-condition valuation.
- **Binders** — arrange owned cards into virtual binder pages.
- **Trade Analyzer** — compare the value of cards given vs. received.
- **Convention Mode** — quick on-the-floor price reporting.
- **CSV import / export** of your collection.

---

## Features

| Area | What it does |
|------|--------------|
| Collection | Browse by set, global name/number search, per-condition quantities and valuation |
| Bulk Add | High-volume entry with live search-as-you-type and quick-add by number |
| Owned view | Every owned card across all sets in one place |
| Binders | Create binders and place cards into pages |
| Trade Analyzer | Side-by-side give/get value comparison with a fairness verdict |
| Convention Mode | Fast price lookups for use at events |
| Import / Export | CSV round-trip of your collection |

---

## Tech Stack

**Frontend** (`web/`)
- React 19 + TypeScript, built with Vite
- TanStack Query for server-state caching
- React Router for client-side routing
- Axios API client

**Backend** (`poketracker-v2/`)
- Scala 3
- ZIO 2.1 (effects/concurrency) + ZIO HTTP 3 (server) + ZIO JSON
- Doobie 1.0 (functional SQL) over the PostgreSQL JDBC driver
- PostgreSQL
- Packaged with Docker

**Infrastructure**
- Railway (frontend and backend services + managed PostgreSQL)
- Upstream card/price data from pokemontcg.io

---

## Architecture

```
React SPA  ──HTTP──▶  ZIO HTTP API  ──Doobie──▶  PostgreSQL
 (web/)                (poketracker-v2/)            │
                              │                     └─ cached catalog: sets, cards, prices
                              └──▶ pokemontcg.io (catalog + price source, on cache miss)
```

The backend keeps a local catalog of sets, cards, and prices in PostgreSQL and
falls back to the pokemontcg.io API when something isn't cached yet. The frontend
talks only to the backend API.

---

## Repository Structure

```
tcg/
├── web/              # React + TypeScript + Vite frontend
├── poketracker-v2/   # Scala 3 + ZIO backend (Dockerized)
│   ├── src/          # routes, services, repositories, models
│   └── sql/          # schema.sql
├── files/            # legacy Node.js prototype — not part of the live app
├── BUGS.md           # tracked known issues
└── README.md
```

---

## API

Base path: `/api`. User scoping is by `userId` in the path.

**Catalog**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sets` | All sets |
| GET | `/api/cards/:setId` | Cards in a set, with prices |
| GET | `/api/cards/id/:cardId` | Single card by id |
| GET | `/api/search?q=…` | Search across all sets by name or number |

**Collection**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collection/:userId` | All collection entries |
| GET | `/api/collection/:userId/owned` | Owned cards with full card data |
| GET | `/api/collection/:userId/stats` | Totals: cards, value, sets entered |
| POST | `/api/collection/:userId/:cardId` | Save/update one card's conditions |
| POST | `/api/collection/:userId/bulk` | Save many cards at once |

**Binders**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/binders/:userId` | List binders |
| POST | `/api/binders/:userId` | Create a binder |
| GET | `/api/binders/:userId/:binderId` | Get one binder |
| PUT | `/api/binders/:userId/:binderId` | Update a binder |
| DELETE | `/api/binders/:userId/:binderId` | Delete a binder |
| PUT | `/api/binders/:userId/:binderId/slot/:slotIndex` | Set/clear a slot |

**Users**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users |
| GET | `/api/users/:username` | Look up by username |
| POST | `/api/users` | Create a user |
| PUT | `/api/users/:userId/location` | Update location |

---

## Getting Started

### Prerequisites
- Node.js 20+
- JDK 17+ and sbt
- PostgreSQL 14+

### Frontend
```bash
cd web
npm install
npm run dev        # Vite dev server; proxies /api to the backend
```
Build for production:
```bash
npm run build      # tsc -b && vite build → web/dist/
```

### Backend
```bash
cd poketracker-v2
# create the schema
psql "$DATABASE_URL" -f sql/schema.sql
sbt run            # starts the API on $PORT (default 8080)
```

### Environment variables
| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | backend | PostgreSQL connection string |
| `POKEMONTCG_API_KEY` | backend | pokemontcg.io API key |
| `PORT` | backend | HTTP port (default 8080) |
| `VITE_API_BASE` | frontend build | Backend base URL in production builds |

> In development the Vite proxy rewrites `/api` to the backend, so
> `VITE_API_BASE` is only needed for production builds.

---

## Deployment

Both services deploy on Railway and auto-build on push to `main`. The frontend
builds with Vite and is served as static files; the backend builds with sbt and
runs as a Dockerized JVM process against a managed PostgreSQL instance.

---

## Known Issues & Roadmap

This project is under active development. Known issues and planned work are
tracked in [`BUGS.md`](./BUGS.md); a summary follows.

**Known issues**
- **Catalog persistence (high priority):** cards added via the live API fallback
  aren't yet written back to the local catalog, so they can appear without
  name/number/price in the Owned view and exports until the catalog is refreshed.
- **Binder image cropping:** card images in binder slots are cropped at the edges
  (CSS `object-fit` fix pending).
- **Design consistency:** styling is currently per-page; a shared design-token
  system is planned to unify colors, spacing, and typography.
- **Trade Analyzer "Quick Add from Collection":** panel is stubbed and not yet
  wired to owned cards.

**Roadmap**
- Choose export scope (binder / set / full collection) and document the import
  format in-app.
- Redesign card-number search into separate numerator/denominator inputs.
- Per-card detail view with optional purchase-price tracking and price-history
  charts (cost-basis vs. market over time).
- TCGplayer "last sold" pricing, broken out by condition.

See [`BUGS.md`](./BUGS.md) for full detail, severities, and root-cause notes.

---

## License

<!-- TODO: choose a license (e.g. MIT) and add a LICENSE file -->
_Not yet licensed._
