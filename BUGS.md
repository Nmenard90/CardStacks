# PokéTracker — Bug Tracker

Living list of known bugs and defects. Add new entries at the bottom of the
relevant severity section, or drop them in **Triage** if severity isn't known
yet. Keep IDs sequential and never reuse a number.

**Status:** `OPEN` · `IN PROGRESS` · `FIXED` · `WONTFIX` · `NEEDS REPRO`
**Severity:** `S1` blocker/crash · `S2` correctness · `S3` minor/UX · `S4` hygiene/docs

How a good entry reads: where it lives, what the user sees, why it happens,
and the intended fix. Fill in what you know; "?" is fine.

---

## Summary

| ID | Sev | Status | Area | Summary |
|----|-----|--------|------|---------|
| 001 | S2 | OPEN | BulkAddPage | Tile state held in a ref + manual `version` bump → conditional hook + stale renders |
| 002 | S2 | NEEDS REPRO | api/client | `VITE_API_BASE` unset in prod → `/api` calls hit wrong origin |
| 003 | S3 | OPEN | BulkAddPage | `setState` called synchronously inside search-debounce effect |
| 004 | S3 | OPEN | BinderPickerModal | `setState` called synchronously inside binder-load effect |
| 005 | S4 | OPEN | Main.scala (CORS) | Wildcard origin + `allowCredentials` is an invalid CORS pair |
| 006 | S4 | OPEN | CollectionPage, ConventionModePage | React Compiler bailouts ("memoization could not be preserved") |
| 007 | S4 | OPEN | OwnedPage | `prefer-const` lint error (line 115) |
| 008 | S4 | OPEN | api/cards | Stale doc comment: search is "by name" but also matches numbers |
| 009 | S2 | NEEDS REPRO | Search (full stack) | `N/M` collector-number search — confirm fixed or still broken |
| 010 | S3 | OPEN | binder.css | Binder card images cropped left/right (`object-fit:cover`, unconstrained slot ratio) |
| 011 | S2 | OPEN | Collection / catalog | Cards added from API fallback aren't persisted → blank Name/Number/Rarity/$0 in export, Owned page, stats |
| 012 | S2 | OPEN | AnalyzerPage | "Quick Add from Your Collection" panel is a placeholder stub — shows nothing |
| 013 | S3 | OPEN | Styling (all pages) | No central design system; per-page CSS, inconsistent colors + scaling |
| 014 | ENH | OPEN | Import/Export | Can't choose export scope (binder/set/collection); import target unclear |
| 015 | S3 | OPEN | Import (UX/docs) | Import format is undocumented — users don't know required columns/format |
| 016 | ENH | OPEN | Bulk search + quick-add | Redesign: split numerator/denominator boxes; decide promo/SWSH handling |
| 017 | ENH | OPEN | Card detail + pricing | Click-through card view; optional purchase price; price-vs-cost + price history |
| 018 | ENH | OPEN | Pricing data | TCGplayer "last sold" price, per condition |

---

## S2 — Correctness

### BUG-001 — BulkAddPage tile state is a ref + manual re-render counter
**Area:** `web/src/pages/BulkAddPage.tsx`
**Status:** OPEN
**Symptom:** Flaky bulk-add behavior; risk of a hook-order crash on login/logout.
**Root cause:** The session grid's source of truth is `tilesRef` (a `Map` in a
`useRef`), mutated in place by every handler, with a `version` `useState` that
gets `bump()`-ed to force re-renders. This produces three linked lint/runtime
violations:
- the `tiles`/`totals` `useMemo` (~line 320) sits *after* the `if (!user) return`
  early return (~line 159), so it's a **conditionally-called hook** (rules-of-hooks).
- refs are read during render in two places (~lines 321 and 387, the
  "×N in session" badge), a stale-render source under the React 19 compiler.
- `version` is flagged as an "unnecessary dependency" — a symptom of the pattern.
**Proposed fix:** Move tiles into real state (`useReducer`, or `useState<Map>`
with immutable updates). Delete `tilesRef` / `orderRef`-as-state / `version` /
`bump()`. Ensure all hooks run before any early return.
**Notes:** Likely the real source of several "weird bulk" reports; may also
resolve BUG-009. Contained to one file.

### BUG-002 — Production API base URL may be empty
**Area:** `web/src/api/client.ts`
**Status:** NEEDS REPRO (verify against live Railway deploy)
**Symptom:** In a production build, every `/api/...` request 404s / hits the
frontend's own origin instead of the backend.
**Root cause:** `const BASE = import.meta.env.VITE_API_BASE ?? ''`. The Vite dev
proxy that rewrites `/api → Railway` only runs in `vite dev`; a production build
relies entirely on `VITE_API_BASE` being set at build time.
**Proposed fix:** Confirm `VITE_API_BASE` is set on the Railway frontend
service. If the live app works, mark FIXED/WONTFIX. Optionally fail loudly in
prod when the var is missing.

