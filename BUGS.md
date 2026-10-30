# PokéTracker — Bug Tracker

Living list of known bugs and defects. Add new entries at the bottom of the
relevant section, or drop them in **Triage** if severity isn't known yet. Keep
IDs sequential and never reuse a number.

**Status:** `OPEN` · `IN PROGRESS` · `FIXED` · `WONTFIX` · `NEEDS REPRO`
**Severity:** `S1` blocker/crash · `S2` correctness · `S3` minor/UX · `S4` hygiene/docs · `ENH` enhancement

_Last updated: 2026-10-29._

---

## Summary

| ID | Sev | Status | Area | Summary |
|----|-----|--------|------|---------|
| 001 | S2 | FIXED | BulkAddPage | Ref + manual re-render counter → stale counts / lost work. Rewritten on a reducer. |
| 002 | S2 | WONTFIX | api/client | `VITE_API_BASE` must be set in Railway frontend env — live app works, confirming it is. |
| 003 | S3 | FIXED | BulkAddPage | `setState` in the search-debounce effect. Restructured into the timeout callback. |
| 004 | S3 | FIXED | BinderPickerModal, CollectionPage, ConventionModePage, OwnedPage | `setState` called synchronously inside effects (cascading renders). |
| 005 | S4 | FIXED | Main.scala (CORS) | Wildcard origin + `allowCredentials` is an invalid CORS pair (latent). |
| 006 | S4 | FIXED | ConventionModePage | React Compiler bailout ("memoization could not be preserved"), line 139. |
| 007 | S4 | FIXED | OwnedPage | `prefer-const` lint error (line 115). |
| 008 | S4 | FIXED | api/cards | Stale doc comment: search is "by name" but also matches numbers. |
| 009 | S2 | FIXED | Search (bulk) | `N/M` number search. Now a set-based lookup with an ambiguity picker. |
| 010 | S3 | FIXED | binder.css | Binder card images cropped left/right (`object-fit:cover`, unconstrained slot). |
| 011 | S2 | FIXED | Collection / catalog | Orphan prevention + repair deployed. (The export blank-rows symptom was actually BUG-014.) |
| 012 | S2 | FIXED | AnalyzerPage | "Quick Add from Your Collection" panel is a placeholder stub. |
| 013 | S3 | OPEN | Styling (all pages) | No central design system; per-page CSS, inconsistent colors + scaling. |
| 014 | ENH |OPEN | Import/Export | Export scope picker (set owned/full, collection, binder). Also fixes blank-row export. |
| 015 | S3 | FIXED | Import (UX/docs) | Import format is undocumented. |
| 016 | ENH | FIXED | Bulk search + quick-add | Two number boxes + set selector. Shipped with the BulkAddPage rewrite. |
| 017 | ENH | OPEN | Card detail + pricing | Click-through card view; optional purchase price; price-vs-cost + history. |
| 018 | ENH | OPEN | Pricing data | TCGplayer "last sold" price, per condition. |
| 019 | S2 | FIXED | Pricing / catalog | First-load always showed "no price"; infinite retry on partial matches. Fixed. |
| 020 | S1 | FIXED | Auth (whole backend) | No real authentication existed — any endpoint's `userId` path segment was trusted from the client, and `GET /api/users` publicly listed every registered username. Replaced with Supabase Auth (email+password) + backend JWT verification + per-request ownership checks (`security/AuthGuard.scala`). |
| 021 | S2 | FIXED | Storage (boxes/drawers by internal id) | A handful of endpoints keyed only by an internal object id (`/api/storage/boxes/:id`, `/api/storage/drawers/:id`) are authenticated but not yet ownership-checked — closing this needs a DB lookup per object, not just a path pattern. See `security/AuthGuard.scala` header. Fixed in 1f95bbf (SQL-level ownership checks). |
| 022 | S2 | FIXED | Pricing (PriceService) | A card's price came from a "(Stamped)"/promo sibling sharing its collector number — Generations Geodude 43/83 showed $15 (the stamped promo) instead of ~$0.25. Plain-named products now win. |
| 023 | ENH | IN PROGRESS | Pricing + collection | Per-print pricing (Normal / Holo / Reverse Holo / Poké Ball / Master Ball). Prices + CardTile picker shipped (279a834, migration 014); which print an owned copy is is recorded (Phase 2, condition keys like `"NM · reverse"`). Still to do: a print selector in Bulk Add (Phase 3). |
| 024 | S2 | FIXED | BulkAddPage | Numpad "." silently toggled 1st Edition — mislabeled 783 lots across 692 cards. Shortcut removed, 1st Ed limited to sets that had it (94afb86). |
| 025 | S2 | FIXED | Pricing (PriceService) | Cards with no Normal print (holo rares) took their main price from Reverse Holofoil — unordered pick. 1,082 cards in the audit, e.g. Porygon-Z GE $17.86 instead of $9.06. Now Normal > Holofoil > others, Reverse/1st Ed last. Same fix for the pokemontcg.io fallback order. |
| 026 | S1 | FIXED | Pricing (set matching) | 9 sets were priced from a DIFFERENT TCGTracking set via shared code/release date: Battle Styles→EX Battle Stadium, Lost Thunder→McDonald's 2018, BREAKpoint→Burger King, Black & White→BW Trainer Kit, Call of Legends→TCG Classic, SM/HGSS/WotC promos→wrong sets. Candidates are now verified by card-name agreement (≥30%); cards only take prices from name-agreeing products; sibling sets (Generations: Radiant Collection) are merged in. |
| 027 | S2 | FIXED | Pricing (WotC sets) | Old sets' main price could come from 1st Edition (Shining Charizard Neo Destiny $7,583). Unlimited now ranks ahead of 1st Edition. |
| 028 | S2 | FIXED | Pricing (refresh) | Owned cards only re-priced when someone opened their exact set, so collection values went stale. Background job re-prices every owned set every 6h. |
| 029 | S2 | FIXED | Navigation | Browser back never returned to the previous view — Spaces area/room/unit/case/box, Explore's set and Trade's tabs were component state. Now in the URL; Binder's "← Shelf" returns to the Binder Library (816aeff, 0d6edfa, dfc7538). |
| 030 | S2 | FIXED | Phone layout | Bottom nav bar sat at the TOP on Trade Analyzer and Convention Mode — a blurred header (`backdrop-filter`) became its containing block (0d6edfa, 77c7be7, 8498201). |
| 031 | S3 | FIXED | Phone layout | Sideways scroll / clipping at 390px: Analyzer and Convention headers, Explore stats row, Trade browser toolbar, Binder header, Add Cards copies box (0d6edfa, 93a58b5, 747750d, dfc7538). |
| 032 | S2 | FIXED | Catalog | English sets TCGplayer sells but pokemontcg.io lacks were missing (e.g. XY Trainer Kit — Tierno 20/30). Added from TCGTracking as `tt` sets in the Pokémon game (3c470a5). |
| 033 | S3 | FIXED | Catalog | "Code Card" products (online redemption codes) were imported as cards in TCGTracking sets. Import skips them; 34 unowned rows deleted in production (0d6edfa). |
| 034 | S2 | FIXED | Trade list | Cards could only be listed one at a time (unusable with thousands of cards), trade tiles looked unlike the rest of the site, and the Artist sort didn't show the artist. Bulk list/remove (Select all, every copy / extras only / 1 of each, make-an-offer or % of market), OwnedCardTile everywhere on trade + share pages, artist on trade card views (53a4f98). |
| 035 | S2 | FIXED (branch `feat/3d-room`) | 3D room | Prototype room bugs found porting it to the site: drei `<Html>` React-19 unmount errors and its overlay catching canvas taps (display cards unclickable), cabinet glass blocking taps, broken phone status chip, camera too far on tall screens, phone-landscape overlaps, raw box types as labels, TCGplayer art blank in WebGL (no CORS → `/card-art` relay). See docs/agent-reports/room3d-landing. |
| 036 | S2 | FIXED (branch `feat/3d-room`) | Shop | Two overlapping trade flows (share-link Trade page + Shop) and the live shop said "Sales only · no trades", against the owner's rules (trades welcome, no % offers, offers even-or-better). Merged into one shop + My Shop inbox; old `/trade` and `/s/<slug>` links redirect. |
| 037 | S3 | FIXED (branch `feat/3d-room`) | Offers | Offer rows in the inbox ignored their own layout (`.page-tracker button` won on specificity: one non-wrapping line spilling into the detail panel), and My Shop was capped at 760px on desktop. |
| 038 | S4 | FIXED (branch `feat/3d-room`) | Hygiene | ~3,800 lines of dead code (unused pages, Shelf API, never-wired trade/reputation models, template tests), ~500 unused CSS selectors, stale docs and 27 abandoned worktrees / 36 branches. Backed up first; see HANDOFF "Repo cleanup". |

