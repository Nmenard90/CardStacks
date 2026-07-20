# PokéTracker V3 Product Requirements Document

Last updated: 2026-07-19

## 1. Product Overview

PokéTracker is a Pokémon TCG collection-management application designed around rapid physical-card entry and trustworthy inventory data. The web application is the first client; the API and database must remain suitable for future clients.

## 2. Product Goals

- Make adding and updating cards faster than maintaining a spreadsheet.
- Correctly represent card, set, variant, condition, quantity, location, and cost.
- Support large inventories without loading everything at once.
- Provide transparent current/historical values.
- Reproduce the best V2 workflows on the safer V3 architecture.
- Make failures understandable and recoverable.

## 3. Personas

### Casual Collector

Wants to search a card and add one copy quickly without understanding every field.

### High-Volume Collector

Owns thousands of cards and needs bulk entry, filters, pagination, exports, and storage locations.

### Master-Set Builder

Needs card/variant completion and a precise missing list.

### Vendor/Convention User

Needs rapid lookup, condition-aware values, and compact inventory context.

### Administrator

Needs sync visibility, controlled overrides, and safe maintenance tools.

## 4. Functional Requirements

### FR-AUTH — Authentication and Account

- **FR-AUTH-001:** Separate sign-in and sign-up actions.
- **FR-AUTH-002:** Google OAuth may be offered after provider configuration is verified.
- **FR-AUTH-003:** Users can sign out.
- **FR-AUTH-004:** The web app restores and visibly represents auth/session state.
- **FR-AUTH-005:** Protected views do not load private data before auth is resolved.
- **FR-AUTH-006:** The API verifies the bearer token and resolves/provisions the matching `AppUser`.
- **FR-AUTH-007:** Wrong-password errors must never trigger account creation.
- **FR-AUTH-008:** Production startup fails when required Supabase configuration is missing.
- **FR-AUTH-009:** Password recovery/email confirmation states are handled clearly.

### FR-CAT — Catalog and Search

- **FR-CAT-001:** List sets with name, series, release date, symbol/logo, and card totals.
- **FR-CAT-002:** List cards for a selected set using pagination or an equivalent bounded strategy.
- **FR-CAT-003:** Search by name, set, number, or combined filters.
- **FR-CAT-004:** Require at least one meaningful search filter.
- **FR-CAT-005:** Number search must not assume global uniqueness.
- **FR-CAT-006:** Pure numeric numbers may match with leading-zero normalization; alphanumeric values remain exact.
- **FR-CAT-007:** Search results include enough set context to resolve ambiguity.
- **FR-CAT-008:** Card detail includes variants and approved price summaries.
- **FR-CAT-009:** Search queries use indexes appropriate to the chosen strategy.
- **FR-CAT-010:** Public catalog responses exclude raw provider JSON.

### FR-COL — Collection

- **FR-COL-001:** Authenticated users can list only their own collection.
- **FR-COL-002:** Results support pagination, sorting, and filters for set, name/number, condition, variant, storage, and ownership.
- **FR-COL-003:** Quick add creates/increments a deterministic default inventory bucket.
- **FR-COL-004:** Users can choose card, variant, condition, quantity, storage location, and notes.
- **FR-COL-005:** Users can update quantity and metadata.
- **FR-COL-006:** Users can remove an inventory bucket.
- **FR-COL-007:** The API verifies the variant belongs to the card.
- **FR-COL-008:** Quantity is a positive bounded integer.
- **FR-COL-009:** Missing/default storage location uses one canonical representation.
- **FR-COL-010:** Database conflicts and missing rows return distinct errors.
- **FR-COL-011:** Collection summary includes unique cards, total copies, sets represented, and value coverage.
- **FR-COL-012:** Paid price, purchase date, seller/source, and lot notes can be recorded without corrupting aggregate quantities.

### FR-BULK — Bulk Add

- **FR-BULK-001:** Users can choose a set and enter collector numbers rapidly.
- **FR-BULK-002:** Global number searches show candidate cards grouped by set when ambiguous.
- **FR-BULK-003:** Users can stage multiple additions before saving.
- **FR-BULK-004:** Staged work survives a transient request failure.
- **FR-BULK-005:** Keyboard operation supports repeated entry.
- **FR-BULK-006:** Every staged row shows card, set, number, variant, condition, and quantity.
- **FR-BULK-007:** Save returns per-row success/failure, not only a global result.

### FR-BIN — Binders

- **FR-BIN-001:** Create, list, view, rename, describe, and delete owned binders.
- **FR-BIN-002:** Configure supported pocket size.
- **FR-BIN-003:** Add, replace, move, and remove cards in page/slot positions.
- **FR-BIN-004:** Slot number must be within binder pocket size; page/slot values are bounded.
- **FR-BIN-005:** Card/variant relationship is validated.
- **FR-BIN-006:** Product decision: binder placements should normally reference owned inventory; exceptions must be explicit.
- **FR-BIN-007:** Set/change a cover card.
- **FR-BIN-008:** Set private, unlisted, or public visibility.
- **FR-BIN-009:** Generate, rotate, and revoke a share slug.
- **FR-BIN-010:** Public response uses an allowlisted DTO and exposes no user ID, raw JSON, source SKU IDs, or private notes.
- **FR-BIN-011:** Binder pages render uncropped card images with accessible names.

### FR-MASTER — Master Sets

