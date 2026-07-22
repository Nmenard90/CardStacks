# MIG-201 — Legacy-to-V3 Product Migration Audit

Status: implementation audit complete; independent provider review required before merge.  
Audit date: 2026-07-21.  
Scope: source-backed comparison of `../web`, `../poketracker-v2`, and the active `V3` applications. No database, deployment, configuration, or historical source was changed.

## How to read this audit

Classifications are: **supported** (working V3 API/schema/worker/UI path exists), **partial** (some layers exist), **missing**, **reimplement** (retain intent, rewrite for V3), **reusable UI/asset**, **obsolete** (must not migrate), and **decision** (product approval required). “Schema proposed” never means approved or migrated.

The legacy frontend is unusually ahead of its backend in places. Trade marketplace types/repositories and reputation models exist, but there are no `TradeRoutes`, `TradeService`, or trade pages. Convention reports are only `localStorage`. These are inventories of intent, not claims of shipped server behavior.

## Executive result and restoration order

1. **MIG-202 — authenticated collection tracker vertical slice.** Restore the set/card grid, set selector, search, owned filter, sorting, condition/variant quantity editing, stats, loading/empty/error states, and responsive visual system against existing V3 APIs. This is first because it restores the collector loop without schema work.
2. **MIG-203 — bulk entry and owned collection.** Restore keyboard-first number/search entry, resumable local draft, atomic/partial save reporting, and the all-owned view. Use V3 variants and conditions; do not revive “1st Ed” as a condition string.
3. **MIG-204 — import/export UX and contract hardening.** Connect existing V3 import/CSV APIs, finish XLSX, formula protection, row-error download, scopes, and browser downloads.
4. **MIG-205 — binder completion.** Add V3 binder UI plus update/delete/cover APIs, enforce page/slot bounds and variant/card consistency, and allowlisted public DTOs.
5. **MIG-206 — pricing and portfolio views.** Expose current/history values in collection UI, establish missing-price semantics and freshness display, and add worker operational acceptance.
6. **MIG-207 — trade analyzer.** Build CRUD/items/calculation APIs and UI on existing `TradeAnalysis` schema; decide snapshot/manual pricing semantics.
7. **MIG-208 — convention mode product decision and, if approved, implementation.** Decide local-private versus server/community reports before schema work.
8. **MIG-209 — marketplace, profile/location, ratings, reports, and moderation decision.** Treat the legacy repository-only marketplace as a new security-sensitive product, not a port.
9. **MIG-210 — admin UI and operational browser coverage.** Add sync/error and access-override UI, auditing, and deployment smoke coverage.

## Source coverage manifest

### Legacy frontend

Every discovered production source module was inspected. Routes are declared in `../web/src/App.tsx`.

| Area | Source modules | Inventory/result |
|---|---|---|
| Shell/routes/session | `App.tsx`, `main.tsx`, `context/UserContext.tsx`, `components/HeaderNav.tsx`, `components/LoginScreen.tsx`, `components/Toast.tsx` | Seven routes; React Query; localStorage user impersonation; persistent last set; shared nav/switch-user and timed notifications. Session behavior is obsolete; layout intent is reusable. |
| Catalog/collection | `api/cards.ts`, `api/collection.ts`, `components/CollectionPage.tsx`, `pages/CollectionPage.tsx`, `components/CardTile.tsx`, `SetSelector.tsx`, `CardPreview.tsx`, `pages/OwnedPage.tsx` | Set browsing, global/set search, collector-number narrowing, card grid, per-condition counts, prices/value, filters/sorts, clear-set, owned aggregate. Two CollectionPage implementations are duplicate/dead-code risk. |
| Bulk/import/export | `pages/BulkAddPage.tsx`, `components/ImportModal.tsx`, `ExportModal.tsx`, `lib/csv.ts` | Keyboard bulk session, local draft, CSV paste/file import, collection/set/binder/checklist exports, browser CSV generation. |
| Binders | `api/binders.ts`, `BinderPickerModal.tsx`, `pages/BinderShelfPage.tsx`, `BinderViewPage.tsx` | Shelf/create/delete, cover upload as data URL, pocket sizes, rename, page-turn animation, slot picker/remove, first-empty quick placement. |
| Analyzer/convention | `pages/AnalyzerPage.tsx`, `ConventionModePage.tsx` | Give/get analyzer with collection picker and market comparison; local-only event price reports/vendor notes, fake-risk checklist, deal score. |
| Domain/helpers | `types/index.ts`, `lib/cardSearch.ts`, `conditions.ts` | Card/set/user/collection/binder/trade/convention shapes; condition multipliers; value math; collector-number parsing. Reuse test cases and UX intent, not wire types. |
| Presentation/assets | `index.css`, `styles/tracker.css`, `binder.css`, `shelf.css`, `analyzer.css`, `convention.css`, `public/favicon.svg`, `public/icons.svg`, `index.html` | Dark tracker design tokens, responsive grids, condition colors, modal/toast/preview, binder animation, social symbol sprite, favicon. CSS and SVGs are candidates subject to brand/accessibility/license review. |
| API transport | `api/client.ts`, `api/users.ts` | Axios, unauthenticated `/api` contract and user-ID-in-path calls. Obsolete and security-unsafe. |