---

## Fixed this session (2026-06-29, session 2)

### BUG-019 — Cards showing "no price"
**Status:** FIXED (backend; needs **Migration 001** run in Railway before deploying)

Two root causes found and fixed:

**Root cause 1 (primary):** `CardService.getCardsBySet`'s first-load branch (`case _ =>`)
fetched prices and stored them in the DB, then `yield result` returned the pokemontcg.io
cards which have `prices = None`. The DB re-read only happened in the "cached, some missing"
branch. Fix: added `withPrices <- repo.findCardsBySet(setId)` after the price fetch and
`yield withPrices` so first load returns prices immediately.

**Root cause 2 (performance/correctness):** If any card in a set has no price row (e.g. promos
not in TCGTracking), every subsequent `GET /api/cards/:setId` call triggered a fresh TCGTracking
round-trip. Fix: added `prices_fetched_at TIMESTAMPTZ` to `card_sets` (Migration 001) and two
new repo methods `isPricesFetchStale` / `markPricesFetched`. The "cached, some missing" branch
now skips the TCGTracking call if prices were attempted within the last 6 hours.

**Additional improvements:**
- `PriceService.findTcgSetId`: added URL-encoding for set names with `&` or spaces; replaced
  silent `catchAll` with explicit logging that shows the raw response body on parse failure and
  lists TCGTracking candidates when no match is found.