- **FR-MASTER-001:** Select a set and view completion.
- **FR-MASTER-002:** Show missing cards and missing qualifying variants.
- **FR-MASTER-003:** Completion derives from current collection data.
- **FR-MASTER-004:** Clearly define whether promo, language, first edition, reverse, holo, and special finishes count.
- **FR-MASTER-005:** Users can override variant-inclusion rules only through an explicit configuration.

### FR-PRICE — Pricing

- **FR-PRICE-001:** Provider responses are validated from committed sanitized fixtures.
- **FR-PRICE-002:** Products/SKUs map deterministically to internal card variants and condition.
- **FR-PRICE-003:** Sync writes current price and historical snapshot atomically for each mapped price.
- **FR-PRICE-004:** Sync records seen, updated, skipped, failed, and unmapped counts.
- **FR-PRICE-005:** Jobs are protected against overlap.
- **FR-PRICE-006:** Provider requests have timeouts, retry/backoff, and rate-limit behavior.
- **FR-PRICE-007:** UI displays source, currency, fetched time, and missing/stale state.
- **FR-PRICE-008:** Zero is never substituted for unknown value.
- **FR-PRICE-009:** Collection valuation states how many items have usable prices.
- **FR-PRICE-010:** Historical queries are paginated/downsampled as needed.

### FR-IMP — Import

- **FR-IMP-001:** Accept CSV and XLSX through bounded authenticated uploads.
- **FR-IMP-002:** Publish downloadable templates and field definitions.
- **FR-IMP-003:** Validate MIME/type, extension, size, headers, row count, and values.
- **FR-IMP-004:** Match cards using stable IDs when available and documented fallback fields otherwise.
- **FR-IMP-005:** Ambiguous matches are reported, not guessed.
- **FR-IMP-006:** Process in batches and maintain job progress.
- **FR-IMP-007:** Store row number, safe raw-row context, and actionable error.
- **FR-IMP-008:** Support partial success and idempotent retry behavior.
- **FR-IMP-009:** The user's existing collection CSV is used as a required compatibility fixture.

### FR-EXP — Export

- **FR-EXP-001:** Export full collection, selected set, binder, or filtered results.
- **FR-EXP-002:** CSV and XLSX formats share documented columns.
- **FR-EXP-003:** Large exports are streamed/batched.
- **FR-EXP-004:** Escape CSV correctly and neutralize spreadsheet formulas.
- **FR-EXP-005:** Include stable identifiers in addition to human-readable fields.
- **FR-EXP-006:** Export/import round trip preserves supported inventory fields.

### FR-TRADE — Trade Analysis

- **FR-TRADE-001:** Create draft analysis with GIVE and RECEIVE sides.
- **FR-TRADE-002:** Add from catalog or owned collection.
- **FR-TRADE-003:** Track card, variant, condition, quantity, market price, and optional manual price.
- **FR-TRADE-004:** Show both totals and absolute/percentage difference.
- **FR-TRADE-005:** Manual prices are visually distinguishable.
- **FR-TRADE-006:** Save, reopen, rename, complete, and delete analyses.
- **FR-TRADE-007:** “Fairness” language is advisory and transparent, not a guarantee.

### FR-ADMIN — Admin and Access

- **FR-ADMIN-001:** View recent sync runs and errors with pagination/filtering.
- **FR-ADMIN-002:** Grant and deactivate time-bounded access overrides.
- **FR-ADMIN-003:** Calculate effective access in one server-side service.
- **FR-ADMIN-004:** Effective access accounts for role, active override, subscription status, date boundaries, and billing-disabled mode.
- **FR-ADMIN-005:** Admin actions are auditable.
- **FR-ADMIN-006:** Expensive/manual sync actions must prevent duplicate concurrent runs.

## 5. Non-Functional Requirements

### Performance

- Search p95 target under 500 ms for local catalog queries.
- Paginate collection and public binder data where size can grow.
- Avoid complete in-memory files for large import/export.
- Batch worker database writes and provider calls.

### Security

- Verified authentication and resource ownership.
- Explicit public DTOs.
- Rate limits with Railway proxy awareness.
- Secret-safe logs and errors.
- Input/file bounds and formula-injection protection.

### Reliability

- Fail fast on invalid production configuration.
- Observable sync/import jobs.
- Deterministic migrations and builds.
- Partial provider/import failures remain diagnosable.

### Accessibility

- Keyboard-operable primary workflows.
- Labeled controls and meaningful alt text.
- Visible focus and errors.
- Do not communicate state using color alone.

### Maintainability

- Route/service/repository/provider boundaries.
- Strict TypeScript and real linting.
- Tests at relevant layers.
- Current docs and ADRs.

## 6. Release Acceptance Criteria

### Foundation Release

- API, web, and worker build reproducibly from a fresh clone.
- Real linting and meaningful tests run in the quality gate.
- Auth/configuration fails safely.
- Collection/binder data-integrity defects are fixed.
- Railway services have verified health/start behavior.

### Collection Core Release

- Complete catalog available locally.
- Search and bulk-add handle number ambiguity.
- Authenticated collection CRUD works with pagination/filters.
- Existing user CSV can import with actionable results.
- CSV/XLSX export round trip is verified.

### Value and Organization Release

- Verified price sync writes current/history data.
- Collection valuation shows freshness and coverage.
- Binders and sharing meet privacy requirements.
- Master-set completion is accurate.

### Premium Tools Release

- Trade analyzer is complete.
- Convention mode is usable.
- Effective access is enforced server-side.