### BUG-009 — `N/M` collector-number search
**Area:** full stack — `CardRepository.searchCards` (DB), `CardService.searchCards`
(API fallback), `web/src/lib/cardSearch.ts` (`narrowByCollectorNumber`)
**Status:** NEEDS REPRO
**Symptom:** (Historically) typing a collector number like `119/117` returned
nothing or the wrong card.
**Root cause:** The previously-broken API fallback (`name:*query*` for numeric
queries) now uses `number:N`; the DB query handles `split_part`; the frontend
disambiguates the denominator. The diagnostic readout has been removed.
**Proposed fix:** Hit the live backend with `119/117` (a secret rare) and a few
normal numbers. If broken, capture the exact query + response here. Possible it
was actually BUG-001 manifesting as stale dropdown results.

### BUG-011 — Cards added from the API fallback are never saved to the catalog
**Area:** save path (`bulkSave` / collection save) + catalog (`cards`/`card_prices`),
surfaced by `findByUserWithCards` JOIN (Owned page, export, stats)
**Status:** OPEN
**Symptom:** In the test export, **92 of 165 rows are blank** — Name, Number,
Rarity empty and Market Price $0. Every blank row is from set **`sv6`**. The
same cards will show blank / $0 on the Owned page and contribute $0 to stats.
**Root cause:** When a card is added that came from the pokemontcg.io API
fallback (not already in the local DB), the collection entry is saved with that
`cardId` but the card itself is never upserted into `cards` (and prices never
into `card_prices`). Later the owned/export JOIN finds the entry but no catalog
row, so it returns nulls. `sv6` (Twilight Masquerade) was evidently never
backfilled and got added live.
**Proposed fix:** Two parts —
1. *Prevent new orphans:* on save, upsert the card + prices into the catalog if
   the `cardId` isn't already present (the API fallback already has the full `Card`).
2. *Repair existing orphans:* one-off backfill of `sv6` (and any other missing
   sets) from pokemontcg.io; or a general "fill catalog for any cardId in
   collection_entries but missing from cards" job.
**Notes:** High impact — actual cause of the "missing data" in the export and
silently zeroes out collection value.

### BUG-012 — Analyzer "Quick Add from Your Collection" is a placeholder
**Area:** `web/src/pages/AnalyzerPage.tsx` (~lines 272–282)
**Status:** OPEN
**Symptom:** The panel header promises "Quick Add from Your Collection" but the
body only renders static hint text — there's nothing to add from.
**Root cause:** The panel was stubbed: `cp-grid` contains only a muted
"Search for a card above…" line. It never fetches the user's owned cards. The
modal search beside it queries the whole catalog, not the collection.
**Proposed fix:** Fetch owned cards (`getOwnedCards`) and render them as
clickable quick-add tiles inside `cp-grid`, wired to the give/get lists.

---

## S3 — Minor / UX

### BUG-003 — setState inside the search-debounce effect
**Area:** `web/src/pages/BulkAddPage.tsx` (~line 139)
**Status:** OPEN
**Symptom:** Cascading renders on each keystroke; no visible break today.
**Root cause:** The debounce `useEffect` calls `setHi(0)` (and others)
synchronously in the effect body.
**Proposed fix:** Restructure so the effect only schedules the timeout; reset
highlight in the `onChange` handler or inside the timeout callback. (Will likely
fold into the BUG-001 refactor.)

### BUG-004 — setState inside the binder-load effect
**Area:** `web/src/components/BinderPickerModal.tsx` (~line 65)
**Status:** OPEN
**Symptom:** Cascading renders when the modal opens.
**Root cause:** `setLoading(true)` is called synchronously in the effect body
before the async `listBinders` call.
**Proposed fix:** Set loading state as part of the same async flow, or guard so
the effect only kicks off the fetch.

### BUG-010 — Binder card images cropped on the left/right
**Area:** `web/src/styles/binder.css` (`.slv img`, ~line 102)
**Status:** OPEN
**Symptom:** Cards placed in a binder have their left and right edges cut off.
**Root cause:** `.slv img { width:100%; height:100%; object-fit:cover }` fills the
slot, and the slot isn't constrained to a card's 2.5:3.5 aspect ratio, so the
image scales to fill the (narrower) slot height and crops the sides.
**Proposed fix:** Either set `object-fit:contain` on `.slv img`, or give the slot
container `aspect-ratio:2.5/3.5` (as `.pcd` at line 138 already does for the
picker grid) so width/height match the card and nothing is cropped.

### BUG-013 — No central design system
**Area:** all of `web/src/styles/*` (analyzer.css, binder.css, convention.css,
shelf.css, tracker.css) and inline styles across pages
**Status:** OPEN
**Symptom:** Sections look unrelated — different colors, fonts, and scale per
page; nothing reads as one product.
**Root cause:** Each page ships its own CSS file with hard-coded colors and sizes
(e.g. binder.css uses `#1c1c24`/`#fff`/`'Inter'` directly instead of the shared
`var(--*)` tokens that tracker.css defines). No shared tokens, spacing scale, or
component classes.
**Proposed fix:** Define one token set (colors, spacing, radius, type scale,
font) in a single place; refactor each page's CSS to consume the tokens; unify
shared components (buttons, cards, headers, panels). Larger effort — worth
scoping into stages.