- `PriceService.fetchAndStorePrices`: logs product/price/match counts and a sample of unmatched
  card numbers so number-format mismatches are visible in Railway logs.
- New endpoint `GET /api/admin/refresh-prices/:setId`: re-fetches only prices from TCGTracking
  without re-downloading card metadata from pokemontcg.io. Cheaper than `/admin/refresh/:setId`
  when only prices are stale.

**Deploy order:** Run Migration 001 in Railway SQL Editor first, then push. The code degrades
gracefully if the column doesn't exist yet (`isPricesFetchStale` failure defaults to `true`).

---

## Fixed this session (2026-06-29)

### BUG-001 / BUG-003 / BUG-009 / BUG-016 — BulkAddPage rewrite
**Status:** FIXED (frontend; delivered, verify on Railway build)
`BulkAddPage.tsx` was rewritten from scratch and `RecentSidebar.tsx` deleted.
- **State** now lives in a `useReducer` (one immutable source of truth) instead
  of a mutable ref + manual `version` counter. The session count and Save button
  are always accurate (BUG-001).
- **Persistence:** the session is mirrored to `localStorage` per user and
  restored on load, so navigating away or refreshing no longer loses entered
  cards. A "N unsaved · saved locally" note shows in the header.
- **Set selector** added — picking a set makes "add by number" an instant,
  reliable local lookup (and pulls that set's prices).
- **Two number boxes** (`No.` / `Total`) plus a **Name** search (BUG-016).
- **Number search fixed** (BUG-009): no longer uses the broken backend text
  search. With a set selected → local match. Without a set → the total finds the
  set(s), which are loaded and matched locally. Leading zeros (`080` vs `80`) are
  handled. When a number/total matches **multiple** sets (numbers aren't globally
  unique), the candidates are shown in the dropdown to pick by set name instead
  of guessing. The Name box recognizes `number/total` queries too.
- **Debounced search** no longer calls `setState` synchronously in the effect
  body (BUG-003).
- **Sidebar removed** — the binder sidebar was only used here and was unwanted.
Typecheck + lint clean for this file.

### BUG-011 — Orphaned catalog cards (prevention + repair)
**Status:** FIXED (backend; deployed — `/api/admin/refresh-orphans` returned
`{"setsRefreshed": 0}`, confirming no DB orphans and that the build compiled).
- `CardService.ensureCached(cardIds)` runs on every save; any card with no
  catalog row has its set refreshed from the API (cards + prices). Both
  `CollectionRoutes` save paths call it, so import / bulk / quick-add can no
  longer create orphans.
- `CardRepository.findOrphanedCardIds` + `CardService.refreshOrphans` + endpoint
  `GET /api/admin/refresh-orphans` repair existing orphans in one call.
- **Note:** the originally-reported "missing data in the export" was *not* DB
  orphans — it was the export reading only the current set's cards on the
  frontend. That is fixed by BUG-014. BUG-011's value is preventing genuine
  future orphans (e.g. importing a CSV of an unloaded set).
- *Deferred:* flipping the `/owned` query to LEFT JOIN as a safety net (needs
  `Option` columns + frontend handling). Revisit only if needed.

### BUG-014 — Export scope picker
**Status:** FIXED (frontend; delivered via patch — confirm it's deployed).
Wired the existing-but-unconnected `ExportModal` into `CollectionPage`. Export
options: this set (owned only / full checklist), whole collection (owned), or a
binder. The collection-owned path pulls full card data from `/api/.../owned`,
which is what fixes the blank/$0 rows in exports.

---

## Open — by severity

### S2 — Correctness

**BUG-002 — Production API base URL may be empty** · `web/src/api/client.ts`
`BASE = import.meta.env.VITE_API_BASE ?? ''`; the Vite dev proxy is dev-only, so
a prod build needs `VITE_API_BASE` set. If the live app reaches the backend,
this is effectively fine — verify the Railway frontend env var, then close.

**BUG-012 — Analyzer "Quick Add from Your Collection" is a stub** ·
`web/src/pages/AnalyzerPage.tsx` (~272–282). The panel renders only hint text and
never fetches owned cards. Fix: fetch `getOwnedCards` and render clickable
quick-add tiles wired to the give/get lists.

~~**BUG-019 — Some cards show "no price"**~~ → FIXED (see below)

### S3 — Minor / UX

**BUG-004 — setState synchronously inside effects** · BinderPickerModal (~65),
CollectionPage (~144), ConventionModePage (~95), OwnedPage (~45). Cascading
renders; works today. Restructure each effect so state changes happen in async
callbacks / handlers, not the effect body. (The BulkAddPage instance is fixed.)

**BUG-010 — Binder card images cropped** · `web/src/styles/binder.css` (`.slv img`,
~102). `object-fit:cover` on an unconstrained slot crops the sides. Fix: use
`object-fit:contain`, or give the slot `aspect-ratio:2.5/3.5`.

**BUG-013 — No central design system** · all of `web/src/styles/*`. Per-page CSS
with hard-coded colors/sizes; nothing reads as one product. Fix: one token set
(colors, spacing, radius, type scale), refactor each page to consume it, unify
shared components. Larger effort — scope into stages.

**BUG-015 — Import format undocumented** · `ImportModal.tsx`, `lib/csv.ts`. Import
needs a `Card ID` + `Quantity` column (`Condition` optional, defaults NM) with
IDs like `sv6-66`; none of this is shown. Fix: show expected columns + an example
row, a "download template" CSV, and skipped-row reasons. Pairs with BUG-014.

### S4 — Hygiene / Docs

**BUG-005 — Invalid CORS combination** · `Main.scala` (~130). Wildcard origin +
`allowCredentials = Allow` is rejected by browsers together. Works now (no
cookies; userId is in the URL). Fix: drop `allowCredentials`, or echo the request
origin instead of `*`.

**BUG-006 — React Compiler memoization bailout** · `ConventionModePage.tsx` (~139).
Performance only. Rework the flagged `useMemo`/deps so the compiler preserves it.

**BUG-007 — `prefer-const`** · `OwnedPage.tsx` (115). `list` is `let` but never
reassigned. `eslint --fix` handles it.

**BUG-008 — Stale doc comment** · `api/cards.ts`. Header says search is "by name"
but the backend also matches numbers. Update the comment.

---

## ENH — Enhancements / future work

**BUG-017 — Card detail view + purchase price + price history.** Click a card →
detail view (modal or page); optionally record what was paid (never required);
show price change since purchase and price over time. Needs a `purchases` table
(user_id, card_id, condition, qty, price, purchased_at), `price_history`
snapshots, save/read routes, and a chart (recharts). Largest item — stage it
(detail view → purchase price → history chart).

**BUG-018 — TCGplayer "last sold" price, by condition.** Show TCGplayer last-sold
prices per condition alongside market price. Sourcing this specifically needs
investigation (data availability / terms). Pairs with BUG-017.

---

## Triage — reported, not yet investigated

- (none)


## Pricing outage (2026-10-25)

TCGTracking moved from `https://tcgtracking.com/tcgapi/v1` to
`https://openapi.tcgtracking.com/v1`. The old URL returns HTTP 308 with an
empty body; the Java clients did not follow it, so scheduled pricing ran but
skipped updates. Both client base URLs are corrected. New-host sets/cards/SKU
responses were checked successfully. Deployed as `7a57aec`; Railway build succeeded, 46 tests passed and 5 skipped.
All 182 owned sets were processed after resetting only their refresh timers;
180 sets have new snapshots dated 2026-10-25. Over 32,000 cards received fresh
snapshots across the catalog and public API spot-checks passed. No schema changes.

Remaining coverage/matching gaps: Pokémon Futsal Collection (`fut20`) and Wizards
Black Star Promos (`basep`) were skipped because no candidate set matched. Their
prices remain older. The background job summary still counts skipped attempts
as "re-priced", so verify snapshots rather than trusting that summary.


## Quantity-zero removals (2026-10-25)

Deployed as `07af84a`: Explore hid cards optimistically even when the
backend rejected deleting allocated copies. Delete now clears allocations and
binder mirrors atomically; removing a condition/print clears only its own
placements. Bulk updates no longer silently discard zero quantities. Explore
queues saves per card, rolls back failures, and invalidates shop/owned/share
caches. Five local Postgres regression tests cover auto boxes, binders, displays,
print-specific removal and bulk zero saves; frontend build and changed-file
lint passed. Full backend suite: 51 passed, 5 skipped, 0 failures. No migration.
Live API demo smoke passed (1 -> 0); existing seller inventory was untouched.
Previously failed removals need to be retried.


## Explore price sort / shop profile (2026-10-25)

Implementation: Owned only in All Sets filtered just the current
60-card catalog page, so Price descending could incorrectly say no cards were
owned. Now sorts the full owned feed before paging; a browser regression
uses 60 expensive unowned cards plus three cheaper owned cards and checks
both sort directions. Shop now supports a saved seller name/bio and card
browsing grouped by expansion, with set navigation in the URL.

Migration 020 (shop profile) manually applied and verified in production before
code push. Backend 56 passed / 5 skipped; frontend build and changed-file lint,
4 Open Graph tests and 6 browser scenarios passed. Evidence in
docs/agent-reports/shop-inviting-20261025. Photos remain a separate branch.

## Cleanup, Shop merge (2026-10-29)

Audit of the repo before merging the 3D room (BUG-036..038). Everything is on
branch `feat/3d-room` (cleanup → shop merge → room); live on `main` since 2026-10-29 (`a65a2d3`).
- The shop branches (`feature/shop-branding`, `feature/shop-photos`) were
  replayed onto main. Their layout and trade rules won over main's later
  storefront, which had reintroduced "Sales only"; main's shop name/bio and
  `?set=` filter were kept. The set-grouped storefront and its CardBrowser
  mode were dropped.
- Needs migration 019 (`shop_photos`) verified in production before deploy.
- Backend 66 passed / 1 skipped with all DB suites against a local Postgres
  (schema + migrations 010-020); `web/tests/shop-browser.mjs` 11/11. Evidence:
  docs/agent-reports/cleanup-20261029.
- Still open for a decision: GitHub branches
  `fix/auto-allocation-protection-mismatch` (real duplicate-row bug, not on
  main), `feature/unsorted-holding-box`, `fix/bulk-add-first-edition-sticky-toggle`.

## Site audit, room zoom (2026-10-29)

From the owner's report and `web/tests/site-audit.mjs` run against production
and the branch. All fixed on `feat/3d-room`; report and screenshots:
docs/agent-reports/site-audit-20261029. Live since 2026-10-29 (`a65a2d3`).
- **BUG-039** Room: a tap on a binder/box/display card from across the room
  opened it without zooming in; on a phone the items were too small to read or
  hit, and the desk chair hid the box shelf (a tap there went to Add Cards).
  Now the first tap zooms to the items, framed to fill the free screen, from an
  unblocked angle; the second tap opens one.
- **BUG-040** Explore opened on the newest set even when it isn't released yet
  (ME06, 2026-11-06): broken images and "no price" on every card. Now the
  newest released set.
- **BUG-041** Card images that 404 showed the broken-image icon; now the 🃏
  placeholder.
- **BUG-042** Unknown URLs rendered a blank page; now "Page not found".
- **BUG-043** Explore's "Missing — click to list" tile cut off its number.
- **BUG-044** Phone tap targets under 24 px (demo "Sign out", 📈, auth and
  legal links, room logo); no page heading on Room/Explore/Add/My Shop.
- Still open: 2 eslint errors in `SpacesLivePage.tsx` (pre-existing); main
  bundle chunk > 500 kB warning.
- **BUG-045** (not a bug) A report that production `shop_photos` had only
  5 columns led to migration 021. Checked with psql on 2026-10-29: production
  already has 019's full shape (7 columns, the side check, the primary key,
  0 rows), so 021 is a no-op there; it stays as a safe, additive guard.
- **BUG-046** The live room froze for the owner: their Chrome draws WebGL in
  software. The landing page now detects that and offers Spaces (with how to
  turn acceleration on, and "Open the 3D room anyway"); pixel cap and adaptive
  quality for slow devices.
- **BUG-047** My Shop requests showed only "2× Gloom #44 (NM)" (no set,
  picture, price or where the card is kept) and buyer contacts like
  "Facebook". Now shows card details and locations, links, a Facebook search
  fallback, and the form requires a Facebook profile/Messenger link.
- **BUG-048** BUG-046's fix only told the owner to turn on graphics
  acceleration; the room still had to run without it. The room now draws
  only when something changes, with cheaper lights, shadows and materials
  (see HANDOFF "Room made light enough…"); it opens everywhere WebGL exists.
- **BUG-049** After BUG-048 went live the room looked "very pixelated" on the
  owner's 2560-wide window: the slow-device fallback had lowered the canvas
  resolution for good and turned off edge smoothing. Now only moving frames
  are drawn smaller; still views are full resolution with edge smoothing.
- **BUG-050** My Shop's request cards had no zoom: their pictures were drawn
  without the page's preview, so hovering did nothing while pulling cards.
  Wired in (2026-10-30). Also fixed for every card zoom on phones: a tap opened
  the zoom and the same tap (its click and the stand-in mouse "leaving" the
  picture) closed it at once. Hover now opens/closes it only for a real mouse,
  and the zoom ignores the opening tap's click.