`components/CollectionPage.tsx` and `pages/CollectionPage.tsx` overlap; `App.tsx` imports the page version. Preserve only verified behavior differences during MIG-202, not both modules.

### Legacy backend

Every production Scala module and `sql/schema.sql` was inspected.

| Layer | Source modules | Inventory/result |
|---|---|---|
| Composition/config | `Main.scala`, `config/DatabaseConfig.scala` | `/health`, route composition, PostgreSQL config/layers. Scala/ZIO/Doobie architecture is obsolete. |
| HTTP | `api/CardRoutes.scala`, `CollectionRoutes.scala`, `BinderRoutes.scala`, `UserRoutes.scala` | Catalog/search/admin refresh, collection CRUD/bulk/stats/owned, binder CRUD/slots, public user register/list/lookup/location. Full route ledger below. |
| Services | `service/CardService.scala`, `PriceService.scala`, `CollectionService.scala`, `BinderService.scala`, `UserService.scala` | Lazy catalog caching, provider mapping/price refresh, value snapshots in collection JSON, collection aggregation, binder manipulation, username registration/location/reputation status. Reimplement only intended behavior behind V3 boundaries. |
| Repositories | `repository/CardRepository.scala`, `CollectionRepository.scala`, `BinderRepository.scala`, `UserRepository.scala`, `TradeRepository.scala` | Catalog/prices/cache freshness/orphans; collection upsert/bulk/enrichment; binder slot CRUD; users; marketplace listings/offers/ratings/reports. Trade repository is not exposed by an HTTP/service layer. |
| Models | `models/Card.scala`, `CardSet.scala`, `Collection.scala`, `Binder.scala`, `User.scala`, `Trade.scala`, `Reputation.scala` | Cards/sets/condition price snapshots; sparse binder slots; public user role/location/reputation; marketplace and safety concepts. |
| Database | `sql/schema.sql` | Sets/cards/current condition prices; users; JSON collection entries; binders/slots; listings/offers/ratings/reports; only DB migration marker is set price-fetch timestamp. |
| Tests | `src/test/scala/MySuite.scala` | Placeholder-level legacy coverage; not migration evidence. |

There is no legacy background scheduler. Catalog and price work is request-triggered by `CardService` and unauthenticated admin GET routes. V3’s explicit worker commands are a security and operational improvement.

### Current V3

Inspected all source under `apps/api`, `apps/worker`, `apps/web`, `packages/db`, and `packages/shared` plus their declared entry/config files. V3 supports: authenticated Supabase user provisioning/profile, public catalog/search, collection quick-add/update/delete/summary, master-set progress, CSV import/export, partial XLSX response, binders and sharing, price current/history reads, admin sync/error reads and access overrides, catalog/price worker commands, normalized variants, price snapshots, sync/import observability, subscriptions/access, and trade-analysis storage. The V3 web currently renders only login, search, collection, and import panels in one page (`apps/web/src/App.tsx`); it has no router or production feature parity.

## Route ledger: browser routes and later browser tests