### BUG-015 — Import format is undocumented
**Area:** `web/src/components/ImportModal.tsx`, `web/src/lib/csv.ts`
**Status:** OPEN
**Symptom:** Users don't know what file/columns import expects or where the data
lands.
**Root cause:** `parseImport` requires a `Card ID` column and a `Quantity`
column (`Condition` optional, defaults NM), and matches card IDs against the
pattern `setcode-number` (e.g. `sv6-66`). None of this is surfaced in the UI.
**Proposed fix:** Show the expected columns + an example row in the modal, link a
"download template" CSV, and report skipped-row reasons. Tie into BUG-014.

---

## S4 — Hygiene / Docs

### BUG-005 — Invalid CORS combination
**Area:** `poketracker-v2/.../Main.scala` (CORS middleware, ~line 130)
**Status:** OPEN
**Symptom:** None today; latent. Any future cookie/credentialed request fails.
**Root cause:** `allowedOrigin = _ => Some(...All)` (wildcard `*`) combined with
`allowCredentials = Allow`. Browsers reject `*` + credentials together.
**Proposed fix:** Either drop `allowCredentials` (current model passes `userId`
in the URL, no cookies) or echo the specific request origin instead of `*`.

### BUG-006 — React Compiler memoization bailouts
**Area:** `web/src/pages/CollectionPage.tsx` (~142), `ConventionModePage.tsx` (~95, ~139)
**Status:** OPEN
**Symptom:** Lint "Compilation Skipped: Existing memoization could not be
preserved." Performance only, not correctness.
**Proposed fix:** Rework the flagged `useMemo`/dependency so the compiler can
preserve it. Low priority.

### BUG-007 — `prefer-const` lint error
**Area:** `web/src/pages/OwnedPage.tsx` (line 115)
**Status:** OPEN
**Root cause:** `list` is declared `let` but never reassigned.
**Proposed fix:** Change to `const` (eslint `--fix` handles it).

### BUG-008 — Stale doc comment in cards API
**Area:** `web/src/api/cards.ts`
**Status:** OPEN
**Root cause:** Header says search is "by name" but the backend also matches
collector numbers.
**Proposed fix:** Update the comment to reflect name + number search.

---

## ENH — Enhancements / redesigns (feature requests, not defects)

### BUG-014 — Choose what to export / where to import
**Area:** `CollectionPage` import/export, `web/src/lib/csv.ts`
**Status:** OPEN
**Want:** Pick the scope of an export — a single binder, a set, or the whole
collection — instead of one undifferentiated "Export CSV." On import, make it
clear what the data merges into.
**Notes:** Pairs with BUG-015 (format docs). Needs UI (scope picker); the
backend already exposes owned/by-set data to build the rows.

### BUG-016 — Redesign bulk search + quick-add (numerator / denominator)
**Area:** `web/src/pages/BulkAddPage.tsx` search + quick-add inputs,
`web/src/lib/cardSearch.ts`
**Status:** OPEN
**Want:** Replace the single text box with two boxes — left = card number,
right = set total — e.g. `188 | 236`. Open question: how to handle promos like
`SWSH158` that have no denominator.
**Direction (proposed):** Make both boxes *text* (not numeric); right box
optional and labelled "/ total (optional)". Left box matches the card's `number`
field; right box matches the set printed total and is only a disambiguator.
- Standard `188/236` and secret rares `245/236` → both boxes.
- Subset cards `TG12/TG30`, `GG01/GG70` → left box (`TG12`) matches; the right
  box won't map to a real set total, so treat as left-box-only too.
- Promos `SWSH158`, `SVP-001`, `SM210` → type in the left box, leave right empty;
  name search stays the primary path since people rarely know promo numbers.
**Decision needed:** confirm this approach (text boxes + optional right) vs. a
type toggle (Standard / Promo / Subset). See chat for full reasoning.

### BUG-017 — Card detail view + purchase price + price history
**Area:** new card detail route/modal; backend `purchases` + `price_history`
tables; `web/` charting (recharts)
**Status:** OPEN
**Want:**
- Click a card to open a detail view (modal or its own page), not just the big
  image overlay.
- Optionally record what was paid (purchase price) — never required.
- Show price change since purchase (cost basis line) and price over time.
**Notes:** Matches the long-standing purchase-price + price-graph asks. Needs a
`purchases` table (user_id, card_id, condition, qty, price, purchased_at),
`price_history` snapshots, save/read routes, and a chart. Largest item — scope
into stages (detail view → purchase price → history chart).

### BUG-018 — TCGplayer "last sold" price, by condition
**Area:** backend `PriceService` + price storage; surfaced on card detail/tiles
**Status:** OPEN
**Want:** Show TCGplayer last-sold prices, broken out per condition
(NM/LP/MP/HP/DMG), alongside market price.
**Notes:** Current `PriceService` scrapes per-condition prices from another
source; sourcing "last sold" specifically from TCGplayer needs investigation
(data availability / terms). Pairs with BUG-017's detail view.

---

## Triage — reported, not yet investigated

_Add new bugs here with a one-line description; promote to a severity section
once root cause is understood._

- (none yet)
