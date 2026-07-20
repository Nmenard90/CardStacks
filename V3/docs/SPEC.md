# PokéTracker V3 Project Specification

Last updated: 2026-07-19

## 1. Project Summary

PokéTracker V3 is a production-minded Pokémon Trading Card Game collection platform. It allows collectors to find cards, record exactly what they own, organize cards into virtual binders, monitor value over time, import/export large inventories, and compare trades.

V3 replaces the older Node prototype and Scala/React implementation while preserving useful product behavior. PostgreSQL is the source of truth and the API is designed to support future web, mobile, and desktop clients.

## 2. Primary Problem

Collectors commonly track cards using spreadsheets, disconnected pricing sites, or apps that are slow for large inventories and do not model variant, condition, purchase cost, binder placement, master-set progress, and historical value together.

PokéTracker should make high-volume entry fast enough to use while sorting physical cards and make the resulting data reliable enough for collection management, trading, and convention use.

## 3. Intended Users

- Casual collectors who need simple search and quick add.
- Serious collectors with thousands of cards and multiple binders.
- Master-set builders tracking missing cards and variants.
- Vendors who need rapid price lookup and inventory/export tools.
- Parents and younger collectors who need a clear, forgiving interface.
- The project owner/admin who needs sync visibility and manual access overrides.

## 4. Product Principles

- Fast first: common card entry should require minimal clicks.
- Data correctness over superficial polish.
- Explicit variant and condition modeling.
- Safe ownership isolation between users.
- Graceful partial failure for imports and external providers.
- Observable background jobs.
- One backend source of truth for all clients.
- Historical versions inform behavior but do not dictate architecture.

## 5. Required User Workflows

### 5.1 Authentication

Users can create an account, sign in, sign out, recover access, and maintain an authenticated session. The API provisions or resolves an `AppUser` from the verified Supabase subject.

### 5.2 Catalog Discovery

Users can:

- browse sets
- browse cards within a set
- search by card name
- search by set name/code
- search by collector number
- distinguish number matches across multiple sets
- view card detail, image, variants, and prices

Collector numbers are not globally unique. Leading-zero normalization applies only to purely numeric values; alphanumeric numbers remain exact.

### 5.3 Collection Management

Users can:

- quick-add a default copy
- choose variant, condition, quantity, storage location, notes, paid price, and purchase date
- increment/decrement quantity quickly
- update or remove an inventory bucket
- browse, sort, filter, and paginate owned cards
- see collection totals and valuation
- avoid accidental duplicate buckets

### 5.4 High-Volume Entry

A bulk-add workflow supports physical sorting:

- set-scoped exact number entry
- global ambiguous-number candidate selection
- search-as-you-type
- keyboard-efficient quantity entry
- staged changes with clear save status
- recovery from network errors without losing the staged list

### 5.5 Binders

Users can create, rename, describe, delete, and reorder binders; configure pocket size; place owned cards into bounded page/slot positions; remove or move cards; choose a cover; and control private/unlisted/public sharing.

Public binder responses expose only an intentional public DTO.

### 5.6 Master Sets

Users can select a set, define which variants count, see completion percentage, and identify missing cards/variants. Progress must be calculated from owned quantities rather than duplicated mutable totals.

### 5.7 Prices and Value History

The worker retrieves verified provider data, maps provider products/SKUs to internal card variants, stores current prices, and writes historical snapshots. Users can view current value, price history, and collection value history when sufficient data exists.

Price data must always show source, condition/variant assumptions, currency, and freshness.

### 5.8 Import and Export

Users can import CSV and XLSX files using documented templates. Imports validate headers and rows, process large files safely, return row-level errors, and never silently discard data.

Users can export CSV/XLSX for full collection, selected set, binder, or filtered view. Exports are streamed/batched and protected against spreadsheet formula injection.

### 5.9 Trade Analysis

Users can create a give/receive comparison, add cards from the catalog or collection, choose condition/variant/quantity, override prices with clear labeling, and see side totals and difference. Analyses can be saved and later marked completed.

### 5.10 Convention/Vendor Mode

A focused workflow provides fast card lookup, fresh price display, and compact inventory context. Vendor-only capabilities are added only after pricing and access control are trustworthy.

### 5.11 Administration

Admins can inspect sync runs/errors, manage time-bounded access overrides, and run safe maintenance actions. Administrative actions are authorized, audited, and do not expose secrets.

## 6. Technology

- Monorepo: pnpm workspaces + Turborepo
- Language: TypeScript
- API: Fastify
- Validation: Zod
- Database: PostgreSQL
- ORM/migrations: Prisma
- Authentication: Supabase Auth
- Web: React + Vite
- Worker: TypeScript scheduled jobs
- Deployment: Railway
- Catalog provider: PokémonTCG.io
- Price provider: Open TCG/TCGTracking-style API after fixture verification

## 7. Architecture

```text
React Web Client
      |
      | HTTPS + bearer token
      v
Fastify API -----------------------> PostgreSQL
      ^                                  ^
      |                                  |
Future Mobile/Desktop              Worker Jobs
                                         |
                      PokémonTCG.io + verified price provider
```

The browser never connects directly to PostgreSQL. External provider formats are isolated behind provider modules. Public API responses use explicit DTOs.

## 8. Data Scale and Performance Targets

Initial assumptions:

- approximately 30,000+ catalog cards and continued growth
- 170+ sets and continued growth
- individual collections from tens to tens of thousands of inventory buckets
- price history that grows continuously

Targets for cached/local data under normal load:

- search response: p95 under 500 ms
- common authenticated collection mutation: p95 under 750 ms
- first useful search results visible without loading the complete catalog
- exports process large collections without constructing the complete file in memory
- sync jobs use bounded memory and observable progress

These are product targets, not claims about the current implementation.

## 9. Security and Reliability

- Verified authentication on private endpoints.
- Ownership checks for every private resource.
- Fail-fast production configuration.
- Route-specific rate limiting and trusted-proxy configuration.
- Zod validation for all request/provider/import boundaries.
- No secrets or full connection strings in logs.
- Safe public DTOs.
- Formula-injection-safe exports.
- Bounded uploads and row counts.
- Observable sync/import status and errors.
- Reproducible container builds.
- Database migrations committed and reviewed.

## 10. Deployment

Railway services:

- PostgreSQL
- API
- Web
- Worker/catalog schedule
- Worker/price schedule

Deployment order:

1. database migration
2. API
3. Web
4. workers

A service must have a deterministic build and start command. Workers must not be deployed until provider mappings and overlap protection are tested.

## 11. Constraints

- TCGplayer API access is unavailable and cannot be required.
- Existing V1/V2 implementations are reference material only.
- The project owner is developing on Windows and may use Git Bash/WSL.
- Railway is the intended initial host.
- Real credentials remain external to Git.
- The first release must prioritize collection correctness and entry speed over monetization.

## 12. Non-Goals for Initial Release

- Marketplace transactions between users.
- Card grading or authenticity guarantees.
- Automated fake-card determination.
- Social feed or messaging system.
- Native mobile/desktop clients before the API/web product is stable.
- Complex vendor accounting or tax features.
- Supporting non-Pokémon games before the Pokémon model is proven.

## 13. Definition of Success

The first credible release succeeds when an authenticated user can search the complete local catalog, accurately record and manage a large collection, import/export it safely, organize cards into binders, see trustworthy fresh prices, and use the deployed app without cross-user data leakage or silent failures.