Production hostnames were not present in the permitted source/config manifest and real `.env` files were not read. Substitute the Foreman-managed `WEB_ORIGIN` and `API_ORIGIN` below; recording exact deployed URLs is a deployment-evidence follow-up, not a reason to guess.

| Legacy URL | Screen/workflow | V3 mapping/class | Browser and observable production acceptance |
|---|---|---|---|
| `WEB_ORIGIN/` | Login gate; sets tracker | V3 auth/search/collection APIs exist; UI **partial**, migrate MIG-202 | Deep-link loads without 404; signed-out auth is explicit; signed-in user can select a set, search, add/edit/remove owned variants, refresh, and see persisted server state; no console errors, failed requests, token/user data logs, or React key/state warnings. |
| `/owned` | All owned cards, search/sort/stats/edit | API **partial**, UI **missing** | Owned-only list is paginated/performant, values and missing prices are explained, edits persist, empty/error/loading states accessible. |
| `/bulk` | Keyboard-first number/name batch entry | **reimplement** MIG-203 | Numeric/alphanumeric/leading-zero numbers resolve correctly; duplicate lines aggregate predictably; draft resumes per authenticated user; partial failures preserve unsaved rows; keyboard focus works. |
| `/shelf` | Binder shelf/create/delete | API/schema **partial**, UI **missing** | Owner lists/creates/deletes after confirmation; other users cannot infer private binder existence; cover/pocket validation is enforced. |
| `/binder/:binderId` | Binder page turns and slot editing | API/schema **partial**, UI **missing** | Owner can navigate pages and place/remove valid card variants within bounds; direct foreign ID returns non-disclosing denial; responsive layout and animation honor reduced motion. |
| `/analyzer` | Give/get trade fairness | Schema only, **partial/decision** | User creates, edits, reloads and deletes an analysis; totals use explicit source/fetched time/manual overrides; zero/missing price never masquerades as fair; ownership and quantity rules are defined. |
| `/convention` | On-site deal checker/log | local-only legacy; **decision** | If retained, offline/privacy/sync policy is explicit; price report validation and provenance shown; untrusted community data cannot imply authenticity; local/server clearing is testable. |
| Future `/imports` | Legacy modal; V3 panel | API/UI **partial** | Accepted file size/type/row bounds enforced, formula-safe errors, job belongs to user, imported rows and row errors reconcile. |
| Future `/admin` | No legacy screen | API **partial**, UI **missing** | Admin-only access; run/error visibility; override reason/time bounds/audit/revocation; non-admin gets non-disclosing denial. |
| Future `/share/binder/:shareSlug` | No legacy public route | API **partial**, UI **missing** | Only allowlisted public binder/card fields render; private/unrecognized slugs return 404; no owner email/internal/raw provider JSON. |

Legacy `BrowserRouter` also needs a production SPA fallback for every deep link. Browser-console risks observed in source: localStorage JSON/session can be stale or corrupt; async effects lack cancellation and can update after navigation; global search timers can race; images have weak fallback/empty preview alt; data-URL covers can exceed storage/request limits; right-click decrement is undiscoverable/inaccessible; `window.confirm` and hover-only preview are poor mobile/accessibility UX; duplicate CollectionPage implementations can diverge; legacy APIs expose user IDs and have no auth; client-side CSV can permit spreadsheet formula execution; local convention reports are forgeable; React Query cache may display stale cross-user data after “Switch user”; legacy route error handling often collapses causes to a toast.

## HTTP route mapping

### Complete legacy route inventory

