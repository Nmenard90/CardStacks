# BUGS

## Open

### BUG-001: Price provider needs real-source verification

- Status: Open
- Severity: High
- Area: Price Sync
- Found: 2026-07-03
- Notes: TCGplayer API key is not available. Price sync is designed around a configurable Open TCG / TCGTracking-style provider, but must be tested against the user's exact API source.
- Next step: Add a real response fixture from the user's pricing API and update `open-tcg-price.provider.ts` mapping.

### BUG-002: Import upload UI is not finished

- Status: Open
- Severity: Medium
- Area: Import/Export
- Found: 2026-07-03
- Notes: Backend services and route scaffolding exist, but the web file upload flow needs UX polish and real browser testing.
- Next step: Add drag/drop CSV/XLSX upload page and row-level import results.

### BUG-003: Google login requires Supabase dashboard setup

- Status: Open
- Severity: High
- Area: Auth
- Found: 2026-07-03
- Notes: Code supports Supabase Google OAuth, but Supabase provider settings and redirect URLs must be configured manually.
- Next step: Configure Supabase Auth providers and Railway/public URLs.

## Fixed

No fixed bugs yet.

## Suspected / Watchlist

- Variant naming may require adjustment after real Open TCG SKU data is tested.
- Large XLSX imports should be tested with 10k+ rows for memory usage.
- Search indexing should be verified after first production-sized catalog sync.
