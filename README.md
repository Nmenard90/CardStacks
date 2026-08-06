# PokéTracker

A full-stack Pokémon TCG collection tracker. Log the physical cards you own — by
condition and quantity — organize them into virtual binders and physical
storage boxes, value the collection from live market prices, and weigh trades
before you make them.

> **Stack at a glance:** React 19 + TypeScript (Vite) frontend · Scala 3 + ZIO 2
> + Doobie + PostgreSQL backend · deployed on Railway.

<!-- TODO: add a live demo link and a couple of screenshots here -->
**Live demo:** _coming soon_ · **API health check:** `GET /health`

---

## Read Me First — This Repo Is Documented Line-by-Line

Every source file in `web/` (the frontend) and `poketracker-v2/` (the backend)
has been commented **line by line**, written for someone who has never coded
before. If you open any `.tsx`, `.ts`, or `.scala` file in this repo, you
should be able to read the comments alongside the code and understand what
every single line does and why it's there — no prior programming knowledge
assumed.

A few files are the best starting points if you want to learn how the code
works by reading it:
- `web/src/components/Mascot.tsx` — explains the absolute basics of web code:
  what an HTML element is, what an "attribute" is, why text in quotes is
  called a "string," what a "function" is, what `className` actually does.
  Read this one first, before any other file.
- `web/src/components/Toast.tsx` — explains React "components," "state," and
  "hooks" (the building blocks every other frontend file uses).