| Legacy route | Behavior/validation found | V3 mapping | Class and gaps | Acceptance criterion |
|---|---|---|---|---|
| `GET /health` | Liveness | `GET /health`, `/api/v1/status` | **supported** | Returns 200 without secrets/DB payload; deployment monitor observes it. |
| `GET /api/sets` | List cached sets | `GET /api/v1/sets` | **supported** | Stable release/name order and allowlisted fields. |
| `GET /api/cards/:setId` | Lazy-fetch set/cards then prices | `GET /api/v1/sets/:setId/cards`; worker sync | **supported/changed** | Reads never trigger provider writes; unknown set 404; worker populates bounded batches. |
| `GET /api/cards/id/:cardId` | Card + prices | `GET /api/v1/cards/:cardId`, variants/prices routes | **supported** | Detail includes valid variants; prices expose source/freshness separately. |
| `GET /api/search?q=` | Minimum 2 chars, UI says cap 60 | `GET /api/v1/search/cards` | **supported** with different max/pagination | Empty/name/set/number behavior documented; rate limited; max 50; leading-zero/alphanumeric tested. |
| `GET /api/admin/refresh/:setId` | Mutating unauthenticated GET | worker `sync-catalog` | legacy **obsolete** | Only authenticated/admin-controlled job trigger if one is added; idempotent observable run. |
| `GET /api/admin/refresh-prices/:setId` | Mutating unauthenticated GET | worker `sync-prices` | legacy **obsolete** | No public mutating GET; worker failure recorded and exits nonzero. |
| `GET /api/admin/refresh-orphans` | Mutating unauthenticated GET | catalog sync recovery | **reimplement if needed** | Recovery is bounded/admin-only/restartable with `SyncRun`/`SyncError`. |
| `GET /api/collection/:userId` | All entries | `GET /api/v1/collection` | **supported**, auth corrected | Identity derives from token; pagination decision required before large-scale UI. |
| `GET .../owned` | Enriched owned cards | collection list includes card/variant | **supported/contract changed** | Only current user; no N+1; explicit pagination/value behavior. |
| `GET .../stats` | copies, unique, value, set count | `GET /api/v1/collection/summary` | **partial** | Define valuation source/condition/variant and missing-price handling; result reconciles to list. |
| `POST .../:cardId` | Replace condition JSON; zero deletes | quick-add + item PATCH/DELETE | **supported/changed** | Variant required; quantity 1..999; ownership and card/variant consistency; zero uses DELETE. |
| `POST .../bulk` | Bulk replaces entries transactionally | import route; no JSON bulk API | **partial** | MIG-203 decides bounded atomic batch endpoint versus client calls; per-row results and idempotency defined. |
| `GET /api/binders/:userId` | Owner list | `GET /api/v1/binders` | **supported** | Token identity, private fields not leaked. |
| `POST /api/binders/:userId` | Name + Four/Nine/Twelve | `POST /api/v1/binders` | **supported/changed** | Name 1..120; pocket 1..12 but product restricts supported layouts. |
| `GET .../:binderId` | Binder + sparse slots | `GET /api/v1/binders/:binderId` | **supported** | Ownership enforced and slots ordered. |
| `PUT .../:binderId` | Rename/cover/resize | none | **missing** | Owner can patch allowlisted fields; validate cover reference/size; resizing collision policy explicit. |
| `DELETE .../:binderId` | Cascade delete | none | **missing** | Owner-only, confirmation UI, cascade atomic; unknown/foreign non-disclosing. |
| `PUT .../slot/:slotIndex` | Place/remove cached card data | V3 page/slot PUT and DELETE | **supported/changed** | Bounds derive from binder layout; card/variant match; no client-cached name/image authority. |
| `GET /api/users` | Public user enumeration/login chips | none | **obsolete/security risk** | Never expose account directory for login. |
| `GET /api/users/:username` | Public lookup/login | `GET /api/v1/me` | **obsolete** | Auth token identifies user; username enumeration unavailable. |
| `POST /api/users` | Register username/email, uniqueness | auth plugin provisions + `/me` | **supported/changed** | Verified auth subject provisions exactly one user; client cannot claim email/role. |
| `PUT /api/users/:userId/location` | Unbounded city location | `PATCH /api/v1/me` lacks location | **decision/missing** | If marketplace approved, owner-only normalized coarse location with privacy controls and length bound. |

### Legacy validation and integrity ledger

These are the material rules actually enforced by the legacy route/service code, including important absences. They are migration inputs, not V3 requirements by themselves.

