# PokéTracker V3 Business Requirements Document

Last updated: 2026-07-19

## Executive Summary

PokéTracker V3 will turn an existing portfolio project into a reliable collection-management product. It combines high-volume inventory entry, card/variant/condition data, virtual binders, market values, historical prices, master-set progress, and trade analysis in one platform.

The immediate business objective is not maximum monetization. It is to establish a trustworthy, impressive, deployable core that demonstrates senior-level product engineering and can later support paid collector and vendor capabilities.

## Business Problem

Collectors currently use spreadsheets and multiple websites because many tools are weak in at least one of these areas:

- fast physical-card entry
- accurate variant/condition inventory
- large-collection performance
- flexible exports
- binder organization
- master-set completion
- transparent pricing history
- trade comparison

The existing V2 proves the usefulness of several workflows, but its architecture and deployment path are not the desired long-term foundation. V3 has a stronger data model and service structure but does not yet reproduce the complete user value.

## Business Objectives

1. Deliver a stable portfolio-quality production application.
2. Reduce card-entry friction enough that users will track real inventories.
3. Keep collection and pricing data trustworthy and portable.
4. Build an API foundation reusable by future clients.
5. Establish a clear path to optional Collector Pro and Vendor Pro plans.
6. Avoid another full rewrite by completing V3 in controlled increments.

## Stakeholders

- Product owner/developer
- Collectors
- Master-set builders
- Vendors/convention users
- Future collaborators or employers reviewing the codebase
- External catalog and pricing providers
- Railway and Supabase as infrastructure dependencies

## Business Requirements

### BR-001 — Trustworthy Inventory

The system must preserve accurate ownership by user, card, variant, condition, quantity, and storage location. Mutations must not silently create unintended duplicate buckets or modify another user's data.

### BR-002 — Fast Entry

The system must support both simple quick add and high-volume bulk entry. Search and number handling must reflect real Pokémon collector-number ambiguity.

### BR-003 — Data Portability

Users must be able to import and export collection data in documented CSV/XLSX formats, including row-level failure feedback.

### BR-004 — Trustworthy Valuation

Displayed values must come from a verified source mapping and include freshness/source context. Missing or stale data must be visible rather than shown as a misleading zero.

### BR-005 — Organization and Sharing

Users must be able to organize cards into virtual binders and intentionally share selected binders without exposing private account or provider data.

### BR-006 — Progress and Decision Support

The system must support master-set progress and trade comparison using the same underlying catalog, variant, condition, and price models.

### BR-007 — Operational Visibility

Admins must be able to inspect sync/import failures and resolve access issues without querying production tables manually.

### BR-008 — Sustainable Engineering

Builds, migrations, tests, deployment, and project documentation must be reproducible enough that development can continue without repeatedly rediscovering project state.

## Scope

### In Scope

- authentication and user provisioning
- catalog/set/card search
- collection management and bulk add
- purchase information
- binders and public sharing
- master-set tracking
- current and historical prices
- CSV/XLSX import/export
- trade analysis
- limited convention/vendor workflow
- plans/subscriptions/access overrides
- admin sync visibility
- Railway deployment

### Out of Scope for Initial Release

- card marketplace
- user-to-user payments
- guaranteed authentication/grading of physical cards
- social network features
- native mobile/desktop applications
- games other than Pokémon
- advanced business accounting

## Success Metrics

Initial launch metrics:

- zero known cross-user authorization defects
- successful deterministic build/deploy for API, web, and worker
- core API behavior covered by meaningful automated tests
- complete catalog sync with tracked failures
- successful price sync using verified fixtures and live provider sample
- successful import/export round trip on the user's existing collection CSV
- a user can add 100 cards in a session without losing staged work
- public binder contains only approved public fields
- collection search remains responsive at full catalog size

Later product metrics may include activation, retained collections, cards tracked, binder shares, import success rate, sync freshness, and paid conversion.

## Risks

- Pricing provider format/availability may change.
- Catalog/variant mapping can create silent valuation errors.
- Existing docs may overstate implemented behavior.
- Weak tests can permit regressions while commands remain green.
- Railway proxy/build behavior may differ from local development.
- Import formats can produce ambiguous card matches.
- Monetization work may distract from core reliability.
- Starting another rewrite would delay all user value.

## Assumptions

- PostgreSQL remains the system of record.
- Supabase remains the initial authentication provider.
- Railway remains the initial deployment platform.
- PokémonTCG.io remains suitable for catalog data.
- The project owner can provide sanitized real price-provider fixtures.
- V2 workflows are product references, not production dependencies.

## Release Strategy

### Release A — Trustworthy Foundation

Real linting/tests, secure auth/configuration, deterministic deployment, data-integrity fixes, and operational documentation.

### Release B — Complete Collection Core

Full search, bulk entry, owned view, import/export, and deployed collection management.

### Release C — Organization and Value

Binders, master sets, price sync/history, and collection valuation.

### Release D — Decision and Premium Tools

Trade analyzer, convention mode, subscriptions, and vendor capabilities.