- `poketracker-v2/src/main/scala/com/poketracker/models/User.scala` —
  explains the same kind of basics for the Scala backend (what a "case
  class" is, what `Option` means, how JSON conversion works).
- `poketracker-v2/src/main/scala/com/poketracker/repository/UserRepository.scala`
  — explains how the backend talks to the database (SQL queries, ZIO
  effects) in beginner terms.

This README explains the *big picture* — what the app does, how its pieces
fit together, and how to actually get it running on your own computer. The
comments **inside** each file explain the fine-grained "what does this
specific line do."

---

## Overview

PokéTracker is built for collectors who own real cards and want a single place to
track them. Card and set data is sourced from the [pokemontcg.io](https://pokemontcg.io)
catalog (backfilled locally across 170+ sets) and enriched with per-condition
pricing from [TCGTracking](https://tcgtracking.com). The app is organized
around a few focused workflows:

- **Browse & search** the full card catalog by set, or search every set at once
  by name or collector number.
- **Bulk add** cards quickly when sorting through a physical pile.
- **Track ownership** by condition (NM / LP / MP / HP / DMG) and quantity, with
  automatic per-condition valuation.
- **Binders** — arrange owned cards into virtual binder pages.
- **Physical storage** — organize owned cards into virtual boxes and drawers
  that mirror how you actually store your real cards (the "Shelf" view).
- **Trade Analyzer** — compare the value of cards given vs. received.
- **Convention Mode** — quick on-the-floor price reporting.
- **CSV import / export** of your collection.

---

## Features

| Area | What it does |
|------|--------------|
| Collection | Browse by set, global name/number search, per-condition quantities and valuation |
| Bulk Add | High-volume entry with live search-as-you-type and quick-add by number |
| Owned view | Every owned card across all sets in one place, with a List view and a Shelf (physical storage) view |
| Binders | Create binders and place cards into pages |
| Physical Storage | Create boxes and drawers, assign owned cards to them, drag-and-drop reassignment |
| Trade Analyzer | Side-by-side give/get value comparison with a fairness verdict |
| Convention Mode | Fast price lookups for use at events |
| Import / Export | CSV round-trip of your collection |

---

## What Each Piece Of The App Actually Is (Plain-Language Architecture)

If you're not a programmer, here's what "frontend," "backend," and
"database" actually mean in this project, and how a single button click
travels through all three:

- **The frontend (`web/`)** is what you actually SEE and click on — the
  webpage itself. It's written in a language called TypeScript (a stricter
  version of JavaScript, the language almost every website's interactivity
  is written in) using a toolkit called React. The frontend's job is purely
  visual: draw the page, react to clicks, and ask the backend for data —
  it never talks to the database directly.
- **The backend (`poketracker-v2/`)** is a separate program that the
  frontend talks to over the internet (using plain web requests, the same
  underlying technology your browser uses to load any webpage). It's
  written in a language called Scala. The backend's job is to enforce the
  actual RULES of the app ("a username must be unique," "a card's price
  comes from real market data, never guessed") and to read/write the database.
- **The database (PostgreSQL)** is where everything is permanently stored —
  every user, every card, every collection entry. Neither the frontend nor
  the backend "is" the data; the database is the one source of truth, and
  both other pieces just read from and write to it.

**A concrete example — what happens when you click "+1" on a card:**
1. You click the button. The frontend (`web/src/components/CardTile.tsx`)
   notices the click and sends a web request to the backend, roughly saying
   "user X now owns one more of card Y in condition NM."
2. The backend receives that request in a **route** file
   (`poketracker-v2/.../api/CollectionRoutes.scala`) — its only job is to
   understand the incoming request and hand it off.
3. The route hands off to a **service** file
   (`poketracker-v2/.../service/CollectionService.scala`) — this is where
   the actual business RULE lives ("update this card's quantity, and if it's
   never been owned before, look up its real price and set of an ID for it").
4. The service asks a **repository** file
   (`poketracker-v2/.../repository/CollectionRepository.scala`) to actually
   read/write the database — this is the ONLY place in the whole backend
   that contains real SQL (database query language).
5. The database saves the new quantity permanently.
6. The backend sends a response back, and the frontend updates what you see
   on screen to match — no page reload needed.

This "route → service → repository → database" chain is the SAME pattern
used for every single feature in the backend — once you understand it for
one feature, you understand it for all of them.

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
- Upstream card data from pokemontcg.io; upstream pricing from TCGTracking

---

## Architecture

```
React SPA  ──HTTP──▶  ZIO HTTP API  ──Doobie──▶  PostgreSQL
 (web/)                (poketracker-v2/)            │
                              │                     └─ cached catalog: sets, cards, prices
                              └──▶ pokemontcg.io (catalog source, on cache miss)
                              └──▶ TCGTracking (per-condition price source)
```

The backend keeps a local catalog of sets, cards, and prices in PostgreSQL and
falls back to the pokemontcg.io/TCGTracking APIs when something isn't cached yet. The
frontend talks only to the backend API — it never calls pokemontcg.io or
TCGTracking directly, and it never touches the database directly.

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
│   │   ├── api/           # HTTP routes — translates web requests into service calls
│   │   ├── config/        # Database connection setup
│   │   └── Main.scala     # The entry point — wires everything together and starts the server
│   └── sql/schema.sql     # The full database structure, run once to set it up
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

Base path: `/api`. User scoping is by `userId` in the path.

**Catalog**
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
| PUT | `/api/storage/boxes/:boxId` | Rename/reorder a box |
| DELETE | `/api/storage/boxes/:boxId` | Delete a box |
| POST | `/api/storage/boxes/:boxId/drawers` | Create a drawer |
| PUT | `/api/storage/drawers/:drawerId` | Rename/reorder a drawer |
| DELETE | `/api/storage/drawers/:drawerId` | Delete a drawer |
| GET | `/api/storage/drawers/:drawerId/cards` | Cards in a drawer |
| GET | `/api/storage/:userId/unassigned` | Owned cards with no drawer |
| POST | `/api/storage/:userId/assign` | Bulk-assign cards to a drawer |
| DELETE | `/api/storage/:userId/assign/:cardId` | Unassign a card |

**Users**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users |
| GET | `/api/users/:username` | Look up by username |
| POST | `/api/users` | Create a user |
| PUT | `/api/users/:userId/location` | Update location |

**Rip Tracker** (schema exists, backend service/routes exist, **not yet wired
into the live server** — see `poketracker-v2/.../api/RipRoutes.scala` header
for exactly what's blocking it) — box-opening EV/verdict math, not reachable
over HTTP yet.

---

## Getting Started — Running It On Your Own Computer

This section assumes you're starting from nothing. Each tool below is
explained in plain language, not just named.

### What you need installed first

| Tool | What it actually is | Why this project needs it |
|------|---------------------|---------------------------|
| [Node.js](https://nodejs.org) (version 20 or newer) | A program that lets JavaScript/TypeScript code run OUTSIDE a web browser, on your own computer. It also comes bundled with `npm`, a tool for downloading other people's pre-written code libraries. | Needed to run and build the `web/` frontend. |
| [JDK 17+](https://adoptium.net) (Java Development Kit) | The underlying platform Scala code actually runs on top of — Scala compiles down to something the JVM (Java Virtual Machine) can execute. | Needed to run the `poketracker-v2/` backend, since it's written in Scala. |
| [sbt](https://www.scala-sbt.org/download.html) (Scala Build Tool) | A command-line program that reads `build.sbt`, downloads every library the backend depends on, and compiles/runs the Scala code. | Needed to build and run the backend. |
| [PostgreSQL](https://www.postgresql.org/download/) 14+ | The actual database program — a separate piece of software that runs in the background and stores all the app's real data (users, cards, collections) on disk. | Needed so the backend has somewhere to store and read data. |

You'll also want a terminal (Command Prompt, PowerShell, or a Unix shell) —
every command below is meant to be typed into one.

### 1. Get the code

If you don't already have this repository on your computer, download/clone it,
then open a terminal and navigate into its folder (the one containing this
README).

### 2. Set up the database

Once PostgreSQL is installed and running, create a new, empty database for
this app (the exact command depends on your PostgreSQL installation, but
commonly):

```bash
createdb poketracker
```

Then load the app's table structure into that empty database by running the
one provided SQL file against it:

```bash
psql poketracker -f poketracker-v2/sql/schema.sql
```

("Running a `.sql` file" means: PostgreSQL reads that file's text and
executes every command in it — in this case, every `CREATE TABLE ...`
statement that builds the app's data structure. `schema.sql` is safe to run
more than once — it won't error out if the tables already exist.)

### 3. Configure the backend's environment variables

An "environment variable" is just a named piece of text your operating
system makes available to a running program, WITHOUT that text being
written directly into the code — this is how the backend learns things
like your database password without that password ever being committed to
this repository. Set these before starting the backend (how you set them
depends on your terminal — see your shell's documentation for "setting an
environment variable"):

| Variable | Purpose |
|----------|---------|
| `DATABASE_HOST` | Where your PostgreSQL server is running (e.g. `localhost`) |
| `DATABASE_PORT` | PostgreSQL's port (defaults to `5432` if not set) |
| `DATABASE_NAME` | The database you created in step 2 (e.g. `poketracker`) |
| `DATABASE_USER` | Your PostgreSQL username |
| `DATABASE_PASSWORD` | Your PostgreSQL password |
| `POKEMONTCG_API_KEY` | Optional — a free API key from [pokemontcg.io](https://pokemontcg.io) for higher rate limits. The app still works without one, just slower on first-time set loads. |
| `PORT` | Optional — which port the backend listens on locally (defaults to `8080`) |

### 4. Start the backend

```bash
cd poketracker-v2
sbt run
```

The first run will take a while — `sbt` needs to download every library the
project depends on (see `build.sbt`). Once it's ready, you'll see a log line
saying the server started, and it will keep running, listening for requests,
until you stop it (Ctrl+C).

### 5. Start the frontend

In a **second**, separate terminal window (leave the backend running in the first one):

```bash
cd web
npm install
npm run dev
```

`npm install` downloads every frontend library this project depends on (see
`web/package.json`) into a folder called `node_modules` — you only need to
run this once, or again later if the dependency list changes. `npm run dev`
starts Vite's local development server, which will print a URL (usually
`http://localhost:5173`) — open that in your web browser to actually use the app.

In development, the frontend automatically forwards any request it makes to
`/api/...` through to your locally-running backend (see `web/vite.config.ts`)
— you don't need to configure CORS or a backend URL for local development.

### 6. Use the app

Open the URL `npm run dev` printed, and you should see the PokéTracker login
screen. Register a user, and you're in.

### Building for production

```bash
# Frontend — produces static files in web/dist/
cd web
npm run build

# Backend — produces a runnable "fat JAR" (a single file containing the
# compiled program plus every library it needs)
cd poketracker-v2
sbt assembly
```

### Running the backend's automated tests

```bash
cd poketracker-v2
sbt test
```

This runs every test file under `poketracker-v2/src/test/scala/` — small,
self-contained checks that verify specific pieces of logic behave correctly
(see `RipOrHoldEngineSuite.scala` for a heavily-commented example of what an
automated test actually is and how to read one).

---

## Environment Variables Reference

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_HOST` | backend | PostgreSQL server hostname |
| `DATABASE_PORT` | backend | PostgreSQL port (default `5432`) |
| `DATABASE_NAME` | backend | Database name |
| `DATABASE_USER` | backend | PostgreSQL username |
| `DATABASE_PASSWORD` | backend | PostgreSQL password |
| `DB_POOL_SIZE` | backend | Optional — max simultaneous database connections (default `10`) |
| `POKEMONTCG_API_KEY` | backend | Optional — pokemontcg.io API key, for a higher rate limit |
| `PORT` | backend | HTTP port the backend listens on (default `8080`) |
| `VITE_API_BASE` | frontend build | Backend base URL baked into a *production* build (see `web/.env.production`). Not needed for local development — the Vite dev server proxies `/api` to the backend automatically. |

---

## Deployment

Both services deploy on Railway and auto-build on push to `main`. The frontend
builds with Vite and is served as static files; the backend builds with sbt and
runs as a Dockerized JVM process against a managed PostgreSQL instance.

**Important:** `poketracker-v2/sql/schema.sql` migrations are applied
**manually**, through Railway's SQL editor — they do **not** run
automatically on deploy. Backend code that depends on a new column/table must
never be pushed to `main` before that migration has actually been run against
the production database, since Railway auto-deploys backend code on push —
code and schema can otherwise go live out of order and break every query
touching the changed table. See `AGENTS.md` for the full rule.

---

## Known Issues & Roadmap

This project is under active development. Known issues and planned work are
tracked in [`BUGS.md`](./BUGS.md); a summary follows.

**Known issues**
- **Binder image cropping:** card images in binder slots are cropped at the edges
  (CSS `object-fit` fix pending).
- **Design consistency:** styling is currently per-page; a shared design-token
  system is planned to unify colors, spacing, and typography.
- **Trade Analyzer "Quick Add from Collection":** panel is stubbed and not yet
  wired to owned cards.

**Roadmap**
- Wire the Rip Tracker (box-opening EV/verdict) feature into the live server
  once Migration 004 has been run against production.
- Choose export scope (binder / set / full collection) and document the import
  format in-app.
- Redesign card-number search into separate numerator/denominator inputs.
- Per-card detail view with optional purchase-price tracking and price-history
  charts (cost-basis vs. market over time) — price-history data collection has
  shipped; the dedicated detail view has not.
- TCGplayer "last sold" pricing, broken out by condition.

See [`BUGS.md`](./BUGS.md) for full detail, severities, and root-cause notes.

---

## License

<!-- TODO: choose a license (e.g. MIT) and add a LICENSE file -->
_Not yet licensed._