| Legacy area and source | Rule actually found | V3 disposition and acceptance |
|---|---|---|
| Card search, `api/CardRoutes.scala`, `service/CardService.scala`, `repository/CardRepository.scala` | Rejects queries shorter than two characters; service defaults to at most 60 results; the repository query is parameterized. Collector-number sorting falls back from integer to lexical ordering. | **supported/changed**: V3 validates pagination and rate limits search. MIG-202/203 must test empty, one-character, 50-result boundary, leading-zero, slash, and alphanumeric numbers and must cancel stale browser searches. |
| Binder create/update, `api/BinderRoutes.scala`, `service/BinderService.scala` | Pocket size accepts only `Four`, `Nine`, or `Twelve`; create/rename rejects an empty trimmed name; placement accepts slot indexes `0..1999`. Cover URLs have no scheme/length validation. Removal does not repeat the placement bound check. | **partial/reimplement**: retain supported layouts only after product approval; apply the same server-side bounds to place/remove; bound names and covers; enforce ownership and card/variant identity; do not inherit the arbitrary 2,000-slot cap without a page-limit decision. |
| Collection writes, `api/CollectionRoutes.scala`, `service/CollectionService.scala`, `repository/CollectionRepository.scala` | JSON decode is the principal route validation. A single entry is deleted when every condition quantity is non-positive; bulk drops entries with no positive condition. Upsert uniqueness is `(user_id, card_id)`. No quantity maximum, known-condition allowlist, card existence check at the service boundary, request-size bound, or authorization exists. | **supported/changed/partial bulk**: V3 token ownership, normalized variant/condition uniqueness, quantity `1..999`, bounded imports, and explicit DELETE are authoritative. Any MIG-203 JSON batch must define maximum rows/body, duplicate aggregation, atomicity/idempotency, per-row errors, and reject unknown card/variant pairs. |
| User registration/profile, `api/UserRoutes.scala`, `service/UserService.scala` | Username and email uniqueness are checked and conflicts map to 409; new role is `Collector`; reputation starts at zero. Location must be non-empty after trimming. There is no authentication, email verification/format validation, username/location length bound, normalization, or authorization on location changes. | Legacy login/profile transport is **obsolete**. V3 verified auth subject owns provisioning. If MIG-209 approves profiles, add bounded normalized display/location fields, privacy consent, non-enumerating errors, and concurrency-safe uniqueness. |
| Trade/reputation models, `models/Trade.scala`, `models/Reputation.scala`, `repository/TradeRepository.scala` | Status and reason values are enums; comments require explanation for negative ratings and all reports, but no HTTP/service validation enforces those statements. Price/cash are unbounded `Double`; missing prices total as zero. Repository SQL provides no lifecycle-transition, self-trade/rating/report, completed-trade, duplicate-rating, quantity, currency, or concurrency enforcement. Warning status is merely report count `>=3`; reputation refresh is a placeholder that writes zero. | Marketplace behavior is **missing/decision**, not reusable validation. MIG-209 must define a state machine, decimal money/currency, positive quantities, missing-price semantics, reservation/versioning, rating eligibility/uniqueness, anti-self/duplicate abuse rules, moderation/appeal, and auditable reputation calculation before schema approval. |
| Provider/cache ingestion, `service/CardService.scala`, `service/PriceService.scala` | Provider parsing skips or logs malformed/missing records in several paths; set/SKU matching normalizes names/codes and collector numbers; cached reads may trigger network/database writes; price freshness is six hours. | Read-triggered mutation is **obsolete**. Worker validation must be bounded, observable, restartable, idempotent, preserve record errors, and never attach a provider SKU to an inferred wrong variant. |

### V3-only API capabilities to preserve

`/api/v1/master-sets/:setId/{progress,missing,missing-variants}`, `/api/v1/cards/:cardId/prices/{current,history}`, `/api/v1/imports/collection`, `/api/v1/exports/collection.{csv,xlsx}`, binder sharing/public reads, `/api/v1/admin/sync-runs`, sync errors, and access overrides have no equivalent completed legacy UI. They are not migration leftovers: build UI/acceptance around them. XLSX currently reports not implemented and must remain visibly incomplete until delivered.

## Workflow/component/state/style/asset mapping

