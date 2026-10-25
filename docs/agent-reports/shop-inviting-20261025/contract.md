# Shop profile, set organization and Explore sort repair

- Visitor job: recognize the seller, browse cards by expansion, find a specific
  card, and send a request without creating an account or paying on the site.
- Owner job: edit the public shop name and multiline bio in Shop requests,
  save it, and follow View my shop to see the result.
- Hierarchy: seller/profile first, compact buying details, search/set/sort,
  named set sections with actual card art, then the request tray. Avoid fabricated
  seller history, reviews, fulfillment promises or scarcity claims.
- Desktop: 1440x900; named set directory plus set previews and View set links.
- Phone: 390x844; native set picker replaces the duplicate directory, card
  previews use two columns, and the first card images remain visible above the tray.
- Set selection lives in the URL, so back restores the previous view.
- Existing flat CardBrowser callers retain the flat layout; shop grouping is opt-in.
- Profile migration 020 is additive and must be verified in production before
  any backend code depending on it is deployed.
- Explore acceptance: Owned only then Price descending sorts the complete owned
  list before paging, even if the first 60 catalog cards are all unowned.
- Rendered fixtures use public catalog/inventory data and a sample bio, not a
  seller profile written on the owner's behalf. All browser API writes are mocked.

Verification: backend suite (56 passed, five skipped); local Postgres profile
and removal suites enabled; frontend build and changed-file lint; four Open Graph
tests; browser checks in web/tests/shop-browser.mjs for both viewports, profile
save/reload/plain text, set navigation/back/search, request success/focus trap,
loading/error/empty/unpriced states and the exact Explore sort regression.

Browser test setup: start Vite with VITE_SUPABASE_URL=https://qa.supabase.co and
VITE_SUPABASE_ANON_KEY=qa-public-test-key. Set PLAYWRIGHT_MODULE to a Playwright
installation (optional when locally resolvable), and optionally
PLAYWRIGHT_CHROMIUM_EXECUTABLE to the Chromium binary. Run
`node web/tests/shop-browser.mjs` with the local server listening on 5178.