| Legacy item | Dependencies | V3 status/class | Security/data integrity and missing work | Explicit acceptance |
|---|---|---|---|---|
| LoginScreen/user chips/local user JSON | public users API, UserContext | **obsolete** | Replace with Supabase explicit auth; clear query caches on account change. | User cannot impersonate by editing URL/storage; expired token returns signed-out state. |
| HeaderNav | router, UserContext | **reusable UI** | Add accessible responsive router/nav; do not copy switch-user semantics. | Every authorized destination is keyboard reachable and active state announced. |
| SetSelector | sets API | **reusable UI** | Preserve grouping/search/all-sets intent; virtualize if catalog grows. | Search, keyboard escape/arrows, no-results, persisted selection work. |
| CardTile + preview | collection, price helpers | **reimplement** | V3 variant+condition model, accessible detail trigger, optimistic rollback. | Exact variant/condition quantity persists; failure restores UI; missing image/price explicit. |
| Tracker page | sets/cards/collection/stats | **partial** | Pagination/server state, rate limits, no full catalog in memory. | Full collector loop passes at production origin and after reload. |
| Global/name/collector search | cardSearch, `/search` | **supported API/reusable behavior** | Cancel stale requests; V3 page/limit; normalize `117/123`, `001`, `TG01`. | Latest query wins and correct set/card resolves without console abort noise. |
| Owned-only/filter/sort/clear set | collection | **partial** | Bulk delete endpoint/transaction decision; destructive confirmation. | Scope is clear; cancel is harmless; confirmed clear deletes only current user/set. |
| BulkAdd reducer/local draft | catalog, bulk collection | **reimplement** | Namespace by auth subject; cap draft; variant required; reconcile partial writes. | Resume, discard, increment/decrement, step size, condition and batch save are deterministic. |
| ImportModal/parser | CSV helper, bulk save | V3 API/UI **partial** | Server parser is authority; file/row bounds; formula/raw-row privacy. | Supported CSV produces job totals; invalid rows downloadable; unsupported file rejected early. |
| ExportModal | collection/catalog/binder, downloadCSV | V3 CSV **partial** | Scope APIs, formula escaping, memory/streaming; XLSX missing. | Download opens in spreadsheet without formulas executing; counts/scope reconcile. |
| Toast | timeout/context | **reusable UI** | Use ARIA live region, dedupe, preserve actionable errors. | Success/error announced and does not hide required recovery. |
| BinderPickerModal first-empty | binder list/detail/slot | **reimplement** | Server should choose/reserve first empty to avoid race. | Concurrent adds never overwrite; full binder is explicit. |
| Shelf create/cover/delete modals | FileReader, binder API | **partial** | Prefer cover card/object storage decision; bound files; missing update/delete APIs. | Create/rename/resize/cover/delete persist with ownership checks. |
| BinderView/page-turn/card picker | catalog/binder slots, resize | **reusable UI/reimplement** | Slot bounds; reduced motion; race-safe writes. | Page count/layout correct for supported pockets; slot state survives reload. |
| Analyzer item/search/collection-picker modals | search, owned, condition prices | schema **partial** | Add owner-scoped services/routes and calculation contract. | Give/receive quantities and prices reconcile and reload; missing price flagged. |
| Convention reports/vendor notes/checklist | localStorage, search/prices | **decision** | Privacy, moderation, provenance, offline sync, authenticity disclaimer. | No community/trust claim without server verification/abuse controls. |
| Condition multipliers (`1,.85,.7,.55,.4`) and “1st Ed” suffix | client helpers | **decision/reimplement** | Do not synthesize prices silently; first edition is a variant/edition, not condition. | Displayed value names source or manual estimate and never mutates stored market data. |
| React Query/local state | TanStack Query/localStorage | V3 lacks server-state layer, **reusable pattern** | Auth-bound cache keys and cancellation. | Signing out removes private cached content; retry does not duplicate writes. |
| CSS systems | six CSS files | **reusable UI/asset** | Consolidate tokens; contrast, focus, mobile, reduced motion. | WCAG-visible focus, 320px layout, no horizontal action loss, animations optional. |
| favicon/social SVG sprite | `public/*.svg` | **reusable asset pending review** | Verify branding, actual use, accessibility and license; unused social sprite may be obsolete. | Approved asset renders without console/network errors and has appropriate accessible name. |

## Backend behavior and data model mapping

| Legacy behavior/module | V3 mapping/class | Concerns and acceptance |
|---|---|---|
| Card repository set/card search/upserts | catalog repository + catalog worker, **supported** | Keep normalized names, numeric and text collector numbers, stable ordering, provider validation and bounded pages. |
| Lazy cache on read and six-hour price freshness | explicit worker + snapshots, legacy behavior **obsolete** | Reads are side-effect free; scheduled runs are non-overlapping/restartable and expose freshness/failures. |
| TCGTracking set/SKU matching and condition price map | OpenTCG provider/current+snapshot tables, **reimplement mappings only when source-backed** | Never infer mismatched variants; currency/source/fetched time required; record-level errors. |
| Collection JSON condition rows with captured price | normalized `CollectionItem`, `PurchaseLot`, prices, **supported/changed** | Historical cost belongs to lots; market value comes from priced variant; do not copy stale price into inventory. |
| Replace/bulk delete-on-zero | quick-add/PATCH/DELETE/import, **partial** | Validate bounds and ownership; transaction/idempotency policy for bulk. |
| Binder cached cardName/image and global slotIndex | relational card/variant + page/slot, **supported/changed** | V3 avoids stale cached metadata; add DB/application bounds and update/delete. |
| Username/email/role/reputation/location | `AppUser` auth subject/email/displayName/role; reputation/location absent | Auth model **supported**; location/reputation **decision**. Never trust URL user ID. |
| Trade listings/offers/status | only legacy model/repository; V3 has private TradeAnalysis | marketplace **missing/decision** | Needs separate lifecycle, authorization, concurrency/acceptance transaction, messaging/privacy and moderation design. |
| Ratings/reports/reputation | legacy models/repository only | **missing/decision** | Prevent self/double/pre-completion ratings, require negative context, appeal/moderation/audit, safe reputation formula. |
| Admin refresh | V3 worker/admin visibility | **supported/changed** | No anonymous mutation; manual trigger, if added, requires admin, audit and overlap lock. |

The repository-only marketplace inventory is complete at the operation level: location-filtered open listing search with a caller-supplied limit; listing lookup and per-user listing history; listing creation and status update; per-listing offer reads; offer creation and status update; rating creation and aggregate reputation calculation; and report creation. These methods depend on legacy `users`, `trade_listings`, `trade_offers`, `trade_ratings`, and `user_reports` tables plus JSON card/want payloads. None has a legacy route or service, so none is evidence of a completed user workflow. All require reimplementation or rejection through MIG-209, with the validation and transaction criteria above.

## Proposed schema changes — separate approval and migration tasks

No migration was run. Each item below must be approved independently with forward migration, backfill, constraints/indexes, rollback/recovery, repository/API tests, and production rollout plan.

| Proposal task | Needed for | Proposed change (not approved) | Product decision/data risk |
|---|---|---|---|
| DB-MIG-BINDER-BOUNDS | MIG-205 | Add positive/check constraints for binder `pocketSize`, slot `pageNumber`, `slotNumber`, quantity; optionally supported-layout enum. | Decide max pages and resize collision handling first. |
| DB-MIG-BINDER-COVER | MIG-205 | Make `coverCardId` a real relation or replace with bounded object-storage asset reference; add update audit if needed. | Card cover vs uploaded art, retention and moderation. |
| DB-MIG-BULK-IDEMPOTENCY | MIG-203/204 | Optional import/bulk idempotency key and request/result ledger. | Required only if retry semantics cannot use existing ImportJob safely. |
| DB-MIG-TRADE-ANALYSIS-SNAPSHOT | MIG-207 | Add calculation currency/source/fetched-at snapshot and optional cash adjustments/version. | Decide live versus frozen valuations and manual override audit. |
| DB-MIG-CONVENTION-REPORTS | MIG-208 | New event, vendor note, price report, provenance/confidence and moderation tables/indexes. | Only if server/community mode approved; privacy/retention/abuse policy blocks it. |
| DB-MIG-PROFILE-LOCATION | MIG-209 | Coarse normalized location/geospatial field plus visibility/consent timestamps. | Marketplace/location sharing must be approved; never store precise location by default. |
| DB-MIG-MARKETPLACE | MIG-209 | Listings, normalized listing items, wants, offers, cash/currency, lifecycle/version and indexes. | New product; avoid legacy JSON blobs; concurrency and reservation rules required. |
| DB-MIG-REPUTATION | MIG-209 | Trade ratings, user reports, moderation actions/appeals, uniqueness/check constraints and audit history. | Legal/safety/moderation ownership and reputation formula required. |
| DB-MIG-ADMIN-AUDIT | MIG-210 | Append-only audit events for access override create/revoke and manual operations. | Define retention and redaction. |

Existing schema is already sufficient for MIG-202’s core tracker, MIG-203’s basic bulk add, catalog/price workers, basic binders, imports, and private trade-analysis drafts. Do not invent migrations for those slices before API/UI gaps are tested.

## Worker/background-job audit

Legacy has no scheduler: card reads may download catalog/prices; admin GETs trigger refresh; repository tracks only per-set price-fetch time. V3 has `sync-catalog` and `sync-prices` command dispatch, Pokémon TCG and OpenTCG provider modules, `SyncRun`/`SyncError`, Railway job configs, entry-point failure exit handling, catalog upserts and price current/snapshot writes.

Production acceptance for both V3 jobs: required env validation fails before writes; only the intended command runs; overlapping-run policy is enforced; provider pages/batches are bounded; malformed records become sanitized per-record errors where recovery is possible; successful rerun is idempotent; run counts reconcile; failures set nonzero exit; no secret/raw sensitive payload appears in logs/admin DTOs; catalog preserves alphanumeric/leading-zero numbers and variant identity; price writes include source/currency/fetched time and never attach a SKU to the wrong variant.

## Current deployed V3 behavior and Railway acceptance

No deployment or browser access was authorized, and no exact production origins were discoverable from the permitted non-secret files. Therefore “current deployed” is recorded conservatively as **not independently observed in MIG-201**. Source and Docker/Railway manifests indicate three deployable surfaces: Fastify API, Vite web, and worker commands. A different provider/deployment owner must attach the exact origins and dated observations.

Minimum current production observation checklist:

- `API_ORIGIN/health` and `/api/v1/status` return 200 with the expected service marker.
- `WEB_ORIGIN/` loads the V3 four-panel shell; Supabase sign-in/provisioning, public search, authenticated collection add/edit/delete, and CSV import are exercised with a non-production-safe test account/data policy.
- Browser network calls use the configured API origin and bearer token only where required; no secret/service-role value reaches the browser.
- Direct navigation and refresh work at every future route listed above after it is introduced.
- Catalog and price Railway jobs run the intended command, produce reconciled `SyncRun` records, exit correctly, and do not overlap.
- API authorization checks deny cross-user collection/binder/import/admin access; public binder output is allowlisted.
- Browser console is free of uncaught errors, mixed-content/CORS failures, 404 assets, React warnings, and sensitive logging.

Per-workflow production criteria are in the route and workflow tables. A source-complete feature is not “deployed accepted” until those observable checks are dated and attached.

## Audit completeness and review gate

Completeness was checked by comparing every discovered legacy frontend production module, all seven declared browser routes, all 23 legacy HTTP routes (including `/health`), every legacy backend model/service/repository/API module, the legacy SQL tables, all V3 registered route modules, Prisma models, worker jobs/providers, and V3 web feature modules against this document.

Required independent review before merge:

1. A provider other than the author rechecks route counts and source paths.
2. Reviewer samples each classification against actual code, especially trade (repository-only), convention (local-only), binder ownership/public DTOs, import/export completeness, price provider mapping, and V3 web limitations.
3. Reviewer records omissions or “no findings”; Foreman must not auto-merge without that review.

## MIG-201 acceptance status

- Legacy frontend routes/screens/components/modals/workflows/state/styles/assets inventoried: **met**.
- Legacy backend routes/services/repositories/models/validation/collection/pricing/trade/profile/admin/jobs inventoried: **met**, including absent route/job distinctions.
- Every item mapped to API/Prisma/worker/frontend support and classified: **met**.
- Security/data-integrity gaps, missing APIs/schema/jobs/UI, restoration order from MIG-202, and workflow acceptance criteria: **met**.
- Schema changes isolated as proposed approval tasks; no migration/database action: **met**.
- Browser/production routes, observable Railway criteria and console risks documented: **met**, exact deployed origins/behavior observation explicitly unavailable.
- Different-provider review: **pending Foreman review; merge blocker**.
